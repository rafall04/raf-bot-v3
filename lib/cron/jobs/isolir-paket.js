/**
 * Header Doc
 * Purpose: Cron ISOLIR PER-PAKET (#b305) — mengisolir pelanggan unpaid pada `isolir_day` PAKETnya
 *   (packages.json), bukan tanggal isolir GLOBAL (config.tanggal_isolir). Job HARIAN: tiap hari cek
 *   pelanggan kohort yang harinya sudah tiba & belum bayar, lalu isolir bila belum terisolir.
 *   Dedup TANPA state: baca profil PPPoE LIVE — bila sudah = isolir_profile, lewati (jaga masa grace
 *   reaktivasi manual + tak reboot berulang). Gagal baca profil → LEWATI (fail-safe: "tak bisa
 *   mengamati ≠ teramati buruk"). Notif isolir dikirim inline; jaring durabel bulanan tetap dari
 *   cron isolir-notification standar (yang tak mengecualikan kohort ini).
 * Caller: `lib/cron.js` (composer) via `initIsolirPaketTask`.
 * Deps: `node-cron`, `../shared`, `../wa-send-queue`, `../../templating`, `../../bill-pay-token`,
 *   `../../whatsapp-gateway`, `../../account-classification` (isPerPackageIsolirActive/getPackageIsolirDay/
 *   isInfrastructure/getWhitelistedPackageNames),
 *   `../../mikrotik` (getPPPoEUserProfile/assertMikrotikResult), `../../services/isolir-service`.
 * MainFuncs: `initIsolirPaketTask(config)`, `runIsolirPaketCycle(nowOverride)`.
 * SideEffects: Jadwalkan job, baca profil MikroTik, pindah profil PPPoE (isolir), kirim WA, log.
 *
 * GERBANG (FAIL-CLOSED, pola #b304): inert bila `config.isolirPerPaket.enabled !== true`. Eksklusi
 * kohort dari isolir standar (isPerPackageIsolirActive) menuntut fitur ON DAN cron terjadwal — bila
 * cron mati, kohort JATUH-AMAN ke isolir standar (ditangani, bukan diabaikan). Prioritas kohort:
 * akhir_bulan > isolir_day paket > global (lihat isPerPackageIsolirActive).
 */
"use strict";

const cron = require("node-cron");

const { delay, isValidCron, loadCronConfig, safeSendMessage } = require("../shared");
const { sendQueueWithRetry, buildJid, resolveRetryConfig } = require("../wa-send-queue");
const { renderTemplate } = require("../../templating");
const { buildBillPayUrl } = require("../../bill-pay-token");
const { isReady, getConnectionState } = require("../../whatsapp-gateway");
const {
    isInfrastructure,
    getWhitelistedPackageNames,
    isPerPackageIsolirActive,
    getPackageIsolirDay,
} = require("../../account-classification");
const { getPPPoEUserProfile, assertMikrotikResult } = require("../../mikrotik");
const IsolirService = require("../../services/isolir-service");

let cronTaskIsolirPaket = null;
let isolirPaketRunning = false;

/** Kohort = pelanggan (bukan infra) yang isolir per-paketnya AKTIF. */
function isCohortMember(user) {
    return !isInfrastructure(user) && isPerPackageIsolirActive(user);
}

/**
 * Inti siklus harian.
 * @param {Date} [nowOverride] untuk test.
 */
