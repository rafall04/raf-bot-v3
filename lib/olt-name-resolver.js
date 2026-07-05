/**
 * Header Doc
 * Purpose: Petakan `olt_id` mentah sebuah event OLT (bisa IP OLT asli dari scraper, ATAU IP
 *          MikroTik ke-NAT `172.17.11.1` dari syslog) → tampilan {name, ip} yang manusiawi.
 *          Sumber: `config.olt.devices` (registry OLT ber-nama) + fallback `config.oltSyslog`
 *          (bot 1-OLT seperti Tanjung). Read-time (dipakai API), jadi tanpa migrasi/backfill.
 * Caller: `routes/olt.js` (endpoint `/api/olt/event-log`).
 * Deps: `global.config.olt.devices`, `global.config.oltSyslog`.
 * MainFuncs: `resolveOltDisplay(rawOltId)` → { name: string|null, ip: string|null }.
 * SideEffects: none (murni baca config).
 */
"use strict";

function norm(s) {
    return String(s == null ? "" : s).trim().toLowerCase();
}

function getDevices() {
    const olt = (global.config && global.config.olt) || {};
    return Array.isArray(olt.devices) ? olt.devices : [];
}

/**
 * @param {string} rawOltId - nilai `olt_id` tersimpan (IP OLT / IP NAT / id device).
 * @returns {{name: string|null, ip: string|null}}
 */
function resolveOltDisplay(rawOltId) {
    const raw = rawOltId != null ? String(rawOltId) : "";
    const devices = getDevices();

    // 1) Cocokkan ke device di registry (host/ip/id) — akurat utk event scraper (OLT asli).
    for (const d of devices) {
        if (!d) continue;
        if (norm(d.host) === norm(raw) || norm(d.ip) === norm(raw) || norm(d.id) === norm(raw)) {
            return { name: d.name || d.host || d.id || null, ip: d.host || d.ip || null };
        }
    }

    // 2) Bot 1-OLT (syslog ke-NAT, tak match host): label eksplisit dari config.oltSyslog.
    const syslogCfg = (global.config && global.config.oltSyslog) || {};
    if (syslogCfg.oltName || syslogCfg.oltHost) {
        return { name: syslogCfg.oltName || null, ip: syslogCfg.oltHost || (raw || null) };
    }

    // 3) Registry cuma 1 device → apapun sumbernya, OLT itu.
    if (devices.length === 1) {
        const d = devices[0];
        return { name: d.name || null, ip: d.host || d.ip || null };
    }

    // 4) Tak dikenal / ambigu (mis. multi-OLT via syslog ke-NAT) → tampilkan apa adanya.
    return { name: null, ip: raw || null };
}

module.exports = { resolveOltDisplay };
