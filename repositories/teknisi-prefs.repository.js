/**
 * Header Doc
 * Purpose: Store PREFERENSI per-teknisi (self-service, RONDE 6 Fase A). Keyed `account.id` (identitas
 *   SAMA di web `req.user.id` & WA `isTeknisi.id`). SATU sumber dipakai halaman "Pengaturan Saya" (web)
 *   + perintah WA (`setelan saya`, `alert ...`, `pantau ...`) + resolver penerima notif. TERPISAH dari
 *   accounts.json (file keamanan hot-reload; CRUD-nya buang field asing). Tulis ATOMIK (#b345) +
 *   karantina berkas rusak. Default kosong = PERILAKU LAMA (tak ada yang berubah diam-diam).
 * Caller: routes/teknisi-settings-api.js (web), message/handlers/teknisi-prefs-handler.js (WA),
 *   lib/teknisi-recipient-resolver.js (routing notif), lib/cron/jobs/redaman-watch & redaman-check-handler (override pantau).
 * Deps: `fs`, `path`, `lib/atomic-file`.
 * MainFuncs: getPrefs (ter-merge default), getRawPrefs, setPrefs (merge+persist), loadAll, listCustomized, reload.
 * SideEffects: Baca/tulis `database/teknisi_prefs.json` (atau `*_test.json` saat NODE_ENV=test).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { writeFileAtomicSync } = require("../lib/atomic-file");

// Default = perilaku lama: terima SEMUA kelas alert, kanal apa adanya, tanpa batasan area, aktif.
const DEFAULTS = Object.freeze({
    enabled: true,                 // master: false = snooze SEMUA alert utk teknisi ini
    alerts: { los: true, redaman: true, ticket_new: true, post_repair: true },
    channel: "both",               // 'dm' | 'group' | 'both'
    areas: [],                     // Fase B: daftar areaKey/odpId yang jadi tanggung jawab (kosong = semua)
    quietHours: { enabled: false, start: "22:00", end: "06:00" }, // Fase C
    pantau: {},                    // Fase C: override redamanWatch pribadi {intervalMs,changeThresholdDb,targetDbm,durationMs}
    snoozeUntil: null,             // Fase C: ISO string; alert dibungkam sampai waktu ini
});

function resolveFilePath() {
    const name = process.env.NODE_ENV === "test" ? "teknisi_prefs_test.json" : "teknisi_prefs.json";
    return path.join(__dirname, "..", "database", name);
}

let _cache = null; // { at, path, map }

function readMap(filePath) {
    try {
        if (!fs.existsSync(filePath)) return {};
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (err) {
        console.warn(`[TEKNISI_PREFS] Gagal baca ${path.basename(filePath)}: ${err.message}`);
        try {
            if (fs.existsSync(filePath)) {
                const cap = new Date().toISOString().replace(/[:.]/g, "-");
                fs.renameSync(filePath, `${filePath}.rusak-${cap}`);
                console.error(`[TEKNISI_PREFS] Berkas rusak DIKARANTINA (.rusak-${cap}).`);
            }
        } catch (e2) { console.error(`[TEKNISI_PREFS] Gagal karantina: ${e2.message}`); }
        return {};
    }
}

function loadAll(filePath = resolveFilePath()) {
    if (_cache && _cache.path === filePath) return _cache.map;
    const map = readMap(filePath);
    _cache = { at: Date.now(), path: filePath, map };
    return map;
}

function persist(map, filePath = resolveFilePath()) {
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        writeFileAtomicSync(filePath, JSON.stringify(map, null, 2));
        _cache = { at: Date.now(), path: filePath, map };
        return true;
    } catch (err) {
        console.error(`[TEKNISI_PREFS] Gagal tulis ${path.basename(filePath)}: ${err.message}`);
        return false;
    }
}

function reload(filePath = resolveFilePath()) { _cache = null; return loadAll(filePath); }

/** Preferensi TERSIMPAN apa adanya (null bila teknisi belum pernah menyetel). */
function getRawPrefs(accountId, filePath = resolveFilePath()) {
    const map = loadAll(filePath);
    const p = map[String(accountId)];
    return p && typeof p === "object" ? p : null;
}

/** Preferensi ter-merge dengan default — pemanggil SELALU dapat objek lengkap. */
function getPrefs(accountId, filePath = resolveFilePath()) {
    const raw = getRawPrefs(accountId, filePath) || {};
    return {
        ...DEFAULTS,
        ...raw,
        alerts: { ...DEFAULTS.alerts, ...(raw.alerts || {}) },
        quietHours: { ...DEFAULTS.quietHours, ...(raw.quietHours || {}) },
        pantau: { ...DEFAULTS.pantau, ...(raw.pantau || {}) },
        areas: Array.isArray(raw.areas) ? raw.areas : DEFAULTS.areas,
    };
}

/** Merge patch ke preferensi teknisi lalu persist. @returns {object} prefs ter-merge terbaru. */
function setPrefs(accountId, patch, filePath = resolveFilePath()) {
    const id = String(accountId);
    const map = { ...loadAll(filePath) };
    const cur = (map[id] && typeof map[id] === "object") ? map[id] : {};
    const next = { ...cur, ...patch };
    if (patch && patch.alerts) next.alerts = { ...(cur.alerts || {}), ...patch.alerts };
    if (patch && patch.quietHours) next.quietHours = { ...(cur.quietHours || {}), ...patch.quietHours };
    if (patch && patch.pantau) next.pantau = { ...(cur.pantau || {}), ...patch.pantau };
    next.updatedAt = new Date().toISOString();
    map[id] = next;
    persist(map, filePath);
    return getPrefs(id, filePath);
}

/** Daftar accountId yang PERNAH menyetel (utk resolver: sisanya pakai default). */
function listCustomized(filePath = resolveFilePath()) {
    return Object.keys(loadAll(filePath));
}

module.exports = { DEFAULTS, resolveFilePath, loadAll, reload, getRawPrefs, getPrefs, setPrefs, listCustomized };