async function runIsolirPaketCycle(nowOverride = null) {
    const cfg = global.config || {};
    if (!(cfg.isolirPerPaket && cfg.isolirPerPaket.enabled === true)) {
        return { skipped: "feature-off" };
    }
    if (cfg.sync_to_mikrotik === false) {
        console.log("[CRON_ISOLIR_PAKET] Sync MikroTik DINONAKTIFKAN — lewati.");
        return { skipped: "sync-off" };
    }
    if (cfg.isolirFeatureEnabled === false) {
        console.log("[CRON_ISOLIR_PAKET] Fitur isolir dinonaktifkan — lewati.");
        return { skipped: "isolir-off" };
    }
    const isolirProfile = cfg.isolir_profile;
    if (!isolirProfile) {
        console.error("[CRON_ISOLIR_PAKET] isolir_profile tak terdefinisi di config — batal.");
        return { skipped: "no-isolir-profile" };
    }

    const now = nowOverride || new Date();
    const today = now.getDate();
    const periode = now.toLocaleDateString("id-ID", { month: "long", year: "numeric" });
    const paketWhitelist = getWhitelistedPackageNames();

    // FASE 1: kumpulkan kandidat (unpaid, kohort, hari isolir_day sudah tiba). Belum sentuh MikroTik.
    const candidates = [];
    const skipped = [];
    for (const user of global.users || []) {
        if (!isCohortMember(user)) continue;
        if (user.paid) continue;
        if (paketWhitelist.has(user.subscription)) { skipped.push({ name: user.name, reason: "paket whitelist" }); continue; }
        if (!user.pppoe_username) { skipped.push({ name: user.name, reason: "tanpa PPPoE" }); continue; }
        const isolirDay = getPackageIsolirDay(user);
        if (isolirDay === null) continue; // seharusnya tak terjadi (gerbang sudah cek), jaga-jaga
        if (today < isolirDay) continue; // belum harinya
        candidates.push({ user, isolirDay });
    }

    if (candidates.length === 0) {
        console.log(`[CRON_ISOLIR_PAKET] hari=${today}: tak ada kandidat isolir per-paket.`);
        return { day: today, isolated: 0, skipped: skipped.length, alreadyIsolir: 0, fetchFail: 0 };
    }

    const throttleMs = (cfg && parseInt(cfg.isolir_action_delay, 10)) || 500;
    console.log(`[CRON_ISOLIR_PAKET] hari=${today}: ${candidates.length} kandidat. Throttle ${throttleMs}ms.`);

    let isolated = 0;
    let failed = 0;
    let alreadyIsolir = 0;
    let fetchFail = 0;
    const isolatedUsers = [];

    // FASE 2: per kandidat — baca profil LIVE (dedup + fail-safe), lalu isolir bila perlu.
    for (const { user, isolirDay } of candidates) {
        let liveProfile = null;
        try {
            const res = await getPPPoEUserProfile(user.pppoe_username, { caller: "cron.isolir-paket" });
            const data = assertMikrotikResult(res);
            liveProfile = data && data.data ? data.data.profile : null;
        } catch (error) {
            // FAIL-SAFE: tak bisa membaca profil → JANGAN isolir buta. Lewati, coba lagi besok.
            fetchFail++;
            console.error(`[CRON_ISOLIR_PAKET_FETCH_ERROR] ${user.name} (${user.pppoe_username}): ${error.message}`);
            continue;
        }
        if (liveProfile === isolirProfile) { alreadyIsolir++; continue; } // sudah terisolir → dedup

        try {
            const actionResult = await IsolirService.executeProfileAction(user, {
                targetProfile: isolirProfile,
                disconnect: true,
                reboot: true,
                caller: "cron.isolir-paket",
            });
            if (!actionResult || !actionResult.ok) throw new Error(actionResult ? actionResult.message : "Tak ada hasil");
            console.log(`[CRON_ISOLIR_PAKET_SUCCESS] ${user.pppoe_username} diisolir (isolir_day=${isolirDay}).`);
            isolated++;
            isolatedUsers.push(user);
        } catch (e) {
            failed++;
            console.error(`[CRON_ISOLIR_PAKET_ERROR] Gagal isolir ${user.name}: ${e.message || e}`);
        }
        if (throttleMs > 0) await delay(throttleMs);
    }

    // FASE 3: notif isolir inline (jaring durabel bulanan tetap dari isolir-notification standar).
    const notifItems = [];
    for (const user of isolatedUsers) {
        if (!user.phone_number) continue;
        let linkBayar = "";
        try {
            linkBayar = buildBillPayUrl(user, { periodMonth: now.getMonth() + 1, periodYear: now.getFullYear() });
        } catch (linkErr) {
            console.error(`[CRON_ISOLIR_PAKET] Gagal buat link bayar ${user.name}: ${linkErr.message}`);
        }
        const message = renderTemplate("isolir_notification", { nama_pelanggan: user.name, periode, link_bayar: linkBayar });
        if (!message || String(message).startsWith("Error:")) continue;
        for (const raw of String(user.phone_number).split("|")) {
            const jid = buildJid(raw);
            if (jid) notifItems.push({ jid, text: message, label: user.name });
        }
    }
    let notified = 0;
    if (notifItems.length) {
        if (!isReady()) console.warn(`[CRON_ISOLIR_PAKET] WhatsApp belum siap (state: ${getConnectionState()}) — antrian ${notifItems.length} di-retry.`);
        const res = await sendQueueWithRetry({
            items: notifItems, safeSendMessage, isReady, delay,
            messageDelayMs: (cfg && parseInt(cfg.whatsapp_message_delay, 10)) || 2000,
            retry: resolveRetryConfig(cfg), tag: "CRON_ISOLIR_PAKET_NOTIF", logger: console,
        });
        notified = res.sent;
    }

    console.log(`[CRON_ISOLIR_PAKET] === SUMMARY === hari=${today} kandidat=${candidates.length} isolir=${isolated} gagal=${failed} sudah-isolir=${alreadyIsolir} gagal-baca-profil=${fetchFail} notif=${notified}`);
    return { day: today, isolated, failed, alreadyIsolir, fetchFail, notified, skipped: skipped.length };
}

