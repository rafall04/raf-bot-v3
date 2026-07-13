/**
 * Header Doc
 * Purpose: Resolusi IP PPPoE pelanggan -> jalur upstream (gmdp/mni/ih/sf). TIGA LAPIS, dari yang
 *          paling spesifik:
 *          (1) OVERRIDE per-pelanggan `RAF-STEER-<jalur>` (dikelola customerSteering, mis. failover)
 *              — dibaca live & MENANG bila ada;
 *          (2) PROFIL per-pool LIVE dari address-list `freedns` (base MNI) vs `lokaldns` (base GMDP)
 *              — INI sumber kebenaran path normal di router (owner memindah pelanggan dgn
 *              enable/disable subnet di dua list ini). Entri `disabled` DIABAIKAN;
 *          (3) BASIS peta pool paket (`upstream-path-resolver`, DEFAULT_PATH_POOLS) sebagai JARING
 *              PENGAMAN bila IP tak ada di profil live (mis. list belum lengkap);
 *          lalu `gmdp` bila tetap tak terpetakan. Baca address-list di-cache ~60s.
 *          FAIL-CLOSED: bila router tak terbaca -> `null` (pemanggil perlakukan "tak bisa
 *          dipastikan", BUKAN asal "normal").
 *          Lapis (2) membuat resolver TETAP presisi walau owner re-toggle pool nanti — tak lagi
 *          bergantung pada peta pool hardcoded. Selisih profil-live vs peta-pool = "drift" yang
 *          bisa dipantau (`computeSteeringDrift`, dipakai `lib/steering-drift-monitor.js`).
 * Caller: `message/handlers/connection-check-handler.js` (resolveUpstreamHealth + buildUpstreamSection),
 *         `lib/steering-drift-monitor.js` (getSteeringSnapshot + computeSteeringDrift).
 * Deps: `./mikrotik` (getSteeringAddressLists) — lazy require agar aman di-unit-test tanpa PHP;
 *       `./upstream-path-resolver` (resolvePathForIp + getPathPools) untuk jaring pengaman & drift.
 * MainFuncs: `resolveCustomerPath`, `getSteeringSnapshot`, `computeSteeringDrift`.
 * SideEffects: Membaca address-list MikroTik lewat bridge PHP (READ-ONLY) + cache in-memori.
 */
'use strict';

// OVERRIDE per-individu (dikelola customerSteering) -> path key upstream-quality-poller.
const STEER_LIST_TO_PATH = {
    'RAF-STEER-GMDP': 'gmdp',
    'RAF-STEER-MNI': 'mni',
    'RAF-STEER-IH': 'ih',
    'RAF-STEER-SF': 'sf',
};
// PROFIL per-pool (sumber kebenaran path normal). freedns=base MNI, lokaldns=base GMDP.
const PROFILE_LIST_TO_PATH = {
    freedns: 'mni',
    lokaldns: 'gmdp',
};
// Bila sebuah IP kebetulan cocok di dua profil (harusnya tak terjadi krn disabled saling
// meniadakan), `freedns` menang — mengikuti urutan rule mangle di router (freedns mark MNI duluan).
const PROFILE_PRECEDENCE = ['freedns', 'lokaldns'];
const DEFAULT_PATH = 'gmdp'; // tak masuk list mana pun = default route = tabel main = jalur utama.
const CACHE_TTL_MS = 60 * 1000;

let cache = { at: 0, snapshot: null };

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
function longToIp(n) {
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
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
// IP wakil (network+1) dari sebuah CIDR — untuk sampling saat menghitung drift.
function firstHostOf(cidr) {
    const m = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(String(cidr || '').trim());
    if (!m) return null;
    const netLong = ipToLong(m[1]);
    if (netLong === null) return null;
    return longToIp((netLong + 1) >>> 0);
}
function unwrapEntries(data) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data && data.data)) return data.data;
    if (Array.isArray(data && data.items)) return data.items;
    return [];
}

/**
 * Baca address-list steering (RAF-STEER-* + freedns/lokaldns) → snapshot terstruktur, cache ~60s.
 * @returns {Promise<{overrides: Array<{path,address}>, profiles: Object<string,string[]>}>}
 * @throws bila router tak terbaca (supaya pemanggil fail-closed, BUKAN cache kosong).
 */
