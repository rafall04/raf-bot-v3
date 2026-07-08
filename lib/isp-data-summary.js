/**
 * Header Doc
 * Purpose: Rangkuman data ISP on-demand untuk perintah WA owner/admin ("data gmdp", "data isp",
 *          "rapor isp") — laporan diagnostik penuh READ-ONLY: vonis keseluruhan, status kini
 *          (arah + gateway + segmen + matriks layanan), route aktif & deteksi failover dari
 *          snapshot router, trafik/utilisasi + puncak throughput + error/drop/flap link,
 *          POLA LOSS PER JAM (sparkline 24 jam), agregat per-arah 24 jam (rata/puncak/jitter),
 *          DOWNTIME nyata dari pasangan insiden gangguan→pulih (termasuk yang sedang berjalan),
 *          layanan bermasalah 24 jam, status engine auto-failover, komplain pelanggan, rapor
 *          24 jam & 7 hari, dan insiden terakhir.
 * Caller: `message/handlers/raf-intent-dispatch/owner-admin-intents.js` (intent `DATA_ISP`).
 * Deps: lazy `lib/upstream-quality-poller` (getMonitorConfig/buildStatusReport),
 *       `repositories/upstream-quality.repository` (getIspReport/getIncidents/getRecentProbes/
 *       getWanHistory/getServiceSummary — semua di-guard `typeof`),
 *       `lib/upstream-quality-alerter` (getAlertStates + formatter arah/kesimpulan/layanan),
 *       lazy `lib/wan-failover-service.getRuleStates`, `lib/complaint-signal-service`.
 * MainFuncs: `buildIspDataSummary`, `buildIspOverview`, `resolvePathArg`.
 * SideEffects: Tidak ada (query SQLite + baca state in-memory saja).
 */
"use strict";

const STATUS_EMOJI = { NORMAL: "🟢", DEGRADASI: "🟠", GANGGUAN: "🔴", PUTUS: "⛔", UNKNOWN: "⚪" };

// Skala sparkline loss per jam (persen, ambang absolut supaya antar-hari sebanding).
const SPARK_BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
const SPARK_THRESHOLDS = [1, 3, 5, 10, 20, 30, 50]; // < ambang[i] → blok[i]; ≥50 → blok[7]
const SPARK_LEGEND = "skala: ▁<1 ▂<3 ▃<5 ▄<10 ▅<20 ▆<30 ▇<50 █≥50 %loss • ·=tanpa data";

function defaultDeps() {
    const poller = require("./upstream-quality-poller");
    const alerter = require("./upstream-quality-alerter");
    return {
        getMonitorConfig: () => poller.getMonitorConfig(),
        buildStatusReport: () => poller.buildStatusReport(),
        getRepo: () => require("../repositories/upstream-quality.repository").getUpstreamQualityRepository(),
        getAlertStates: () => alerter.getAlertStates(),
        buildDirectionText: (cfg, pathKey, entry) => alerter._internal.buildDirectionText(cfg, pathKey, entry),
        buildConclusionText: (cfg, pathKey, entry) => alerter._internal.buildConclusionText(cfg, pathKey, entry),
        buildServiceSection: (pathKey) => alerter._internal.buildServiceSectionText(pathKey, {}),
        getFailoverStates: () => {
            try { return require("./wan-failover-service").getRuleStates(); } catch (_e) { return {}; }
        },
        getComplaintSignals: () => {
            try {
                const m = require("./complaint-signal-service");
                return m.getComplaintConfig().enabled ? m.getComplaintStats().signals : null;
            } catch (_e) { return null; }
        },
        nowMs: () => Date.now()
    };
}

function fmt(n, digits = 0) {
    return n == null ? "-" : Number(n).toFixed(digits);
}

function fmtTime(ms) {
    return new Date(ms).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" });
}

function fmtDur(ms) {
    if (ms == null) return "-";
    const menit = Math.max(1, Math.round(ms / 60000));
    if (menit < 60) return `${menit} mnt`;
    return `${Math.floor(menit / 60)} jam ${menit % 60} mnt`;
}