/**
 * Jadwalkan/restart task. Schedule + status dari cron.json; enable fitur dari config.json tiap tick.
 * Fail-closed misconfig warning (#b304): enabled tapi tak terjadwal → teriak keras.
 */
function initIsolirPaketTask(config) {
    if (cronTaskIsolirPaket) cronTaskIsolirPaket.stop();
    if (config.status_isolir_paket === true && isValidCron(config.schedule_isolir_paket)) {
        console.log("[CRON_ISOLIR_PAKET] Start/restart schedule:", config.schedule_isolir_paket);
        cronTaskIsolirPaket = cron.schedule(config.schedule_isolir_paket, async () => {
            if (isolirPaketRunning) {
                console.warn("[CRON_ISOLIR_PAKET_SKIPPED] Siklus sebelumnya masih jalan, lewati tick ini.");
                return;
            }
            const currentConfig = loadCronConfig();
            if (currentConfig.status_isolir_paket !== true) return;
            isolirPaketRunning = true;
            try {
                await runIsolirPaketCycle();
            } catch (err) {
                console.error("[CRON_ISOLIR_PAKET_ERROR]", err.message || err);
            } finally {
                isolirPaketRunning = false;
            }
        });
    } else {
        const fiturOn = !!(global.config && global.config.isolirPerPaket && global.config.isolirPerPaket.enabled === true);
        if (fiturOn) {
            console.error(
                "[CRON_ISOLIR_PAKET_MISCONFIG] config.isolirPerPaket.enabled=true TAPI job tak terjadwal " +
                `(status_isolir_paket=${config.status_isolir_paket}, schedule=${JSON.stringify(config.schedule_isolir_paket)}, ` +
                `valid=${isValidCron(config.schedule_isolir_paket)}). Kohort per-paket JATUH-AMAN ke isolir standar. ` +
                "Set status_isolir_paket=true + schedule valid di database/cron.json."
            );
        }
    }
}

module.exports = {
    initIsolirPaketTask,
    runIsolirPaketCycle,
    isCohortMember,
};
