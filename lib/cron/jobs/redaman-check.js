/**
 * Header Doc
 * Purpose: Cron job redaman-check — poll GenieACS untuk device MILIK PELANGGAN BOT INI, refresh nilai redaman (RX power) agar segar, saring yang lebih buruk dari `rx_tolerance` DAN masih layak dipercaya umurnya, lalu kirim notifikasi WA ke penerima yang DIATUR pemilik (peran + nomor tambahan). State holder `checkTask` ter-encapsulasi di module ini. Function di-export sebagai `startCheck` (legacy name) untuk backward compat dengan `routes/admin-config-routes.js` dan composer.
 * Caller: `lib/cron.js` (composer) via `startCheck`.
 * Deps: `node-cron`, `../shared` (delay, loadCronConfig, safeSendMessage), `../../wifi` (REDAMAN_PATHS), `../../genieacs` (queryDevices, refreshObjects), `../../templating` (renderTemplate, templatesCache), `../../redaman-alert-recipients`, `../../redaman-alert-scope`, `../../redaman-alert-cooldown-store`.
 * MainFuncs: `startCheck()` — schedule/restart task redaman check; reload setiap kali dipanggil (idempotent).
 * SideEffects: Jadwalkan job background, panggil GenieACS API (refresh + query devices), tulis `database/redaman-alert-cooldown.json`, kirim WhatsApp ke PENERIMA yang diatur di halaman Konfigurasi — lihat lib/redaman-alert-recipients.js & lib/redaman-alert-scope.js.
 */
"use strict";

const cron = require('node-cron');

