/**
 * Header Doc
 * Purpose: Penanda aktivitas chat untuk menahan auto-respons bot: (1) kapan admin terakhir balas
 *          MANUAL dari nomor bot ke sebuah chat (event `fromMe` dari HP ter-link), (2) kapan bot
 *          terakhir mengirim balasan fallback (cooldown anti-spam), (3) kapan pelanggan terakhir
 *          mengeluh koneksi (konteks multi-turn — "Shopee kak" susulan dikenali sebagai lanjutan).
 *
 *          DURABEL sejak 14-07. Sebelumnya murni Map in-memory, dan itu akar insiden bukti-bayar
 *          palsu: prod restart 7–13×/hari, foto koordinasi CCTV masuk 19 DETIK sesudah restart →
 *          Map masih kosong → gerbang "admin sedang menangani chat" tidak tahu apa-apa → foto
 *          ditangkap sebagai bukti pembayaran. Sinyal pengaman TIDAK BOLEH amnesia (CLAUDE.md:
 *          "Durable jobs, not setTimeout" — apa pun yang menahan bot dari salah bertindak harus
 *          bertahan lintas restart).
 *
 *          Modul ini TETAP MURNI: I/O hanya lewat adapter yang DISUNTIK lewat
 *          `configureChatActivityPersistence()` (default: tidak ada → perilaku in-memory seperti
 *          dulu, jadi test tetap cepat & tanpa DB).
 * Caller: `message/raf.js` (noteAdminOutbound pada event fromMe), `message/handlers/customer-fallback-handler.js`
 *         (cek umur + cooldown + konteks komplain), `message/handlers/connection-check-handler.js`
 *         (noteConnectivityComplaint), `index.js` (configureChatActivityPersistence saat boot),
 *         `services/payment-proof.service.js` lewat raf.js (isAdminHandlingChat + isChatSignalReady).
 * Deps: — (murni; persistensi disuntik dari `repositories/message-log.repository`).
 * MainFuncs: `noteAdminOutbound`, `getAdminOutboundAgeMs`, `isAdminHandlingChat`, `noteFallbackReply`,
 *            `getFallbackReplyAgeMs`, `noteConnectivityComplaint`, `getConnectivityComplaintAgeMs`,
 *            `hasRecentComplaint`, `configureChatActivityPersistence`, `isChatSignalReady`,
 *            `hydrateChatActivity`, `resetChatActivityForTest`.
 * SideEffects: Menulis Map in-memory (bounded, prune otomatis) + tulis-balik best-effort ke adapter
 *              persistensi bila dikonfigurasi (fire-and-forget, tidak pernah throw).
 */
"use strict";

const MAX_ENTRIES = 3000;
const PRUNE_TO = 2000;

const adminOutboundByChat = new Map();
const fallbackReplyByChat = new Map();
const complaintByChat = new Map();

/**
 * Adapter persistensi (disuntik). Kontrak:
 *   saveAdminOutbound(chatJid, timestampMs) -> void  (fire-and-forget, tak boleh throw)
 *   saveComplaint(chatJid, timestampMs)     -> void  (idem)
 *   loadRecent(maxAgeMs) -> Promise<Array<{chat_jid, last_admin_outbound_at, last_complaint_at}>>
 */
let persistence = null;

/**
 * State pemulihan jejak dari disk:
 *   "none"    → tanpa persistensi (test / fallback) — perilaku in-memory, dianggap SIAP.
 *   "pending" → sedang memulihkan. Kita BUTA: Map kosong bukan berarti "tak ada admin".
 *   "ready"   → jejak sudah pulih (atau gagal pulih & kita menyerah ke mode in-memory).
 */
let hydrationState = "none";

function pruneIfNeeded(map) {
    if (map.size <= MAX_ENTRIES) return;
    // Map menjaga urutan insert; entri terlama ada di depan. delete+set saat mencatat ulang
    // membuat entri aktif selalu pindah ke belakang.
    const excess = map.size - PRUNE_TO;
    let removed = 0;
    for (const key of map.keys()) {
        map.delete(key);
        removed += 1;
        if (removed >= excess) break;
    }
}

