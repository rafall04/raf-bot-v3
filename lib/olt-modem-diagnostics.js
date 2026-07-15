/**
 * Header Doc
 * Purpose: Analitik & VERDICT kesehatan modem OLT — turunkan metrik (uptime/MTBF/MTTR, hitung per
 *          jenis) + diagnosa pola (reboot terjadwal, mati listrik, LOS berulang, flapping, terdampak
 *          area) dari `olt_incidents`, dengan DUA rendering (internal teknis vs pelanggan konservatif).
 *          Fungsi murni (mudah diuji) + orchestrator yang membaca repo. Ambang calibratable.
 *          Lihat docs/olt-modem-state-blueprint.md §8.
 * Caller: Route/halaman diagnosa OLT (admin) & WA self-service pelanggan (Fase 4).
 * Deps: `repositories/olt-incident.repository` (via orchestrator), `global.config.oltModemState.verdict`.
 * MainFuncs: `computeModemMetrics`, `detectRebootSchedule`, `computeVerdict`, `buildModemDiagnosis`.
 * SideEffects: Tidak ada di fungsi murni; orchestrator hanya MEMBACA repo.
 */
"use strict";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function vcfg(config) {
    return ((config && config.oltModemState && config.oltModemState.verdict) || {});
}

function getThresholds(config) {
    const c = vcfg(config);
    return {
        windowDays: Number.isFinite(c.windowDays) ? c.windowDays : 30,
        rebootK: Number.isFinite(c.rebootK) ? c.rebootK : 4,      // ≥ ini reboot → pola reboot
        losK: Number.isFinite(c.losK) ? c.losK : 3,              // ≥ ini LOS (non-area) → fiber berulang
        dgK: Number.isFinite(c.dgK) ? c.dgK : 4,                 // ≥ ini DG → sering mati listrik
        flapCount: Number.isFinite(c.flapCount) ? c.flapCount : 4,
        flapWindowMs: Number.isFinite(c.flapWindowMs) ? c.flapWindowMs : 6 * HOUR_MS,
        areaShare: Number.isFinite(c.areaShare) ? c.areaShare : 0.5, // porsi insiden area → "terdampak area"
    };
}

/** Metrik per-modem dalam jendela (default 30 hari). Insiden AREA dikecualikan dari hitung per-modem. */
function computeModemMetrics(incidents, { windowMs = 30 * DAY_MS, now = Date.now() } = {}) {
    const list = Array.isArray(incidents) ? incidents : [];
    const since = now - windowMs;
    const inWindow = list.filter((i) => Number(i.started_at_ms || 0) >= since);
    const area = inWindow.filter((i) => i.is_area_event);
    const nonArea = inWindow.filter((i) => !i.is_area_event);
    const byType = (t) => nonArea.filter((i) => i.incident_type === t).length;
    const resolved = nonArea.filter((i) => i.duration_ms != null && i.duration_ms >= 0);
    const downtime = resolved.reduce((s, i) => s + Number(i.duration_ms || 0), 0);
    const longest = resolved.reduce((m, i) => Math.max(m, Number(i.duration_ms || 0)), 0);
    const mttr = resolved.length ? Math.round(downtime / resolved.length) : null;
    const mtbf = nonArea.length ? Math.round(windowMs / nonArea.length) : null;
    const uptimePct = windowMs > 0 ? Math.max(0, Math.min(100, 100 * (1 - downtime / windowMs))) : null;
    return {
        window_ms: windowMs,
        total: inWindow.length,
        non_area: nonArea.length,
        area: area.length,
        los: byType("los"),
        dying_gasp: byType("dying_gasp"),
        reboot: byType("reboot"),
        downtime_ms: downtime,
        mttr_ms: mttr,
        mtbf_ms: mtbf,
        longest_ms: longest,
        uptime_pct: uptimePct == null ? null : Math.round(uptimePct * 10) / 10,
    };
}

