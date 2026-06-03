/**
 * Header Doc
 * Purpose: Cron job sinkronisasi paid status pelanggan untuk periode berjalan — reset `paid=true` user non-whitelist supaya konsisten dengan periode billing baru. State holder `cronTaskSetUnpaid` ter-encapsulasi di module ini.
 * Caller: `lib/cron.js` (composer) via `initSetUnpaidTask`.
 * Deps: `node-cron`, `../shared` (isValidCron, loadCronConfig), `../../myfunc` (getProfileBySubscription), `../../payment-finance-service` (syncUserPaidStatusForCurrentPeriod).
 * MainFuncs: `initSetUnpaidTask(config)` — schedule/restart task set-unpaid berdasarkan config.
 * SideEffects: Jadwalkan job background, mengubah field `paid` user via service (persist via DB layer service).
 */
"use strict";

const cron = require('node-cron');

const { isValidCron, loadCronConfig } = require('../shared');
const { getProfileBySubscription } = require('../../myfunc');
const { syncUserPaidStatusForCurrentPeriod } = require('../../payment-finance-service');

let cronTaskSetUnpaid = null;

function initSetUnpaidTask(config) {
    if (cronTaskSetUnpaid) cronTaskSetUnpaid.stop();
    if (config.status_unpaid_schedule === true && isValidCron(config.unpaid_schedule)) {
        console.log("[CRON_SET_UNPAID] Starting/Restarting set-unpaid task with schedule:", config.unpaid_schedule);
        cronTaskSetUnpaid = cron.schedule(config.unpaid_schedule, async () => {
            const currentConfig = loadCronConfig();
            if (currentConfig.status_unpaid_schedule !== true) return;

            const whitelistedProfile = global.packages.filter(v => v.whitelist).map(v => v.profile);
            await Promise.all((global.users || []).map(async (user) => {
                const userProfile = getProfileBySubscription(user.subscription);
                if (!whitelistedProfile.includes(userProfile) && user.paid) {
                    try {
                        await syncUserPaidStatusForCurrentPeriod({ user });
                    } catch (err) {
                        console.error(`[CRON_UNPAID_RESET_ERROR] Failed to sync paid status for user ${user.id}: ${err.message}`);
                    }
                }
            }));
        });
    } else {
        // Set-unpaid task disabled (silent)
    }
}

module.exports = {
    initSetUnpaidTask
};
