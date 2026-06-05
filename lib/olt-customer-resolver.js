/**
 * OLT Customer Resolver
 *
 * Memetakan MAC ONU (dari event OLT/LOS) ke record pelanggan — untuk notifikasi
 * pelanggan otomatis saat fiber putus.
 *
 * KENAPA INI ROBUST & RINGAN:
 *   - Sumber data = `database/last-caller-id-cache.json` yang SUDAH dipelihara
 *     oleh dashboard OLT (routes/olt.js) tiap pelanggan terlihat online. Jadi
 *     TIDAK ada query MikroTik baru, TIDAK ada poller baru — cukup baca file.
 *   - Pakai MAC TERAKHIR diketahui (saat pelanggan online), jadi tetap bisa
 *     resolve walau saat LOS pelanggan sedang offline (justru itu yang kita butuh).
 *   - matchMAC menangani selisih 2 digit terakhir antara MAC MikroTik vs OLT.
 *
 * Best-effort: tidak pernah throw. Kalau tak ketemu → null (caller menandai
 * incident `customer_unresolved` supaya admin bisa info manual).
 *
 * Cache file di-reload hanya saat mtime berubah (hemat I/O).
 */
"use strict";

const fs = require("fs");
const path = require("path");

const CALLER_ID_CACHE_FILE = path.join(__dirname, "..", "database", "last-caller-id-cache.json");

let _cache = null;        // { pppoe_username: { mac, timestamp } }
let _cacheMtimeMs = 0;

function defaultLoadCallerIdCache() {
    try {
        const stat = fs.statSync(CALLER_ID_CACHE_FILE);
        if (_cache && stat.mtimeMs === _cacheMtimeMs) return _cache; // belum berubah → pakai memori
        const parsed = JSON.parse(fs.readFileSync(CALLER_ID_CACHE_FILE, "utf8"));
        _cache = parsed && typeof parsed === "object" ? parsed : {};
        _cacheMtimeMs = stat.mtimeMs;
        return _cache;
    } catch (_e) {
        return _cache || {}; // file belum ada / korup → pakai cache lama / kosong
    }
}

/**
 * @param {object} deps - { loadCallerIdCache, getUsers, matchMAC } (untuk test)
 * @returns {function(string): (object|null)} resolver MAC→user
 */
function createCustomerResolver(deps = {}) {
    const loadCache = deps.loadCallerIdCache || defaultLoadCallerIdCache;
    const getUsers = deps.getUsers || (() => global.users || []);
    const matchMAC = deps.matchMAC || require("./olt-hioso").matchMAC;

    return function resolveCustomerByMac(oltMac) {
        if (!oltMac) return null;
        let cache;
        try {
            cache = loadCache() || {};
        } catch (_e) {
            return null;
        }
        const users = getUsers() || [];
        if (users.length === 0) return null;

        // Cari pppoe_username yang MAC terakhirnya cocok dengan MAC ONU di OLT.
        for (const pppoe of Object.keys(cache)) {
            const info = cache[pppoe];
            const mac = info && info.mac;
            if (!mac) continue;
            let matched = false;
            try {
                matched = matchMAC(mac, oltMac); // (mikrotikMAC, oltMAC)
            } catch (_e) {
                matched = false;
            }
            if (matched) {
                const user = users.find((u) => u && u.pppoe_username === pppoe);
                if (user) return user;
            }
        }
        return null;
    };
}

// Resolver default (dipakai broadcaster runtime).
const resolveCustomerByMac = createCustomerResolver();

module.exports = {
    createCustomerResolver,
    resolveCustomerByMac,
    CALLER_ID_CACHE_FILE,
    _resetCache: () => { _cache = null; _cacheMtimeMs = 0; },
};
