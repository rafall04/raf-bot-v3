/**
 * Header Doc
 * Purpose: Primitif presentasi pesan Telegram (parse_mode HTML) untuk bot teknisi —
 *          escape HTML, badge status ONU, vonis kualitas redaman (rxVerdict), dan
 *          builder pesan generik (belum terdaftar). Murni & bebas I/O agar mudah diuji.
 *          Formatter laporan lengkap (redaman/koneksi/modem/olt/pelanggan) ditambahkan
 *          di modul ini juga dan dipakai command-handlers.
 * Caller: `lib/telegram/telegram-intent-dispatch.js`, `message/telegram/command-handlers/*`.
 * Deps: (tidak ada).
 * MainFuncs: `escapeHtml`, `b`, `code`, `statusBadge`, `rxVerdict`, `buildUnregisteredMessage`,
 *            + formatter laporan.
 * SideEffects: tidak ada.
 */
"use strict";

/** Escape karakter yang bermakna di parse_mode HTML Telegram (& < >). */
function escapeHtml(value) {
    return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function b(value) {
    return `<b>${escapeHtml(value)}</b>`;
}

function code(value) {
    return `<code>${escapeHtml(value)}</code>`;
}

/** Badge emoji untuk status ONU. */
function statusBadge(status) {
    const s = String(status || "").toLowerCase();
    if (s === "online") return "🟢";
    if (s === "los") return "🔴";
    if (s.includes("dying")) return "🟠";
    if (s === "offline") return "⚫";
    return "⚪";
}

/**
 * Parse nilai redaman (dBm) dari number / string ("-25", "-25 dBm"). null bila tak valid.
 */
function parseRedaman(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "string") {
        const m = value.match(/-?\d+(\.\d+)?/);
        if (m) {
            const n = parseFloat(m[0]);
            return Number.isFinite(n) ? n : null;
        }
    }
    return null;
}

/**
 * Vonis kualitas RX power vs toleransi (mis. -25). Nilai makin negatif = makin buruk.
 * @returns {{ emoji:string, label:string, value:(number|null) }}
 */
function rxVerdict(rawValue, tolerance) {
    const value = parseRedaman(rawValue);
    const tol = parseRedaman(tolerance);
    if (value === null) return { emoji: "⚪", label: "tidak ada data", value: null };
    if (tol === null) return { emoji: "🟢", label: "—", value };
    if (value < tol) return { emoji: "🔴", label: "BURUK", value };
    if (value < tol + 3) return { emoji: "🟡", label: "WASPADA", value };
    return { emoji: "🟢", label: "BAIK", value };
}

/** Pesan untuk chat yang belum ter-whitelist (sekaligus beri tahu chat_id-nya). */
function buildUnregisteredMessage(chatId) {
    return (
        "⛔ Kamu belum terdaftar sebagai teknisi.\n\n" +
        `chat_id kamu: ${code(chatId)}\n\n` +
        "Kirim ID di atas ke admin agar didaftarkan."
    );
}

/** Pesan untuk teknisi terdaftar tetapi dinonaktifkan sementara. */
function buildDisabledMessage() {
    return "⛔ Akses bot kamu sedang dinonaktifkan sementara. Hubungi admin.";
}

module.exports = {
    escapeHtml,
    b,
    code,
    statusBadge,
    parseRedaman,
    rxVerdict,
    buildUnregisteredMessage,
    buildDisabledMessage,
};
