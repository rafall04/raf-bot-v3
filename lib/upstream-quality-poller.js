/**
 * Header Doc
 * Purpose: Poller kualitas jalur upstream — tiap interval, ping policy-routed per routing-table
 *          (GMDP=main, IH=FREE, MNI, SF=SF-PROBE) ke target eksternal via bridge PHP RouterOS,
 *          simpan loss/RTT/jitter ke `upstream_quality.sqlite`, dan hitung vonis per jalur
 *          (NORMAL/DEGRADASI/GANGGUAN/PUTUS) + deteksi failover MNI→SF dari route aktif.
 *          Probe dari router TIDAK terkena mangle prerouting (bebas paksaan ICMP→IH) dan
 *          TIDAK memakai `interface=` (metode itu terbukti memberi vonis palsu — lihat memori
 *          traffic-monitor-per-isp).
 * Caller: `lib/app-runtime.js` (start saat boot) dan `routes/admin-upstream-quality-routes.js`
 *         (status/poll-now/trace/report).
 * Deps: `child_process.spawn` (php `views/upstream_quality_probe.php`),
 *       `repositories/upstream-quality.repository`, `lib/upstream-wan-metrics` (delta/flap/
 *       utilisasi/segmen), lazy `lib/upstream-quality-alerter` + `lib/wan-failover-service`
 *       (evaluasi pasca-siklus), config `global.config.upstreamMonitor`.
 * MainFuncs: `startUpstreamQualityPoller`, `stopUpstreamQualityPoller`, `pollOnce`,
 *            `buildStatusReport`, `runTraceProbe`, `getPollerStats`, `getMonitorConfig`.
 * SideEffects: Spawn proses php per siklus, ICMP keluar dari router, tulis SQLite
 *              (probe + wan_link_samples + insiden), timer unref.
 */
"use strict";

const path = require("path");
const { spawn } = require("child_process");
const { getUpstreamQualityRepository } = require("../repositories/upstream-quality.repository");
const {
    computeLinkDelta,
    detectFlap,
    computeUtilization,
    classifySegment,
    SEGMENT_LABELS
} = require("./upstream-wan-metrics");

const DEFAULT_INTERVAL_MS = 60_000;
const MIN_INTERVAL_MS = 30_000;

// Default 4 jalur gateway DANDER (hasil recon live 2026-07-07). Configurable via
// config.upstreamMonitor.paths agar router lain (Tanjung/VANS) bisa punya peta sendiri.
// iface = interface WAN utk counter utilisasi/error; gatewayTarget = next-hop ISP utk probe
// segmen last-mile (path tunnel: otomatis dari remote-address monitor); capacity (Mbps) diisi
// user via config utk deteksi JENUH.
const DEFAULT_PATHS = [
    { key: "gmdp", label: "GMDP (utama)", routingTable: null, iface: "1.VLAN62-GMDP", gatewayTarget: "195.168.62.1", affects: "pelanggan reguler (pool 70.x)" },
    { key: "ih", label: "IndiHome direct", routingTable: "FREE", iface: "2.VLAN502", gatewayTarget: "192.168.102.1", affects: "trafik WhatsApp/game pelanggan 110k-125k + jalur FREE" },
    { key: "mni", label: "IH via MNI", routingTable: "MNI", iface: "Tunnel-MNI", tunnelType: "l2tp", affects: "paket 110k & 125k (browsing/video)" },
    { key: "sf", label: "SF (backup MNI)", routingTable: "SF-PROBE", iface: "SF", tunnelType: "sstp", affects: "paket 110k & 125k saat dialihkan ke backup" }
];

// Hindari 1.1.1.1 & 8.8.8.8 — dipakai router untuk recursive gateway-check (route /32 pinned).
const DEFAULT_TARGETS = [
    { key: "google", label: "Google DNS", address: "8.8.4.4" },
    { key: "cloudflare", label: "Cloudflare DNS", address: "1.0.0.1" }
];

const DEFAULT_THRESHOLDS = {
    lossWarnPct: 5,
    lossCritPct: 20,
    rttWarnFactor: 1.7,
    rttCritFactor: 2.5,
    minSamples: 3,
    saturationPct: 85 // utilisasi ≥ ini + loss → vonis JENUH (kongesti), bukan jalur rusak
};

// Counter interface siklus sebelumnya per path (delta → bps; in-memory, single-instance).
const prevLinkCounters = new Map();

