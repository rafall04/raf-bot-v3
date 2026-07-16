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
 *   `lib/cron/jobs/isolir-notification.js`.
 * Deps: TIDAK ADA — seluruh dependency (safeSendMessage/isReady/delay/logger) DIINJEKSI supaya
 *   fungsi murni & mudah diuji, serta mock test tiap cron tetap mengalir.
 * MainFuncs: `sendQueueWithRetry`, `waitForWa`, `resolveRetryConfig`, `buildJid`.
 * SideEffects: Tidak ada sendiri; efek kirim datang dari `safeSendMessage` yang diinjeksi.
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

    let sent = 0;
    let pending = items.slice();
    let rounds = 0;

    for (let attempt = 1; attempt <= maxAttempts && pending.length > 0; attempt += 1) {
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
        for (const item of round) {
            if (!isReady()) {
                pending.push(item); // WA putus di tengah ronde → simpan, JANGAN hilang
                continue;
            }
            let result;
            try {
                result = await safeSendMessage(item.jid, { text: item.text });
            } catch (err) {
                result = { success: false, error: err && err.message };
            }
            if (result && result.success) {
                sent += 1;
                logger.log(`[${tag}] ✅ Terkirim ke ${item.label} (${item.jid})`);
                await delay(messageDelayMs);
            } else {
                pending.push(item);
                logger.error(`[${tag}_SEND_ERROR] Gagal kirim ke ${item.label} (${item.jid}): ${result && result.error}`);
            }
        }
    }

    for (const f of pending) {
        logger.error(`[${tag}_FAILED] ${f.label} (${f.jid}): TAK TERKIRIM setelah ${maxAttempts} ronde.`);
    }
    return { sent, failed: pending, rounds };
}

module.exports = {
    sendQueueWithRetry,
    waitForWa,
    resolveRetryConfig,
    buildJid,
    DEFAULT_MAX_ATTEMPTS,
    DEFAULT_WA_WAIT_MS,
};
