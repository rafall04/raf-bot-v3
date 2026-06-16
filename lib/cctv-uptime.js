/**
 * Header Doc
 * Purpose: Hitung ketersediaan (uptime %) per host CCTV dari riwayat insiden. Downtime = irisan
 *          [detectedAt, recoveredAt|now] dengan jendela periode. PERKIRAAN — akurat sebatas data
 *          insiden yang tersimpan & asumsi monitor menyala terus.
 * Caller: routes/cctv.js (GET /api/cctv/uptime), lib/cctv-monitor.js (variabel {uptime_*} di pesan).
 * Deps: none (murni).
 * MainFuncs: downtimeMs, uptimePct, summarize.
 * SideEffects: none.
 */
'use strict';

const DAY_MS = 86400000;

function norm(h) { return String(h == null ? '' : h).trim().toLowerCase(); }

/** Total downtime (ms) host dalam [now-periodMs, now], dari insiden. Di-clamp ke periode. */
function downtimeMs(incidents, host, nowMs, periodMs) {
    const h = norm(host);
    const windowStart = nowMs - periodMs;
    let down = 0;
    for (const inc of (Array.isArray(incidents) ? incidents : [])) {
        if (norm(inc.host) !== h) continue;
        const start = Date.parse(inc.detectedAt);
        if (!Number.isFinite(start)) continue;
        let end = inc.recoveredAt ? Date.parse(inc.recoveredAt) : nowMs;
        if (!Number.isFinite(end)) end = nowMs;
        const s = Math.max(start, windowStart);
        const e = Math.min(end, nowMs);
        if (e > s) down += (e - s);
    }
    return Math.min(down, periodMs);
}

/** Uptime % (0–100) host dalam periode. */
function uptimePct(incidents, host, nowMs, periodMs) {
    if (!(periodMs > 0)) return 100;
    const pct = (1 - downtimeMs(incidents, host, nowMs, periodMs) / periodMs) * 100;
    return Math.max(0, Math.min(100, pct));
}

/** Ringkasan per host: { hostLower: {uptime24h, uptime7d, uptime30d} }. */
function summarize(incidents, hosts, nowMs) {
    const out = {};
    for (const host of (Array.isArray(hosts) ? hosts : [])) {
        const h = norm(host);
        out[h] = {
            uptime24h: +uptimePct(incidents, h, nowMs, DAY_MS).toFixed(2),
            uptime7d: +uptimePct(incidents, h, nowMs, 7 * DAY_MS).toFixed(2),
            uptime30d: +uptimePct(incidents, h, nowMs, 30 * DAY_MS).toFixed(2),
        };
    }
    return out;
}

module.exports = { downtimeMs, uptimePct, summarize, DAY_MS };
