/**
 * Header Doc
 * Purpose: Cron job notifikasi isolir — kirim WA ke pelanggan yang sedang berada di profile isolir, untuk memberi tahu status isolasi. State holder `cronTaskIsolirNotification` ter-encapsulasi di module ini.
 * Caller: `lib/cron.js` (composer) via `initIsolirNotificationTask`.
 * Deps: `node-cron`, `../shared` (delay, isValidCron, safeSendMessage), `../../mikrotik` (getPPPoEUserProfile, assertMikrotikResult), `../../templating` (renderTemplate), `../../whatsapp-gateway` (isReady).
 * MainFuncs: `initIsolirNotificationTask(config)` — schedule/restart task notifikasi isolir berdasarkan config.
 * SideEffects: Jadwalkan job background, panggil MikroTik API (read profile), kirim WhatsApp.
 */
"use strict";

const cron = require('node-cron');

const { delay, isValidCron, safeSendMessage } = require('../shared');
const { getPPPoEUserProfile, assertMikrotikResult } = require('../../mikrotik');
const { renderTemplate } = require('../../templating');
const { isReady } = require('../../whatsapp-gateway');

let cronTaskIsolirNotification = null;

function initIsolirNotificationTask(config) {
    if (cronTaskIsolirNotification) cronTaskIsolirNotification.stop();
    if (config.status_message_isolir_notification === true && isValidCron(config.schedule_isolir_notification)) {
        console.log("[CRON_ISOLIR_NOTIF] Starting/Restarting isolir notification task with schedule:", config.schedule_isolir_notification);
        cronTaskIsolirNotification = cron.schedule(config.schedule_isolir_notification, async () => {
            const isolirProfileToUse = global.config.isolir_profile;
            if (!isolirProfileToUse) {
                console.error("[CRON_ISOLIR_NOTIF_ERROR] `isolir_profile` is not defined in config.json. Cannot send notifications.");
                return;
            }

            console.log(`[CRON_ISOLIR_NOTIF] Task executed at: ${new Date().toLocaleString('id-ID')}. Checking for isolated users.`);

            // Get configurable delay (default 2000ms = 2 seconds)
            const messageDelay = (global.config && parseInt(global.config.whatsapp_message_delay)) || 2000;

            for (let user of global.users) {
                // Skip users without a PPPoE username
                if (!user.pppoe_username) continue;

                try {
                    // Get the user's LIVE profile from MikroTik
                    const liveProfileResult = await getPPPoEUserProfile(user.pppoe_username, { caller: 'cron.isolir-notification' });
                    const liveProfileData = assertMikrotikResult(liveProfileResult);
                    const liveProfile = liveProfileData.data?.profile;

                    // Check if the user is currently isolated
                    if (liveProfile === isolirProfileToUse) {
                        if (user.phone_number && isReady()) {
                            const phoneNumbers = user.phone_number.split('|');
                            let shouldStopSending = false;

                            for (let number of phoneNumbers) {
                                if (shouldStopSending) break;

                                const normalizedNumber = number.trim().replace(/\D/g, ''); // Clean non-digit characters

                                if (normalizedNumber.length > 5) { // Basic validation
                                    const jid = normalizedNumber + "@s.whatsapp.net";
                                    const message = renderTemplate('isolir_notification', {
                                        nama_pelanggan: user.name,
                                        periode: new Date().toLocaleString('id-ID', { month: 'long', year: 'numeric' })
                                    });

                                    const result = await safeSendMessage(jid, { text: message });

                                    if (result.success) {
                                        console.log(`[CRON_ISOLIR_NOTIF] Notification sent to ${user.name} at ${jid}`);
                                        await delay(messageDelay);
                                    } else {
                                        console.error(`[CRON_ISOLIR_NOTIF_SEND_ERROR] Failed to send to ${jid} for user ${user.name}:`, result.error);
                                        if (result.shouldStop) {
                                            console.warn(`[CRON_ISOLIR_NOTIF_WARN] Connection error detected, stopping notification cycle.`);
                                            shouldStopSending = true;
                                        }
                                    }
                                }
                            }
                        }
                    }
                } catch (error) {
                    // This error is from getPPPoEUserProfile, likely user not found on router or API error
                    console.error(`[CRON_ISOLIR_NOTIF_FETCH_ERROR] Could not get profile for user ${user.name} (${user.pppoe_username}): ${error.message}`);
                }
            }
        });
    } else {
        // Isolir notification task disabled (silent)
    }
}

module.exports = {
    initIsolirNotificationTask
};
