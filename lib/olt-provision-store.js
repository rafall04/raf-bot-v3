/**
 * Header Doc
 * Purpose: Penyimpanan profil "tipe modem" (ONU type) untuk registrasi ONU ZTE — tiap profil
 *          membawa template script CLI + variabel default (VLAN, profile bandwidth, ACS, SSID).
 *          Seed otomatis 3 profil bawaan saat file belum ada (fresh clone).
 * Caller: routes/olt-provisioning.js (CRUD + render), lib/olt-zte-provision.js (via route).
 * Deps: fs, path. Data di database/olt_onu_types.json (gitignored, auto-seed).
 * MainFuncs: listOnuTypes, getOnuType, saveOnuType, deleteOnuType, PLACEHOLDER_DOC.
 * SideEffects: baca/tulis database/olt_onu_types.json.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const STORE_FILE = path.join(__dirname, '..', 'database', 'olt_onu_types.json');

// Dokumentasi placeholder untuk UI (cheatsheet di editor template).
const PLACEHOLDER_DOC = [
    { key: 'ponPort', desc: 'Port PON, format slot/kartu/port (mis. 1/3/16) — dari form' },
    { key: 'onuId', desc: 'Nomor ONU di port PON (1-128) — otomatis disarankan' },
    { key: 'sn', desc: 'Serial number ONU (mis. ZTEGCCA16805) — dari scan/form' },
    { key: 'onuType', desc: 'Tipe ONU di perintah "onu N type ..." (ALL/F660/F609/Bridge)' },
    { key: 'name', desc: 'Nama ONU (tanpa spasi) — biasanya kode pelanggan' },
    { key: 'description', desc: 'Deskripsi ONU (tanpa spasi) — biasanya kode ODP' },
    { key: 'pppoeUser', desc: 'Username PPPoE pelanggan' },
    { key: 'pppoePassword', desc: 'Password PPPoE pelanggan' },
    { key: 'pppoeVlan', desc: 'VLAN layanan internet/PPPoE' },
    { key: 'hotspotVlan', desc: 'VLAN layanan hotspot' },
    { key: 'tr069Vlan', desc: 'VLAN manajemen TR069/ACS' },
    { key: 'extraVlan', desc: 'VLAN layanan tambahan (mis. CCTV/Dishub)' },
    { key: 'tcontProfile', desc: 'Nama profile T-CONT upstream (sudah dibuat di OLT)' },
    { key: 'downProfile', desc: 'Nama traffic-limit downstream (sudah dibuat di OLT)' },
    { key: 'acsUrl', desc: 'URL ACS GenieACS untuk TR069' },
    { key: 'acsUsername', desc: 'Username ACS' },
    { key: 'acsPassword', desc: 'Password ACS' },
    { key: 'ssidName', desc: 'Nama SSID WiFi bawaan ONU' },
];

// ── Profil bawaan ────────────────────────────────────────────────────────────
// Template default mengikuti pola registrasi manual yang dipakai di lapangan
// (lihat contoh CLI di dokumentasi fitur). Operator bebas mengubah lewat UI.

const TEMPLATE_ROUTER_FULL = [
    'conf t',
    'int gpon-olt_{{ponPort}}',
    'onu {{onuId}} type {{onuType}} sn {{sn}}',
    '!',
    'int gpon-onu_{{ponPort}}:{{onuId}}',
    'name {{name}}',
    'description {{description}}',
    'tcont 1 profile {{tcontProfile}}',
    'gemport 1 name Internet tcont 1',
    'gemport 1 traffic-limit downstream {{downProfile}}',
    'service-port 1 vport 1 user-vlan {{pppoeVlan}} vlan {{pppoeVlan}}',
    'service-port 2 vport 1 user-vlan {{hotspotVlan}} vlan {{hotspotVlan}}',
    'service-port 3 vport 1 user-vlan {{tr069Vlan}} vlan {{tr069Vlan}}',
    'service-port 4 vport 1 user-vlan {{extraVlan}} vlan {{extraVlan}}',
    '!',
    'pon-onu-mng gpon-onu_{{ponPort}}:{{onuId}}',
    'service PPPOE gemport 1 vlan {{pppoeVlan}}',
    'service HOTSPOT gemport 1 vlan {{hotspotVlan}}',
    'service TR069 gemport 1 vlan {{tr069Vlan}}',
    'service DISHUB gemport 1 vlan {{extraVlan}}',
    'switchport-bind switch_0/1 iphost 1',
    'switchport-bind switch_0/1 veip 1',
    'pppoe 1 nat enable user {{pppoeUser}} password {{pppoePassword}}',
    'vlan-filter-mode iphost 1 tag-filter vlan-filter untag-filter discard',
    'wan-ip 1 ping-response enable traceroute-response enable',
    'tr069-mgmt 1 state unlock',
    'tr069-mgmt 1 acs {{acsUrl}} validate basic username {{acsUsername}} password {{acsPassword}}',
    'tr069-mgmt 1 tag pri 0 vlan {{tr069Vlan}}',
    'vlan-filter iphost 1 pri 0 vlan {{pppoeVlan}}',
    'vlan port eth_0/1 mode tag vlan {{extraVlan}}',
    'vlan port eth_0/2 mode tag vlan {{extraVlan}}',
    'vlan port eth_0/3 mode tag vlan {{extraVlan}}',
    'vlan port eth_0/4 mode tag vlan {{hotspotVlan}}',
    'vlan port wifi_0/4 mode tag vlan {{hotspotVlan}}',
    'security-mgmt 1 state enable mode forward protocol web',
    'ssid auth wep wifi_0/4 open-system',
    'ssid ctrl wifi_0/4 name {{ssidName}}',
    'end',
].join('\n');

const TEMPLATE_ROUTER_SIMPLE = [
    'conf t',
    'int gpon-olt_{{ponPort}}',
    'onu {{onuId}} type {{onuType}} sn {{sn}}',
    '!',
    'int gpon-onu_{{ponPort}}:{{onuId}}',
    'name {{name}}',
    'description {{description}}',
    'tcont 1 profile {{tcontProfile}}',
    'gemport 1 name Internet tcont 1',
    'gemport 1 traffic-limit downstream {{downProfile}}',
    'service-port 1 vport 1 user-vlan {{pppoeVlan}} vlan {{pppoeVlan}}',
    'service-port 2 vport 1 user-vlan {{tr069Vlan}} vlan {{tr069Vlan}}',
    '!',
    'pon-onu-mng gpon-onu_{{ponPort}}:{{onuId}}',
    'service PPPOE gemport 1 vlan {{pppoeVlan}}',
    'service TR069 gemport 1 vlan {{tr069Vlan}}',
    'switchport-bind switch_0/1 iphost 1',
    'pppoe 1 nat enable user {{pppoeUser}} password {{pppoePassword}}',
    'vlan-filter-mode iphost 1 tag-filter vlan-filter untag-filter discard',
    'vlan-filter iphost 1 pri 0 vlan {{pppoeVlan}}',
    'wan-ip 1 ping-response enable traceroute-response enable',
    'tr069-mgmt 1 state unlock',
    'tr069-mgmt 1 acs {{acsUrl}} validate basic username {{acsUsername}} password {{acsPassword}}',
    'tr069-mgmt 1 tag pri 0 vlan {{tr069Vlan}}',
    'end',
].join('\n');

const TEMPLATE_BRIDGE = [
    'conf t',
    'int gpon-olt_{{ponPort}}',
    'onu {{onuId}} type {{onuType}} sn {{sn}}',
    '!',
    'int gpon-onu_{{ponPort}}:{{onuId}}',
    'name {{name}}',
    'description {{description}}',
    'tcont 1 profile {{tcontProfile}}',
    'gemport 1 name Internet tcont 1',
    'gemport 1 traffic-limit downstream {{downProfile}}',
    'service-port 1 vport 1 user-vlan {{pppoeVlan}} vlan {{pppoeVlan}}',
    '!',
    'pon-onu-mng gpon-onu_{{ponPort}}:{{onuId}}',
    'service internet gemport 1 vlan {{pppoeVlan}}',
    'vlan port eth_0/1 mode tag vlan {{pppoeVlan}}',
    'end',
].join('\n');

const COMMON_VARS = {
    onuType: 'ALL',
    tcontProfile: 'UNNET-1G-UP',
    downProfile: 'UNNET-1G-DOWN',
    pppoeVlan: '3010',
};

const DEFAULT_ONU_TYPES = [
    {
        id: 'zte-router-full',
        name: 'ZTE Router — Full (PPPoE NAT + Hotspot + TR069 + CCTV)',
        brand: 'zte',
        notes: 'ONU router (F660/F609/F670L): PPPoE NAT di ONU, port LAN4+WiFi untuk hotspot, TR069 ke ACS, port LAN1-3 VLAN CCTV/Dishub.',
        vars: {
            ...COMMON_VARS,
            hotspotVlan: '3011',
            tr069Vlan: '100',
            extraVlan: '178',
            acsUrl: 'http://172.17.11.6:7547',
            acsUsername: 'unnet.acs',
            acsPassword: 'unnet.acs123',
            ssidName: 'UNNET',
        },
        scriptTemplate: TEMPLATE_ROUTER_FULL,
        builtin: true,
    },
    {
        id: 'zte-router-pppoe',
        name: 'ZTE Router — PPPoE + TR069 (standar)',
        brand: 'zte',
        notes: 'ONU router standar: PPPoE NAT di ONU + manajemen TR069, tanpa hotspot/VLAN tambahan.',
        vars: {
            ...COMMON_VARS,
            tr069Vlan: '100',
            acsUrl: 'http://172.17.11.6:7547',
            acsUsername: 'unnet.acs',
            acsPassword: 'unnet.acs123',
        },
        scriptTemplate: TEMPLATE_ROUTER_SIMPLE,
        builtin: true,
    },
    {
        id: 'zte-bridge',
        name: 'Bridge — PPPoE dial dari router pelanggan',
        brand: 'zte',
        notes: 'ONU mode jembatan: VLAN internet diteruskan transparan ke LAN1; PPPoE dial dari router pelanggan.',
        vars: { ...COMMON_VARS },
        scriptTemplate: TEMPLATE_BRIDGE,
        builtin: true,
    },
];

// ── Persistensi ──────────────────────────────────────────────────────────────

function readStore() {
    try {
        if (fs.existsSync(STORE_FILE)) {
            const data = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
            if (Array.isArray(data.onuTypes)) return data;
        }
    } catch (e) {
        console.error('[OLT-PROVISION-STORE] Gagal baca store, pakai default:', e.message);
    }
    return { onuTypes: DEFAULT_ONU_TYPES.map((t) => ({ ...t })) };
}

function writeStore(data) {
    fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2), 'utf8');
}

/** Pastikan file store ada (seed default saat fresh clone). */
function ensureSeeded() {
    if (!fs.existsSync(STORE_FILE)) {
        writeStore({ onuTypes: DEFAULT_ONU_TYPES.map((t) => ({ ...t })) });
        console.log('[OLT-PROVISION-STORE] Seed profil tipe modem default →', STORE_FILE);
    }
}

