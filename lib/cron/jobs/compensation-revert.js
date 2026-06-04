/**
 * Header Doc
 * Purpose: Cron job revert kompensasi — kembalikan profile MikroTik pelanggan ke originalProfile saat masa kompensasi berakhir, lalu kirim notifikasi WA. State holder `cronTaskCompensationRevert` ter-encapsulasi di module ini.
 * Caller: `lib/cron.js` (composer) via `initCompensationRevertTask`.
 * Deps: `node-cron`, `fs`, `path`, `../shared` (delay, isValidCron, safeSendMessage), `../../mikrotik` (updatePPPoEProfile, deleteActivePPPoEUser, assertMikrotikResult), `../../wifi` (rebootRouter), `../../templating` (renderTemplate, templatesCache), `../../database` (saveCompensations), `../../whatsapp-gateway` (isReady).
 * MainFuncs: `initCompensationRevertTask(config)` — schedule/restart task revert kompensasi berdasarkan config.
 * SideEffects: Jadwalkan job background, baca cron.json + compensations.json, panggil MikroTik (update profile + disconnect), reboot router, kirim WhatsApp, persist `global.compensations` via `saveCompensations`.
 */
"use strict";

const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

const { delay, isValidCron, safeSendMessage } = require('../shared');
const { updatePPPoEProfile, deleteActivePPPoEUser, assertMikrotikResult } = require('../../mikrotik');
const { rebootRouter } = require('../../wifi');
const { renderTemplate, templatesCache } = require('../../templating');
const { saveCompensations } = require('../../database');
const { isReady } = require('../../whatsapp-gateway');

let cronTaskCompensationRevert = null;
let compensationRevertRunning = false;

const compensationsDbPath = path.join(__dirname, '..', '..', '..', 'database', 'compensations.json');

