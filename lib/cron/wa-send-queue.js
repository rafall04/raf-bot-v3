/**
 * Header Doc
 * Purpose: Helper BERSAMA pengiriman WA massal untuk cron tagihan — antrian + RETRY tahan blip
 *   koneksi + laporan lengkap (TAK BISU). Satu pola untuk `reminder`, `grace-reminder` (masa
 *   tenggang), dan `isolir-notification`.
 *   AKAR (prod 2026-07-16): tiap cron dulu punya perilaku sendiri saat WA putus sesaat —
 *   reminder & masa tenggang `break` (sisa antrian HILANG untuk bulan itu), notif isolir melewati
 *   DIAM-DIAM tanpa log (kasus Achwan Fatoni: WA drop tepat di gilirannya, log terlanjur bilang
 *   "sent"). Blip 7 detik tak boleh menghilangkan pelanggan.
 * Caller: `lib/cron/jobs/reminder.js`, `lib/cron/jobs/grace-reminder.js`,
 *   `lib/cron/jobs/isolir-notification.js`, `lib/cron/jobs/rating-survey.js`.
 * Deps: dependency inti (safeSendMessage/isReady/delay/logger) DIINJEKSI. ANTI-BAN (opt-in
 *   `config.broadcastGuard.enabled`) me-lazy-require `../broadcast-ledger` (skip terblokir/min-gap),
 *   `../admin-recipients`+`../whatsapp-critical-delivery` (alert saat circuit-breaker trip).
 * MainFuncs: `sendQueueWithRetry`, `waitForWa`, `resolveRetryConfig`, `resolveBroadcastGuard`, `buildJid`.
 * SideEffects: Kirim via `safeSendMessage` diinjeksi; saat guard ON juga baca/tulis broadcast_ledger
 *   & bisa kirim alert admin (breaker). Guard OFF (default) = tak ada side-effect tambahan.
 *
 * ANTI-BAN GUARD (opt-in): (1) jitter delay, (2) jeda batch tiap N pesan, (3) cap per-run + tunda sisa,
 *   (4) circuit-breaker (gagal beruntun → stop + alert), (5) ledger (lewati terblokir/over-messaging).
 *   enabled=false → helper INERT (perilaku lama byte-identik).
 */
"use strict";

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_WA_WAIT_MS = 60000; // tunggu WA pulih sebelum ronde ulang
const DEFAULT_POLL_MS = 2000;

/** Normalisasi 1 nomor → JID WhatsApp. Return null bila tak valid. */
function buildJid(raw) {
    const digits = String(raw || "").trim().replace(/\D/g, "");
    return digits.length > 5 ? `${digits}@s.whatsapp.net` : null;
}

/** Ambil setelan retry (calibratable lewat `config.waSendRetry`). */
function resolveRetryConfig(config) {
    const c = (config && config.waSendRetry) || {};
    return {
        maxAttempts: Number.isFinite(c.maxAttempts) && c.maxAttempts > 0 ? c.maxAttempts : DEFAULT_MAX_ATTEMPTS,
        waWaitMs: Number.isFinite(c.waitMs) && c.waitMs >= 0 ? c.waitMs : DEFAULT_WA_WAIT_MS,
        pollMs: Number.isFinite(c.pollMs) && c.pollMs > 0 ? c.pollMs : DEFAULT_POLL_MS,
    };
}

// Default anti-ban broadcast (calibratable lewat config.broadcastGuard). Angka konservatif-aktif.
const GUARD_DEFAULTS = { jitterMaxExtraMs: 4000, batchSize: 25, batchPauseMs: 60000, maxPerRun: 0, breakerThreshold: 6, minGapMs: 0, validateOnWhatsApp: false, waRecheckDays: 30 };

/**
 * Setelan anti-ban broadcast dari `config.broadcastGuard`. `enabled=false` (default) → helper
 * berperilaku PERSIS seperti sebelum fitur ini ada (inert). Tiap knob 0 = fitur itu mati.
 */
