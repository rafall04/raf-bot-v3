/**
 * Header Doc
 * Purpose: Riwayat pelanggan terakhir yang dicek per-teknisi (per chatId) untuk akses cepat
 *          (/terakhir). In-memory & sengaja TIDAK persist — cukup untuk sesi kerja, dan aman
 *          dengan invariant single-instance. READ-ONLY terhadap data bisnis.
 * Caller: `message/telegram/command-handlers/resolve-helper.js` (record saat resolve),
 *         `message/telegram/command-handlers/terakhir-command.js` (list).
 * Deps: (tidak ada).
 * MainFuncs: `record(chatId, user)`, `list(chatId)`, `_reset()`.
 * SideEffects: menyimpan state in-memory (Map).
 */
"use strict";

const MAX = 5;
const store = new Map(); // chatId(str) -> [userId(str), ...] terbaru dulu

function record(chatId, user) {
    if (chatId == null || !user || user.id == null) return;
    const key = String(chatId);
    const id = String(user.id);
    const prev = store.get(key) || [];
    const next = [id, ...prev.filter((x) => x !== id)].slice(0, MAX);
    store.set(key, next);
}

function list(chatId) {
    if (chatId == null) return [];
    return (store.get(String(chatId)) || []).slice();
}

function _reset() {
    store.clear();
}

module.exports = { record, list, MAX, _reset };