function note(map, chatJid, timestamp) {
    if (!chatJid || typeof chatJid !== "string") return null;
    const ts = Number.isFinite(timestamp) ? timestamp : Date.now();
    map.delete(chatJid);
    map.set(chatJid, ts);
    pruneIfNeeded(map);
    return ts;
}

function ageMs(map, chatJid) {
    if (!chatJid || typeof chatJid !== "string") return Infinity;
    const ts = map.get(chatJid);
    return typeof ts === "number" ? Date.now() - ts : Infinity;
}

/** Panggil adapter tanpa pernah menjatuhkan jalur pesan. */
function persistSafe(method, chatJid, ts) {
    if (!persistence || typeof persistence[method] !== "function") return;
    try {
        persistence[method](chatJid, ts);
    } catch (_error) {
        // Persistensi bersifat best-effort — jejak in-memory tetap jalan.
    }
}

/** Catat balasan manual admin (event fromMe dari device ter-link) untuk chat ini. */
function noteAdminOutbound(chatJid) {
    const ts = note(adminOutboundByChat, chatJid);
    if (ts !== null) persistSafe("saveAdminOutbound", chatJid, ts);
}

/** Umur (ms) sejak admin terakhir balas manual di chat ini; Infinity bila tidak ada catatan. */
function getAdminOutboundAgeMs(chatJid) {
    return ageMs(adminOutboundByChat, chatJid);
}

/**
 * Apakah admin SEDANG menangani salah satu chat-key ini secara manual (balas `fromMe`) dalam
 * `quietMs` terakhir? Dipakai untuk menahan auto-respons bot (fallback anti-diam, intake bukti
 * bayar) agar tidak menyela percakapan admin↔pelanggan. Menerima beberapa kandidat JID sekaligus
 * (mis. `sender` @lid + `stateSender` kanonik). Aman untuk elemen null / quietMs tak valid.
 *
 * CATATAN PENTING: jawaban `false` dari fungsi ini hanya bermakna kalau `isChatSignalReady()` juga
 * true. Saat jejak belum pulih dari disk, `false` artinya "belum tahu", BUKAN "tidak ada admin".
 * @param {string[]} chatKeys
 * @param {number} quietMs
 * @returns {boolean}
 */
function isAdminHandlingChat(chatKeys, quietMs) {
    if (!Array.isArray(chatKeys) || !Number.isFinite(quietMs) || quietMs <= 0) return false;
    return chatKeys.some((jid) => getAdminOutboundAgeMs(jid) < quietMs);
}

/** Catat balasan fallback bot ke chat ini (dipakai cooldown). Sengaja TIDAK didurabelkan: cooldown
 *  anti-spam yang ter-reset saat restart paling buruk hanya membuat bot menyapa sekali lagi. */
function noteFallbackReply(chatJid) {
    note(fallbackReplyByChat, chatJid);
}

/** Umur (ms) sejak balasan fallback terakhir ke chat ini; Infinity bila tidak ada catatan. */
function getFallbackReplyAgeMs(chatJid) {
    return ageMs(fallbackReplyByChat, chatJid);
}

/** Catat bahwa chat ini baru saja mengeluh koneksi (konteks multi-turn + penahan intake bukti bayar). */
function noteConnectivityComplaint(chatJid) {
    const ts = note(complaintByChat, chatJid);
    if (ts !== null) persistSafe("saveComplaint", chatJid, ts);
}

/** Umur (ms) sejak komplain koneksi terakhir di chat ini; Infinity bila tidak ada catatan. */
function getConnectivityComplaintAgeMs(chatJid) {
    return ageMs(complaintByChat, chatJid);
}

/**
 * Apakah salah satu chat-key ini baru mengeluh koneksi dalam `windowMs` terakhir? (Bentuk jamak dari
 * getConnectivityComplaintAgeMs — sama seperti isAdminHandlingChat, mendukung @lid + JID kanonik.)
 * @param {string[]} chatKeys
 * @param {number} windowMs
 * @returns {boolean}
 */
function hasRecentComplaint(chatKeys, windowMs) {
    if (!Array.isArray(chatKeys) || !Number.isFinite(windowMs) || windowMs <= 0) return false;
    return chatKeys.some((jid) => getConnectivityComplaintAgeMs(jid) < windowMs);
}