function resolveBroadcastGuard(config) {
    const c = (config && config.broadcastGuard) || {};
    const nOr = (v, d) => (Number.isFinite(v) && v >= 0 ? v : d);
    return {
        enabled: c.enabled === true,
        jitterMaxExtraMs: nOr(c.jitterMaxExtraMs, GUARD_DEFAULTS.jitterMaxExtraMs),
        batchSize: nOr(c.batchSize, GUARD_DEFAULTS.batchSize),
        batchPauseMs: nOr(c.batchPauseMs, GUARD_DEFAULTS.batchPauseMs),
        maxPerRun: nOr(c.maxPerRun, GUARD_DEFAULTS.maxPerRun),
        breakerThreshold: nOr(c.breakerThreshold, GUARD_DEFAULTS.breakerThreshold),
        minGapMs: nOr(c.minGapMs, GUARD_DEFAULTS.minGapMs),
        validateOnWhatsApp: c.validateOnWhatsApp === true,
        waRecheckDays: nOr(c.waRecheckDays, GUARD_DEFAULTS.waRecheckDays) || GUARD_DEFAULTS.waRecheckDays,
    };
}

let _waChecker;
/** Pengecek onWhatsApp runtime (lazy). Null bila gagal require → pemanggil fail-open. */
function getDefaultWaChecker() {
    if (_waChecker === undefined) {
        try { _waChecker = require("../whatsapp-gateway").isRegisteredOnWhatsApp; }
        catch (_e) { _waChecker = null; }
    }
    return _waChecker;
}

let _ledgerSingleton;
/** Ledger broadcast runtime (lazy). Null bila gagal init → pemanggil fail-open. */
function getDefaultLedger() {
    if (_ledgerSingleton === undefined) {
        try { _ledgerSingleton = require("../broadcast-ledger").getBroadcastLedger(); }
        catch (_e) { _ledgerSingleton = null; }
    }
    return _ledgerSingleton;
}

/** Alert admin default saat circuit-breaker trip (best-effort, never-throw). */
async function defaultOnBreaker(info) {
    try {
        const { getAdminJids } = require("../admin-recipients");
        const { sendCritical } = require("../whatsapp-critical-delivery");
        const jids = getAdminJids();
        const text = `🚨 *Broadcast dihentikan otomatis* (${info.tag})\n\n${info.consecutiveErrors} kegagalan kirim beruntun — kemungkinan koneksi WA bermasalah/dibatasi. ${info.deferred} pesan DITUNDA ke run berikutnya (tak hilang). Mohon cek koneksi WhatsApp.`;
        for (const jid of jids) { try { await sendCritical(jid, { text }, { label: "broadcast-breaker" }); } catch (_e) { /* best-effort */ } }
    } catch (_e) { /* never-throw */ }
}

/** Tunggu WhatsApp siap (poll) sampai `maxWaitMs`. Return true bila siap. */
async function waitForWa({ isReady, delay, maxWaitMs, pollMs = DEFAULT_POLL_MS }) {
    if (isReady()) return true;
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
        await delay(pollMs);
        if (isReady()) return true;
    }
    return isReady();
}

/**
 * Kirim antrian pesan dengan RETRY tahan blip koneksi.
 * 1 item = 1 NOMOR (bukan per pelanggan) → retry TIDAK dobel-kirim ke nomor yang sudah sukses.
 * Item yang gagal / terkena WA-putus dikembalikan ke antrian dan dicoba di ronde berikutnya
 * setelah menunggu koneksi pulih. Yang tetap gagal DILAPORKAN eksplisit (tak hilang diam-diam).
 *
 * @param {object} o
 * @param {Array<{jid:string,text:string,label:string}>} o.items
 * @param {function} o.safeSendMessage  (jid, {text}) => {success, error?, shouldStop?}
 * @param {function} o.isReady          () => boolean
 * @param {function} o.delay            (ms) => Promise
 * @param {number}   [o.messageDelayMs] jeda antar pesan sukses
 * @param {object}   [o.retry]          {maxAttempts, waWaitMs, pollMs}
 * @param {string}   [o.tag]            prefix log, mis. 'CRON_REMINDER'
 * @param {object}   [o.logger]
 * @returns {Promise<{sent:number, failed:Array, rounds:number}>}
 */
