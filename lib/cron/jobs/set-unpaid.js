/**
 * Header Doc
 * Purpose: Cron job sinkronisasi paid status pelanggan untuk periode berjalan — reset `paid=true` user non-whitelist supaya konsisten dengan periode billing baru. State holder `cronTaskSetUnpaid` ter-encapsulasi di module ini.
 * Caller: `lib/cron.js` (composer) via `initSetUnpaidTask`.
 * Deps: `node-cron`, `../shared` (isValidCron, loadCronConfig), `../../payment-finance-service` (syncUserPaidStatusForCurrentPeriod).
 * MainFuncs: `initSetUnpaidTask(config)` — schedule/restart task set-unpaid berdasarkan config.
 * SideEffects: Jadwalkan job background, mengubah field `paid` user via service (persist via DB layer service).
 */
"use strict";

const cron = require('node-cron');

const { isValidCron, loadCronConfig } = require('../shared');
const { syncUserPaidStatusForCurrentPeriod } = require('../../payment-finance-service');
const { isInfrastructure, getWhitelistedPackageNames } = require('../../account-classification');

let cronTaskSetUnpaid = null;
let setUnpaidRunning = false;

function initSetUnpaidTask(config) {
    if (cronTaskSetUnpaid) cronTaskSetUnpaid.stop();
    if (config.status_unpaid_schedule === true && isValidCron(config.unpaid_schedule)) {
        console.log("[CRON_SET_UNPAID] Starting/Restarting set-unpaid task with schedule:", config.unpaid_schedule);
        cronTaskSetUnpaid = cron.schedule(config.unpaid_schedule, async () => {
            // Overlap guard — cegah dua siklus jalan bersamaan (konsisten dgn isolir).
            if (setUnpaidRunning) {
                console.warn("[CRON_SET_UNPAID_SKIPPED] Previous set-unpaid cycle still running, skipping this tick.");
                return;
            }

            const currentConfig = loadCronConfig();
            if (currentConfig.status_unpaid_schedule !== true) return;

            setUnpaidRunning = true;
            try {
                // Dikunci pada NAMA PAKET, bukan profil — lihat lib/account-classification.js.
                const paketWhitelist = getWhitelistedPackageNames();
                const users = global.users || [];

                // Sequential (bukan Promise.all paralel) — sebelumnya semua user
                // di-fire serentak → burst write DB (risiko SQLITE_BUSY / memory spike
                // saat ribuan user). Sama disiplin dgn cron isolir.
                let syncedCount = 0;
                let failedCount = 0;
                for (const user of users) {
                    // Akun infrastruktur (mis. modem CCTV/monitoring) tidak ditagih → lewati.
                    if (isInfrastructure(user)) continue;
                    if (paketWhitelist.has(user.subscription) || !user.paid) {
                        continue;
                    }
                    try {
                        await syncUserPaidStatusForCurrentPeriod({ user });
                        syncedCount++;
                    } catch (err) {
                        console.error(`[CRON_UNPAID_RESET_ERROR] Failed to sync paid status for user ${user.id}: ${err.message}`);
                        failedCount++;
                    }
                }
                console.log(`[CRON_SET_UNPAID] Summary: ${syncedCount} synced, ${failedCount} failed.`);
            } finally {
                setUnpaidRunning = false;
            }
        });
    } else {
        // Set-unpaid task disabled (silent)
    }
}

module.exports = {
    initSetUnpaidTask
};