/** Deteksi reboot terjadwal: apakah reboot terpusat di 1 jam tertentu (mis. tiap 15:00)? */
function detectRebootSchedule(incidents, { rebootK = 4, now = Date.now(), windowMs = 30 * DAY_MS } = {}) {
    const since = now - windowMs;
    const reboots = (Array.isArray(incidents) ? incidents : [])
        .filter((i) => i.incident_type === "reboot" && !i.is_area_event && Number(i.started_at_ms || 0) >= since);
    if (reboots.length < rebootK) return { scheduled: false, count: reboots.length };
    const byHour = {};
    for (const r of reboots) {
        const h = new Date(Number(r.started_at_ms)).getHours(); // TZ proses = Asia/Jakarta
        byHour[h] = (byHour[h] || 0) + 1;
    }
    let topHour = null;
    let topCount = 0;
    for (const [h, n] of Object.entries(byHour)) {
        if (n > topCount) { topCount = n; topHour = Number(h); }
    }
    // Terjadwal bila mayoritas reboot menumpuk di 1 jam & mencapai ambang.
    const scheduled = topCount >= rebootK && topCount >= Math.ceil(reboots.length * 0.6);
    return { scheduled, hour: topHour, count: reboots.length, peak: topCount };
}

function detectFlapping(incidents, { flapCount = 4, flapWindowMs = 6 * HOUR_MS, now = Date.now() } = {}) {
    const since = now - flapWindowMs;
    const recent = (Array.isArray(incidents) ? incidents : [])
        .filter((i) => !i.is_area_event && Number(i.started_at_ms || 0) >= since);
    return { flapping: recent.length >= flapCount, count: recent.length };
}

function fmtDurasi(ms) {
    if (ms == null) return "-";
    const m = Math.round(ms / 60000);
    if (m < 60) return `${m} menit`;
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem ? `${h} jam ${rem} menit` : `${h} jam`;
}

/**
 * Verdict kesehatan modem. Return {code, health, confidence, headline_internal, headline_customer,
 * dugaan, evidence}. `health`: ok | watch | chronic. Insiden area dikecualikan dari vonis per-modem.
 */
