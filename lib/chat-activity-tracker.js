/**
 * Header Doc
 * Purpose: Penanda aktivitas chat in-memory (single-instance) untuk fallback anti-diam:
 *          (1) kapan admin terakhir balas MANUAL dari nomor bot ke sebuah chat (event `fromMe`
 *          dari HP ter-link), (2) kapan bot terakhir mengirim balasan fallback ke sebuah chat
 *          (cooldown anti-spam). Murni Map di memori — hilang saat restart itu aman (fallback
 *          jadi sedikit lebih "berani" sesaat, bukan korupsi data).
 * Caller: `message/raf.js` (noteAdminOutbound pada event fromMe) dan
 *         `message/handlers/customer-fallback-handler.js` (cek umur + catat cooldown).
 * Deps: — (murni, tanpa I/O; tanpa timer supaya tidak menahan event loop/test).
 * MainFuncs: `noteAdminOutbound`, `getAdminOutboundAgeMs`, `noteFallbackReply`,
 *            `getFallbackReplyAgeMs`, `resetChatActivityForTest`.
 * SideEffects: Menulis Map in-memory (bounded, prune otomatis).
 */
"use strict";

const MAX_ENTRIES = 3000;
const PRUNE_TO = 2000;

const adminOutboundByChat = new Map();
const fallbackReplyByChat = new Map();

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

function note(map, chatJid) {
    if (!chatJid || typeof chatJid !== "string") return;
    map.delete(chatJid);
    map.set(chatJid, Date.now());
    pruneIfNeeded(map);
}

function ageMs(map, chatJid) {
    if (!chatJid || typeof chatJid !== "string") return Infinity;
    const ts = map.get(chatJid);
    return typeof ts === "number" ? Date.now() - ts : Infinity;
}

/** Catat balasan manual admin (event fromMe dari device ter-link) untuk chat ini. */
function noteAdminOutbound(chatJid) {
    note(adminOutboundByChat, chatJid);
}

/** Umur (ms) sejak admin terakhir balas manual di chat ini; Infinity bila tidak ada catatan. */
function getAdminOutboundAgeMs(chatJid) {
    return ageMs(adminOutboundByChat, chatJid);
}

/** Catat balasan fallback bot ke chat ini (dipakai cooldown). */
function noteFallbackReply(chatJid) {
    note(fallbackReplyByChat, chatJid);
}

/** Umur (ms) sejak balasan fallback terakhir ke chat ini; Infinity bila tidak ada catatan. */
function getFallbackReplyAgeMs(chatJid) {
    return ageMs(fallbackReplyByChat, chatJid);
}

/** Reset seluruh state — khusus test. */
function resetChatActivityForTest() {
    adminOutboundByChat.clear();
    fallbackReplyByChat.clear();
}

module.exports = {
    noteAdminOutbound,
    getAdminOutboundAgeMs,
    noteFallbackReply,
    getFallbackReplyAgeMs,
    resetChatActivityForTest
};