async function sendQueueWithRetry(o = {}) {
    const {
        items = [],
        safeSendMessage,
        isReady,
        delay,
        messageDelayMs = 2000,
        tag = "CRON",
        logger = console,
    } = o;
    const { maxAttempts, waWaitMs, pollMs } = { ...resolveRetryConfig(null), ...(o.retry || {}) };

    // ANTI-BAN GUARD — opt-in lewat config.broadcastGuard.enabled. OFF → perilaku lama PERSIS.
    const guard = o.guard || resolveBroadcastGuard(typeof global !== "undefined" ? global.config : null);
    const guardOn = Boolean(guard && guard.enabled === true);
    const ledger = o.ledger !== undefined ? o.ledger : (guardOn ? getDefaultLedger() : null);
    const random = typeof o.random === "function" ? o.random : Math.random;
    const checkRegistered = typeof o.checkRegistered === "function"
        ? o.checkRegistered
        : (guardOn && guard.validateOnWhatsApp ? getDefaultWaChecker() : null);
    const waRecheckMs = (guard.waRecheckDays || 30) * 86400000;
    const nextDelayMs = () => (guardOn ? messageDelayMs + Math.floor(random() * guard.jitterMaxExtraMs) : messageDelayMs);

    let sent = 0;
    let sentInBatch = 0;
    let consecutiveErrors = 0;
    let breakerTripped = false;
    let pending = items.slice();
    let deferred = [];
    const skipped = [];
    let rounds = 0;
    let stop = false;

    for (let attempt = 1; attempt <= maxAttempts && pending.length > 0 && !stop; attempt += 1) {
        rounds = attempt;
        if (attempt > 1) {
            logger.warn(`[${tag}_RETRY] Ronde ${attempt}/${maxAttempts} — ${pending.length} pesan tersisa, menunggu WhatsApp siap...`);
            const ready = await waitForWa({ isReady, delay, maxWaitMs: waWaitMs, pollMs });
            if (!ready) {
                logger.error(`[${tag}_RETRY] WhatsApp belum pulih setelah ${waWaitMs}ms — ronde ${attempt} ditunda.`);
                continue; // `pending` sengaja TIDAK dikosongkan → dicoba lagi ronde berikutnya
            }
        }

        const round = pending;
        pending = [];
        for (let idx = 0; idx < round.length; idx += 1) {
            const item = round[idx];

            // (3) CAP per-run: sisanya DITUNDA ke run berikutnya (bukan blast sekaligus). Default OFF.
            if (guardOn && guard.maxPerRun > 0 && sent >= guard.maxPerRun) {
                deferred = deferred.concat(round.slice(idx));
                logger.warn(`[${tag}_CAP] Batas ${guard.maxPerRun}/run tercapai — ${deferred.length} pesan ditunda ke run berikutnya.`);
                stop = true;
                break;
            }

            if (!isReady()) {
                pending.push(item); // WA putus di tengah ronde → simpan, JANGAN hilang
                continue;
            }

            // (5) LEDGER: lewati nomor terblokir / baru dikirimi (< minGap). FAIL-OPEN.
            if (ledger) {
                let sk = null;
                try { sk = await ledger.shouldSkip(item.jid, { minGapMs: guardOn ? guard.minGapMs : 0 }); } catch (_e) { sk = null; }
                if (sk && sk.skip) {
                    skipped.push({ jid: item.jid, label: item.label, reason: sk.reason });
                    logger.log(`[${tag}_SKIP] ${item.label} (${item.jid}): ${sk.reason}`);
                    continue;
                }
            }

            // (6) VALIDASI onWhatsApp: lewati nomor TAK TERDAFTAR (kurangi sinyal gagal-kirim). FAIL-OPEN + cache.
            if (checkRegistered) {
                let registered = null;
                const cached = ledger ? await ledger.getWaStatus(item.jid) : null;
                if (cached && (Date.now() - cached.checkedAt) < waRecheckMs) {
                    registered = cached.registered;
                } else {
                    try { registered = await checkRegistered(item.jid); } catch (_e) { registered = null; }
                    if (registered !== null && ledger) { try { await ledger.setWaStatus(item.jid, registered); } catch (_e) { /* fail-open */ } }
                }
                if (registered === false) {
                    skipped.push({ jid: item.jid, label: item.label, reason: "tak terdaftar di WhatsApp" });
                    logger.log(`[${tag}_SKIP] ${item.label} (${item.jid}): tak terdaftar di WhatsApp`);
                    continue;
                }
            }

            let result;
            try {
                result = await safeSendMessage(item.jid, { text: item.text });
            } catch (err) {
                result = { success: false, error: err && err.message };
            }
            if (result && result.success) {
                sent += 1;
                sentInBatch += 1;
                consecutiveErrors = 0;
                logger.log(`[${tag}] ✅ Terkirim ke ${item.label} (${item.jid})`);
                if (ledger) { try { await ledger.recordSent(item.jid); } catch (_e) { /* fail-open */ } }

                // (1) jitter delay / (2) jeda batch tiap N pesan.
                const moreLeft = idx < round.length - 1 || pending.length > 0;
                if (guardOn && guard.batchSize > 0 && sentInBatch >= guard.batchSize && moreLeft) {
                    logger.log(`[${tag}_BATCH] Jeda ${Math.round(guard.batchPauseMs / 1000)}s setelah ${sentInBatch} pesan (anti-ban).`);
                    sentInBatch = 0;
                    await delay(guard.batchPauseMs);
                } else {
                    await delay(nextDelayMs());
                }
            } else {
                pending.push(item);
                consecutiveErrors += 1;
                logger.error(`[${tag}_SEND_ERROR] Gagal kirim ke ${item.label} (${item.jid}): ${result && result.error}`);

                // (4) CIRCUIT BREAKER: gagal beruntun banyak → STOP + sisa ditandai gagal + alert admin.
                if (guardOn && guard.breakerThreshold > 0 && consecutiveErrors >= guard.breakerThreshold) {
                    breakerTripped = true;
                    pending = pending.concat(round.slice(idx + 1)); // sisa tak-dicoba → dilaporkan gagal (bukan hilang)
                    const stuck = pending.length;
                    logger.error(`[${tag}_BREAKER] ${consecutiveErrors} gagal beruntun — STOP broadcast, ${stuck} pesan tak terkirim.`);
                    try { await (o.onBreaker || defaultOnBreaker)({ tag, consecutiveErrors, deferred: stuck }); } catch (_e) { /* best-effort */ }
                    stop = true;
                    break;
                }
            }
        }
    }

    for (const f of pending) {
        logger.error(`[${tag}_FAILED] ${f.label} (${f.jid}): TAK TERKIRIM${breakerTripped ? " (breaker)" : ` setelah ${maxAttempts} ronde`}.`);
    }

    const out = { sent, failed: pending, rounds };
    if (guardOn || deferred.length || skipped.length || breakerTripped) {
        out.deferred = deferred;
        out.skipped = skipped;
        out.breakerTripped = breakerTripped;
    }
    return out;
}

module.exports = {
    sendQueueWithRetry,
    waitForWa,
    resolveRetryConfig,
    resolveBroadcastGuard,
    buildJid,
    DEFAULT_MAX_ATTEMPTS,
    DEFAULT_WA_WAIT_MS,
    GUARD_DEFAULTS,
};