async function loadSteeringSnapshot() {
    const now = Date.now();
    if (cache.snapshot && now - cache.at < CACHE_TTL_MS) return cache.snapshot;
    const { getSteeringAddressLists } = require('./mikrotik');
    const res = await getSteeringAddressLists();
    if (!res || res.ok !== true) {
        throw new Error('steering read gagal: ' + ((res && res.message) || 'unknown'));
    }
    const overrides = [];
    const profiles = { freedns: [], lokaldns: [] };
    for (const e of unwrapEntries(res.data)) {
        if (!e || e.disabled === true) continue; // entri nonaktif diabaikan
        const address = e.address;
        if (!address) continue;
        if (STEER_LIST_TO_PATH[e.list]) {
            overrides.push({ path: STEER_LIST_TO_PATH[e.list], address });
        } else if (PROFILE_LIST_TO_PATH[e.list]) {
            profiles[e.list].push(address);
        }
    }
    const snapshot = { overrides, profiles };
    cache = { at: now, snapshot };
    return snapshot;
}

/** Path dari PROFIL live (freedns/lokaldns) untuk `ip`, atau null bila tak ada profil yang cocok. */
function matchProfilePath(ip, snapshot) {
    const profiles = (snapshot && snapshot.profiles) || {};
    for (const listName of PROFILE_PRECEDENCE) {
        const addrs = profiles[listName] || [];
        for (const addr of addrs) {
            if (addressMatchesIp(addr, ip)) return PROFILE_LIST_TO_PATH[listName];
        }
    }
    return null;
}

/**
 * Jalur upstream pelanggan (lihat Header Doc untuk urutan 3 lapis).
 * @param {string} ip - IP remote PPPoE pelanggan.
 * @returns {Promise<'gmdp'|'mni'|'ih'|'sf'|null>}
 */
async function resolveCustomerPath(ip) {
    if (!ip) return null;
    const clean = String(ip).trim().split('/')[0];
    if (ipToLong(clean) === null) return null;
    let snapshot;
    try {
        snapshot = await loadSteeringSnapshot();
    } catch (_e) {
        return null; // router tak terbaca → fail-closed (verdict tak asal "normal")
    }
    // 1. OVERRIDE per-individu (RAF-STEER-*) — menang bila ada.
    for (const r of snapshot.overrides) {
        if (addressMatchesIp(r.address, clean)) return r.path;
    }
    // 2. PROFIL per-pool LIVE (freedns→mni / lokaldns→gmdp) — sumber kebenaran path normal.
    const profilePath = matchProfilePath(clean, snapshot);
    if (profilePath) return profilePath;
    // 3. JARING PENGAMAN: peta pool paket (dipakai hanya bila IP tak ada di profil live).
    try {
        const { resolvePathForIp } = require('./upstream-path-resolver');
        const upCfg = (global.config && global.config.upstreamMonitor) || {};
        const resolved = resolvePathForIp(clean, upCfg);
        if (resolved && resolved.path) return resolved.path;
    } catch (_e) {
        /* peta pool gagal → jatuh ke default utama */
    }
    return DEFAULT_PATH;
}

/** Snapshot steering live (untuk monitor drift). Melempar bila router tak terbaca. */
async function getSteeringSnapshot() {
    return loadSteeringSnapshot();
}

/**
 * Hitung "drift": subnet di peta pool hardcoded yang jalurnya BEDA dari profil live freedns/lokaldns.
 * Dipakai `lib/steering-drift-monitor.js` untuk mengingatkan admin agar memutakhirkan peta pool
 * (jaring pengaman) bila owner mengubah steering di router. MURNI (tanpa efek samping).
 * @param {{profiles: Object<string,string[]>}} snapshot - dari getSteeringSnapshot().
 * @param {object} [upCfg] - config.upstreamMonitor (untuk getPathPools).
 * @returns {Array<{cidr:string, poolPath:string, livePath:string}>} kosong = selaras.
 */
function computeSteeringDrift(snapshot, upCfg) {
    const drift = [];
    let getPathPools;
    try {
        ({ getPathPools } = require('./upstream-path-resolver'));
    } catch (_e) {
        return drift;
    }
    const cfg = upCfg || (global.config && global.config.upstreamMonitor) || {};
    for (const pool of getPathPools(cfg)) {
        for (const cidr of pool.cidrs || []) {
            const repIp = firstHostOf(cidr) || String(cidr).split('/')[0];
            const livePath = matchProfilePath(repIp, snapshot);
            // livePath null = subnet ini tak ada di profil live → tak bisa dibandingkan (bukan drift).
            if (livePath && livePath !== pool.path) {
                drift.push({ cidr, poolPath: pool.path, livePath });
            }
        }
    }
    return drift;
}

function _resetCacheForTest() {
    cache = { at: 0, snapshot: null };
}

module.exports = {
    resolveCustomerPath,
    getSteeringSnapshot,
    computeSteeringDrift,
    _resetCacheForTest,
    _internal: { addressMatchesIp, ipInCidr, ipInRange, firstHostOf, matchProfilePath, STEER_LIST_TO_PATH, PROFILE_LIST_TO_PATH, DEFAULT_PATH },
};
