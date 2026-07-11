/**
 * Header Doc
 * Purpose: Gerbang "sadar mati-listrik" untuk CCTV monitor. Membaca log kejadian OLT
 *          (database/olt_events.sqlite) dan menghitung berapa ONU/modem yang mengirim
 *          `dying-gasp` (kehilangan daya PLN) di sekitar waktu sebuah CCTV terdeteksi mati.
 *          Dipakai cctv-monitor untuk MENAHAN broadcast "CCTV mati" ke pelanggan ketika akar
 *          masalah sebenarnya adalah listrik area padam (modem & CCTV mati bersama), BUKAN
 *          gangguan CCTV. Sinyal dying-gasp = kebenaran-dasar hilangnya daya (lihat
 *          lib/olt-event-classifier.js).
 * Caller: lib/cctv-monitor.js (pollOnce → tangkap verdikt saat CCTV turun; onConfirm baca sinkron).
 * Deps: repositories/olt-event.repository (getOltEventRepository → listEvents), dimuat lazy agar
 *       import modul ini tidak membuka koneksi SQLite (mis. di unit test yang menyuntik dep).
 * MainFuncs: createPowerOutageGate(deps) — factory testable; getContext(opts) — singleton default.
 * SideEffects: baca-ONLY SQLite olt_events (koneksi singleton yg sudah dibuka olt-event-logger);
 *              cache in-memory pendek (TTL) anti-query berulang. NEVER-THROW pada jalur default →
 *              kegagalan baca dikembalikan sebagai { dgOnu: 0 } (fail-open: jangan menahan broadcast
 *              hanya karena kita buta terhadap OLT).
 */
'use strict';

const DEFAULT_CACHE_TTL_MS = 30_000;
const DEFAULT_LOOKBACK_MS = 6 * 60_000; // dying-gasp mendahului CCTV-unreachable beberapa detik–menit
const DEFAULT_FORWARD_MS = 2 * 60_000;  // toleransi bila syslog OLT sedikit telat dari deteksi netwatch
const MAX_ROWS = 1024;                   // cukup utk 2 PON × 128 ONU = 256 modem (dedup di repo)
const MAX_NAMES = 24;                    // contoh pelanggan terdampak untuk ringkasan admin

function normMac(m) { return String(m || '').replace(/[^0-9a-f]/gi, '').toLowerCase(); }

function createPowerOutageGate(deps = {}) {
    const getRepo = deps.getRepo
        || (() => require('../repositories/olt-event.repository').getOltEventRepository());
    const now = deps.now || (() => Date.now());
    const cacheTtlMs = Number.isFinite(deps.cacheTtlMs) ? deps.cacheTtlMs : DEFAULT_CACHE_TTL_MS;
    const cache = new Map(); // windowKey → { at, value }

    /**
     * Hitung konteks mati-listrik di jendela [at - lookback, at + forward].
     * @param {{at?:number, lookbackMs?:number, forwardMs?:number}} opts
     * @returns {Promise<{dgOnu:number, customers:string[], firstAtMs:(number|null), error?:string}>}
     *          dgOnu = jumlah ONU/modem BERBEDA yang dying-gasp di jendela itu.
     */
    async function getContext(opts = {}) {
        const at = Number.isFinite(opts.at) ? opts.at : now();
        const lookbackMs = Number.isFinite(opts.lookbackMs) ? opts.lookbackMs : DEFAULT_LOOKBACK_MS;
        const forwardMs = Number.isFinite(opts.forwardMs) ? opts.forwardMs : DEFAULT_FORWARD_MS;
        const from = at - Math.max(0, lookbackMs);
        const to = at + Math.max(0, forwardMs);

        // Cache per-jendela (dibulatkan ke detik): banyak CCTV turun di poll yang sama punya
        // `at` identik → berbagi satu query nyata. Insiden yang sama di poll berikutnya juga hit.
        const key = Math.round(from / 1000) + ':' + Math.round(to / 1000);
        const hit = cache.get(key);
        if (hit && (now() - hit.at) < cacheTtlMs) return hit.value;

        let value = { dgOnu: 0, customers: [], firstAtMs: null };
        try {
            const repo = getRepo();
            const rows = await repo.listEvents({ from, to, type: 'dying-gasp', limit: MAX_ROWS });
            const macs = new Set();
            const names = [];
            let firstAtMs = null;
            for (const r of rows || []) {
                const mn = normMac(r.mac);
                if (mn && !macs.has(mn)) {
                    macs.add(mn);
                    if (r.customer_name && names.length < MAX_NAMES) names.push(r.customer_name);
                }
                const tms = Number(r.ts_ms);
                if (Number.isFinite(tms)) firstAtMs = firstAtMs === null ? tms : Math.min(firstAtMs, tms);
            }
            value = { dgOnu: macs.size, customers: names, firstAtMs };
        } catch (e) {
            // fail-open: buta terhadap OLT → JANGAN menahan broadcast (kembalikan nol).
            value = { dgOnu: 0, customers: [], firstAtMs: null, error: e && e.message };
        }

        cache.set(key, { at: now(), value });
        if (cache.size > 64) { const k = cache.keys().next().value; cache.delete(k); } // batasi memori
        return value;
    }

    return { getContext, _cache: cache };
}

let _singleton = null;
function getContext(opts) {
    if (!_singleton) _singleton = createPowerOutageGate();
    return _singleton.getContext(opts);
}

module.exports = { createPowerOutageGate, getContext, DEFAULT_LOOKBACK_MS, DEFAULT_FORWARD_MS };
