/**
 * Header Doc
 * Purpose: Cron job pengingat pembayaran (reminder) — kirim notifikasi WhatsApp ke pelanggan unpaid pada `tanggal_pengingat` di config. State holder `cronTaskReminder` ter-encapsulasi di module ini.
 * Caller: `lib/cron.js` (composer) via `initReminderTask`.
 * Deps: `node-cron`, `../shared` (delay, isValidCron, loadCronConfig, safeSendMessage), `../../templating` (renderTemplate), `../../myfunc` (getProfileBySubscription), `../../whatsapp-gateway` (isReady, getConnectionState), `rupiah-format`.
 * MainFuncs: `initReminderTask(config)` — schedule/restart task reminder berdasarkan config.
 * SideEffects: Jadwalkan job background, kirim WhatsApp, log progress.
 */
"use strict";

const cron = require('node-cron');
const formatRupiah = require('rupiah-format');

const { delay, isValidCron, loadCronConfig, safeSendMessage } = require('../shared');
const { renderTemplate } = require('../../templating');
const { getProfileBySubscription } = require('../../myfunc');
const { isReady, getConnectionState } = require('../../whatsapp-gateway');

let cronTaskReminder = null;

function generateReminderData(user) {
    const packageInfo = global.packages.find(p => p.name === user.subscription) || {};
    const price = packageInfo.price ? formatRupiah.convert(packageInfo.price) : 'Tidak diketahui';

    const dueDate = new Date();
    dueDate.setDate(global.config.tanggal_batas_bayar || 10);
    const formattedDueDate = dueDate.toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });

    return {
        nama: user.name,
        nama_layanan: global.config.nama || 'Layanan Kami',
        nama_paket: user.subscription,
        harga_paket: price,
        tanggal_jatuh_tempo: formattedDueDate,
    };
}

