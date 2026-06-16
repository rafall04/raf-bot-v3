/**
 * Header Doc
 * Purpose: Penyimpanan profil "tipe modem" (ONU type) untuk registrasi ONU ZTE — tiap profil
 *          membawa template script CLI + variabel default (VLAN, profile bandwidth, ACS, SSID)
 *          + `vendorMatch` (tier vendor yang cocok, utk auto-pilih dari prefix SN).
 *          Seed otomatis profil bawaan saat file belum ada (fresh clone).
 * Caller: routes/olt-provisioning.js (CRUD + render), lib/olt-zte-provision.js (via route).
 * Deps: fs, path. Data di database/olt_onu_types.json (gitignored, auto-seed).
 * MainFuncs: listOnuTypes, getOnuType, saveOnuType, deleteOnuType, PLACEHOLDER_DOC.
 * SideEffects: baca/tulis database/olt_onu_types.json.
 *
 * CATATAN: template bawaan DIKALIBRASI dari konfigurasi NYATA OLT VANS C320 (live,
 * 2026-06-16) — 96% ONU = F609 router penuh (PPPoE+Hotspot+WiFi+ACS), sisanya clone/bridge.
 * `vendorMatch` memetakan tier dari classifyVendorTier (zte/clone/huawei) → profil yang tepat
 * supaya teknisi cukup scan SN dan profil ter-pilih otomatis (anti salah-klik).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const STORE_FILE = path.join(__dirname, '..', 'database', 'olt_onu_types.json');

// Tier vendor yang valid untuk vendorMatch (selaras lib/olt-zte-provision.classifyVendorTier).
const VALID_VENDOR_TIERS = ['zte', 'clone', 'huawei', 'unknown'];

// Dokumentasi placeholder untuk UI (cheatsheet di editor template).
const PLACEHOLDER_DOC = [
    { key: 'ponPort', desc: 'Port PON, format slot/kartu/port (mis. 1/2/1) — dari form' },
    { key: 'onuId', desc: 'Nomor ONU di port PON (1-128) — otomatis disarankan' },
    { key: 'sn', desc: 'Serial number ONU (mis. ZTEGD0337233) — dari scan/form' },
    { key: 'onuType', desc: 'Tipe ONU di perintah "onu N type ..." (F609/ALL/dst — harus ada di OLT)' },
    { key: 'name', desc: 'Nama ONU (tanpa spasi) — di VANS = username PPPoE pelanggan' },
    { key: 'description', desc: 'Deskripsi ONU (tanpa spasi) — biasanya kode ODP (opsional)' },
    { key: 'pppoeUser', desc: 'Username PPPoE pelanggan' },
    { key: 'pppoePassword', desc: 'Password PPPoE pelanggan' },
    { key: 'pppoeVlan', desc: 'VLAN layanan internet/PPPoE (VANS: 300)' },
    { key: 'hotspotVlan', desc: 'VLAN layanan hotspot/WiFi (VANS: 310)' },
    { key: 'tr069Vlan', desc: 'VLAN manajemen TR069/ACS (alias lama mgmtVlan)' },
    { key: 'mgmtVlan', desc: 'VLAN manajemen ACS/TR069 (VANS: 100) — selaras setting ACS' },
    { key: 'extraVlan', desc: 'VLAN layanan tambahan (mis. CCTV/Dishub)' },
    { key: 'tcontProfile', desc: 'Nama profile T-CONT upstream (VANS: 1G / 50M — sudah ada di OLT)' },
    { key: 'downProfile', desc: 'Nama traffic-limit downstream (sudah dibuat di OLT)' },
    { key: 'vlanProfile', desc: 'Nama vlan-profile di OLT untuk wan-ip pppoe (VANS: PPPOE)' },
    { key: 'acsUrl', desc: 'URL ACS GenieACS untuk TR069 (VANS: http://172.17.11.2:7547)' },
    { key: 'acsUsername', desc: 'Username ACS (VANS: acs)' },
    { key: 'acsPassword', desc: 'Password ACS (VANS: acs123)' },
    { key: 'ssidName', desc: 'Nama SSID WiFi bawaan ONU (VANS: VANS-45NET)' },
];

// ── Profil bawaan (DIKALIBRASI dari konfig nyata OLT VANS C320 live) ───────────
// Template = pola registrasi NYATA yang sudah jalan di lapangan. Operator bebas
// mengubah lewat UI. Pemetaan vendorMatch dari prefix SN: ZTEG→zte, RTEG/ZICG/ZXIC/
// CIOT→clone, HWTC→huawei.

// (1) ZTE asli (F609/F660/F670L, prefix ZTEG) — router penuh: PPPoE (wan-ip) + Hotspot
//     + WiFi + ACS/TR069 lengkap (tr069-mgmt) dalam SATU langkah → ONU langsung inform.
//     Persis konfig fleet VANS (verif live gpon-onu_1/2/2:33 dkk).
const TEMPLATE_VANS_ZTE = [
    'conf t',
    'int gpon-olt_{{ponPort}}',
    'onu {{onuId}} type {{onuType}} sn {{sn}}',
    '!',
    'int gpon-onu_{{ponPort}}:{{onuId}}',
    'name {{name}}',
    'tcont 1 name INET profile {{tcontProfile}}',
    'gemport 1 name INET tcont 1',
    'service-port 1 vport 1 user-vlan {{pppoeVlan}} vlan {{pppoeVlan}}',
    'service-port 2 vport 1 user-vlan {{hotspotVlan}} vlan {{hotspotVlan}}',
    'service-port 3 vport 1 user-vlan {{mgmtVlan}} vlan {{mgmtVlan}}',
    '!',
    'pon-onu-mng gpon-onu_{{ponPort}}:{{onuId}}',
    'service INET gemport 1 vlan {{pppoeVlan}}',
    'service HS gemport 1 vlan {{hotspotVlan}}',
    'service TR069 gemport 1 vlan {{mgmtVlan}}',
    'wan-ip 1 mode pppoe username {{pppoeUser}} password {{pppoePassword}} vlan-profile {{vlanProfile}} host 1',
    'vlan port eth_0/1 mode tag vlan {{hotspotVlan}}',
    'vlan port eth_0/2 mode tag vlan {{hotspotVlan}}',
    'vlan port eth_0/3 mode tag vlan {{hotspotVlan}}',
    'vlan port eth_0/4 mode tag vlan {{hotspotVlan}}',
    'vlan port wifi_0/2 mode tag vlan {{hotspotVlan}}',
    'tr069-mgmt 1 state unlock',
    'tr069-mgmt 1 acs {{acsUrl}} validate basic username {{acsUsername}} password {{acsPassword}}',
    'tr069-mgmt 1 tag pri 0 vlan {{mgmtVlan}}',
    'security-mgmt 1 state enable mode forward protocol web',
    'ssid auth wep wifi_0/2 open-system',
    'ssid ctrl wifi_0/2 name {{ssidName}}',
    'wan 1 service internet host 1',
    'end',
].join('\n');

// (2) Clone/OEM (prefix RTEG/ZICG/ZXIC/CIOT) — router PPPoE + Hotspot + WiFi, TANPA
//     blok tr069-mgmt (firmware clone abaikan OMCI tr069 → malah bisa rebutan VLAN).
//     ACS di-set DI MODEM (in-band lewat WAN internet). Persis konfig clone nyata VANS.
const TEMPLATE_VANS_CLONE = [
    'conf t',
    'int gpon-olt_{{ponPort}}',
    'onu {{onuId}} type {{onuType}} sn {{sn}}',
    '!',
    'int gpon-onu_{{ponPort}}:{{onuId}}',
    'name {{name}}',
    'tcont 1 name INET profile {{tcontProfile}}',
    'gemport 1 name INET tcont 1',
    'service-port 1 vport 1 user-vlan {{pppoeVlan}} vlan {{pppoeVlan}}',
    'service-port 2 vport 1 user-vlan {{hotspotVlan}} vlan {{hotspotVlan}}',
    '!',
    'pon-onu-mng gpon-onu_{{ponPort}}:{{onuId}}',
    'service INET gemport 1 vlan {{pppoeVlan}}',
    'service HS gemport 1 vlan {{hotspotVlan}}',
    'wan-ip 1 mode pppoe username {{pppoeUser}} password {{pppoePassword}} vlan-profile {{vlanProfile}} host 1',
    'vlan port eth_0/1 mode tag vlan {{hotspotVlan}}',
    'vlan port eth_0/2 mode tag vlan {{hotspotVlan}}',
    'vlan port eth_0/3 mode tag vlan {{hotspotVlan}}',
    'vlan port eth_0/4 mode tag vlan {{hotspotVlan}}',
    'vlan port wifi_0/2 mode tag vlan {{hotspotVlan}}',
    'security-mgmt 1 state enable mode forward protocol web',
    'ssid auth wep wifi_0/2 open-system',
    'ssid ctrl wifi_0/2 name {{ssidName}}',
    'wan 1 service internet host 1',
    'end',
].join('\n');

// (3) Bridge / Huawei (prefix HWTC, atau ONU yang dial PPPoE dari modemnya sendiri) —
//     OLT cuma sediakan transport VLAN INET + Hotspot, tanpa wan-ip/SSID/ACS. Modem
//     mengurus WAN sendiri. Persis konfig Huawei nyata VANS (gpon-onu_1/2/2:26).
const TEMPLATE_VANS_BRIDGE = [
    'conf t',
    'int gpon-olt_{{ponPort}}',
    'onu {{onuId}} type {{onuType}} sn {{sn}}',
    '!',
    'int gpon-onu_{{ponPort}}:{{onuId}}',
    'name {{name}}',
    'tcont 1 name INET profile {{tcontProfile}}',
    'gemport 1 name INET tcont 1',
    'service-port 1 vport 1 user-vlan {{pppoeVlan}} vlan {{pppoeVlan}}',
    'service-port 2 vport 1 user-vlan {{hotspotVlan}} vlan {{hotspotVlan}}',
    '!',
    'pon-onu-mng gpon-onu_{{ponPort}}:{{onuId}}',
    'service INET gemport 1 vlan {{pppoeVlan}}',
    'service HS gemport 1 vlan {{hotspotVlan}}',
    'vlan port eth_0/1 mode tag vlan {{hotspotVlan}}',
    'vlan port eth_0/2 mode tag vlan {{hotspotVlan}}',
    'vlan port eth_0/3 mode tag vlan {{hotspotVlan}}',
    'vlan port eth_0/4 mode tag vlan {{hotspotVlan}}',
    'end',
].join('\n');

// Default var bersama (nilai NYATA VANS — guard fakta OLT akan menolak bila tak cocok
// di OLT lain, jadi aman dipakai sebagai baseline).
const COMMON_VARS = {
    tcontProfile: '1G',
    pppoeVlan: '300',
    hotspotVlan: '310',
    vlanProfile: 'PPPOE',
    ssidName: 'VANS-45NET',
};

const DEFAULT_ONU_TYPES = [
    {
        id: 'vans-zte-router',
        name: 'ZTE Router (F609/F660/F670L) — PPPoE + Hotspot + WiFi + ACS',
        brand: 'zte',
        vendorMatch: ['zte'],
        notes: 'ONU ZTE ASLI (SN ZTEG…). Router penuh 1 langkah: PPPoE (wan-ip), Hotspot, WiFi, dan TR069/ACS (tr069-mgmt) — ONU langsung inform ke GenieACS. Profil standar untuk ±96% pelanggan VANS.',
        vars: {
            ...COMMON_VARS,
            onuType: 'F609',
            mgmtVlan: '100',
            acsUrl: 'http://172.17.11.2:7547',
            acsUsername: 'acs',
            acsPassword: 'acs123',
        },
        scriptTemplate: TEMPLATE_VANS_ZTE,
        builtin: true,
    },
    {
        id: 'vans-clone-router',
        name: 'Clone/OEM Router (RTEG/ZICG/ZXIC) — PPPoE + Hotspot + WiFi (ACS di modem)',
        brand: 'zte',
        vendorMatch: ['clone'],
        notes: 'ONU CLONE/OEM (SN RTEG/ZICG/ZXIC/CIOT). Sama seperti ZTE TAPI tanpa tr069-mgmt — firmware clone abaikan ACS via OLT. Setelah daftar, set TR069 langsung DI MODEM (lewat WAN internet).',
        vars: {
            ...COMMON_VARS,
            onuType: 'ALL',
        },
        scriptTemplate: TEMPLATE_VANS_CLONE,
        builtin: true,
    },
    {
        id: 'vans-bridge',
        name: 'Bridge / Huawei — transport saja (modem dial sendiri)',
        brand: 'zte',
        vendorMatch: ['huawei'],
        notes: 'ONU Huawei (SN HWTC) atau yang dial PPPoE dari routernya sendiri. OLT cuma sediakan transport VLAN internet + hotspot; tanpa wan-ip/SSID/ACS. WAN & WiFi diurus di modem.',
        vars: {
            ...COMMON_VARS,
            onuType: 'ALL',
        },
        scriptTemplate: TEMPLATE_VANS_BRIDGE,
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
 * @param {object} profile {id?, name, brand?, vendorMatch?, notes?, vars?, scriptTemplate}
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
        vendorMatch: sanitizeVendorMatch(profile.vendorMatch),
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

/** vendorMatch: hanya tier vendor yang dikenal (zte/clone/huawei/unknown), unik. */
function sanitizeVendorMatch(vendorMatch) {
    if (!Array.isArray(vendorMatch)) return [];
    const out = [];
    for (const t of vendorMatch) {
        const tier = String(t || '').trim().toLowerCase();
        if (VALID_VENDOR_TIERS.includes(tier) && !out.includes(tier)) out.push(tier);
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
    VALID_VENDOR_TIERS,
    __test: { slugify, sanitizeVarsObject, sanitizeVendorMatch, DEFAULT_ONU_TYPES, STORE_FILE },
};
