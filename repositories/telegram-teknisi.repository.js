/**
 * Header Doc
 * Purpose: Persistensi whitelist chat_id teknisi untuk bot Telegram. ACL ini berubah
 *          independen dari config.json dan bukan atribut pelanggan, jadi disimpan di
 *          store JSON khusus `database/telegram_teknisi.json` (array of entri). Hanya
 *          chat_id yang ter-whitelist (dan enabled) yang boleh memakai bot.
 * Caller: `lib/telegram/telegram-intent-dispatch.js` (auth gate, hot path) dan
 *         `routes/admin-telegram-teknisi-routes.js` (CRUD dari panel admin).
 * Deps: `lib/json-store` (loadJSON/saveJSON) — dapat diinjeksi untuk test.
 * MainFuncs: `createTelegramTeknisiRepository(deps)` → { list, find, isWhitelisted, add,
 *            remove, setEnabled, reload }. Export juga instance default (singleton proses)
 *            agar cache whitelist koheren antara dispatcher & panel admin.
 * SideEffects: Baca/tulis file JSON. Cache memori di-invalidasi tiap tulis.
 *
 * Bentuk entri: { chatId:string, name:string, addedBy:string, addedAt:ISO, enabled:boolean }
 */
"use strict";

const jsonStore = require("../lib/json-store");

const DEFAULT_FILE = "telegram_teknisi.json";

function normId(id) {
    return String(id == null ? "" : id).trim();
}

function createTelegramTeknisiRepository(deps = {}) {
    const file = deps.file || DEFAULT_FILE;
    const load = deps.load || (() => jsonStore.loadJSON(file));
    const save = deps.save || ((data) => jsonStore.saveJSON(file, data));
    const now = deps.now || (() => new Date().toISOString());

    let cache = null;

    function readAll() {
        if (cache) return cache;
        const data = load();
        cache = Array.isArray(data) ? data : [];
        return cache;
    }

    function writeAll(list) {
        cache = list;
        save(list);
        return list;
    }

    /** Salinan daftar (agar pemanggil tak memutasi cache internal). */
    function list() {
        return readAll().map((t) => ({ ...t }));
    }

    function find(chatId) {
        const id = normId(chatId);
        if (!id) return null;
        const found = readAll().find((t) => normId(t.chatId) === id);
        return found ? { ...found } : null;
    }

    /** Hot path auth gate: true bila ter-whitelist DAN enabled (default enabled). */
    function isWhitelisted(chatId) {
        const id = normId(chatId);
        if (!id) return false;
        const found = readAll().find((t) => normId(t.chatId) === id);
        return !!(found && found.enabled !== false);
    }

    /**
     * Tambah/aktifkan teknisi. Idempoten: bila chat_id sudah ada → update nama
     * (bila diberikan) & set enabled true; bila belum → buat entri baru enabled.
     * @returns {object} entri tersimpan
     */
    function add({ chatId, name, addedBy } = {}) {
        const id = normId(chatId);
        if (!id) throw new Error("chatId wajib diisi");
        const all = readAll().map((t) => ({ ...t }));
        const idx = all.findIndex((t) => normId(t.chatId) === id);
        if (idx >= 0) {
            all[idx].enabled = true;
            if (name) all[idx].name = name;
            if (addedBy) all[idx].addedBy = addedBy;
            writeAll(all);
            return { ...all[idx] };
        }
        const entry = {
            chatId: id,
            name: name || "",
            addedBy: addedBy || "",
            addedAt: now(),
            enabled: true,
        };
        all.push(entry);
        writeAll(all);
        return { ...entry };
    }

    /** Hapus entri. @returns {boolean} true bila ada yang terhapus. */
    function remove(chatId) {
        const id = normId(chatId);
        const all = readAll();
        const next = all.filter((t) => normId(t.chatId) !== id);
        if (next.length === all.length) return false;
        writeAll(next);
        return true;
    }

    /** Aktif/nonaktifkan tanpa menghapus. @returns {object|null} entri terbaru. */
    function setEnabled(chatId, enabled) {
        const id = normId(chatId);
        const all = readAll().map((t) => ({ ...t }));
        const idx = all.findIndex((t) => normId(t.chatId) === id);
        if (idx < 0) return null;
        all[idx].enabled = enabled !== false;
        writeAll(all);
        return { ...all[idx] };
    }

    /** Paksa muat ulang dari disk (buang cache). */
    function reload() {
        cache = null;
        return list();
    }

    return { list, find, isWhitelisted, add, remove, setEnabled, reload };
}

// Instance default (dipakai dispatcher & panel admin dalam satu proses).
const defaultRepository = createTelegramTeknisiRepository();

module.exports = {
    createTelegramTeknisiRepository,
    telegramTeknisiRepository: defaultRepository,
    DEFAULT_FILE,
};