function initReminderTask(config) {
    if (cronTaskReminder) cronTaskReminder.stop();
    if (config.status_schedule === true && isValidCron(config.schedule)) {
        console.log("[CRON_REMINDER] Starting/Restarting reminder task with schedule:", config.schedule);
        cronTaskReminder = cron.schedule(config.schedule, async () => {
            const currentConfig = loadCronConfig();
            if (currentConfig.status_schedule !== true) return;

            const now = new Date();
            const currentDay = now.getDate();
            const reminderDay = (global.config && parseInt(global.config.tanggal_pengingat)) || 1;

            console.log(`[CRON_REMINDER] Current day: ${currentDay}, Reminder day: ${reminderDay}`);

            // Allow bypassing day check for testing (set test_mode_skip_day_check in config)
            const skipDayCheck = global.config && global.config.test_mode_skip_day_check === true;

            if (currentDay === reminderDay || skipDayCheck) {
                if (skipDayCheck) {
                    console.log(`[CRON_REMINDER] ⚠️ TEST MODE: Day check bypassed!`);
                }
                console.log(`[CRON_REMINDER] Task executed at: ${new Date().toLocaleString('id-ID')}. Today is reminder day.`);
                const whitelistedProfile = global.packages.filter(v => v.whitelist).map(v => v.profile);

                // Get configurable delay (default 2000ms = 2 seconds)
                const messageDelay = (global.config && parseInt(global.config.whatsapp_message_delay)) || 2000;
                console.log(`[CRON_REMINDER] Using message delay: ${messageDelay}ms`);

                // Debug: Check prerequisites
                console.log(`[CRON_REMINDER] Total users: ${global.users ? global.users.length : 0}`);
                console.log(`[CRON_REMINDER] WhatsApp connected: ${isReady() ? 'YES' : 'NO'}`);
                console.log(`[CRON_REMINDER] Whitelisted profiles: ${whitelistedProfile.join(', ') || 'none'}`);

                let unpaidCount = 0;
                let whitelistedCount = 0;
                let messagesSent = 0;

                for (let user of global.users) {
                    const userProfile = getProfileBySubscription(user.subscription);

                    // Debug: Track user status
                    if (user.paid) {
                        // Skip paid users (no log to avoid spam)
                        continue;
                    }

                    unpaidCount++;

                    if (whitelistedProfile.includes(userProfile)) {
                        whitelistedCount++;
                        continue;
                    }

                    // User is unpaid and not whitelisted - should send reminder
                    console.log(`[CRON_REMINDER] Processing user: ${user.name} (${user.subscription}, paid=${user.paid})`);

                    if (!whitelistedProfile.includes(userProfile) && !user.paid) {

                        const packageInfo = global.packages.find(p => p.name === user.subscription) || {};

                        // Periode adalah bulan ini (bukan bulan depan)
                        const currentMonth = new Date();
                        const periode = currentMonth.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });

                        // Jatuh tempo adalah tanggal batas bayar di bulan ini
                        const dueDate = new Date();
                        const batasBayar = global.config.tanggal_batas_bayar || 10;
                        dueDate.setDate(batasBayar);
                        const jatuh_tempo = dueDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

                        const templateData = {
                            nama_pelanggan: user.name,
                            nama_paket: user.subscription,
                            harga: packageInfo.price || 0,
                            jatuh_tempo: jatuh_tempo,
                            periode: periode
                        };

                        const messageText = renderTemplate('unpaid_reminder', templateData);

                        // Debug: Check message and phone
                        if (!messageText || messageText.startsWith('Error:')) {
                            console.error(`[CRON_REMINDER_ERROR] Template render failed for ${user.name}: ${messageText}`);
                            continue;
                        }

                        if (!user.phone_number) {
                            console.warn(`[CRON_REMINDER_WARN] User ${user.name} has no phone number`);
                            continue;
                        }

                        if (!isReady()) {
                            console.error(`[CRON_REMINDER_ERROR] WhatsApp not connected (state: ${getConnectionState()})! Cannot send messages.`);
                            break;
                        }

                        if (user.phone_number && isReady()) {
                            const phoneNumbers = user.phone_number.split('|');
                            let shouldStopSending = false;

                            for (let number of phoneNumbers) {
                                if (shouldStopSending) break;

                                const normalizedNumber = number.trim() + "@s.whatsapp.net";

                                if (normalizedNumber.length > 15) {
                                    const result = await safeSendMessage(normalizedNumber, { text: messageText });

                                    if (result.success) {
                                        console.log(`[CRON_REMINDER] ✅ Reminder sent to ${user.name} at ${normalizedNumber}`);
                                        messagesSent++;
                                        await delay(messageDelay);
                                    } else {
                                        console.error(`[CRON_REMINDER_ERROR] ❌ Failed to send reminder to ${normalizedNumber} for user ${user.name}:`, result.error);
                                        if (result.shouldStop) {
                                            console.warn(`[CRON_REMINDER_WARN] Connection error detected, stopping reminder cycle.`);
                                            shouldStopSending = true;
                                        }
                                    }
                                } else {
                                    console.warn(`[CRON_REMINDER_WARN] Invalid phone length for ${user.name}: ${normalizedNumber} (${normalizedNumber.length} chars)`);
                                }
                            }

                            // Jika ada connection error, keluar dari loop users
                            if (shouldStopSending) break;
                        }
                    }
                }

                // Summary logging
                console.log(`[CRON_REMINDER] === SUMMARY ===`);
                console.log(`[CRON_REMINDER] Total users: ${global.users ? global.users.length : 0}`);
                console.log(`[CRON_REMINDER] Unpaid users: ${unpaidCount}`);
                console.log(`[CRON_REMINDER] Whitelisted (skipped): ${whitelistedCount}`);
                console.log(`[CRON_REMINDER] Messages sent: ${messagesSent}`);
                console.log(`[CRON_REMINDER] ===============`);
            } else {
                console.log(`[CRON_REMINDER] Skipping execution. Current day (${currentDay}) does not match reminder day (${reminderDay}).`);
            }
        });
    } else {
        // Reminder task disabled (silent)
    }
}

module.exports = {
    initReminderTask,
    generateReminderData
};
