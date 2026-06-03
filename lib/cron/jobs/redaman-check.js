/**
 * Header Doc
 * Purpose: Cron job redaman-check — periodically poll GenieACS untuk semua device, fetch metrik redaman (RX power), filter device dengan signal lebih buruk dari `rx_tolerance`, kemudian kirim notifikasi WA ke admin/operator. State holder `checkTask` ter-encapsulasi di module ini. Function di-export sebagai `startCheck` (legacy name) untuk backward compat dengan `routes/admin-config-routes.js` dan composer.
 * Caller: `lib/cron.js` (composer) via `startCheck`.
 * Deps: `node-cron`, `../shared` (delay, loadCronConfig, safeSendMessage, getNestedValue), `../../wifi` (REDAMAN_PATHS), `../../genieacs` (queryDevices, refreshObjects), `../../templating` (renderTemplate, templatesCache).
 * MainFuncs: `startCheck()` — schedule/restart task redaman check; reload setiap kali dipanggil (idempotent).
 * SideEffects: Jadwalkan job background, panggil GenieACS API (refresh + query devices), kirim WhatsApp ke semua account dengan phone_number valid.
 */
"use strict";

const cron = require('node-cron');

const { delay, loadCronConfig, safeSendMessage, getNestedValue } = require('../shared');
const { REDAMAN_PATHS } = require('../../wifi');
const { queryDevices, refreshObjects } = require('../../genieacs');
const { renderTemplate, templatesCache } = require('../../templating');

let checkTask = null;

