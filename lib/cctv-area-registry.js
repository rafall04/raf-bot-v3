/**
 * Header Doc
 * Purpose: Registry Area + Koordinator RT (name → {coordinatorName, coordinatorPhone, coordinatorGroupId}).
 *          Dipakai cctv-monitor untuk menotifikasi koordinator/grup WA RT saat CCTV di area itu mati,
 *          dan UI admin untuk CRUD + dropdown. Target bisa nomor WA dan/atau grup WA (pilih salah satu
 *          atau dua-duanya). Dicocokkan ke field `area` tiap CCTV (case-insensitive).
 * Caller: lib/cctv-monitor.js (lookup koordinator via dep), routes/cctv.js (CRUD + dropdown).
 * Deps: fs/path. Disk: database/cctv-areas.json (pola mirror cctv-registry).
 * MainFuncs: list, get, getByName, matchByName, upsert, remove, normalizeName.
 * SideEffects: baca/tulis JSON; reload otomatis bila mtime berubah.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'database', 'cctv-areas.json');
let _cache = null;
let _mtime = 0;

function ensureDir() {
    const dir = path.dirname(FILE);
    try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch (_e) { /* ignore */ }
}
function load() {
    try {
        if (!fs.existsSync(FILE)) return [];
        const st = fs.statSync(FILE);
        if (_cache && st.mtimeMs === _mtime) return _cache;
        const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
        _cache = Array.isArray(parsed) ? parsed : [];
        _mtime = st.mtimeMs;
        return _cache;
    } catch (_e) { return _cache || []; }
}
function save(listv) {
    ensureDir();
    try { fs.writeFileSync(FILE, JSON.stringify(listv, null, 2), 'utf8'); _cache = listv; _mtime = fs.statSync(FILE).mtimeMs; }
    catch (e) { console.error('[CCTV-AREA] save error:', e.message); }
}
function normalizeName(n) { return String(n || '').trim().toLowerCase(); }

/** Cari area by nama (case-insensitive) dari list yang diberikan — murni, mudah ditest. */
function matchByName(listv, name) {
    const n = normalizeName(name);
    if (!n) return null;
    return (Array.isArray(listv) ? listv : []).find((a) => normalizeName(a.name) === n) || null;
}

function list() { return load().slice(); }
function get(id) { return load().find((a) => a.id === id) || null; }
function getByName(name) { return matchByName(load(), name); }

function upsert(area) {
    const listv = load().slice();
    const cleaned = {
        id: area.id || ('area_' + Math.random().toString(36).slice(2, 9)),
        name: String(area.name || '').trim(),
        coordinatorName: String(area.coordinatorName || '').trim(),
        coordinatorPhone: String(area.coordinatorPhone || '').trim(),
        coordinatorGroupId: String(area.coordinatorGroupId || '').trim(),
        coordinatorGroupName: String(area.coordinatorGroupName || '').trim(),
        customersInGroup: area.customersInGroup === true,
        coordinatorInGroup: area.coordinatorInGroup === true,
        // Override jam tenang per-area: 'inherit' (ikut global) | 'custom' (jendela sendiri) | 'off' (tanpa jam tenang).
        quietMode: ['custom', 'off'].includes(area.quietMode) ? area.quietMode : 'inherit',
        quietStart: String(area.quietStart || '').trim(),
        quietEnd: String(area.quietEnd || '').trim(),
        enabled: area.enabled !== false,
        createdAt: area.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    if (!cleaned.name) throw new Error('Area: nama wajib diisi');
    // Koordinator OPSIONAL (#b316): area kini entitas kelas-satu (desa/dusun/RT) — boleh cuma NAMA
    // sebagai label lokasi. Bila diberi nomor/grup, ia jadi target notifikasi koordinator. Pengaman
    // "tiap CCTV wajib punya penerima" tetap dipegang requireRecipient di routes (CCTV butuh nomor
    // pelanggan ATAU area yang koordinatornya aktif) — jadi area tanpa koordinator tak pernah bikin
    // CCTV kehilangan penerima, ia cuma tak menambah penerima koordinator.
    const idx = listv.findIndex((a) => a.id === cleaned.id);
    if (idx >= 0) listv[idx] = { ...listv[idx], ...cleaned };
    else listv.push(cleaned);
    save(listv);
    return cleaned;
}
function remove(id) { save(load().filter((a) => a.id !== id)); }
function _resetCache() { _cache = null; _mtime = 0; }

module.exports = { list, get, getByName, matchByName, upsert, remove, normalizeName, FILE, _resetCache };
