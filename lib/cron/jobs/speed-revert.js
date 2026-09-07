/**
 * Header Doc
 * Purpose: Cron job revert Speed-on-Demand (SOD) — kembalikan profile MikroTik pelanggan dari boost ke originalProfile saat masa boost berakhir, lalu kirim notifikasi WA. Schedule hardcoded `* * * * *` (setiap menit) untuk responsiveness; toggle on/off via `status_speed_boost_revert` di cron.json. State holder `cronTaskSpeedRequestRevert` ter-encapsulasi di module ini.
 * Caller: `lib/cron.js` (composer) via `initSpeedRevertTask`.
 * Deps: `node-cron`, `../shared` (delay, loadCronConfig, safeSendMessage), `../../mikrotik` (updatePPPoEProfile, deleteActivePPPoEUser, assertMikrotikResult), `../../templating` (renderTemplate, templatesCache), `../../database` (saveSpeedRequests), `../../whatsapp-gateway` (isReady).
 * MainFuncs: `initSpeedRevertTask(config)` — schedule/restart task SOD revert berdasarkan config.
 * SideEffects: Jadwalkan job background, baca cron.json, panggil MikroTik (update profile + disconnect), kirim WhatsApp, persist `global.speed_requests` via `saveSpeedRequests`.
 */
"use strict";

const cron = require('node-cron');

const { delay, loadCronConfig, safeSendMessage } = require('../shared');
const { updatePPPoEProfile, deleteActivePPPoEUser, assertMikrotikResult } = require('../../mikrotik');
const { renderTemplate, templatesCache } = require('../../templating');
const { saveSpeedRequests } = require('../../database');
const { isReady } = require('../../whatsapp-gateway');

let cronTaskSpeedRequestRevert = null;
let speedRevertRunning = false;
// #b347: batas percobaan revert utk kegagalan TRANSIEN sebelum menyerah + eskalasi admin.
const MAX_REVERT_RETRIES = 5;
// Kode/pesan error MikroTik yang TRANSIEN (layak dicoba lagi tick berikut), bukan permanen.
function isTransientMikrotikError(err) {
    const code = err && err.code;
    if (["TIMEOUT_ERROR", "CIRCUIT_OPEN", "CONNECT_ERROR"].includes(code)) return true;
    return /timeout|circuit|breaker|ECONN|ETIMEDOUT|EHOSTUNREACH|unreachable|not connected/i.test((err && err.message) || "");
}
async function alertRevertStuck(label, username, retries) {
    try {
        const { getAdminJids } = require('../../admin-recipients');
        const jids = getAdminJids() || [];
        const text = `⚠️ *REVERT ${label} MACET* — ${username} gagal dikembalikan dari profil boost ${retries}x berturut (MikroTik transien). Pelanggan masih di profil boost (bocor pendapatan). Cek & revert manual.`;
        for (const jid of jids) {
            try { await safeSendMessage(jid, { text }); } catch (_e) { /* best-effort */ }
        }
    } catch (_e) { /* never-throw: eskalasi gagal tak boleh menjatuhkan cron */ }
}

