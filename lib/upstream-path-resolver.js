/**
 * Header Doc
 * Purpose: Pemetaan IP PPPoE pelanggan → jalur upstream (CIDR pool → path key). Sumber peta:
 *          `config.upstreamMonitor.pathPools`; default = hasil recon router gateway DANDER
 *          2026-07-07 (pool 110k/125k/FREE → freedns → jalur MNI; pool reguler → GMDP).
 *          Steering di router berbasis SUBNET remote-address PPPoE, bukan per-profil.
 * Caller: `message/handlers/connection-check-handler.js` (seksi upstream) dan calon konsumen
 *         verdict lain (tiket teknisi).
 * Deps: — (murni; baca config via parameter/global).
 * MainFuncs: `resolvePathForIp`, `ipInCidr`, `getPathPools`.
 * SideEffects: Tidak ada.
 */
"use strict";

// Default sesuai address-list aktif router gateway DANDER (freedns vs lokaldns).
const DEFAULT_PATH_POOLS = [
    { path: "mni", cidrs: ["192.168.61.0/24", "192.168.62.0/24", "192.168.71.0/24", "192.168.123.0/24", "10.10.50.0/24"] },
    { path: "gmdp", cidrs: ["192.168.70.0/24", "10.10.0.0/20", "192.168.145.0/24"] }
];

function ipToLong(ip) {
    const parts = String(ip || "").trim().split(".");
    if (parts.length !== 4) return null;
    let out = 0;
    for (const part of parts) {
        if (!/^\d{1,3}$/.test(part)) return null;
        const n = Number(part);
        if (n > 255) return null;
        out = out * 256 + n;
    }
    return out >>> 0;
}

/** True bila IPv4 `ip` berada dalam `cidr` (mis. "192.168.61.0/24"). Input tak valid → false. */
function ipInCidr(ip, cidr) {
    const m = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(String(cidr || "").trim());
    if (!m) return false;
    const prefix = Number(m[2]);
    if (prefix < 0 || prefix > 32) return false;
    const ipLong = ipToLong(ip);
    const netLong = ipToLong(m[1]);
    if (ipLong === null || netLong === null) return false;
    if (prefix === 0) return true;
    const mask = (0xffffffff << (32 - prefix)) >>> 0;
    return (ipLong & mask) === (netLong & mask);
}

function getPathPools(upstreamConfig = (global.config && global.config.upstreamMonitor) || {}) {
    const pools = Array.isArray(upstreamConfig.pathPools) && upstreamConfig.pathPools.length
        ? upstreamConfig.pathPools
        : DEFAULT_PATH_POOLS;
    return pools.filter((p) => p && p.path && Array.isArray(p.cidrs));
}

/**
 * Petakan IP pelanggan ke jalur upstream.
 * @returns {{path: string, cidr: string}|null} null bila tak ada pool yang cocok / IP tak valid.
 */
function resolvePathForIp(ip, upstreamConfig) {
    if (!ip) return null;
    // Bentuk MikroTik ppp active `address` kadang "1.2.3.4" polos — buang suffix aneh bila ada.
    const cleanIp = String(ip).trim().split("/")[0];
    for (const pool of getPathPools(upstreamConfig)) {
        for (const cidr of pool.cidrs) {
            if (ipInCidr(cleanIp, cidr)) {
                return { path: pool.path, cidr };
            }
        }
    }
    return null;
}

module.exports = {
    resolvePathForIp,
    ipInCidr,
    getPathPools,
    _internal: { DEFAULT_PATH_POOLS, ipToLong }
};