/** @returns {Array} semua profil tipe modem */
function listOnuTypes() {
    ensureSeeded();
    return readStore().onuTypes;
}

/**
 * @param {string} id
 * @returns {object|null}
 */
function getOnuType(id) {
    return listOnuTypes().find((t) => t.id === id) || null;
}

/**
 * Simpan profil (create bila id belum ada, update bila sudah).
 * @param {object} profile {id?, name, brand?, notes?, vars?, scriptTemplate}
 * @returns {object} profil tersimpan
 */
function saveOnuType(profile) {
    if (!profile || !profile.name || !profile.scriptTemplate) {
        throw new Error('Profil tipe modem wajib punya name dan scriptTemplate');
    }
    ensureSeeded();
    const store = readStore();
    const id = profile.id && String(profile.id).trim()
        ? String(profile.id).trim()
        : slugify(profile.name);
    const clean = {
        id,
        name: String(profile.name).trim(),
        brand: profile.brand || 'zte',
        notes: profile.notes ? String(profile.notes) : '',
        vars: sanitizeVarsObject(profile.vars),
        scriptTemplate: String(profile.scriptTemplate),
        builtin: false,
    };
    const idx = store.onuTypes.findIndex((t) => t.id === id);
    if (idx >= 0) {
        // Profil builtin boleh diedit — tapi tetap tandai builtin supaya UI bisa kasih label.
        clean.builtin = store.onuTypes[idx].builtin === true;
        store.onuTypes[idx] = clean;
    } else {
        store.onuTypes.push(clean);
    }
    writeStore(store);
    return clean;
}