function computeVerdict({ metrics, incidents = [], current_state = "online", config = null, now = Date.now() } = {}) {
    const th = getThresholds(config);
    const windowMs = th.windowDays * DAY_MS;
    const m = metrics || computeModemMetrics(incidents, { windowMs, now });
    const reboot = detectRebootSchedule(incidents, { rebootK: th.rebootK, now, windowMs });
    const flap = detectFlapping(incidents, { flapCount: th.flapCount, flapWindowMs: th.flapWindowMs, now });
    const areaShare = m.total > 0 ? m.area / m.total : 0;

    const currentlyDown = current_state === "los" || current_state === "dying_gasp";

    let code = "healthy";
    let health = "ok";
    let confidence = 0.5;
    let internal = "Sehat";
    let customer = "Koneksi modem Anda terpantau normal.";
    let dugaan = null;

    if (reboot.scheduled) {
        code = "scheduled_reboot"; health = "chronic"; confidence = 0.75;
        internal = `Sering reboot terjadwal (~jam ${reboot.hour}:00, ${reboot.count}× / ${th.windowDays} hari).`;
        customer = "Perangkat Anda terpantau sering restart di jam yang sama — kemungkinan terkait listrik/adaptor.";
        dugaan = "Listrik / adaptor / timer";
    } else if (flap.flapping) {
        // Flapping = gangguan terkonsentrasi di window pendek → sinyal instabilitas paling mendesak,
        // dicek SEBELUM pola hitung-jangka-panjang (los/dg). Hanya non-area (area sudah dikecualikan).
        code = "unstable_flapping"; health = "chronic"; confidence = 0.7;
        internal = `Flapping (${flap.count} gangguan dalam ${Math.round(th.flapWindowMs / HOUR_MS)} jam terakhir).`;
        customer = "Koneksi Anda terpantau tidak stabil — teknisi akan memeriksa.";
        dugaan = "Splitter / kabel / redaman";
    } else if (m.dying_gasp >= th.dgK) {
        code = "frequent_power"; health = "chronic"; confidence = 0.8;
        internal = `Sering dying-gasp (${m.dying_gasp}× / ${th.windowDays} hari) — indikasi listrik.`;
        customer = "Layanan Anda beberapa kali terputus karena listrik padam.";
        dugaan = "Listrik area / rumah";
    } else if (m.los >= th.losK) {
        code = "recurring_los"; health = "chronic"; confidence = 0.7;
        internal = `LOS berulang (${m.los}× / ${th.windowDays} hari, non-area).`;
        customer = "Terpantau beberapa kali kehilangan sinyal — teknisi akan memeriksa jaringan Anda.";
        dugaan = "Konektor / splicing / fiber kendor";
    } else if (m.total > 0 && areaShare >= th.areaShare) {
        code = "area_affected"; health = "watch"; confidence = 0.65;
        internal = `Mayoritas gangguan = gangguan AREA (${m.area}/${m.total}) — bukan modem ini.`;
        customer = "Gangguan yang Anda alami sebagian besar karena gangguan area, bukan perangkat Anda.";
        dugaan = "Backbone / POP / listrik area";
    } else if (m.non_area <= 1) {
        code = "healthy"; health = "ok"; confidence = 0.6;
        internal = m.non_area === 0 ? "Sehat (tanpa gangguan tercatat)." : "Sehat (1 gangguan tercatat).";
        customer = "Koneksi modem Anda terpantau normal.";
    } else {
        code = "minor_issues"; health = "watch"; confidence = 0.55;
        internal = `Beberapa gangguan (${m.non_area}× / ${th.windowDays} hari, belum berpola).`;
        customer = "Terpantau beberapa gangguan ringan pada koneksi Anda.";
        dugaan = null;
    }

    // Overlay status SEKARANG (lebih mendesak dari pola historis).
    if (currentlyDown) {
        const label = current_state === "dying_gasp" ? "mati listrik (dying-gasp)" : "kehilangan sinyal (LOS)";
        internal = `SEDANG DOWN: ${label}. ${internal}`;
        customer = `Saat ini perangkat Anda terpantau ${current_state === "dying_gasp" ? "mati (kemungkinan listrik padam)" : "kehilangan sinyal"}. ${customer}`;
    }

    const evidence = (Array.isArray(incidents) ? incidents : [])
        .filter((i) => !i.is_area_event)
        .slice(0, 5)
        .map((i) => ({ type: i.incident_type, started_at_ms: i.started_at_ms, duration: fmtDurasi(i.duration_ms), confidence: i.confidence }));

    return { code, health, confidence, headline_internal: internal, headline_customer: customer, dugaan, currently_down: currentlyDown, evidence };
}

/**
 * Orchestrator: baca insiden+state modem dari repo → metrik + verdict. READ-ONLY.
 * Kunci pakai `mac` ATAU `pppoe_username`.
 */
async function buildModemDiagnosis({ repo, mac = null, pppoe_username = null, config = null, now = () => Date.now() } = {}) {
    const th = getThresholds(config);
    const windowMs = th.windowDays * DAY_MS;
    const nowMs = now();

    let state = null;
    let incidents = [];
    if (mac) {
        state = await repo.getModemState(mac);
        incidents = await repo.listIncidents({ mac, from: nowMs - windowMs, limit: 1000 });
    } else if (pppoe_username) {
        state = await repo.getModemStateByPppoe(pppoe_username);
        incidents = await repo.listIncidents({ pppoe_username, from: nowMs - windowMs, limit: 1000 });
    } else {
        return { found: false };
    }

    const currentState = state ? state.current_state : "unknown";
    const metrics = computeModemMetrics(incidents, { windowMs, now: nowMs });
    const verdict = computeVerdict({ metrics, incidents, current_state: currentState, config, now: nowMs });

    return {
        found: !!(state || incidents.length),
        mac: state ? state.mac : (mac ? repo.normMac(mac) : null),
        pppoe_username: state ? state.pppoe_username : pppoe_username,
        customer_name: state ? state.customer_name : null,
        current_state: currentState,
        state_since_ms: state ? state.state_since_ms : null,
        stale: state ? !!state.stale : false,
        metrics,
        verdict,
    };
}

module.exports = {
    computeModemMetrics,
    detectRebootSchedule,
    detectFlapping,
    computeVerdict,
    buildModemDiagnosis,
    getThresholds,
    fmtDurasi,
};