const SEVERITY_ORDER = { PUTUS: 4, GANGGUAN: 3, DEGRADASI: 2, NORMAL: 1, UNKNOWN: 0 };

let pollTimer = null;
let pruneTimer = null;
let initialTimer = null;
let isRunning = false;
let isPolling = false; // guard anti-overlap bila satu siklus lambat

const stats = {
    started_at: null,
    poll_count: 0,
    last_poll_at: null,
    last_poll_duration_ms: null,
    last_probe_rows: 0,
    last_error: null
};

// Kustomisasi TAMPILAN report "data <isp>" + isi baris "Terdampak" (diatur leluasa dari panel admin,
// live tanpa restart). affectedListMax: 0 = tampilkan SEMUA pelanggan terdampak (report on-demand yang
// ditarik admin). alertAffectedListMax: batas nama di notif alert (dorong) supaya notif tak kebanjiran.
// sections: on/off tiap blok report agar admin bisa memangkas report jadi seringkas yang diinginkan.
const DEFAULT_REPORT = {
    affectedListMax: 0,
    alertAffectedListMax: 5,
    sections: {
        rincianArah: true,
        layananPopuler: true,
        polaLossPerJam: true,
        perArah24jam: true,
        gangguanTercatat: true,
        tujuhHari: true,
        insidenTerakhir: true
    }
};

// Merge report config user di atas default (guard tipe) → getMonitorConfig SELALU balikkan report utuh,
// jadi buildAffectedLine (alerter) & isp-data-summary cukup baca cfg.report tanpa cek-null berulang.
function normalizeReport(raw) {
    const r = (raw && typeof raw === "object") ? raw : {};
    const clampInt = (v, def, min, max) => {
        const n = Number(v);
        return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : def;
    };
    const secIn = (r.sections && typeof r.sections === "object") ? r.sections : {};
    const sections = {};
    for (const k of Object.keys(DEFAULT_REPORT.sections)) {
        sections[k] = secIn[k] === undefined ? DEFAULT_REPORT.sections[k] : secIn[k] !== false;
    }
    return {
        affectedListMax: clampInt(r.affectedListMax, DEFAULT_REPORT.affectedListMax, 0, 1000),
        alertAffectedListMax: clampInt(r.alertAffectedListMax, DEFAULT_REPORT.alertAffectedListMax, 0, 200),
        sections
    };
}

function getMonitorConfig() {
    const cfg = (global.config && global.config.upstreamMonitor) || {};
    const intervalSeconds = Number(cfg.intervalSeconds);
    const intervalMs = Number.isFinite(intervalSeconds) && intervalSeconds * 1000 >= MIN_INTERVAL_MS
        ? intervalSeconds * 1000
        : DEFAULT_INTERVAL_MS;
    const paths = Array.isArray(cfg.paths) && cfg.paths.length
        ? cfg.paths.filter((p) => p && p.key)
        : DEFAULT_PATHS;
    const targets = Array.isArray(cfg.targets) && cfg.targets.length
        ? cfg.targets.filter((t) => t && t.address)
        : DEFAULT_TARGETS;
    return {
        enabled: cfg.enabled === true,
        host: cfg.host || null,
        port: Number(cfg.port) || 8728,
        user: cfg.user || null,
        password: cfg.password || null,
        intervalMs,
        pingCount: Math.max(1, Math.min(20, Number(cfg.pingCount) || 5)),
        gatewayPingCount: Math.max(1, Math.min(10, Number(cfg.gatewayPingCount) || 3)),
        pingIntervalSeconds: Number(cfg.pingIntervalSeconds) || 0.3,
        connectTimeoutSeconds: Math.max(3, Math.min(30, Number(cfg.connectTimeoutSeconds) || 8)),
        statusWindowMinutes: Math.max(5, Math.min(120, Number(cfg.statusWindowMinutes) || 15)),
        baselineHours: Math.max(1, Math.min(168, Number(cfg.baselineHours) || 24)),
        retentionDays: Math.max(1, Math.min(365, Number(cfg.retentionDays) || 30)),
        thresholds: { ...DEFAULT_THRESHOLDS, ...(cfg.thresholds || {}) },
        // Alert transisi jalur (lib/upstream-quality-alerter) — opt-in eksplisit, default MATI.
        alerts: {
            enabled: false,
            consecutiveCycles: 3,
            recoveryCycles: 3,
            cooldownMinutes: 120,
            groupJid: null,
            notifyAdmins: true,
            recipients: [],
            includeSteerSuggestion: true,
            traceWaitSeconds: 45, // tunggu hasil traceroute agar ikut DI DALAM pesan alert
            ...(cfg.alerts || {})
        },
        report: normalizeReport(cfg.report),
        paths,
        targets,
        valid: Boolean(cfg.host && cfg.user && cfg.password)
    };
}

