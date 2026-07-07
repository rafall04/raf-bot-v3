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
 *         (status/poll-now).
 * Deps: `child_process.spawn` (php `views/upstream_quality_probe.php`),
 *       `repositories/upstream-quality.repository`, config `global.config.upstreamMonitor`.
 * MainFuncs: `startUpstreamQualityPoller`, `stopUpstreamQualityPoller`, `pollOnce`,
 *            `buildStatusReport`, `getPollerStats`, `getMonitorConfig`.
 * SideEffects: Spawn proses php per siklus, ICMP keluar dari router, tulis SQLite, timer unref.
 */
"use strict";

const path = require("path");
const { spawn } = require("child_process");
const { getUpstreamQualityRepository } = require("../repositories/upstream-quality.repository");

const DEFAULT_INTERVAL_MS = 60_000;
const MIN_INTERVAL_MS = 30_000;

// Default 4 jalur gateway DANDER (hasil recon live 2026-07-07). Configurable via
// config.upstreamMonitor.paths agar router lain (Tanjung/VANS) bisa punya peta sendiri.
const DEFAULT_PATHS = [
    { key: "gmdp", label: "GMDP (utama)", routingTable: null },
    { key: "ih", label: "IndiHome direct", routingTable: "FREE" },
    { key: "mni", label: "IH via MNI", routingTable: "MNI" },
    { key: "sf", label: "SF (backup MNI)", routingTable: "SF-PROBE" }
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
    minSamples: 3
};

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
            includeSteerSuggestion: true,
            ...(cfg.alerts || {})
        },
        paths,
        targets,
        valid: Boolean(cfg.host && cfg.user && cfg.password)
    };
}

/**
 * Jalankan bridge PHP probe. Kredensial lewat env MTIN_UPQ_* (bukan argv — argv terlihat di
 * `ps aux`), spesifikasi non-rahasia lewat argv JSON. Tidak pernah reject — selalu resolve
 * envelope { status, message, data }.
 */
function runProbeBridge(cfg) {
    const scriptPath = path.resolve(__dirname, "..", "views", "upstream_quality_probe.php");
    const spec = {
        paths: cfg.paths.map((p) => ({ key: p.key, routingTable: p.routingTable || null })),
        targets: cfg.targets.map((t) => ({ key: t.key || t.address, address: t.address })),
        count: cfg.pingCount,
        pingIntervalSeconds: cfg.pingIntervalSeconds,
        connectTimeoutSeconds: cfg.connectTimeoutSeconds
    };
    // Estimasi worst-case: tiap paket loss menunggu ~1s + interval, plus overhead koneksi.
    const perCommandMs = cfg.pingCount * (cfg.pingIntervalSeconds * 1000 + 1100) + 2000;
    const timeoutMs = Math.max(90_000, cfg.paths.length * cfg.targets.length * perCommandMs + 15_000);

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

        stats.poll_count += 1;
        stats.last_poll_at = probedAt;
        stats.last_poll_duration_ms = Date.now() - startedAt;
        stats.last_probe_rows = probes.length;
        stats.last_error = null;

        // Evaluasi alert transisi jalur (gate alerts.enabled=true; modul tidak pernah throw).
        try {
            const alerter = deps.alerter || require("./upstream-quality-alerter");
            await alerter.evaluateAfterCycle(cfg, deps.alerterDeps || {});
        } catch (_e) {
            // Alert tidak boleh mengganggu siklus probe.
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
        return {
            key: p.key,
            label: p.label || p.key,
            routing_table: p.routingTable || "main",
            status: targets.length ? worstVerdict(targets.map((t) => t.verdict)) : "UNKNOWN",
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
    getPollerStats,
    getMonitorConfig,
    // Diekspor untuk test/tuning.
    _internal: { verdictForTarget, worstVerdict, detectFailover, runProbeBridge, DEFAULT_PATHS, DEFAULT_TARGETS, DEFAULT_THRESHOLDS }
};