function startCheck() {
    // Always stop the existing task first to prevent duplicates or zombies.
    if (checkTask) {
        // Stopping redaman task (silent)
        checkTask.stop();
        checkTask = null;
    }

    try {
        // Get schedule from cron config (moved from config.json to cron.json)
        const cronConfig = loadCronConfig();
        const schedule = cronConfig.check_schedule || '0 */6 * * *'; // Default: every 6 hours
        const isEnabled = cronConfig.status_check_schedule !== false; // Default enabled if not specified

        // Check if disabled
        if (!isEnabled || schedule.startsWith('#')) {
            console.log(`[CRON_REDAMAN] Redaman check task is DISABLED (status: ${isEnabled}, schedule: ${schedule})`);
            return;
        }

        // Validate the schedule
        if (!cron.validate(schedule)) {
            console.error(`[CRON_REDAMAN_ERROR] Invalid cron expression: "${schedule}". Job not started.`);
            return;
        }

        // If we reach here, the schedule is valid, so we create a new task.
        checkTask = cron.schedule(schedule, async () => {
            try {
                // 1. Get all device IDs from GenieACS
                const allDevicesResult = await queryDevices({
                    projection: ['_id'],
                    timeoutMs: 30000,
                    operation: 'cron.redaman.listDevices',
                });
                if (!allDevicesResult.ok) {
                    throw new Error(allDevicesResult.message);
                }
                const allDevices = allDevicesResult.data;
                if (!allDevices || allDevices.length === 0) {
                    // Silent skip if no devices
                    return;
                }
                const deviceIDs = allDevices.map(d => d._id);

                // 2. Batch Refresh: Send refreshObject tasks for redaman paths in parallel
                const refreshPromises = [];
                for (const deviceId of deviceIDs) {
                    refreshPromises.push(
                        refreshObjects(deviceId, REDAMAN_PATHS, {
                            operation: 'cron.redaman.refresh',
                            timeoutMs: 30000,
                        }).catch(err => console.warn(`[CRON_REDAMAN_WARN] Failed to send refresh for device ${deviceId}: ${err.message}`))
                    );
                }
                await Promise.allSettled(refreshPromises);
                const delayAfterRefresh = global.config.genieacsRefreshBatchDelay || 5000;
                // console.log(`[CRON_REDAMAN] All refresh commands sent. Waiting for ${delayAfterRefresh}ms...`);
                await delay(delayAfterRefresh);

                // 3. Batch Fetch: Get only redaman data for all devices in one call
                const projectionFields = REDAMAN_PATHS.join(',');
                const devicesWithRedamanResult = await queryDevices({
                    query: { "_id": { "$in": deviceIDs } },
                    projection: projectionFields,
                    timeoutMs: 30000,
                    operation: 'cron.redaman.fetchMetrics',
                });
                if (!devicesWithRedamanResult.ok) {
                    throw new Error(devicesWithRedamanResult.message);
                }
                const devicesWithRedaman = devicesWithRedamanResult.data || [];

                // console.log(`[CRON_REDAMAN] Fetched data for ${devicesWithRedaman.length} devices. Analyzing...`);

                // 4. Process and notify
                const rxTolerance = parseInt(global.config.rx_tolerance, 10);
                if (isNaN(rxTolerance)) {
                    console.error("[CRON_REDAMAN_ERROR] `rx_tolerance` in config.json is not a valid number. Skipping checks.");
                    return;
                }

                let devicesWithBadRedaman = 0;
                let devicesChecked = 0;
                let devicesSkipped = 0;

                for (const device of devicesWithRedaman) {
                    let redamanValue = null;

                    // Find the redaman value from the possible paths
                    for (const path of REDAMAN_PATHS) {
                        const value = getNestedValue(device, path);
                        if (typeof value !== 'undefined' && typeof value._value !== 'undefined') {
                            redamanValue = value._value;
                            break;
                        }
                    }

                    if (redamanValue === null) {
                        devicesSkipped++;
                        continue; // Skip device if no redaman value found
                    }

                    // Parse redaman value - handle both string and number formats
                    // Support negative values (e.g., -25, "-25", "-25 dBm")
                    let redamanInt;
                    if (typeof redamanValue === 'number') {
                        redamanInt = redamanValue;
                    } else if (typeof redamanValue === 'string') {
                        // Extract numeric value from string (handles formats like "-25", "-25 dBm", etc.)
                        const numericMatch = redamanValue.match(/-?\d+\.?\d*/);
                        if (numericMatch) {
                            redamanInt = parseFloat(numericMatch[0]);
                        } else {
                            redamanInt = parseInt(redamanValue, 10);
                        }
                    } else {
                        redamanInt = parseInt(redamanValue, 10);
                    }

                    if (isNaN(redamanInt)) {
                        devicesSkipped++;
                        continue; // Skip device if redaman value cannot be parsed
                    }

                    devicesChecked++;

                    // Check if redaman is worse than tolerance
                    // Redaman values are typically negative (e.g., -25 dBm, -26 dBm)
                    // More negative values = worse signal quality
                    // Example: if rxTolerance = -24, then -25, -26, -27 are all worse (< -24)
                    // Logic: redamanInt < rxTolerance means redaman is worse than tolerance
                    if (redamanInt < rxTolerance) {
                        devicesWithBadRedaman++; // Increment counter
                        // Simplified log - only show device ID and redaman value
                        // Only log errors, not individual device checks

                        const findUser = global.users.find(u => u.device_id === device._id);

                        const templateData = {
                            nama_pelanggan: findUser?.name?.split("|")[0] || "(Tidak Terdaftar)",
                            no_hp: findUser?.phone_number?.split("|")[0] || "(Tidak Terdaftar)",
                            alamat: findUser?.address?.split("|")[0] || "(Tidak Diketahui)",
                            pppoe: findUser?.pppoe_username?.split("|")[0] || "(Tidak Diketahui)",
                            redaman: `${redamanInt} dBm`
                        };

                        // --- Defensive templating with diagnostics ---

                        // 1. Check if the template exists in the cache first
                        if (!templatesCache.notificationTemplates?.redaman_alert?.template) {
                            console.error(`[CRON_REDAMAN_ERROR] Template 'redaman_alert' tidak ditemukan. Skip device ${device._id}.`);
                            continue; // Skip to the next device in the loop
                        }

                        // 2. Render the template
                        const notificationText = renderTemplate('redaman_alert', templateData);

                        // 3. Check if rendering was successful
                        if (!notificationText || notificationText.startsWith('Error:')) {
                            console.error(`[CRON_REDAMAN_ERROR] Gagal render template untuk device ${device._id}. Skip notifikasi.`);
                            continue; // Skip to the next device in the loop
                        }

                        // Send notification to all accounts with a phone number
                        // Use skipDuplicateCheck: true because each alert is for a different device
                        // Notification tracker blocks alerts with similar content, but each redaman alert
                        // is unique (different device, different customer, different redaman value)
                        const messageDelay = (global.config && parseInt(global.config.whatsapp_message_delay)) || 2000;

                        for (const account of global.accounts) {
                            if (account.phone_number && account.phone_number.length > 0 && !account.phone_number.startsWith("0")) {
                                const targetJid = account.phone_number.endsWith('@s.whatsapp.net') ? account.phone_number : `${account.phone_number}@s.whatsapp.net`;

                                // Gunakan safeSendMessage untuk pengecekan koneksi yang aman
                                const result = await safeSendMessage(targetJid, { text: notificationText }, { skipDuplicateCheck: true });

                                if (result.success) {
                                    // Add delay between notifications to same account
                                    await delay(messageDelay);
                                } else {
                                    console.error(`[CRON_REDAMAN_NOTIF_ERROR] Failed to send notification to ${account.username} (${targetJid}):`, result.error);
                                    // Jika error adalah connection error, stop sending ke account lain
                                    if (result.shouldStop) {
                                        console.warn(`[CRON_REDAMAN_NOTIF_WARN] Connection error detected, stopping notifications for this cycle.`);
                                        break;
                                    }
                                }
                            }
                        }

                        // Add delay between devices to prevent overwhelming the system
                        // This ensures proper spacing between different device alerts
                        if (messageDelay > 0) {
                            await delay(messageDelay);
                        }
                    }
                }

                // Only log if there are issues
                if (devicesWithBadRedaman > 0) {
                    console.log(`[CRON] Redaman: ${devicesWithBadRedaman}/${devicesChecked} device buruk`);
                }

            } catch (error) {
                const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
                console.error(`[CRON_REDAMAN_ERROR] Error: ${errorMessage}`);
            }
        });
        // Redaman check scheduled (silent)
    } catch (e) {
        console.error("[CRON_REDAMAN_SETUP_ERROR] Error setting up redaman check cron job:", e);
    }
}

module.exports = {
    startCheck
};