/**
 * Jalankan bridge PHP dengan spesifikasi bebas (mode probe/trace). Kredensial lewat env
 * MTIN_UPQ_* (bukan argv — argv terlihat di `ps aux`), spesifikasi non-rahasia lewat argv JSON.
 * Tidak pernah reject — selalu resolve envelope { status, message, data }.
 */
function runBridgeSpec(cfg, spec, timeoutMs) {
    const scriptPath = path.resolve(__dirname, "..", "views", "upstream_quality_probe.php");

    return new Promise((resolve) => {
        const childEnv = {
            ...process.env,
            MTIN_UPQ_HOST: String(cfg.host),
            MTIN_UPQ_PORT: String(cfg.port),
            MTIN_UPQ_USER: String(cfg.user),
            MTIN_UPQ_PASS: String(cfg.password)
        };
        let child;
        try {
            child = spawn("php", [scriptPath, JSON.stringify(spec)], {
                cwd: path.resolve(__dirname, ".."),
                windowsHide: true,
                env: childEnv
            });
        } catch (err) {
            return resolve({ status: "error", message: `Gagal spawn php: ${err.message}` });
        }

        let stdout = "";
        let stderr = "";
        let finished = false;
        const finalize = (result) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            resolve(result);
        };
        const timer = setTimeout(() => {
            try { child.kill("SIGKILL"); } catch (_e) { /* abaikan */ }
            finalize({ status: "error", message: `Bridge probe timeout ${Math.round(timeoutMs / 1000)}s.` });
        }, timeoutMs);

        child.stdout.on("data", (d) => { stdout += d; });
        child.stderr.on("data", (d) => { stderr += d; });
        child.on("error", (err) => finalize({ status: "error", message: `Bridge error: ${err.message}` }));
        child.on("close", () => {
            const trimmed = (stdout || "").trim();
            if (!trimmed) {
                return finalize({ status: "error", message: (stderr || "Bridge tanpa output.").trim().slice(0, 500) });
            }
            try {
                finalize(JSON.parse(trimmed));
            } catch (err) {
                finalize({ status: "error", message: `Output bridge tidak valid: ${err.message}` });
            }
        });
    });
}

/** Bridge mode PROBE: ping jauh per tabel + ping gateway + counter iface + monitor tunnel. */
function runProbeBridge(cfg) {
    const spec = {
        mode: "probe",
        paths: cfg.paths.map((p) => ({
            key: p.key,
            routingTable: p.routingTable || null,
            iface: p.iface || null,
            gatewayTarget: p.gatewayTarget || null,
            tunnelType: p.tunnelType || null
        })),
        targets: cfg.targets.map((t) => ({ key: t.key || t.address, address: t.address })),
        count: cfg.pingCount,
        gatewayPingCount: cfg.gatewayPingCount,
        pingIntervalSeconds: cfg.pingIntervalSeconds,
        connectTimeoutSeconds: cfg.connectTimeoutSeconds
    };
    // Estimasi worst-case: tiap paket loss menunggu ~1s + interval; (targets + 1 gateway) per
    // jalur, plus monitor tunnel & counter iface (ringan) + overhead koneksi.
    const perCommandMs = cfg.pingCount * (cfg.pingIntervalSeconds * 1000 + 1100) + 2000;
    const timeoutMs = Math.max(90_000, cfg.paths.length * (cfg.targets.length + 1) * perCommandMs + 25_000);
    return runBridgeSpec(cfg, spec, timeoutMs);
}

/**
 * Satu siklus probe. `deps` bisa dioverride untuk test ({ runBridge, repo, nowIso }).
 * Tidak pernah throw.
 */