/**
 * Hapus profil. Profil builtin boleh dihapus (operator yang tahu kebutuhannya);
 * seed TIDAK menulis ulang karena file store sudah ada.
 * @param {string} id
 * @returns {boolean} true bila terhapus
 */
function deleteOnuType(id) {
    ensureSeeded();
    const store = readStore();
    const before = store.onuTypes.length;
    store.onuTypes = store.onuTypes.filter((t) => t.id !== id);
    if (store.onuTypes.length === before) return false;
    writeStore(store);
    return true;
}

/** Reset profil bawaan (tambahkan kembali yang hilang, tanpa menimpa edit). */
function restoreBuiltinTypes() {
    ensureSeeded();
    const store = readStore();
    let added = 0;
    for (const def of DEFAULT_ONU_TYPES) {
        if (!store.onuTypes.some((t) => t.id === def.id)) {
            store.onuTypes.push({ ...def });
            added++;
        }
    }
    if (added > 0) writeStore(store);
    return added;
}

// ── Helper ───────────────────────────────────────────────────────────────────

function slugify(name) {
    const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    return base || 'onu-type-' + Date.now();
}

/** Vars profil: hanya string sederhana (anti objek bersarang / newline). */
function sanitizeVarsObject(vars) {
    const out = {};
    if (vars && typeof vars === 'object') {
        for (const [k, v] of Object.entries(vars)) {
            if (v === undefined || v === null) continue;
            if (!/^[\w.-]{1,40}$/.test(k)) continue;
            out[k] = String(v).replace(/[\r\n]/g, ' ').slice(0, 160);
        }
    }
    return out;
}

module.exports = {
    listOnuTypes,
    getOnuType,
    saveOnuType,
    deleteOnuType,
    restoreBuiltinTypes,
    ensureSeeded,
    PLACEHOLDER_DOC,
    __test: { slugify, sanitizeVarsObject, DEFAULT_ONU_TYPES, STORE_FILE },
};