function initCompensationRevertTask(config) {
    if (cronTaskCompensationRevert) {
        cronTaskCompensationRevert.stop();
    }

    if (config.status_compensation_revert === true && isValidCron(config.schedule_compensation_revert)) {
        // Only log on first start, not on every restart
        if (!global.compensationCronJobInitialized) {
            console.log(`[CRON] Compensation task started (${config.schedule_compensation_revert})`);
            global.compensationCronJobInitialized = true;
        }
        cronTaskCompensationRevert = cron.schedule(config.schedule_compensation_revert, async () => {
            // Re-entrance guard: cron jalan tiap menit, sementara siklus revert bisa lama
            // (updateProfile + disconnect + reboot + WA per comp). Tanpa guard ini, tick berikutnya
            // bisa overlap dan double-revert comp yang sama.
            if (compensationRevertRunning) {
                return;
            }

            let currentCronConfig;
            try {
                currentCronConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'database', 'cron.json'), 'utf8'));
            } catch (e) {
                console.error("[CRON_COMPENSATION_ERROR] Error reading cron.json:", e);
                return;
            }

            if (currentCronConfig.status_compensation_revert !== true) {
                return;
            }

            compensationRevertRunning = true;
            try {

            let currentCompensationsData;
            try {
                currentCompensationsData = JSON.parse(fs.readFileSync(compensationsDbPath, 'utf8'));
            } catch (e) {
                if (e.code !== 'ENOENT') {
                    console.error("[CRON_COMPENSATION_ERROR] Error reading compensations.json:", e);
                }
                return;
            }

            const now = new Date();
            let compensationsModifiedInThisRun = false;
            const compensationsToKeep = [];
            const activeCompensations = currentCompensationsData.filter(c => c.status === 'active');
            let expiredCount = 0;

            // Check if sync to MikroTik is enabled
            const syncToMikrotik = global.config.sync_to_mikrotik !== false; // Default to true if not set

            for (const comp of currentCompensationsData) {
                if (comp.status === 'active' && new Date(comp.endDate) <= now) {
                    expiredCount++;
                    console.log(`[CRON_COMPENSATION] Reverting expired compensation ${comp.id} (user: ${comp.userId})...`);
                    const userToRevert = global.users.find(u => u.id.toString() === comp.userId.toString());

                    if (!userToRevert) {
                        console.error(`[CRON_COMPENSATION_REVERT_ERROR] User with ID ${comp.userId} not found for compensation ID ${comp.id}.`);
                        comp.status = 'error_revert_user_not_found';
                        compensationsToKeep.push(comp);
                        compensationsModifiedInThisRun = true;
                        continue;
                    }

                    if (!syncToMikrotik) {
                        compensationsToKeep.push(comp);
                        continue;
                    }

                    try {
                        assertMikrotikResult(
                            await updatePPPoEProfile(comp.pppoeUsername, comp.originalProfile, { caller: 'cron.compensation-revert' })
                        );

                        try {
                            const disconnectResult = await deleteActivePPPoEUser(comp.pppoeUsername, { caller: 'cron.compensation-revert' });
                            if (!disconnectResult.ok) {
                                throw new Error(disconnectResult.message);
                            }
                        } catch (disconnectError) {
                            console.warn(`[CRON_COMPENSATION_WARN] Could not disconnect active session for ${comp.pppoeUsername}: ${disconnectError.message}`);
                        }

                        if (userToRevert.device_id) {
                            try {
                                const rebootResult = await rebootRouter(userToRevert.device_id, {
                                    context: { caller: 'cron.compensation-revert', deviceId: userToRevert.device_id },
                                });
                                if (!rebootResult.success) {
                                    throw new Error(rebootResult.message);
                                }
                            } catch (rebootError) {
                                console.warn(`[CRON_COMPENSATION_WARN] Could not reboot router for ${comp.pppoeUsername}: ${rebootError.message}`);
                            }
                        }

                        if (currentCronConfig.status_message_compensation_reverted === true && templatesCache.notificationTemplates['compensation_reverted'] && isReady()) {
                            if (userToRevert.phone_number && userToRevert.phone_number.trim() !== "") {
                                const locale = currentCronConfig.date_locale_for_notification || 'id-ID';
                                const dateOptions = currentCronConfig.date_options_for_revert_notification || { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
                                const dataPesan = {
                                    nama_pelanggan: userToRevert.name,
                                    tanggalRevert: new Date().toLocaleDateString(locale, dateOptions),
                                    profileAsli: global.packages.find(p => p.profile === comp.originalProfile)?.name || comp.originalProfile,
                                };

                                const messageText = renderTemplate('compensation_reverted', dataPesan);

                                const messageDelay = (global.config && parseInt(global.config.whatsapp_message_delay)) || 2000;
                                const phoneNumbers = userToRevert.phone_number.split('|');
                                for (let number of phoneNumbers) {
                                    let normalizedNumber = number.trim().replace(/\D/g, '');
                                    if (normalizedNumber.length > 5) {
                                        const jid = normalizedNumber + "@s.whatsapp.net";
                                        const result = await safeSendMessage(jid, { text: messageText });

                                        if (result.success) {
                                            await delay(messageDelay);
                                        } else {
                                            console.error(`[CRON_COMPENSATION_NOTIF_ERROR] Failed to send revert message to ${jid}:`, result.error);
                                            if (result.shouldStop) break;
                                        }
                                    }
                                }
                            }
                        }

                        // Audit trail: simpan comp dengan status 'reverted' + revertedAt
                        // ketimbang dihapus dari JSON, supaya history kompensasi tetap bisa di-trace.
                        compensationsToKeep.push({
                            ...comp,
                            status: 'reverted',
                            revertedAt: new Date().toISOString(),
                        });
                        compensationsModifiedInThisRun = true;

                    } catch (mikrotikError) {
                        console.error(`[CRON_COMPENSATION_REVERT_ERROR] Failed to revert Mikrotik profile for ${comp.pppoeUsername}:`, mikrotikError.message);
                        comp.status = 'error_revert';
                        compensationsToKeep.push(comp);
                        compensationsModifiedInThisRun = true;
                    }
                } else {
                    compensationsToKeep.push(comp);
                }
            }

            if (compensationsModifiedInThisRun) {
                global.compensations = compensationsToKeep;
                // NOTE: saveCompensations() is synchronous and uses fs.writeFileSync
                // For single instance, this is safe. For multiple instances, consider file locking.
                saveCompensations();
            }

            // Only log if there are changes
            if (expiredCount > 0) {
                console.log(`[CRON] Compensation: ${expiredCount} expired, ${activeCompensations.length} active`);
            }
            } finally {
                compensationRevertRunning = false;
            }
        }, {
            scheduled: true,
            timezone: "Asia/Jakarta"
        });

        // Explicitly start the task
        cronTaskCompensationRevert.start();
        // Compensation task started (silent)
    } else {
        // Compensation task disabled (silent)
    }
}

module.exports = {
    initCompensationRevertTask
};