async function pollOnce(deps = {}) {
    if (isPolling) return { skipped: true, reason: "in-flight" };
    isPolling = true;
    const startedAt = Date.now();
    const cfg = deps.config || getMonitorConfig();
    try {
        if (!cfg.valid) {
            stats.last_error = { at: new Date().toISOString(), message: "Konfigurasi upstreamMonitor tidak lengkap (host/user/password)." };
            return { ok: false, error: stats.last_error.message };
        }
        const runBridge = deps.runBridge || runProbeBridge;
        const repo = deps.repo || getUpstreamQualityRepository();
        const probedAt = deps.nowIso || new Date().toISOString();

        const envelope = await runBridge(cfg);
        if (!envelope || envelope.status !== "success" || !envelope.data) {
            const message = (envelope && envelope.message) || "Bridge probe gagal tanpa pesan.";
            stats.last_error = { at: new Date().toISOString(), message };
            return { ok: false, error: message };
        }

        const probes = Array.isArray(envelope.data.probes) ? envelope.data.probes : [];
        const routes = Array.isArray(envelope.data.routes) ? envelope.data.routes : [];
        await repo.insertProbes(probedAt, probes);
        await repo.insertRouteStates(probedAt, routes);

        // Sampel link WAN: delta counter → bps/error/drop per interval, flap tunnel
        // (uptime mundur / link-downs naik), utilisasi vs kapasitas (config capacity per path).
        const links = Array.isArray(envelope.data.links) ? envelope.data.links : [];
        const tunnels = Array.isArray(envelope.data.tunnels) ? envelope.data.tunnels : [];
        const tunnelByPath = new Map(tunnels.map((t) => [t.path, t]));
        const nowMs = Date.now();
        const wanRows = [];
        for (const link of links) {
            const tunnel = tunnelByPath.get(link.path) || null;
            const curr = {
                rx_byte: link.rx_byte,
                tx_byte: link.tx_byte,
                rx_error: link.rx_error,
                tx_error: link.tx_error,
                rx_drop: link.rx_drop,
                tx_drop: link.tx_drop,
                link_downs: link.link_downs,
                tunnel_uptime_s: tunnel ? tunnel.uptime_s : null
            };
            const prev = prevLinkCounters.get(link.path) || null;
            const delta = (prev ? computeLinkDelta(prev, curr, nowMs - prev.atMs) : null) || {};
            const flap = detectFlap(prev, curr);
            const pathCfg = cfg.paths.find((p) => p.key === link.path) || {};
            const util = computeUtilization(
                { rx_bps: delta.rx_bps, tx_bps: delta.tx_bps },
                pathCfg.capacity || null
            );
            wanRows.push({
                path: link.path,
                iface: link.iface,
                rx_bps: delta.rx_bps,
                tx_bps: delta.tx_bps,
                rx_error_d: delta.rx_error_d,
                tx_error_d: delta.tx_error_d,
                rx_drop_d: delta.rx_drop_d,
                tx_drop_d: delta.tx_drop_d,
                link_downs: curr.link_downs,
                tunnel_uptime_s: curr.tunnel_uptime_s,
                util_down_pct: util.down_pct,
                util_up_pct: util.up_pct,
                flap
            });
            if (flap && typeof repo.addIncident === "function") {
                try {
                    await repo.addIncident({
                        createdAt: probedAt,
                        path: link.path,
                        kind: "flap",
                        detail: { iface: link.iface, tunnel_uptime_s: curr.tunnel_uptime_s, link_downs: curr.link_downs }
                    });
                } catch (_e) { /* insiden best-effort */ }
            }
            prevLinkCounters.set(link.path, { ...curr, atMs: nowMs });
        }
        if (wanRows.length && typeof repo.insertWanSamples === "function") {
            await repo.insertWanSamples(probedAt, wanRows);
        }

        stats.poll_count += 1;
        stats.last_poll_at = probedAt;
        stats.last_poll_duration_ms = Date.now() - startedAt;
        stats.last_probe_rows = probes.length;
        stats.last_error = null;

        // Evaluasi alert transisi jalur (gate alerts.enabled=true; modul tidak pernah throw).
        // requestTrace: traceroute otomatis saat transisi sakit (bukti hop utk komplain ISP);
        // getPathStatus: segmen/util utk memperkaya isi alert.
        try {
            const alerter = deps.alerter || require("./upstream-quality-alerter");
            const alerterDeps = deps.alerterDeps || {
                requestTrace: (pathKey) => runTraceProbe(pathKey).catch(() => null),
                getPathStatus: async (pathKey) => {
                    const report = await buildStatusReport();
                    return (report.paths || []).find((p) => p.key === pathKey) || null;
                }
            };
            await alerter.evaluateAfterCycle(cfg, alerterDeps);
        } catch (_e) {
            // Alert tidak boleh mengganggu siklus probe.
        }

        // Evaluasi failover otomatis/saran (gate config.wanFailover.enabled, default MATI;
        // modul tidak pernah throw — propose kirim WA saja, auto eksekusi switch allowlist).
        try {
            const failover = deps.failover || require("./wan-failover-service");
            await failover.evaluateAfterCycle(cfg, deps.failoverDeps || {});
        } catch (_e) {
            // Failover tidak boleh mengganggu siklus probe.
        }

        return { ok: true, probes: probes.length, routes: routes.length };
    } catch (err) {
        stats.last_error = { at: new Date().toISOString(), message: err.message };
        console.error("[UPQ-Poller] Siklus probe error:", err.message);
        return { ok: false, error: err.message };
    } finally {
        isPolling = false;
    }
}