function initSpeedRevertTask(config) {
    if (cronTaskSpeedRequestRevert) cronTaskSpeedRequestRevert.stop();

    // The schedule is hardcoded to every minute for responsiveness.
    const schedule = '* * * * *';

    if (config.status_speed_boost_revert === true) {
        console.log(`[CRON_SPEED_REVERT] Starting/Restarting speed boost revert task with schedule: ${schedule}`);
        cronTaskSpeedRequestRevert = cron.schedule(schedule, async () => {
            // Overlap guard — schedule tiap menit + revert bisa lambat (MikroTik + throttle).
            // Tanpa guard, tick berikutnya overlap → req yang sama (status masih 'active'
            // sampai aksi selesai) bisa di-revert dua kali. Konsisten dgn compensation-revert.
            if (speedRevertRunning) {
                console.warn("[CRON_SPEED_REVERT_SKIPPED] Previous speed-revert cycle still running, skipping this tick.");
                return;
            }

            // Re-check the config inside the cron to ensure it can be disabled without a restart
            let currentCronConfig;
            try {
                currentCronConfig = loadCronConfig();
            } catch (e) {
                console.error("[CRON_SPEED_REVERT_ERROR] Error reading cron.json:", e);
                return;
            }

            if (!currentCronConfig || currentCronConfig.status_speed_boost_revert !== true) {
                return;
            }

            if (!global.speed_requests || !Array.isArray(global.speed_requests)) {
                return;
            }

            speedRevertRunning = true;
            try {
            const now = new Date();
            let requestsModified = false;

            const activeRequests = global.speed_requests.filter(r => r.status === 'active');
            let expiredCount = 0;

            // Check if sync to MikroTik is enabled
            const syncToMikrotik = global.config.sync_to_mikrotik !== false; // Default to true if not set

            for (const req of global.speed_requests) {
                if (!req || req.status !== 'active') {
                    continue;
                }

                // Validate expiration date
                if (!req.expirationDate) {
                    console.warn(`[CRON_SPEED_REVERT_WARN] Request ${req.id || 'unknown'} has no expirationDate, skipping`);
                    continue;
                }

                const expirationDate = new Date(req.expirationDate);
                if (isNaN(expirationDate.getTime())) {
                    console.warn(`[CRON_SPEED_REVERT_WARN] Request ${req.id || 'unknown'} has invalid expirationDate: ${req.expirationDate}, skipping`);
                    continue;
                }

                if (expirationDate <= now) {
                    expiredCount++;
                    const requestId = req.id || 'unknown';
                    const userId = req.userId || 'unknown';
                    console.log(`[CRON_SPEED_REVERT] Reverting expired request ${requestId} (user: ${userId})...`);

                    if (!req.userId) {
                        console.error(`[CRON_SPEED_REVERT_ERROR] Request ${requestId} has no userId, skipping`);
                        req.status = 'error_revert_invalid_data';
                        requestsModified = true;
                        continue;
                    }

                    const userToRevert = global.users.find(u => u.id.toString() === req.userId.toString());
                    if (!userToRevert) {
                        console.error(`[CRON_SPEED_REVERT_ERROR] User with ID ${req.userId} not found for request ID ${requestId}.`);
                        req.status = 'error_revert_user_not_found';
                        requestsModified = true;
                        continue;
                    }

                    if (!req.currentPackageName) {
                        console.error(`[CRON_SPEED_REVERT_ERROR] Request ${requestId} has no currentPackageName, skipping`);
                        req.status = 'error_revert_invalid_data';
                        requestsModified = true;
                        continue;
                    }

                    const originalPackage = global.packages.find(p => p.name === req.currentPackageName);
                    if (!originalPackage || !originalPackage.profile) {
                        console.error(`[CRON_SPEED_REVERT_ERROR] Original package profile not found for package name: ${req.currentPackageName}.`);
                        req.status = 'error_revert_package_not_found';
                        requestsModified = true;
                        continue;
                    }

                    if (!req.pppoeUsername) {
                        console.error(`[CRON_SPEED_REVERT_ERROR] Request ${requestId} has no pppoeUsername, skipping`);
                        req.status = 'error_revert_invalid_data';
                        requestsModified = true;
                        continue;
                    }

                    if (!syncToMikrotik) {
                        continue;
                    }

                    const originalProfile = originalPackage.profile;

                    try {
                        // 1. Revert profile in Mikrotik
                        assertMikrotikResult(
                            await updatePPPoEProfile(req.pppoeUsername, originalProfile, { caller: 'cron.speed-revert' })
                        );

                        // 2. Disconnect user session
                        let disconnected = false;
                        try {
                            const disconnectResult = await deleteActivePPPoEUser(req.pppoeUsername, { caller: 'cron.speed-revert' });
                            if (!disconnectResult.ok) {
                                throw new Error(disconnectResult.message);
                            }
                            disconnected = true;
                        } catch (disconnectError) {
                            console.warn(`[CRON_SPEED_REVERT_WARN] Could not disconnect active session for ${req.pppoeUsername}: ${disconnectError.message}. This is often not critical.`);
                        }

                        // 3. Update request status
                        req.status = 'reverted';
                        requestsModified = true;

                        // 4. Send notification if enabled
                        let notificationSent = false;
                        if (currentCronConfig.status_message_sod_reverted === true && templatesCache.notificationTemplates['speed_on_demand_reverted'] && isReady()) {
                            if (userToRevert.phone_number && userToRevert.phone_number.trim() !== "") {
                                const dataPesan = {
                                    nama_pelanggan: userToRevert.name,
                                    requestedPackageName: req.requestedPackageName,
                                    originalPackageName: req.currentPackageName
                                };
                                const messageText = renderTemplate('speed_on_demand_reverted', dataPesan);

                                const messageDelay = (global.config && parseInt(global.config.whatsapp_message_delay)) || 2000;
                                const phoneNumbers = userToRevert.phone_number.split('|');
                                let sentToAny = false;
                                for (let number of phoneNumbers) {
                                    let normalizedNumber = number.trim().replace(/\D/g, '');
                                    if (normalizedNumber.length > 5) {
                                        const jid = normalizedNumber + "@s.whatsapp.net";
                                        const result = await safeSendMessage(jid, { text: messageText });

                                        if (result.success) {
                                            sentToAny = true;
                                            await delay(messageDelay);
                                        } else {
                                            console.error(`[CRON_SPEED_REVERT_NOTIF_ERROR] Failed to send 'reverted' message to ${jid}:`, result.error);
                                            if (result.shouldStop) break;
                                        }
                                    }
                                }
                                notificationSent = sentToAny;
                            }
                        }

                    } catch (mikrotikError) {
                        console.error(`[CRON_SPEED_REVERT_ERROR] Failed to revert Mikrotik profile for ${req.pppoeUsername}:`, mikrotikError.message);
                        requestsModified = true;
                        // #b347: kegagalan TRANSIEN (timeout/breaker/tak terjangkau) JANGAN di-finalize
                        // ke status error permanen — loop hanya proses 'active', jadi status error =
                        // pelanggan TERTAHAN di profil boost SELAMANYA (bocor pendapatan). Biarkan
                        // 'active' agar tick berikut mencoba lagi (updatePPPoEProfile idempoten; notif
                        // baru terkirim setelah SUKSES). Setelah MAX_REVERT_RETRIES → finalize + eskalasi.
                        if (isTransientMikrotikError(mikrotikError)) {
                            req.revertRetryCount = (req.revertRetryCount || 0) + 1;
                            if (req.revertRetryCount >= MAX_REVERT_RETRIES) {
                                req.status = 'error_revert_failed';
                                console.error(`[CRON_SPEED_REVERT_ERROR] ${req.pppoeUsername}: gagal revert ${req.revertRetryCount}x (transien) — finalize error + eskalasi admin.`);
                                await alertRevertStuck('SOD', req.pppoeUsername, req.revertRetryCount);
                            } else {
                                console.warn(`[CRON_SPEED_REVERT_RETRY] ${req.pppoeUsername}: gagal transien (${mikrotikError.code || mikrotikError.message}), tetap 'active' utk retry (${req.revertRetryCount}/${MAX_REVERT_RETRIES}).`);
                            }
                        } else {
                            // Permanen (paket tak ada / data invalid): retry tak menolong → finalize.
                            req.status = 'error_revert_failed';
                        }
                    }
                }
            }

            // Handle save errors
            // NOTE: saveSpeedRequests() is synchronous and uses fs.writeFileSync
            // For single instance, this is safe. For multiple instances, consider file locking.
            if (requestsModified) {
                try {
                    saveSpeedRequests();
                } catch (saveError) {
                    console.error(`[CRON_SPEED_REVERT_ERROR] Failed to save speed requests:`, saveError.message);
                }
            }

            if (expiredCount > 0) {
                console.log(`[CRON_SPEED_REVERT] Reverted ${expiredCount} expired request(s)`);
            } else if (activeRequests.length > 0) {
                console.log(`[CRON_SPEED_REVERT] ${activeRequests.length} active request(s) monitored`);
            }
            } finally {
                speedRevertRunning = false;
            }
        }, {
            scheduled: true,
            timezone: "Asia/Jakarta"
        });

        // Explicitly start the task
        cronTaskSpeedRequestRevert.start();
        console.log("[CRON_SPEED_REVERT] Task started successfully!");
    } else {
        // Speed revert task disabled (silent)
    }
}

module.exports = {
    initSpeedRevertTask
};
