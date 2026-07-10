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

const { delay, isValidCron } = require('../shared');
const { getProfileBySubscription } = require('../../myfunc');
const IsolirService = require('../../services/isolir-service');
const { isInfrastructure } = require('../../account-classification');

let cronTaskUnpaidAction = null;
let isolirRunning = false;

/**
 * Ambil hari-dalam-bulan dari ekspresi cron bila ia berupa angka tunggal (mis. "0 0 16 * *" → 16).
 * Kembalikan null untuk pola non-tunggal (`*`, list, range, step) — di situ kita tak bisa menyimpulkan.
 */
function fixedDayOfMonth(schedule) {
    const field = String(schedule || "").trim().split(/\s+/)[2];
    return /^\d{1,2}$/.test(field) ? parseInt(field, 10) : null;
}

/**
 * Deteksi konfigurasi yang MUSTAHIL berhasil: cron menyala pada hari X, tetapi guard di dalam job
 * menuntut `hari >= tanggal_isolir`. Bila X < tanggal_isolir, job SELALU skip → auto-isolir tak
 * pernah jalan, tanpa satu pun error. Persis yang terjadi di RAF-TANJUNGHARJO (cron tgl 15,
 * tanggal_isolir 16): nol baris audit, 87 pelanggan unpaid tak pernah tersentuh.
 */
function warnIfScheduleCanNeverAct(schedule) {
    const cronDay = fixedDayOfMonth(schedule);
    const isolirDay = (global.config && parseInt(global.config.tanggal_isolir, 10)) || 11;
    if (cronDay !== null && cronDay < isolirDay) {
        console.error(
            `[CRON_ISOLIR_ACTION_MISCONFIG] Jadwal cron menyala tgl ${cronDay}, tetapi guard menuntut ` +
            `hari >= tanggal_isolir (${isolirDay}). Task ini TIDAK AKAN PERNAH mengisolir siapa pun. ` +
            `Samakan schedule_unpaid_action dengan tanggal_isolir.`
        );
    }
}

function initIsolirTask(config) {
    if (cronTaskUnpaidAction) cronTaskUnpaidAction.stop();
    if (config.status_schedule_unpaid_action === true && isValidCron(config.schedule_unpaid_action)) {
        console.log("[CRON_ISOLIR_ACTION] Starting/Restarting isolir action task with schedule:", config.schedule_unpaid_action);
        warnIfScheduleCanNeverAct(config.schedule_unpaid_action);
        cronTaskUnpaidAction = cron.schedule(config.schedule_unpaid_action, async () => {
            if (isolirRunning) {
                console.warn("[CRON_ISOLIR_ACTION_SKIPPED] Previous isolir cycle still running, skipping this tick.");
                return;
            }

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

            isolirRunning = true;
            try {
                const whitelistedProfile = global.packages.filter(v => v.whitelist).map(v => v.profile);

                // Kumpulkan kandidat lebih dulu agar bisa diproses sequential dengan throttle.
                // Sebelumnya semua user difire paralel tanpa await → bisa membanjiri MikroTik API.
                const candidates = [];
                for (const user of (global.users || [])) {
                    const userProfile = getProfileBySubscription(user.subscription);
                    if (!user.paid
                        && !whitelistedProfile.includes(userProfile)
                        && userProfile !== isolirProfileToUse
                        && user.pppoe_username
                        && !isInfrastructure(user)) {
                        candidates.push(user);
                    }
                }

                if (candidates.length === 0) {
                    console.log("[CRON_ISOLIR_ACTION] No candidate users to isolate.");
                    return;
                }

                const throttleMs = (global.config && parseInt(global.config.isolir_action_delay)) || 500;
                console.log(`[CRON_ISOLIR_ACTION] Found ${candidates.length} candidate(s). Processing sequentially with ${throttleMs}ms throttle.`);

                let isolatedCount = 0;
                let failedCount = 0;

                for (const user of candidates) {
                    console.log(`[CRON_ISOLIR_ACTION] Attempting to isolate user: ${user.pppoe_username} with profile: "${isolirProfileToUse}"`);
                    try {
                        const actionResult = await IsolirService.executeProfileAction(user, {
                            targetProfile: isolirProfileToUse,
                            disconnect: true,
                            reboot: true,
                            caller: 'cron.isolir',
                        });
                        if (!actionResult || !actionResult.ok) {
                            throw new Error(actionResult ? actionResult.message : 'No result returned');
                        }
                        console.log(`[CRON_ISOLIR_SUCCESS] ${user.pppoe_username} berhasil diisolir.`);
                        isolatedCount++;
                    } catch (e) {
                        console.error(`[CRON_ISOLIR_ACTION_ERROR] Full process failed for user ${user.name}: ${e.message || e}`);
                        failedCount++;
                    }
                    if (throttleMs > 0) {
                        await delay(throttleMs);
                    }
                }

                console.log(`[CRON_ISOLIR_ACTION] Summary: ${isolatedCount} isolated, ${failedCount} failed, ${candidates.length} total.`);
            } finally {
                isolirRunning = false;
            }
        });
    } else {
        // Isolir action task disabled (silent)
    }
}

module.exports = {
    initIsolirTask,
    // Diekspor untuk test — guard konfigurasi mustahil.
    _internal: { fixedDayOfMonth, warnIfScheduleCanNeverAct }
};
