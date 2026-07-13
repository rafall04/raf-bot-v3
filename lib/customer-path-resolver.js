/**
 * Header Doc
 * Purpose: Resolusi IP PPPoE pelanggan -> jalur upstream (gmdp/mni/ih/sf). DUA LAPIS:
 *          (1) OVERRIDE LIVE per-pelanggan dari address-list `RAF-STEER-<jalur>` (dikelola
 *          customerSteering saat memindah pelanggan tertentu, mis. failover) — dibaca live & MENANG;
 *          (2) BASIS peta pool paket (`upstream-path-resolver`: reguler pool70=gmdp, 110k/125k/FREE
 *          pool61/62/71=mni) untuk kondisi NORMAL — ini benar sekarang (110k/125k memang di MNI).
 *          Dulu resolver ini keliru mem-default SEMUA ke gmdp saat RAF-STEER kosong; kini jatuh ke
 *          basis pool yg akurat. Baca RAF-STEER di-cache ~60s (seirama reconcileIntervalSeconds).
 *          FAIL-CLOSED: bila router tak terbaca -> `null` (pemanggil perlakukan "tak bisa dipastikan",
 *          BUKAN asal "normal").
 * Caller: `message/handlers/connection-check-handler.js` (resolveUpstreamHealth + buildUpstreamSection).
 * Deps: `./mikrotik` (getSteeringAddressLists) — lazy require agar aman di-unit-test tanpa PHP.
 * MainFuncs: `resolveCustomerPath`.
 * SideEffects: Membaca address-list MikroTik lewat bridge PHP (READ-ONLY) + cache in-memori.
 */
'use strict';

// Address-list steering (dikelola customerSteering bot) -> path key upstream-quality-poller.
const STEER_LIST_TO_PATH = {
    'RAF-STEER-GMDP': 'gmdp',
    'RAF-STEER-MNI': 'mni',
    'RAF-STEER-IH': 'ih',
    'RAF-STEER-SF': 'sf',
};
const DEFAULT_PATH = 'gmdp'; // tak masuk list steering = default route = tabel main = jalur utama.
const CACHE_TTL_MS = 60 * 1000;

let cache = { at: 0, rules: null };

function ipToLong(ip) {
    const parts = String(ip || '').trim().split('.');
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
function ipInCidr(ip, cidr) {
    const m = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(String(cidr || '').trim());
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
function ipInRange(ip, a, b) {
    const L = ipToLong(ip);
    const A = ipToLong(a);
    const B = ipToLong(b);
    return L !== null && A !== null && B !== null && L >= A && L <= B;
}
// RouterOS `address` bisa: IP tunggal, CIDR, atau rentang "a-b".
function addressMatchesIp(address, ip) {
    const a = String(address || '').trim();
    if (!a) return false;
    if (a.includes('/')) return ipInCidr(ip, a);
    if (a.includes('-')) {
        const [x, y] = a.split('-');
        return ipInRange(ip, x, y);
    }
    return a === ip;
}
function unwrapEntries(data) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data && data.data)) return data.data;
    if (Array.isArray(data && data.items)) return data.items;
    return [];
}

async function loadSteeringRules() {
    const now = Date.now();
    if (cache.rules && now - cache.at < CACHE_TTL_MS) return cache.rules;
    const { getSteeringAddressLists } = require('./mikrotik');
    const res = await getSteeringAddressLists();
    if (!res || res.ok !== true) {
        // Router tak terbaca -> lempar supaya resolveCustomerPath fail-closed (null), BUKAN cache kosong.
        throw new Error('steering read gagal: ' + ((res && res.message) || 'unknown'));
    }
    const rules = [];
    for (const e of unwrapEntries(res.data)) {
        const path = STEER_LIST_TO_PATH[e && e.list];
        const address = e && e.address;
        if (path && address) rules.push({ path, address });
    }
    cache = { at: now, rules };
    return rules;
}

/**
 * Jalur upstream pelanggan.
 * PRIORITAS: (1) OVERRIDE LIVE per-pelanggan dari `RAF-STEER-*` (dipakai customerSteering saat
 * memindah pelanggan tertentu, mis. failover) — MENANG bila ada; (2) BASIS STABIL peta pool paket
 * (`upstream-path-resolver`: 110k/125k/FREE=mni, reguler=gmdp) — kondisi normal; (3) `gmdp` bila IP
 * tak terpetakan pool mana pun. `null` HANYA bila router tak terbaca / IP invalid (fail-closed).
 * @param {string} ip - IP remote PPPoE pelanggan.
 * @returns {Promise<'gmdp'|'mni'|'ih'|'sf'|null>}
 */
async function resolveCustomerPath(ip) {
    if (!ip) return null;
    const clean = String(ip).trim().split('/')[0];
    if (ipToLong(clean) === null) return null;
    let rules;
    try {
        rules = await loadSteeringRules();
    } catch (_e) {
        return null; // router tak terbaca → fail-closed (verdict tak asal "normal")
    }
    // 1. Override LIVE per-pelanggan (RAF-STEER-*). Kosong saat ini → lanjut ke basis pool.
    for (const r of rules) {
        if (addressMatchesIp(r.address, clean)) return r.path;
    }
    // 2. Basis STABIL: peta pool paket → jalur (reguler=gmdp, 110k/125k/FREE=mni). Ini kondisi normal
    //    yang benar sekarang (110k/125k memang di MNI). RAF-STEER hanya MENIMPA saat ada steering khusus.
    try {
        const { resolvePathForIp } = require('./upstream-path-resolver');
        const upCfg = (global.config && global.config.upstreamMonitor) || {};
        const resolved = resolvePathForIp(clean, upCfg);
        if (resolved && resolved.path) return resolved.path;
    } catch (_e) {
        // peta pool gagal → jatuh ke default utama
    }
    return DEFAULT_PATH; // tak terpetakan pool mana pun → asumsikan jalur utama.
}

function _resetCacheForTest() {
    cache = { at: 0, rules: null };
}

module.exports = {
    resolveCustomerPath,
    _resetCacheForTest,
    _internal: { addressMatchesIp, ipInCidr, ipInRange, STEER_LIST_TO_PATH, DEFAULT_PATH },
};
