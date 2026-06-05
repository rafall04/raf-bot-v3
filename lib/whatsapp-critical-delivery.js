/**
 * WhatsApp Critical Delivery
 *
 * Pengiriman pesan WhatsApp yang TIDAK BOLEH hilang diam-diam — kode voucher,
 * konfirmasi transfer saldo, dll. Jalur `sendReply`/`sendMessage` biasa menyerah
 * saat gagal (swallow error) atau drop saat WA belum ready. Untuk pesan finansial,
 * itu berarti pelanggan bayar tapi tidak dapat bukti/kode.
 *
 * Jaminan di sini:
 *   1. Tunggu WA ready (bounded) — handle window reconnect.
 *   2. Retry exponential backoff untuk kegagalan transient.
 *   3. Kalau tetap gagal → persist ke DEAD-LETTER (database/failed_critical_deliveries.json)
 *      dengan recipient + isi pesan lengkap, supaya bisa di-retry / di-relay admin.
 *      Tidak ada yang hilang diam-diam.
 *
 * Catatan: dead-letter menyimpan isi pesan apa adanya (termasuk kode voucher).
 * Itu disengaja — supaya admin bisa relay manual ke pelanggan kalau auto-retry
 * gagal total. File server-local.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const gateway = require("./whatsapp-gateway");

const DEAD_LETTER_FILE = path.join(__dirname, "..", "database", "failed_critical_deliveries.json");
const MAX_DEAD_LETTER = 500;

const DEFAULTS = {
    maxAttempts: 4,
    baseDelayMs: 600,      // 600, 1200, 2400
    waitForReadyMs: 20000, // tunggu reconnect maksimal 20 detik
    pollIntervalMs: 1000,
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function ensureJid(recipient) {
    if (!recipient) return "";
    const str = String(recipient);
    if (str.includes("@")) return str; // sudah JID (s.whatsapp.net / @lid / @g.us)
    let digits = str.replace(/[^0-9]/g, "");
    if (!digits) return "";            // tidak ada digit sama sekali → invalid (ditolak)
    // Normalisasi ke format internasional Indonesia. PENTING: nomor lokal "08xxx"
    // HARUS jadi "628xxx" — kalau tidak, JID "08xxx@s.whatsapp.net" tidak terkirim.
    if (digits.startsWith("0")) digits = "62" + digits.slice(1);
    else if (!digits.startsWith("62")) digits = "62" + digits;
    return `${digits}@s.whatsapp.net`;
}

function maskRecipient(jid) {
    const d = String(jid || "").replace(/@.*/, "");
    if (d.length <= 6) return d || "unknown";
    return `${d.slice(0, 4)}****${d.slice(-2)}`;
}

function loadDeadLetters() {
    try {
        if (fs.existsSync(DEAD_LETTER_FILE)) {
            const parsed = JSON.parse(fs.readFileSync(DEAD_LETTER_FILE, "utf8"));
            return Array.isArray(parsed) ? parsed : [];
        }
    } catch (err) {
        console.error("[WA_CRITICAL] Gagal baca dead-letter:", err.message);
    }
    return [];
}

function saveDeadLetters(entries) {
    try {
        const trimmed = entries.length > MAX_DEAD_LETTER ? entries.slice(-MAX_DEAD_LETTER) : entries;
        fs.writeFileSync(DEAD_LETTER_FILE, JSON.stringify(trimmed, null, 2), "utf8");
    } catch (err) {
        console.error("[WA_CRITICAL] Gagal tulis dead-letter:", err.message);
    }
}

