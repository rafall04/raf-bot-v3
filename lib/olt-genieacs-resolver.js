/**
 * Header Doc
 * Purpose: Resolusi OLT-MAC → pelanggan lewat GenieACS (jembatan MAC↔device↔pppoe/_id) yang
 *          ANDAL walau modem OFFLINE (Dying-Gasp/LOS) & tanpa `last-caller-id-cache.json`.
 *          GenieACS = sumber kebenaran device↔pppoe/_id (persist walau ONU mati). Index MAC
 *          di-cache in-memory (TTL) + refresh async (never-throw); lookup SINKRON dari index hangat.
 * Caller: `lib/olt-customer-resolver.js` (fallback setelah caller-id cache miss) → dipakai
 *          logger event OLT & broadcaster LOS.
 * Deps: `lib/genieacs.queryDevices` (auth + circuit breaker), `lib/olt-hioso.matchMAC`.
 * MainFuncs: `resolveByMacSync(oltMac)` → {deviceId,pppoe}|null; `ensureFresh()`; `refreshIndex()`.
 * SideEffects: HTTP GET ke GenieACS (best-effort). Tidak pernah throw.
 */
"use strict";

const CACHE_TTL_MS = 10 * 60 * 1000; // refresh index tiap 10 menit

// Path MAC & pppoe lintas-model (Huawei/ZTE/generic). Index dibangun dari proyeksi ini.
const MAC_PATHS = [
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.MACAddress",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.MACAddress",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.MACAddress",
    "InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1.MACAddress",
    "InternetGatewayDevice.WANDevice.1.X_CT-COM_WANGponLinkConfig.MACAddress",
];
const PPP_PATHS = [
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.Username",
    "Device.PPP.Interface.1.Username",
];

let _index = [];       // [{ mac(norm), deviceId, pppoe }]
let _builtAt = 0;
let _building = null;

function norm(m) {
    return String(m || "").replace(/[^0-9a-f]/gi, "").toLowerCase();
}

// Kumpulkan semua nilai leaf `_value` dari objek device GenieACS (tanpa peduli path).
function collectValues(obj, out) {
    if (!obj || typeof obj !== "object") return;
    if (Object.prototype.hasOwnProperty.call(obj, "_value")) {
        out.push(obj._value);
    }
    for (const k of Object.keys(obj)) {
        if (k === "_value") continue;
        collectValues(obj[k], out);
    }
}

// PURE: bangun index dari array device GenieACS. Proyeksi = _id + MAC + Username, jadi
// nilai ber-"@" = pppoe, nilai 12-hex = MAC. deviceId dari `_id` (cocok users.device_id).
function buildIndexFromDevices(devices) {
    const idx = [];
    for (const dev of devices || []) {
        if (!dev) continue;
        const vals = [];
        collectValues(dev, vals);
        const macs = vals.filter((v) => typeof v === "string" && norm(v).length === 12);
        const pppoe = vals.find((v) => typeof v === "string" && v.includes("@")) || null;
        const deviceId = dev._id || null;
        for (const m of macs) {
            idx.push({ mac: norm(m), deviceId, pppoe });
        }
    }
    return idx;
}

async function refreshIndex() {
    try {
        const genieacs = require("./genieacs");
        const res = await genieacs.queryDevices({
            operation: "oltMacIndex",
            projection: ["_id", ...MAC_PATHS, ...PPP_PATHS],
            timeoutMs: 20000,
        });
        if (!res || !res.ok || !Array.isArray(res.data)) return _index;
        _index = buildIndexFromDevices(res.data);
        _builtAt = Date.now();
        return _index;
    } catch (_e) {
        return _index; // best-effort — pertahankan index lama
    }
}

// Kick refresh async bila index kosong / basi. Non-blocking.
function ensureFresh() {
    if (_building) return;
    if (_index.length && (Date.now() - _builtAt) < CACHE_TTL_MS) return;
    _building = Promise.resolve()
        .then(refreshIndex)
        .catch(() => _index)
        .finally(() => { _building = null; });
}

/**
 * Lookup SINKRON dari index hangat. Return {deviceId, pppoe}|null.
 * matchMAC menoleransi selisih ≤2 pada oktet terakhir (OLT vs GenieACS bisa beda 1–2).
 */
function resolveByMacSync(oltMac) {
    ensureFresh();
    if (!_index.length) return null;
    const target = norm(oltMac);
    if (!target) return null;
    let matchMAC;
    try { matchMAC = require("./olt-hioso").matchMAC; } catch (_e) { matchMAC = null; }
    for (const e of _index) {
        try {
            if (e.mac === target || (matchMAC && matchMAC(e.mac, oltMac))) {
                return { deviceId: e.deviceId, pppoe: e.pppoe };
            }
        } catch (_e) { /* ignore satu entri */ }
    }
    return null;
}

module.exports = {
    resolveByMacSync,
    ensureFresh,
    refreshIndex,
    buildIndexFromDevices,
    // Dipakai bersama `lib/redaman-alert-scope.js` — SATU definisi jalur username PPPoE.
    PPP_PATHS,
    // Internal — untuk test.
    _getIndex: () => _index,
    _setIndexForTest: (i) => { _index = i || []; _builtAt = Date.now(); },
};