/**
 * Isi ulang Map dari jejak yang tersimpan di disk. Hanya menimpa bila stempel dari disk LEBIH BARU
 * (jejak yang lahir sesudah boot tidak boleh dimundurkan oleh baris lama).
 * @param {Array<{chat_jid: string, last_admin_outbound_at?: number, last_complaint_at?: number}>} rows
 */
function hydrateChatActivity(rows) {
    if (!Array.isArray(rows)) return 0;
    let restored = 0;
    for (const row of rows) {
        const jid = row && row.chat_jid;
        if (!jid || typeof jid !== "string") continue;

        const adminTs = Number(row.last_admin_outbound_at);
        if (Number.isFinite(adminTs) && adminTs > (adminOutboundByChat.get(jid) || 0)) {
            note(adminOutboundByChat, jid, adminTs);
            restored += 1;
        }

        const complaintTs = Number(row.last_complaint_at);
        if (Number.isFinite(complaintTs) && complaintTs > (complaintByChat.get(jid) || 0)) {
            note(complaintByChat, jid, complaintTs);
        }
    }
    return restored;
}

/**
 * Pasang adapter persistensi + pulihkan jejak dari disk. Dipanggil SEKALI saat boot (index.js),
 * SEBELUM koneksi WhatsApp dibuka, supaya jejak sudah pulih saat pesan pertama datang.
 *
 * Selama pemulihan berjalan, `isChatSignalReady()` = false → pemanggil yang mengambil keputusan
 * berisiko (intake bukti bayar) WAJIB fail-closed. Kalau pemulihan GAGAL, kita tetap pindah ke
 * "ready" dan jatuh ke mode in-memory — kalau tidak, kegagalan DB akan mematikan intake bukti bayar
 * selamanya (obat yang lebih buruk dari penyakitnya).
 * @param {{saveAdminOutbound?: Function, saveComplaint?: Function, loadRecent?: Function}} adapter
 * @param {{maxAgeMs?: number}} [options]
 * @returns {Promise<number>} jumlah entri admin-outbound yang dipulihkan
 */
async function configureChatActivityPersistence(adapter, options = {}) {
    persistence = adapter || null;
    if (!persistence || typeof persistence.loadRecent !== "function") {
        hydrationState = "none";
        return 0;
    }

    hydrationState = "pending";
    const maxAgeMs = Number.isFinite(options.maxAgeMs) ? options.maxAgeMs : 60 * 60 * 1000;
    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 10000;

    // Tunggu TERBATAS. Kalau DB menggantung, "pending" selamanya berarti intake bukti bayar mati
    // selamanya — obat yang lebih buruk dari penyakitnya. Menyerah lalu jalan in-memory.
    let timer = null;
    const bounded = new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
        if (timer && typeof timer.unref === "function") timer.unref();
    });

    try {
        const rows = await Promise.race([persistence.loadRecent(maxAgeMs), bounded]);
        return hydrateChatActivity(rows);
    } catch (_error) {
        return 0;
    } finally {
        if (timer) clearTimeout(timer);
        hydrationState = "ready";
    }
}

/**
 * Apakah jejak chat sudah bisa dipercaya? false HANYA selama pemulihan dari disk berjalan.
 * Saat false, "tidak ada jejak admin" berarti "belum tahu", bukan "tidak ada".
 */
function isChatSignalReady() {
    return hydrationState !== "pending";
}

/** Reset seluruh state — khusus test. */
function resetChatActivityForTest() {
    adminOutboundByChat.clear();
    fallbackReplyByChat.clear();
    complaintByChat.clear();
    persistence = null;
    hydrationState = "none";
}

module.exports = {
    noteAdminOutbound,
    getAdminOutboundAgeMs,
    isAdminHandlingChat,
    noteFallbackReply,
    getFallbackReplyAgeMs,
    noteConnectivityComplaint,
    getConnectivityComplaintAgeMs,
    hasRecentComplaint,
    configureChatActivityPersistence,
    isChatSignalReady,
    hydrateChatActivity,
    resetChatActivityForTest
};
