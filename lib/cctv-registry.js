/**
 * Header Doc
 * Purpose: Registry persisten daftar CCTV publik (host → {nama, IP, phone, customMessage}).
 *          Dipakai cctv-monitor untuk memetakan host yang down ke pelanggan yg perlu di-notify,
 *          dan UI admin untuk CRUD.
 * Caller: lib/cctv-monitor.js, routes/cctv-routes.js (UI).
 * Deps: fs/path. Disk format: database/cctv-devices.json (mirror pola los-incidents).
 * MainFuncs: list, get, getByHost, upsert, remove, normalizeHost.
 * SideEffects: baca/tulis file JSON; reload otomatis bila mtime berubah (hemat I/O).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'database', 'cctv-devices.json');

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
        if (_cache && st.mtimeMs === _mtime) return _cache; // unchanged → reuse memory
        const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
        _cache = Array.isArray(parsed) ? parsed : [];
        _mtime = st.mtimeMs;
        return _cache;
    } catch (__e) {
        return _cache || [];
    }
}

function save(list) {
    ensureDir();
    try {
        fs.writeFileSync(FILE, JSON.stringify(list, null, 2), 'utf8');
        _cache = list;
        _mtime = fs.statSync(FILE).mtimeMs;
    } catch (e) {
        console.error('[CCTV] save error:', e.message);
    }
}

/**
 * Normalisasi host: trim + lowercase (IP biasanya lowercase tapi defensif).
 */
function normalizeHost(h) { return String(h || '').trim().toLowerCase(); }

function list() { return load().slice(); }

function get(id) {
    return load().find((d) => d.id === id) || null;
}

function getByHost(host) {
    const h = normalizeHost(host);
    return load().find((d) => normalizeHost(d.host) === h) || null;
}

/**
 * Tambah/update device. Id auto bila baru.
 * @param {object} dev {id?, name, host, phone, customerName?, area?, customMessage?, confirmationMinutes?, enabled?, notifyCustomer?}
 */
function upsert(dev) {
    const list = load().slice();
    const cleaned = {
        id: dev.id || ('cctv_' + Math.random().toString(36).slice(2, 9)),
        name: String(dev.name || '').trim(),
        host: normalizeHost(dev.host),
        phone: String(dev.phone || '').trim(),
        customerName: String(dev.customerName || '').trim(),
        area: String(dev.area || '').trim(),
        customMessage: String(dev.customMessage || '').trim(),
        confirmationMinutes: Number.isFinite(+dev.confirmationMinutes) ? +dev.confirmationMinutes : null,
        enabled: dev.enabled !== false,
        notifyCustomer: dev.notifyCustomer !== false, // opt-out: false = pantau saja, tak WA pelanggan
        createdAt: dev.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    if (!cleaned.name || !cleaned.host || !cleaned.phone) {
        throw new Error('CCTV: name, host, phone wajib diisi');
    }
    const idx = list.findIndex((d) => d.id === cleaned.id);
    if (idx >= 0) list[idx] = { ...list[idx], ...cleaned };
    else list.push(cleaned);
    save(list);
    return cleaned;
}

function remove(id) {
    const list = load().filter((d) => d.id !== id);
    save(list);
}

function _resetCache() { _cache = null; _mtime = 0; }

module.exports = { list, get, getByHost, upsert, remove, normalizeHost, FILE, _resetCache };