const { delay, loadCronConfig, safeSendMessage } = require('../shared');
const { REDAMAN_PATHS } = require('../../wifi');
const { queryDevices, refreshObjects } = require('../../genieacs');
const { renderTemplate, templatesCache } = require('../../templating');
const { resolvePenerimaRedaman } = require('../../redaman-alert-recipients');
const {
    ALASAN,
    bacaSetelanLingkup,
    bangunPetaDevicePelanggan,
    evaluasiDevice,
} = require('../../redaman-alert-scope');
const cooldownStore = require('../../redaman-alert-cooldown-store');

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
                const setelanLingkup = bacaSetelanLingkup(global.config);
                const petaPelanggan = bangunPetaDevicePelanggan(global.users);

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

                // 1b. Saring ke modem MILIK bot ini SEBELUM di-refresh. ACS dipakai bersama dua
                //     bot, jadi tanpa saringan ini tiap bot menyegarkan & menilai modem bot lain
                //     (terukur: 160 device di ACS, hanya 58 milik Dander / 96 milik Tanjungharjo).
                //     Menyaring lebih awal sekaligus memangkas beban connection-request ke ACS.
                let deviceIDs = allDevices.map(d => d._id);
                const totalDiAcs = deviceIDs.length;
                if (setelanLingkup.hanyaPelangganSendiri) {
                    deviceIDs = deviceIDs.filter(id => petaPelanggan.has(id));
                }
                const dilewatiBukanMilik = totalDiAcs - deviceIDs.length;
                if (deviceIDs.length === 0) {
                    // JANGAN BISU: tak ada device milik sendiri terlihat sama persis dengan
                    // "semua modem sehat" kalau tidak dicetak.
                    console.warn(`[CRON_REDAMAN_WARN] Tak ada modem pelanggan bot ini di ACS (${totalDiAcs} device asing dilewati) — tidak ada yang diperiksa.`);
                    return;
                }

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

                // 3. Batch Fetch: Get only redaman data for all devices in one call.
                //    `_id` diminta eksplisit karena dipakai memetakan device → pelanggan.
                const projectionFields = ['_id', ...REDAMAN_PATHS].join(',');
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

                // Cooldown agar device buruk yang sama tidak di-alert tiap cycle. Kini DURABEL
                // (ditulis ke disk) — versi Map in-memory-nya kosong tiap `pm2 restart`, sehingga
                // jeda 12 jam sebenarnya cuma "sejak restart terakhir". Lihat store-nya.
                const cooldownMs = setelanLingkup.cooldownMs;
                const cooldown = cooldownStore.muat();
                let cooldownBerubah = false;
                const nowMs = Date.now();

                let devicesWithBadRedaman = 0;
                let devicesChecked = 0;
                let devicesSkipped = 0;
                let devicesAlertedSkippedByCooldown = 0;
                let devicesBukanMilik = 0;
                let devicesNilaiBasi = 0;

                for (const device of devicesWithRedaman) {
                    // Satu tempat memutuskan: kepemilikan → nilai terbaca → sehat/buruk →
                    // masih layak dipercaya umurnya. Fail-closed: buta bukan berarti buruk.
                    const putusan = evaluasiDevice(device, {
                        petaPelanggan,
                        paths: REDAMAN_PATHS,
                        rxTolerance,
                        maksUmurMs: setelanLingkup.maksUmurMs,
                        hanyaPelangganSendiri: setelanLingkup.hanyaPelangganSendiri,
                        sekarang: nowMs,
                    });

                    if (putusan.alasan === ALASAN.BUKAN_PELANGGAN) { devicesBukanMilik++; continue; }
                    if (putusan.alasan === ALASAN.TANPA_NILAI) { devicesSkipped++; continue; }

                    devicesChecked++;

                    if (putusan.alasan === ALASAN.NILAI_BASI) {
                        // Modem tak menjawab refresh — yang kita pegang cuma pembacaan lama.
                        // Mengalert dari sini akan mengulang vonis yang sama selamanya.
                        devicesNilaiBasi++;
                        devicesWithBadRedaman++;
                        continue;
                    }

                    if (putusan.alasan === ALASAN.ALERT) {
                        const redamanInt = putusan.angka;
                        devicesWithBadRedaman++; // Increment counter

                        // Cooldown: lewati notifikasi jika alert untuk device ini baru dikirim.
                        if (cooldownStore.masihDalamCooldown(cooldown, device._id, cooldownMs, nowMs)) {
                            devicesAlertedSkippedByCooldown++;
                            continue;
                        }

                        // Simplified log - only show device ID and redaman value
                        // Only log errors, not individual device checks

                        const findUser = putusan.pelanggan;

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
                        let alertedAtLeastOnce = false;

                        // Penerima kini DIATUR dari halaman Konfigurasi (per peran + nomor
                        // tambahan), bukan di-hardcode "semua akun berponsel". Lihat alasan
                        // lengkap & bawaannya di lib/redaman-alert-recipients.js.
                        const penerima = resolvePenerimaRedaman();
                        if (!penerima.aktif) {
                            console.log('[CRON_REDAMAN_NOTIF] Alert redaman dimatikan dari konfigurasi — tak ada yang dikirimi.');
                        } else if (penerima.rincian.length === 0) {
                            // JANGAN BISU: setelan yang menghasilkan NOL penerima terlihat sama
                            // dengan "tak ada device bermasalah" kalau tak dicetak.
                            console.warn('[CRON_REDAMAN_NOTIF_WARN] Setelan penerima menghasilkan NOL penerima — alert tidak terkirim ke siapa pun.');
                        }

                        for (const target of penerima.rincian) {
                            // Gunakan safeSendMessage untuk pengecekan koneksi yang aman
                            const result = await safeSendMessage(target.jid, { text: notificationText }, { skipDuplicateCheck: true });

                            if (result.success) {
                                alertedAtLeastOnce = true;
                                // Add delay between notifications to same account
                                await delay(messageDelay);
                            } else {
                                console.error(`[CRON_REDAMAN_NOTIF_ERROR] Gagal kirim ke ${target.label} (${target.jid}):`, result.error);
                                // Jika error adalah connection error, stop sending ke account lain
                                if (result.shouldStop) {
                                    console.warn(`[CRON_REDAMAN_NOTIF_WARN] Connection error detected, stopping notifications for this cycle.`);
                                    break;
                                }
                            }
                        }

                        // Tandai cooldown hanya jika minimal satu account berhasil menerima.
                        // Jika WA mati total, jangan masukin cooldown supaya cycle berikutnya retry.
                        if (alertedAtLeastOnce) {
                            cooldownStore.tandaiTerkirim(cooldown, device._id, Date.now());
                            cooldownBerubah = true;
                        }

                        // Add delay between devices to prevent overwhelming the system
                        // This ensures proper spacing between different device alerts
                        if (messageDelay > 0) {
                            await delay(messageDelay);
                        }
                    }
                }

                // Satu tulis per siklus, bukan satu IO per device.
                if (cooldownBerubah) {
                    cooldownStore.simpan(cooldownStore.prune(cooldown, undefined, nowMs));
                }

                // Only log if there are issues
                if (devicesWithBadRedaman > 0) {
                    const cooldownNote = devicesAlertedSkippedByCooldown > 0
                        ? ` (${devicesAlertedSkippedByCooldown} ditahan cooldown)`
                        : '';
                    const basiNote = devicesNilaiBasi > 0
                        ? ` (${devicesNilaiBasi} DILEWATI: nilainya basi, modem tak menjawab refresh)`
                        : '';
                    console.log(`[CRON] Redaman: ${devicesWithBadRedaman}/${devicesChecked} device buruk${cooldownNote}${basiNote}`);
                }

                // Ringkasan cakupan — dicetak walau semua sehat, supaya penyaringan tak pernah
                // tak terlihat. Tanpa ini, "0 device buruk" tak bisa dibedakan dari
                // "tak ada yang diperiksa karena tersaring habis".
                console.log(
                    `[CRON_REDAMAN_CAKUPAN] ACS ${totalDiAcs} device · diperiksa ${devicesChecked}`
                    + ` · bukan pelanggan bot ini ${dilewatiBukanMilik + devicesBukanMilik}`
                    + ` · tanpa nilai ${devicesSkipped}`
                    + ` · nilai basi ${devicesNilaiBasi}`
                );

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
