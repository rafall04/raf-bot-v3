/**
 * Header Doc
 * Purpose: Monitoring BANDWIDTH OLT ZTE C320 (ZXAN) — snapshot rate/util per PON port & uplink
 *          (READ-ONLY) + histori ring in-memory untuk sparkline/tren. Rate diambil langsung dari
 *          counter device (`show interface` memberi "Input/Output rate" instan → tak perlu delta).
 * Caller: routes/olt-provisioning.js (GET /provision/devices/:id/bandwidth[/history]).
 * Deps: lib/olt-ssh-client (openOltShell, withHostLock), lib/olt-health-service (parseCard,
 *       parsePhysInterface — reuse parser uplink & kartu).
 * MainFuncs: getBandwidthSnapshot(device,opts), getBandwidthHistory(device), parseGponOltInterface
 *            (murni, di-export untuk test), resetBandwidthState.
 * SideEffects: SATU sesi SSH read-only per refresh (serial per host, cache TTL), simpan ring history.
 *
 * Catatan: histori in-memory (hilang saat restart) — cukup untuk sparkline/tren sesi berjalan.
 * Poller cron persisten (mis. SQLite spt olt-rxpower-history) = peningkatan lanjutan bila perlu
 * histori 24/7 lintas-restart. Interval refresh dijaga konservatif (cache) — ZXAN sensitif spam SSH.
 */
'use strict';

const { openOltShell, withHostLock } = require('./olt-ssh-client');
const { parseCard, parsePhysInterface } = require('./olt-health-service');

const CACHE_TTL_MS = 30000;
const HISTORY_MAX = 288; // ~24 jam @ sampel 5 menit
const MAX_PORT_PROBE = 24;

const cache = new Map(); // host -> { at, snapshot }
const history = new Map(); // `${host}|${port}` -> [{ at, inBps, outBps, utilIn, utilOut }]

function num(v) {
    const n = parseInt(String(v).replace(/[^\d-]/g, ''), 10);
    return Number.isNaN(n) ? null : n;
}

/**
 * Parse `show interface gpon-olt_<r>/<s>/<p>` (per-PON). Kembalikan null bila output bukan
 * interface PON valid (mis. %Error / port tak terpasang).
 */
function parseGponOltInterface(text, name) {
    const t = String(text || '');
    if (/%\s*Error/i.test(t)) return null;
    if (!/\bis\s+(activate|inactivate|up|down)\b/i.test(t)) return null;
    const onus = t.match(/has\s+(\d+)\s+onus,\s+the number of registered onus is\s+(\d+)/i);
    const inR = t.match(/Input rate\s*:\s*(\d+)\s*Bps\s+(\d+)\s*pps/i);
    const outR = t.match(/Output rate\s*:\s*(\d+)\s*Bps\s+(\d+)\s*pps/i);
    const inU = t.match(/Input Instantaneous bandwidth throughput\s*:\s*([\d.]+)\s*%/i);
    const outU = t.match(/Output Instantaneous bandwidth throughput\s*:\s*([\d.]+)\s*%/i);
    return {
        name: name || (t.match(/^(\S+)\s+is\s+/m) || [])[1] || null,
        kind: 'pon',
        onuCapacity: onus ? num(onus[1]) : null,
        onuRegistered: onus ? num(onus[2]) : null,
        inBps: inR ? num(inR[1]) : null,
        inPps: inR ? num(inR[2]) : null,
        outBps: outR ? num(outR[1]) : null,
        outPps: outR ? num(outR[2]) : null,
        utilIn: inU ? parseFloat(inU[1]) : null,
        utilOut: outU ? parseFloat(outU[1]) : null
    };
}

function recordSample(host, port, s) {
    if (!host || !port) return;
    const key = `${host}|${port}`;
    const arr = history.get(key) || [];
    arr.push({ at: Date.now(), inBps: s.inBps, outBps: s.outBps, utilIn: s.utilIn, utilOut: s.utilOut });
    if (arr.length > HISTORY_MAX) arr.splice(0, arr.length - HISTORY_MAX);
    history.set(key, arr);
}

/**
 * Snapshot bandwidth semua PON + uplink dalam SATU sesi SSH read-only. Port diturunkan dari
 * `show card` (kartu GPON → gpon-olt_*, kartu kontrol non-GPON → gei_*).
 * @param {object} device {host, sshPort, sshUsername, sshPassword}
 * @param {object} [opts] {force, ttlMs}
 */
async function getBandwidthSnapshot(device, opts = {}) {
    const host = device && device.host;
    const ttl = opts.ttlMs || CACHE_TTL_MS;
    const cached = host && cache.get(host);
    if (!opts.force && cached && Date.now() - cached.at < ttl) return { ...cached.snapshot, cached: true };

    return withHostLock(host, async () => {
        const again = host && cache.get(host);
        if (!opts.force && again && Date.now() - again.at < ttl) return { ...again.snapshot, cached: true };

        let session = null;
        try {
            session = await openOltShell(device, { connectRetries: 1 });
        } catch (e) {
            return { ok: false, fetchedAt: new Date().toISOString(), error: e.message, pons: [], uplinks: [] };
        }
        const safeExec = async (cmd) => {
            try {
                return await session.exec(cmd, { timeoutMs: 15000 });
            } catch (_e) {
                return '';
            }
        };
        try {
            const cards = parseCard(await safeExec('show card'));
            const pons = [];
            const uplinks = [];
            for (const c of cards) {
                if (!c.ok) continue;
                const type = c.realType || c.cfgType || '';
                const ports = Math.min(c.port || 0, MAX_PORT_PROBE);
                if (/^GT/i.test(type)) {
                    for (let i = 1; i <= ports; i++) {
                        const name = `gpon-olt_${c.rack || 1}/${c.slot}/${i}`;
                        const parsed = parseGponOltInterface(await safeExec(`show interface ${name}`), name);
                        if (parsed) {
                            recordSample(host, name, parsed);
                            pons.push(parsed);
                        }
                    }
                } else {
                    for (let i = 1; i <= Math.min(ports, 8); i++) {
                        const name = `gei_${c.rack || 1}/${c.slot}/${i}`;
                        const parsed = parsePhysInterface(await safeExec(`show interface ${name}`), name);
                        if (parsed) {
                            recordSample(host, name, parsed);
                            uplinks.push({ ...parsed, kind: 'uplink' });
                        }
                    }
                }
            }
            const snapshot = { ok: true, fetchedAt: new Date().toISOString(), pons, uplinks };
            if (host) cache.set(host, { at: Date.now(), snapshot });
            return snapshot;
        } finally {
            try {
                session.close();
            } catch (_e) {
                /* abaikan */
            }
        }
    });
}

/** Ambil histori ring per-port untuk sebuah host: { port: [{at,inBps,outBps,utilIn,utilOut}] }. */
function getBandwidthHistory(device) {
    const host = device && device.host;
    const out = {};
    if (!host) return out;
    const prefix = `${host}|`;
    for (const [key, arr] of history.entries()) {
        if (key.startsWith(prefix)) out[key.slice(prefix.length)] = arr;
    }
    return out;
}

function resetBandwidthState() {
    cache.clear();
    history.clear();
}

module.exports = {
    getBandwidthSnapshot,
    getBandwidthHistory,
    parseGponOltInterface,
    resetBandwidthState,
    HISTORY_MAX
};