function verdictForTarget(row, thresholds) {
    if (!row || Number(row.samples) < thresholds.minSamples) return "UNKNOWN";
    const loss = row.loss_avg == null ? null : Number(row.loss_avg);
    const rtt = row.rtt_avg == null ? null : Number(row.rtt_avg);
    const base = row.baseline && row.baseline.rtt_avg != null ? Number(row.baseline.rtt_avg) : null;
    if (loss != null && loss >= 99) return "PUTUS";
    if (loss != null && loss >= thresholds.lossCritPct) return "GANGGUAN";
    if (base != null && rtt != null && base > 0 && rtt >= base * thresholds.rttCritFactor) return "GANGGUAN";
    if (loss != null && loss >= thresholds.lossWarnPct) return "DEGRADASI";
    if (base != null && rtt != null && base > 0 && rtt >= base * thresholds.rttWarnFactor) return "DEGRADASI";
    return "NORMAL";
}

function worstVerdict(verdicts) {
    let worst = "UNKNOWN";
    for (const v of verdicts) {
        if (SEVERITY_ORDER[v] > SEVERITY_ORDER[worst]) worst = v;
    }
    return worst;
}

/**
 * Deteksi failover per mark multi-gateway (kasus nyata: MNI primary Tunnel-MNI dist 1 +
 * backup SF dist 2). failover=true bila primary inactive dan backup active.
 */
function detectFailover(routeRows) {
    const byMark = new Map();
    for (const r of routeRows) {
        if (r.disabled) continue;
        if (!byMark.has(r.mark)) byMark.set(r.mark, []);
        byMark.get(r.mark).push(r);
    }
    const result = {};
    for (const [mark, rows] of byMark.entries()) {
        if (rows.length < 2) continue;
        const sorted = [...rows].sort((a, b) => (a.distance || 0) - (b.distance || 0));
        const primary = sorted[0];
        const backup = sorted[sorted.length - 1];
        result[mark] = {
            primary_gateway: primary.gateway,
            primary_active: Boolean(primary.active),
            backup_gateway: backup.gateway,
            backup_active: Boolean(backup.active),
            failover: !primary.active && Boolean(backup.active)
        };
    }
    return result;
}

/**
 * Laporan status per jalur untuk endpoint admin / verdict cek-koneksi.
 * `deps` override untuk test ({ repo, config, nowMs }).
 */