function persistFailed(jid, message, label, errorCode, attempts) {
    const entries = loadDeadLetters();
    entries.push({
        id: `dl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
        recipient: jid,
        label: label || "critical",
        message,          // isi lengkap supaya bisa di-relay/retry
        errorCode: errorCode || "SEND_FAILED",
        attempts: attempts || 0,
        retried: false,
        retried_at: null,
    });
    saveDeadLetters(entries);
    console.error(`[WA_CRITICAL] DEAD-LETTER tersimpan: ${label} → ${maskRecipient(jid)} (${errorCode})`);
}

/**
 * Kirim pesan kritis dengan jaminan: tunggu-ready → retry → dead-letter.
 *
 * @param {string} recipient - nomor / JID
 * @param {object} message - payload Baileys (mis. { text }) atau { contacts }
 * @param {object} options - { label, maxAttempts, baseDelayMs, waitForReadyMs, pollIntervalMs, ...sendOpts }
 * @returns {Promise<{delivered:boolean, attempts:number, errorCode?:string}>}
 */
async function sendCritical(recipient, message, options = {}) {
    const cfg = {
        maxAttempts: Number.isInteger(options.maxAttempts) ? options.maxAttempts : DEFAULTS.maxAttempts,
        baseDelayMs: Number.isInteger(options.baseDelayMs) ? options.baseDelayMs : DEFAULTS.baseDelayMs,
        waitForReadyMs: Number.isInteger(options.waitForReadyMs) ? options.waitForReadyMs : DEFAULTS.waitForReadyMs,
        pollIntervalMs: Number.isInteger(options.pollIntervalMs) ? options.pollIntervalMs : DEFAULTS.pollIntervalMs,
    };
    const label = options.label || "critical";
    const jid = ensureJid(recipient);
    if (!jid) {
        persistFailed(String(recipient || ""), message, label, "INVALID_RECIPIENT", 0);
        return { delivered: false, attempts: 0, errorCode: "INVALID_RECIPIENT" };
    }

    // 1. Tunggu WA ready (bounded) — handle reconnect.
    const readyDeadline = Date.now() + cfg.waitForReadyMs;
    while (!gateway.isReady() && Date.now() < readyDeadline) {
        await wait(cfg.pollIntervalMs);
    }
    if (!gateway.isReady()) {
        persistFailed(jid, message, label, "WHATSAPP_NOT_CONNECTED", 0);
        return { delivered: false, attempts: 0, errorCode: "WHATSAPP_NOT_CONNECTED" };
    }

    // 2. Kirim + retry.
    const sendOpts = { ...options };
    ["label", "maxAttempts", "baseDelayMs", "waitForReadyMs", "pollIntervalMs"].forEach((k) => delete sendOpts[k]);

    let lastError = null;
    for (let attempt = 1; attempt <= cfg.maxAttempts; attempt += 1) {
        try {
            await gateway.sendPayload(jid, message, sendOpts);
            if (attempt > 1) {
                console.log(`[WA_CRITICAL] ${label} → ${maskRecipient(jid)} terkirim di attempt ${attempt}`);
            }
            return { delivered: true, attempts: attempt };
        } catch (err) {
            lastError = err;
            if (attempt < cfg.maxAttempts) {
                await wait(cfg.baseDelayMs * Math.pow(2, attempt - 1));
            }
        }
    }

    // 3. Gagal total → dead-letter.
    persistFailed(jid, message, label, lastError?.message || "SEND_FAILED", cfg.maxAttempts);
    return { delivered: false, attempts: cfg.maxAttempts, errorCode: "SEND_FAILED", warning: lastError?.message };
}

/**
 * Daftar pesan kritis yang gagal terkirim (untuk admin / recovery).
 */
function listFailedDeliveries({ unretriedOnly = false } = {}) {
    const entries = loadDeadLetters();
    return unretriedOnly ? entries.filter((e) => !e.retried) : entries;
}

/**
 * Coba kirim ulang semua dead-letter yang belum di-retry. Tandai retried saat sukses.
 * @returns {Promise<{attempted:number, delivered:number}>}
 */
async function retryFailedDeliveries(options = {}) {
    const entries = loadDeadLetters();
    let attempted = 0;
    let delivered = 0;
    for (const entry of entries) {
        if (entry.retried) continue;
        attempted += 1;
        // Pakai sendCritical tanpa re-persist loop tak hingga: kalau gagal lagi,
        // entry tetap unretried (sendCritical akan buat dead-letter baru — tapi kita
        // cegah dengan kirim langsung di sini).
        const jid = ensureJid(entry.recipient);
        if (!jid || !gateway.isReady()) continue;
        try {
            await gateway.sendPayload(jid, entry.message, {});
            entry.retried = true;
            entry.retried_at = new Date().toISOString();
            delivered += 1;
        } catch (err) {
            console.error(`[WA_CRITICAL] Retry gagal untuk ${maskRecipient(jid)}:`, err.message);
        }
    }
    if (delivered > 0) saveDeadLetters(entries);
    return { attempted, delivered };
}

module.exports = {
    sendCritical,
    listFailedDeliveries,
    retryFailedDeliveries,
    // Internal — test.
    _ensureJid: ensureJid,
    _loadDeadLetters: loadDeadLetters,
    _DEAD_LETTER_FILE: DEAD_LETTER_FILE,
};
