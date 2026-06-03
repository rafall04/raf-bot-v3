/**
 * Header Doc
 * Purpose: Cron job isolir action — pindahkan user unpaid ke isolir profile (PPPoE) pada `tanggal_isolir`. State holder `cronTaskUnpaidAction` ter-encapsulasi di module ini.
 * Caller: `lib/cron.js` (composer) via `initIsolirTask`.
 * Deps: `node-cron`, `../shared` (isValidCron), `../../myfunc` (getProfileBySubscription), `../../services/isolir-service` (executeProfileAction).
 * MainFuncs: `initIsolirTask(config)` — schedule/restart task isolir action berdasarkan config.
 * SideEffects: Jadwalkan job background, panggil MikroTik API untuk update profile + disconnect + reboot router.
 */
"use strict";

const cron = require('node-cron');

const { isValidCron } = require('../shared');
const { getProfileBySubscription } = require('../../myfunc');
const IsolirService = require('../../services/isolir-service');

let cronTaskUnpaidAction = null;

function initIsolirTask(config) {
    if (cronTaskUnpaidAction) cronTaskUnpaidAction.stop();
    if (config.status_schedule_unpaid_action === true && isValidCron(config.schedule_unpaid_action)) {
        console.log("[CRON_ISOLIR_ACTION] Starting/Restarting isolir action task with schedule:", config.schedule_unpaid_action);
        cronTaskUnpaidAction = cron.schedule(config.schedule_unpaid_action, async () => {
            const isolirDay = (global.config && parseInt(global.config.tanggal_isolir)) || 11;
            const currentDay = new Date().getDate();

            if (currentDay < isolirDay) {
                console.log(`[CRON_ISOLIR_ACTION_SKIPPED] Today (day ${currentDay}) is before the configured isolation day (${isolirDay}). No action will be taken.`);
                return;
            }

            console.log(`[CRON_ISOLIR_ACTION_STARTED] Today is day ${currentDay}, which is on or after the isolation day (${isolirDay}). Starting isolation process for unpaid users.`);
            const isolirProfileToUse = global.config.isolir_profile;
            if (!isolirProfileToUse) {
                console.error("[CRON_ISOLIR_ACTION_ERROR] `isolir_profile` is not defined in config.json. Cannot proceed.");
                return;
            }

            // Check if sync to MikroTik is enabled
            const syncToMikrotik = global.config.sync_to_mikrotik !== false; // Default to true if not set

            if (!syncToMikrotik) {
                console.log("[CRON_ISOLIR_ACTION] Sync to MikroTik is DISABLED - skipping isolir action.");
                return;
            }

            if (global.config && global.config.isolirFeatureEnabled === false) {
                console.log("[CRON_ISOLIR_ACTION] Fitur isolir dinonaktifkan - skipping isolir action.");
                return;
            }

            const whitelistedProfile = global.packages.filter(v => v.whitelist).map(v => v.profile);
            for (let user of global.users) {
                const userProfile = getProfileBySubscription(user.subscription);
                if (!user.paid && !whitelistedProfile.includes(userProfile) && userProfile !== isolirProfileToUse) {
                    if (user.pppoe_username) {
                        console.log(`[CRON_ISOLIR_ACTION] Attempting to isolate user: ${user.pppoe_username} with profile: "${isolirProfileToUse}"`);
                        IsolirService.executeProfileAction(user, {
                            targetProfile: isolirProfileToUse,
                            disconnect: true,
                            reboot: true,
                            caller: 'cron.isolir',
                        })
                            .then((actionResult) => {
                                if (!actionResult.ok) {
                                    throw new Error(actionResult.message);
                                }
                                console.log(`[CRON_ISOLIR_SUCCESS] ${user.pppoe_username} berhasil diisolir.`);
                            })
                            .catch(e => console.error(`[CRON_ISOLIR_ACTION_ERROR] Full process failed for user ${user.name}:`, e.message || e));
                    }
                }
            }
        });
    } else {
        // Isolir action task disabled (silent)
    }
}

module.exports = {
    initIsolirTask
};