async function buildStatusReport(deps = {}) {
    const cfg = deps.config || getMonitorConfig();
    const repo = deps.repo || getUpstreamQualityRepository();
    const nowMs = deps.nowMs || Date.now();
    const windowSinceIso = new Date(nowMs - cfg.statusWindowMinutes * 60 * 1000).toISOString();
    const baselineSinceIso = new Date(nowMs - cfg.baselineHours * 60 * 60 * 1000).toISOString();

    const summary = await repo.getSummary({ windowSinceIso, baselineSinceIso });
    const routeRows = await repo.getLatestRouteStates();
    const failover = detectFailover(routeRows);

    // Segmen & utilisasi (guard typeof: repo lama/fake test tanpa method baru tetap jalan).
    const gwRows = typeof repo.getGatewaySummary === "function"
        ? await repo.getGatewaySummary({ windowSinceIso })
        : [];
    const wanRows = typeof repo.getWanWindowStats === "function"
        ? await repo.getWanWindowStats({
            windowSinceIso,
            flapSinceIso: new Date(nowMs - 24 * 60 * 60 * 1000).toISOString()
        })
        : [];
    const gwByPath = new Map(gwRows.map((g) => [g.path, g]));
    const wanByPath = new Map(wanRows.map((w) => [w.path, w]));

    const paths = cfg.paths.map((p) => {
        const targetRows = summary.filter((s) => s.path === p.key);
        const targets = targetRows.map((row) => ({
            target: row.target,
            target_key: row.target_key,
            samples: Number(row.samples) || 0,
            loss_avg_pct: row.loss_avg == null ? null : Math.round(Number(row.loss_avg) * 10) / 10,
            rtt_avg_ms: row.rtt_avg == null ? null : Math.round(Number(row.rtt_avg) * 10) / 10,
            jitter_avg_ms: row.jitter_avg == null ? null : Math.round(Number(row.jitter_avg) * 10) / 10,
            baseline_rtt_ms: row.baseline && row.baseline.rtt_avg != null
                ? Math.round(Number(row.baseline.rtt_avg) * 10) / 10
                : null,
            last_probed_at: row.last_probed_at || null,
            verdict: verdictForTarget(row, cfg.thresholds)
        }));
        // Segmen penyebab: bandingkan loss target jauh vs loss GATEWAY vs utilisasi link.
        const gw = gwByPath.get(p.key) || null;
        const wan = wanByPath.get(p.key) || null;
        const farLossVals = targets.map((t) => t.loss_avg_pct).filter((v) => v != null);
        const farLossPct = farLossVals.length
            ? farLossVals.reduce((a, b) => a + b, 0) / farLossVals.length
            : null;
        const utilVals = wan ? [wan.util_down_max, wan.util_up_max].filter((v) => v != null) : [];
        const utilMaxPct = utilVals.length ? Math.max(...utilVals) : null;
        const segment = classifySegment({
            farLossPct,
            gwLossPct: gw && gw.loss_avg != null ? Number(gw.loss_avg) : null,
            utilMaxPct,
            thresholds: cfg.thresholds
        });

        return {
            key: p.key,
            label: p.label || p.key,
            routing_table: p.routingTable || "main",
            status: targets.length ? worstVerdict(targets.map((t) => t.verdict)) : "UNKNOWN",
            segment,
            segment_label: SEGMENT_LABELS[segment] || segment,
            gateway: gw ? {
                target: gw.target || null,
                samples: Number(gw.samples) || 0,
                loss_avg_pct: gw.loss_avg == null ? null : Math.round(Number(gw.loss_avg) * 10) / 10,
                rtt_avg_ms: gw.rtt_avg == null ? null : Math.round(Number(gw.rtt_avg) * 10) / 10
            } : null,
            wan: wan ? {
                rx_mbps: wan.rx_bps_avg == null ? null : Math.round(Number(wan.rx_bps_avg) / 1e5) / 10,
                tx_mbps: wan.tx_bps_avg == null ? null : Math.round(Number(wan.tx_bps_avg) / 1e5) / 10,
                util_down_max_pct: wan.util_down_max == null ? null : Math.round(Number(wan.util_down_max) * 10) / 10,
                util_up_max_pct: wan.util_up_max == null ? null : Math.round(Number(wan.util_up_max) * 10) / 10,
                errors: Number(wan.errors) || 0,
                drops: Number(wan.drops) || 0,
                flaps_24h: Number(wan.flaps) || 0
            } : null,
            targets
        };
    });

    return {
        generated_at: new Date(nowMs).toISOString(),
        enabled: cfg.enabled,
        window_minutes: cfg.statusWindowMinutes,
        baseline_hours: cfg.baselineHours,
        paths,
        failover,
        route_snapshot: routeRows,
        poller: { ...stats }
    };
}

/**
 * Traceroute policy-routed satu putaran untuk sebuah jalur — bukti "loss mulai di hop mana"
 * saat komplain ke ISP. Hasil disimpan sebagai insiden (kind 'trace'). Tidak pernah throw.
 */