function parseDetail(raw) {
    if (raw == null) return null;
    if (typeof raw === "object") return raw;
    try { return JSON.parse(raw); } catch (_e) { return null; }
}

/**
 * Ambil path key dari teks perintah ("data gmdp 7h" → "gmdp"). Cocokkan key persis ATAU
 * kata pada label jalur (config.upstreamMonitor.paths). Null bila tidak ada → overview.
 */
function resolvePathArg(text, monitorCfg = null) {
    try {
        const cfg = monitorCfg || require("./upstream-quality-poller").getMonitorConfig();
        const tokens = String(text || "").toLowerCase().split(/\s+/).filter(Boolean);
        for (const p of cfg.paths || []) {
            const key = String(p.key || "").toLowerCase();
            if (key && tokens.includes(key)) return p.key;
        }
        // Kata pada label ("indihome" → ih) — abaikan kata terlalu umum.
        for (const p of cfg.paths || []) {
            const labelWords = String(p.label || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
            if (labelWords.some((w) => tokens.includes(w) && !["via", "utama", "backup", "direct"].includes(w))) {
                return p.key;
            }
        }
        return null;
    } catch (_e) {
        return null;
    }
}

/** Vonis keseluruhan satu jalur dari status kini + rapor 24 jam. */
function overallVerdict({ status, isp24 }) {
    const sick = isp24 && isp24.sick_pct != null ? Number(isp24.sick_pct) : null;
    const avail = isp24 && isp24.availability_pct != null ? Number(isp24.availability_pct) : null;
    const nowBad = ["GANGGUAN", "PUTUS"].includes(status);
    if (nowBad) return { ok: false, text: `SEDANG BERMASALAH (status kini ${status})` };
    if (sick != null && sick >= 30) return { ok: false, text: `PERLU PERHATIAN — ${fmt(sick)}% waktu bermasalah dalam 24 jam` };
    if (avail != null && avail < 97) return { ok: false, text: `PERLU PERHATIAN — availability 24 jam hanya ${fmt(avail, 1)}%` };
    if (status === "DEGRADASI") return { ok: false, text: "AGAK TERGANGGU saat ini (degradasi ringan)" };
    if (sick == null && avail == null) return { ok: true, text: "OK (data 24 jam belum cukup)" };
    return { ok: true, text: `OK — sehat ${sick != null ? fmt(100 - sick) : "-"}% waktu, availability ${fmt(avail, 1)}% (24 jam)` };
}

/** Baris rapor ringkas satu jalur utk jendela tertentu. */
function raporLine(label, row) {
    if (!row) return `\n• ${label}: belum ada data`;
    return `\n• ${label}: avail *${fmt(row.availability_pct, 1)}%* • loss rata ${fmt(row.loss_avg, 1)}% • RTT ${fmt(row.rtt_avg)}ms • bermasalah ${fmt(row.sick_pct)}% waktu • flap ${row.flaps || 0}×`;
}

/** Karakter sparkline utk satu nilai loss (null → '·' tanpa data). */
function sparkChar(lossAvg) {
    if (lossAvg == null) return "·";
    for (let i = 0; i < SPARK_THRESHOLDS.length; i += 1) {
        if (lossAvg < SPARK_THRESHOLDS[i]) return SPARK_BLOCKS[i];
    }
    return SPARK_BLOCKS[SPARK_BLOCKS.length - 1];
}

/**
 * Bucket per-jam dari baris probe target JAUH (kiri=terlama, kanan=terkini).
 * @returns {{buckets:Array<{startMs:number, lossAvg:number|null}>, worst:{startMs,lossAvg}|null}}
 */
function buildHourlyBuckets(rows, nowMs, hours = 24) {
    const bucketMs = 60 * 60 * 1000;
    const startMs = nowMs - hours * bucketMs;
    const acc = Array.from({ length: hours }, (_v, i) => ({ startMs: startMs + i * bucketMs, losses: [] }));
    for (const r of rows || []) {
        if (String(r.target_key || "") === "gateway") continue;
        const t = Date.parse(r.probed_at);
        if (!Number.isFinite(t) || t < startMs || t >= nowMs + bucketMs) continue;
        const idx = Math.min(hours - 1, Math.max(0, Math.floor((t - startMs) / bucketMs)));
        if (r.loss_pct != null) acc[idx].losses.push(Number(r.loss_pct));
    }
    let worst = null;
    const buckets = acc.map((b) => {
        const lossAvg = b.losses.length ? b.losses.reduce((a, c) => a + c, 0) / b.losses.length : null;
        if (lossAvg != null && (!worst || lossAvg > worst.lossAvg)) worst = { startMs: b.startMs, lossAvg };
        return { startMs: b.startMs, lossAvg };
    });
    return { buckets, worst };
}

function sparkline(buckets) {
    return (buckets || []).map((b) => sparkChar(b.lossAvg)).join("");
}

/** Agregat per-arah (far per target + gateway) dari baris probe mentah: rata/puncak/jitter. */
function aggregateDirections(rows, pathKey) {
    const far = new Map();
    let gw = null;
    for (const r of rows || []) {
        if (r.path !== pathKey || !r.target) continue;
        const isGw = String(r.target_key || "") === "gateway";
        const bucket = isGw
            ? (gw = gw || { losses: [], rtts: [], jitters: [], target: r.target, target_key: "gateway" })
            : (far.get(r.target) || far.set(r.target, { losses: [], rtts: [], jitters: [], target: r.target, target_key: r.target_key }).get(r.target));
        if (r.loss_pct != null) bucket.losses.push(Number(r.loss_pct));
        if (r.rtt_avg_ms != null) bucket.rtts.push(Number(r.rtt_avg_ms));
        if (r.jitter_ms != null) bucket.jitters.push(Number(r.jitter_ms));
    }
    const agg = (b) => {
        const stat = (arr) => (arr.length ? { avg: arr.reduce((a, c) => a + c, 0) / arr.length, max: Math.max(...arr) } : null);
        return { target: b.target, target_key: b.target_key, loss: stat(b.losses), rtt: stat(b.rtts), jitter: stat(b.jitters) };
    };
    return { far: [...far.values()].map(agg), gw: gw ? agg(gw) : null };
}

/**
 * Downtime dari pasangan insiden alert→alert_recovered dalam jendela (clip ke sinceMs);
 * gangguan yang belum pulih (state SICK) dihitung "berjalan" sampai nowMs.
 */
function computeDowntime({ incidents, pathKey, sinceMs, nowMs, sickNow = false }) {
    const mine = (incidents || [])
        .filter((i) => i.path === pathKey && ["alert", "alert_recovered"].includes(i.kind))
        .map((i) => ({ kind: i.kind, atMs: Date.parse(i.created_at) }))
        .filter((i) => Number.isFinite(i.atMs))
        .sort((a, b) => a.atMs - b.atMs);
    let openStart = null;
    let count = 0;
    let totalMs = 0;
    let maxMs = 0;
    for (const inc of mine) {
        if (inc.kind === "alert") {
            if (openStart == null) openStart = inc.atMs;
        } else if (openStart != null) {
            const effStart = Math.max(openStart, sinceMs);
            if (inc.atMs > effStart) {
                const dur = inc.atMs - effStart;
                count += 1;
                totalMs += dur;
                if (dur > maxMs) maxMs = dur;
            }
            openStart = null;
        }
    }
    let ongoingMs = null;
    if (openStart != null && sickNow) {
        ongoingMs = nowMs - Math.max(openStart, sinceMs);
        if (ongoingMs > 0) {
            count += 1;
            totalMs += ongoingMs;
            if (ongoingMs > maxMs) maxMs = ongoingMs;
        }
    }
    return { count, totalMs, maxMs, ongoingMs };
}

/** Baris "Gangguan tercatat" utk satu jendela; "" bila nol. */
function downtimeLine(label, dt) {
    if (!dt || !dt.count) return `\n• Gangguan tercatat ${label}: tidak ada 🎉`;
    let out = `\n• Gangguan tercatat ${label}: *${dt.count}×* • total ±${fmtDur(dt.totalMs)} • terlama ±${fmtDur(dt.maxMs)}`;
    if (dt.ongoingMs != null) out += ` • ⚠️ SEDANG BERJALAN ±${fmtDur(dt.ongoingMs)}`;
    return out;
}

/** Baris route aktif + deteksi failover utk mark jalur (dari snapshot route report). */
function buildRouteLine(report, pathCfg) {
    try {
        if (!report || !Array.isArray(report.route_snapshot)) return "";
        const mark = (pathCfg && pathCfg.routingTable) || "main";
        const rows = report.route_snapshot.filter((r) => (r.mark || "main") === mark);
        if (!rows.length) return "";
        const active = rows.find((r) => r.active && !r.disabled);
        const disabledCount = rows.filter((r) => r.disabled).length;
        const fo = report.failover && report.failover[mark];
        let out = `\n• Route aktif (${mark}): ${active ? `*${active.gateway}*` : "*(tidak ada route aktif!)*"}`;
        if (fo && fo.failover) out += ` — ⚠️ BACKUP AKTIF (primary ${fo.primary_gateway} tidak jalan)`;
        if (disabledCount) out += ` • ${disabledCount} route dinonaktifkan (indikasi steer/switch)`;
        return out;
    } catch (_e) {
        return "";
    }
}

/** Baris trafik kini + puncak 24 jam + kesehatan link dari wan samples. */
function buildLinkLines({ entry, wanRows24 }) {
    let out = "";
    try {
        if (entry && entry.wan && (entry.wan.rx_mbps != null || entry.wan.tx_mbps != null)) {
            out += `\n• Trafik (15 mnt): ↓${fmt(entry.wan.rx_mbps, 1)} Mbps / ↑${fmt(entry.wan.tx_mbps, 1)} Mbps`;
            if (entry.wan.util_down_max_pct != null || entry.wan.util_up_max_pct != null) {
                out += ` • util ↓${fmt(entry.wan.util_down_max_pct)}%/↑${fmt(entry.wan.util_up_max_pct)}%`;
            }
        }
        if (Array.isArray(wanRows24) && wanRows24.length) {
            // Baris terkini (query DESC) → uptime tunnel; puncak & kesehatan dari seluruh 24 jam.
            const latest = wanRows24[0];
            let peakRx = null;
            let peakTx = null;
            let errors = 0;
            let drops = 0;
            let flaps = 0;
            for (const w of wanRows24) {
                if (w.rx_bps != null) peakRx = Math.max(peakRx || 0, Number(w.rx_bps));
                if (w.tx_bps != null) peakTx = Math.max(peakTx || 0, Number(w.tx_bps));
                errors += (Number(w.rx_error_d) || 0) + (Number(w.tx_error_d) || 0);
                drops += (Number(w.rx_drop_d) || 0) + (Number(w.tx_drop_d) || 0);
                flaps += w.flap ? 1 : 0;
            }
            out += `\n• Link 24 jam: puncak ↓${peakRx != null ? fmt(peakRx / 1e6, 1) : "-"} Mbps / ↑${peakTx != null ? fmt(peakTx / 1e6, 1) : "-"} Mbps • error ${errors} • drop ${drops} • flap ${flaps}×`;
            if (latest && latest.tunnel_uptime_s != null) {
                out += `\n• Tunnel uptime: ${fmtDur(Number(latest.tunnel_uptime_s) * 1000)}`;
            }
        }
    } catch (_e) { /* link best-effort */ }
    return out;
}

/** Baris layanan bermasalah 24 jam (ok<99% atau TLS lambat); "" bila prober mati/kosong. */
function buildService24Line(svcRows, pathKey) {
    try {
        if (!Array.isArray(svcRows)) return "";
        const mine = svcRows.filter((s) => s.path === pathKey && Number(s.samples) > 0);
        if (!mine.length) return "";
        const labelOf = (key) => {
            try {
                const svcs = require("./service-reachability-prober").getServiceConfig().services;
                const s = svcs.find((x) => x.key === key);
                return (s && s.label) || key;
            } catch (_e) { return key; }
        };
        const problems = [];
        for (const s of mine) {
            const okPct = (Number(s.ok_count) / Number(s.samples)) * 100;
            const tls = s.tls_avg != null ? Number(s.tls_avg) : null;
            if (okPct < 99) problems.push(`${labelOf(s.service)} ok ${fmt(okPct, 1)}%`);
            else if (tls != null && tls >= 500) problems.push(`${labelOf(s.service)} TLS rata ${fmt(tls)}ms`);
        }
        if (!problems.length) return `\n• Layanan 24 jam: semua normal ✅`;
        return `\n• Layanan 24 jam bermasalah: ${problems.slice(0, 4).join(" • ")}${problems.length > 4 ? ` (+${problems.length - 4} lagi)` : ""}`;
    } catch (_e) {
        return "";
    }
}

/** Baris status engine auto-failover utk jalur (fase APPLIED / terkunci). */
function buildFailoverLine(pathKey, deps, nowMs) {
    try {
        const rules = (global.config && global.config.wanFailover && global.config.wanFailover.rules) || [];
        const rule = rules.find((r) => r && r.sickPath === pathKey && r.switchId);
        if (!rule) return "";
        const st = (deps.getFailoverStates() || {})[rule.switchId];
        if (!st) return "";
        if (st.lockedUntilMs && st.lockedUntilMs > nowMs) {
            return `\n🤖 Auto-failover: *TERKUNCI* (anti-flapping) s/d ${fmtTime(st.lockedUntilMs)}`;
        }
        if (st.phase === "APPLIED") {
            return `\n🤖 Auto-failover: switch *${rule.switchId}* sedang DITERAPKAN${st.appliedByAuto ? " (oleh bot)" : " (manual/panel)"}`;
        }
        return "";
    } catch (_e) {
        return "";
    }
}

/** Baris komplain pelanggan jalur ini dalam 60 menit terakhir (agregator in-memory). */
function buildComplaintLine(pathKey, deps, nowMs) {
    try {
        const signals = deps.getComplaintSignals();
        if (!Array.isArray(signals)) return "";
        const windowMs = 60 * 60 * 1000;
        const distinct = new Set(
            signals.filter((s) => s.path === pathKey && nowMs - s.atMs <= windowMs).map((s) => s.userId)
        );
        if (!distinct.size) return "";
        return `\n📢 Komplain pelanggan jalur ini (60 mnt): *${distinct.size} pelanggan*`;
    } catch (_e) {
        return "";
    }
}

/**
 * Rangkuman LENGKAP satu jalur — jawaban "data gmdp". Tidak pernah throw.
 */
async function buildIspDataSummary(pathKey, depsOverride = {}) {
    const deps = { ...defaultDeps(), ...depsOverride };
    try {
        const cfg = deps.getMonitorConfig();
        if (!cfg.enabled) {
            return "Monitor jalur upstream belum aktif di bot ini (config.upstreamMonitor.enabled).";
        }
        const pathCfg = (cfg.paths || []).find((p) => p.key === pathKey);
        if (!pathCfg) {
            const daftar = (cfg.paths || []).map((p) => p.key).join(", ");
            return `Jalur *${pathKey}* tidak dikenal. Pilihan: ${daftar}.`;
        }
        const nowMs = deps.nowMs();
        const label = pathCfg.label || pathKey;
        const repo = deps.getRepo();
        const since24Iso = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
        const since7dIso = new Date(nowMs - 7 * 24 * 60 * 60 * 1000).toISOString();

        const report = await deps.buildStatusReport();
        const entry = (report.paths || []).find((p) => p.key === pathKey) || null;
        const status = (entry && entry.status) || "UNKNOWN";

        // ===== Data pendukung (semua best-effort per sumber) =====
        let isp24 = null;
        let isp7 = null;
        try {
            const lossWarnPct = (cfg.thresholds || {}).lossWarnPct || 5;
            const rows24 = await repo.getIspReport({ sinceIso: since24Iso, lossWarnPct });
            isp24 = (rows24 || []).find((r) => r.path === pathKey) || null;
            const rows7 = await repo.getIspReport({ sinceIso: since7dIso, lossWarnPct });
            isp7 = (rows7 || []).find((r) => r.path === pathKey) || null;
        } catch (_e) { /* rapor best-effort */ }

        let probeRows24 = [];
        try {
            if (typeof repo.getRecentProbes === "function") {
                probeRows24 = await repo.getRecentProbes({ sinceIso: since24Iso, path: pathKey, limit: 10000 });
            }
        } catch (_e) { /* probe best-effort */ }

        let wanRows24 = [];
        try {
            if (typeof repo.getWanHistory === "function") {
                wanRows24 = await repo.getWanHistory({ sinceIso: since24Iso, path: pathKey, limit: 2000 });
            }
        } catch (_e) { /* wan best-effort */ }

        let svcRows24 = null;
        try {
            const smCfg = global.config && global.config.serviceMonitor;
            if (smCfg && smCfg.enabled === true && typeof repo.getServiceSummary === "function") {
                svcRows24 = await repo.getServiceSummary({ windowSinceIso: since24Iso });
            }
        } catch (_e) { /* layanan best-effort */ }

        let incidents = [];
        try {
            if (typeof repo.getIncidents === "function") incidents = await repo.getIncidents({ limit: 200 });
        } catch (_e) { /* insiden best-effort */ }

        let alertState = null;
        try { alertState = (deps.getAlertStates() || {})[pathKey] || null; } catch (_e) { /* best-effort */ }
        const sickNow = Boolean(alertState && alertState.condition === "SICK");

        const vonis = overallVerdict({ status, isp24 });
        const dt24 = computeDowntime({ incidents, pathKey, sinceMs: nowMs - 24 * 60 * 60 * 1000, nowMs, sickNow });
        const dt7 = computeDowntime({ incidents, pathKey, sinceMs: nowMs - 7 * 24 * 60 * 60 * 1000, nowMs, sickNow });

        // ===== Susun pesan =====
        let out = `${STATUS_EMOJI[status] || "⚪"} *DATA JALUR ${String(label).toUpperCase()}*` +
            (pathCfg.tunnelType ? ` _(tunnel ${String(pathCfg.tunnelType).toUpperCase()})_` : "") +
            `\n\n📋 *Keseluruhan: ${vonis.ok ? "✅" : "🔴"} ${vonis.text}*`;

        // --- KONDISI SEKARANG ---
        out += `\n\n━━ *KONDISI SEKARANG* ━━` +
            `\n• Status: *${status}*${entry && entry.segment_label && entry.segment !== "SEHAT" && entry.segment !== "UNKNOWN" ? ` — ${entry.segment_label}` : ""}`;
        if (sickNow) {
            out += `\n⚠️ Alert berjalan: *GANGGUAN* sejak ${alertState.sickSince ? fmtTime(alertState.sickSince) : "-"} (level ${alertState.lastLevel || "-"})`;
        }
        out += buildRouteLine(report, pathCfg);
        out += buildLinkLines({ entry, wanRows24 });
        try { out += deps.buildDirectionText(cfg, pathKey, entry); } catch (_e) { /* best-effort */ }
        try { out += await deps.buildServiceSection(pathKey); } catch (_e) { /* best-effort */ }
        try { out += deps.buildConclusionText(cfg, pathKey, entry); } catch (_e) { /* best-effort */ }
        out += buildFailoverLine(pathKey, deps, nowMs);
        out += buildComplaintLine(pathKey, deps, nowMs);

        // --- 24 JAM TERAKHIR ---
        out += `\n\n━━ *24 JAM TERAKHIR* ━━` + raporLine("Rapor", isp24);
        try {
            if (probeRows24.length) {
                const { buckets, worst } = buildHourlyBuckets(probeRows24, nowMs, 24);
                out += `\n• Pola loss per jam (kiri=24 jam lalu):\n  \`${sparkline(buckets)}\``;
                if (worst && worst.lossAvg >= 1) {
                    out += `\n  terburuk: ${new Date(worst.startMs).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })} (loss ${fmt(worst.lossAvg)}%)`;
                }
                out += `\n  _${SPARK_LEGEND}_`;
                const dir = aggregateDirections(probeRows24, pathKey);
                if (dir.far.length) {
                    out += `\n• Per arah 24 jam:`;
                    for (const d of dir.far) {
                        out += `\n  - → ${d.target_key || d.target} (${d.target}): loss rata ${fmt(d.loss && d.loss.avg, 1)}% (puncak ${fmt(d.loss && d.loss.max)}%)` +
                            `${d.rtt ? ` • RTT ${fmt(d.rtt.avg)}ms` : ""}${d.jitter ? ` • jitter ${fmt(d.jitter.avg)}ms` : ""}`;
                    }
                    if (dir.gw) {
                        out += `\n  - → gateway (${dir.gw.target}): loss rata ${fmt(dir.gw.loss && dir.gw.loss.avg, 1)}% (puncak ${fmt(dir.gw.loss && dir.gw.loss.max)}%)${dir.gw.rtt ? ` • RTT ${fmt(dir.gw.rtt.avg)}ms` : ""}`;
                    }
                }
            }
        } catch (_e) { /* pola best-effort */ }
        out += downtimeLine("24 jam", dt24);
        out += buildService24Line(svcRows24, pathKey);

        // --- 7 HARI ---
        out += `\n\n━━ *7 HARI* ━━` + raporLine("Rapor", isp7) + downtimeLine("7 hari", dt7);

        // --- Insiden terakhir ---
        try {
            const mine = (incidents || []).filter((i) => i.path === pathKey).slice(0, 5);
            if (mine.length) {
                const KIND_LABEL = {
                    alert: "🚨 alert gangguan",
                    alert_recovered: "✅ pulih",
                    trace: "🔎 traceroute",
                    flap: "⚡ flap link",
                    switch: "🔀 switch",
                    failover: "🤖 failover",
                    complaint_cluster: "📢 komplain menumpuk",
                    "service-down": "🌐 layanan down"
                };
                out += `\n\n🗒️ *Insiden terakhir:*`;
                for (const inc of mine) {
                    const d = parseDetail(inc.detail) || {};
                    const extra = d.level ? ` (${d.level})` : (d.action ? ` (${d.action})` : "");
                    out += `\n• ${fmtTime(Date.parse(inc.created_at))} — ${KIND_LABEL[inc.kind] || inc.kind}${extra}`;
                }
            }
        } catch (_e) { /* insiden best-effort */ }

        out += `\n\nGrafik & riwayat lengkap: */upstream-quality*. Semua jalur: ketik *data isp*.`;
        return out;
    } catch (err) {
        console.warn(`[ISP-Data] Rangkuman ${pathKey} gagal: ${err.message}`);
        return "Maaf, gagal menyusun rangkuman jalur. Coba lagi sebentar lagi.";
    }
}

/**
 * Ringkasan SEMUA jalur — jawaban "data isp" / "rapor isp". Tidak pernah throw.
 */
async function buildIspOverview(depsOverride = {}) {
    const deps = { ...defaultDeps(), ...depsOverride };
    try {
        const cfg = deps.getMonitorConfig();
        if (!cfg.enabled) {
            return "Monitor jalur upstream belum aktif di bot ini (config.upstreamMonitor.enabled).";
        }
        const nowMs = deps.nowMs();
        const report = await deps.buildStatusReport();
        const repo = deps.getRepo();
        let rows24 = [];
        try {
            rows24 = await repo.getIspReport({
                sinceIso: new Date(nowMs - 24 * 60 * 60 * 1000).toISOString(),
                lossWarnPct: (cfg.thresholds || {}).lossWarnPct || 5
            });
        } catch (_e) { /* rapor best-effort */ }
        const by24 = new Map((rows24 || []).map((r) => [r.path, r]));
        let incidents = [];
        try {
            if (typeof repo.getIncidents === "function") incidents = await repo.getIncidents({ limit: 200 });
        } catch (_e) { /* insiden best-effort */ }
        let alertStates = {};
        try { alertStates = deps.getAlertStates() || {}; } catch (_e) { /* best-effort */ }

        let semuaOk = true;
        let out = `📊 *DATA SEMUA JALUR ISP*`;
        for (const p of cfg.paths || []) {
            const entry = (report.paths || []).find((x) => x.key === p.key) || null;
            const status = (entry && entry.status) || "UNKNOWN";
            const isp24 = by24.get(p.key) || null;
            const vonis = overallVerdict({ status, isp24 });
            if (!vonis.ok) semuaOk = false;

            const targets = entry && Array.isArray(entry.targets) ? entry.targets.filter((t) => t.samples > 0) : [];
            const lossVals = targets.map((t) => t.loss_avg_pct).filter((v) => v != null);
            const rttVals = targets.map((t) => t.rtt_avg_ms).filter((v) => v != null);
            const lossNow = lossVals.length ? lossVals.reduce((a, b) => a + b, 0) / lossVals.length : null;
            const rttNow = rttVals.length ? rttVals.reduce((a, b) => a + b, 0) / rttVals.length : null;
            const st = alertStates[p.key];
            const sickNow = Boolean(st && st.condition === "SICK");
            const dt24 = computeDowntime({ incidents, pathKey: p.key, sinceMs: nowMs - 24 * 60 * 60 * 1000, nowMs, sickNow });
            const mark = p.routingTable || "main";
            const fo = report.failover && report.failover[mark];

            out += `\n\n${STATUS_EMOJI[status] || "⚪"} *${p.label || p.key}* — ${vonis.ok ? "✅" : "🔴"} ${vonis.text}` +
                `\n   kini: loss ${fmt(lossNow)}% • RTT ${fmt(rttNow)}ms` +
                (entry && entry.wan && entry.wan.rx_mbps != null ? ` • ↓${fmt(entry.wan.rx_mbps, 1)}/↑${fmt(entry.wan.tx_mbps, 1)} Mbps` : "") +
                (entry && entry.segment_label && entry.segment !== "SEHAT" && entry.segment !== "UNKNOWN" ? ` • ${entry.segment_label}` : "") +
                (fo && fo.failover ? `\n   ⚠️ BACKUP AKTIF (primary ${fo.primary_gateway} tidak jalan)` : "") +
                (sickNow ? `\n   ⚠️ gangguan berjalan sejak ${st.sickSince ? fmtTime(st.sickSince) : "-"}` : "") +
                (isp24 ? `\n   24 jam: avail ${fmt(isp24.availability_pct, 1)}% • bermasalah ${fmt(isp24.sick_pct)}% waktu • flap ${isp24.flaps || 0}×` : `\n   24 jam: belum ada data`) +
                (dt24.count ? `\n   gangguan 24 jam: ${dt24.count}× (total ±${fmtDur(dt24.totalMs)}${dt24.ongoingMs != null ? ", berjalan" : ""})` : "");
        }
        out = out.replace("*DATA SEMUA JALUR ISP*",
            `*DATA SEMUA JALUR ISP* — ${semuaOk ? "✅ KESELURUHAN OK" : "🔴 ADA YANG PERLU PERHATIAN"}`);
        out += `\n\nDetail satu jalur: *data gmdp* / *data ih* / *data mni* / *data sf*.\nGrafik: */upstream-quality*.`;
        return out;
    } catch (err) {
        console.warn(`[ISP-Data] Overview gagal: ${err.message}`);
        return "Maaf, gagal menyusun rangkuman ISP. Coba lagi sebentar lagi.";
    }
}

module.exports = {
    buildIspDataSummary,
    buildIspOverview,
    resolvePathArg,
    _internal: {
        overallVerdict,
        raporLine,
        STATUS_EMOJI,
        sparkChar,
        sparkline,
        buildHourlyBuckets,
        aggregateDirections,
        computeDowntime,
        downtimeLine,
        buildRouteLine,
        buildLinkLines,
        buildService24Line
    }
};