async function runTraceProbe(pathKey, targetAddress = null, deps = {}) {
    try {
        const cfg = deps.config || getMonitorConfig();
        if (!cfg.valid) return { ok: false, error: "Konfigurasi upstreamMonitor tidak lengkap." };
        const pathCfg = cfg.paths.find((p) => p.key === pathKey);
        if (!pathCfg) return { ok: false, error: `Jalur tidak dikenal: ${pathKey}` };

        const address = targetAddress || (cfg.targets[0] && cfg.targets[0].address) || "8.8.4.4";
        const spec = {
            mode: "trace",
            address,
            routingTable: pathCfg.routingTable || null,
            connectTimeoutSeconds: cfg.connectTimeoutSeconds
        };
        const runBridge = deps.runBridge || ((c, s) => runBridgeSpec(c, s, 60_000));
        const envelope = await runBridge(cfg, spec);
        if (!envelope || envelope.status !== "success" || !envelope.data) {
            return { ok: false, error: (envelope && envelope.message) || "Trace gagal tanpa pesan." };
        }

        const hops = Array.isArray(envelope.data.hops) ? envelope.data.hops : [];
        const firstBadHop = hops.find((h) => h && h.address && h.loss_pct != null && h.loss_pct >= 50) || null;
        const repo = deps.repo || getUpstreamQualityRepository();
        if (typeof repo.addIncident === "function") {
            await repo.addIncident({
                path: pathKey,
                kind: "trace",
                detail: {
                    target: address,
                    routing_table: pathCfg.routingTable || null,
                    first_bad_hop: firstBadHop,
                    hops
                }
            });
        }
        // hops + target ikut dikembalikan supaya alerter bisa menampilkan bukti hop DI DALAM pesan.
        return { ok: true, firstBadHop, hopCount: hops.length, hops, target: address, routingTable: pathCfg.routingTable || null };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

function startUpstreamQualityPoller() {
    if (isRunning) {
        console.log("[UPQ-Poller] Sudah berjalan");
        return;
    }
    const cfg = getMonitorConfig();
    if (!cfg.enabled) {
        console.log("[UPQ-Poller] Nonaktif (set config.upstreamMonitor.enabled=true untuk mengaktifkan)");
        return;
    }
    if (!cfg.valid) {
        console.warn("[UPQ-Poller] Aktif tapi konfigurasi tidak lengkap (host/user/password) — poller tidak dijalankan.");
        return;
    }

    console.log(`[UPQ-Poller] Start (interval ${Math.round(cfg.intervalMs / 1000)}s, ${cfg.paths.length} jalur × ${cfg.targets.length} target, router ${cfg.host}:${cfg.port})`);
    stats.started_at = new Date().toISOString();
    isRunning = true;

    // Poll pertama sebentar setelah boot (biarkan WA/HTTP init duluan).
    initialTimer = setTimeout(() => { pollOnce().catch(() => {}); }, 5000);
    if (initialTimer.unref) initialTimer.unref();

    pollTimer = setInterval(() => { pollOnce().catch(() => {}); }, cfg.intervalMs);
    if (pollTimer.unref) pollTimer.unref();

    // Prune retensi harian (pola olt-event repo).
    const doPrune = () => {
        try {
            getUpstreamQualityRepository().pruneOld(cfg.retentionDays).catch(() => {});
        } catch (_e) { /* jangan jatuhkan poller karena prune */ }
    };
    doPrune();
    pruneTimer = setInterval(doPrune, 24 * 60 * 60 * 1000);
    if (pruneTimer.unref) pruneTimer.unref();
}

function stopUpstreamQualityPoller() {
    if (pollTimer) clearInterval(pollTimer);
    if (pruneTimer) clearInterval(pruneTimer);
    if (initialTimer) clearTimeout(initialTimer);
    pollTimer = null;
    pruneTimer = null;
    initialTimer = null;
    isRunning = false;
}

function getPollerStats() {
    return { ...stats, is_running: isRunning, is_polling: isPolling };
}

module.exports = {
    startUpstreamQualityPoller,
    stopUpstreamQualityPoller,
    pollOnce,
    buildStatusReport,
    runTraceProbe,
    getPollerStats,
    getMonitorConfig,
    // Diekspor untuk test/tuning.
    _internal: { verdictForTarget, worstVerdict, detectFailover, runProbeBridge, runBridgeSpec, DEFAULT_PATHS, DEFAULT_TARGETS, DEFAULT_THRESHOLDS, DEFAULT_REPORT, normalizeReport, prevLinkCounters }
};
