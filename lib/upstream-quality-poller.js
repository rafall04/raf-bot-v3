/**
 * Header Doc
 * Purpose: Poller kualitas jalur upstream — tiap interval, ping policy-routed per routing-table
 *          (GMDP=main, IH=FREE, MNI, SF=SF-PROBE) ke target eksternal via bridge PHP RouterOS,
 *          simpan loss/RTT/jitter ke `upstream_quality.sqlite`, dan hitung vonis per jalur
 *          (NORMAL/DEGRADASI/GANGGUAN/PUTUS) + deteksi failover dari route aktif (tangga
 *          berapa pun rung-nya, termasuk pindah ke rung TENGAH).
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
const { analisaTrace } = require("./traceroute-analyzer");
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
// segmen last-mile (path tunnel: otomatis dari remote-address monitor).
//
// capacity = OBJEK `{ downMbps, upMbps }` — BUKAN angka polos. `computeUtilization`
// membaca `capacity.downMbps`/`.upMbps`, jadi `capacity: 200` menghasilkan NaN dan
// util_down_pct tetap null tanpa error apa pun (terbukti 2026-08-20). Isi hanya arah
// yang punya plafon empiris jelas; tanpa capacity, vonis JENUH tak pernah bisa menyala.
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
    // Satu layanan boleh punya BEBERAPA alamat (#b264): `addresses: ["ip1","ip2"]`. Bentuk lama
    // `address: "ip"` tetap diterima dan diperlakukan sebagai daftar berisi satu.
    //
    // !! KENAPA PENTING: satu IP bukan sampel yang sah untuk sebuah layanan. Terukur di produksi,
    // satu alamat `meta` yang bermasalah membuat SELURUH jalur divonis terganggu, dan lewat itu
    // setiap pelanggan diberi tahu jaringan kami rusak padahal sehat.
    const targets = (Array.isArray(cfg.targets) && cfg.targets.length ? cfg.targets : DEFAULT_TARGETS)
        .map((t) => {
            if (!t) return null;
            const daftar = Array.isArray(t.addresses) && t.addresses.length
                ? t.addresses.filter(Boolean).map(String)
                : (t.address ? [String(t.address)] : []);
            if (!daftar.length) return null;
            return {
                key: t.key || daftar[0],
                label: t.label || t.key || daftar[0],
                // Nama untuk PELANGGAN — sengaja terpisah dari `label` yang boleh teknis
                // ("Akamai CDN"). Kosong = layanan ini tak pernah disebut ke pelanggan.
                namaAwam: t.namaAwam || null,
                address: daftar[0],
                addresses: daftar
            };
        })
        .filter(Boolean);
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
        // Alarm KESTABILAN (lib/quality-alarm) — opt-in eksplisit, default MATI (deploy gelap).
        // Menjawab "cukup stabil untuk game?" dengan ambang TERUKUR, berbeda dari `alerts` di atas
        // yang menjawab "jalurnya rusak?" dengan `lossWarnPct: 5`.
        alarmKestabilan: {
            enabled: false,
            consecutiveCycles: 3,
            cooldownMinutes: 120,
            windowMinutes: 10,
            ...(cfg.alarmKestabilan || {})
        },
        // Penimpa ambang kestabilan (lib/latency-verdict). Kosong = pakai angka terukur bawaan.
        // Diteruskan APA ADANYA supaya kunci baru di config tak hilang saat normalisasi ini —
        // jebakan yang mudah terlewat: fungsi ini merakit ULANG objeknya, jadi kunci yang tak
        // disebut di sini TIDAK PERNAH sampai ke pemakainya.
        ambangStabilitas: cfg.ambangStabilitas || {},
        stabilitasWindowMinutes: Number(cfg.stabilitasWindowMinutes) > 0 ? Number(cfg.stabilitasWindowMinutes) : 10,
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
        // Satu entri per ALAMAT, tapi `key` tetap nama LAYANAN — supaya barisnya bisa digabung
        // kembali per layanan saat laporan dirakit (#b264).
        targets: cfg.targets.flatMap((t) => (t.addresses || [t.address]).filter(Boolean)
            .map((a) => ({ key: t.key || a, address: a }))),
        count: cfg.pingCount,
        gatewayPingCount: cfg.gatewayPingCount,
        pingIntervalSeconds: cfg.pingIntervalSeconds,
        connectTimeoutSeconds: cfg.connectTimeoutSeconds
    };
    // Estimasi worst-case: tiap paket loss menunggu ~1s + interval; (targets + 1 gateway) per
    // jalur, plus monitor tunnel & counter iface (ringan) + overhead koneksi.
    const perCommandMs = cfg.pingCount * (cfg.pingIntervalSeconds * 1000 + 1100) + 2000;
    // Dihitung per ALAMAT (bukan per layanan) — satu layanan bisa punya beberapa IP.
    const jumlahAlamat = cfg.targets.reduce((n, t) => n + ((t.addresses || [t.address]).filter(Boolean).length), 0);
    const timeoutMs = Math.max(90_000, cfg.paths.length * (jumlahAlamat + 1) * perCommandMs + 25_000);
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

        // Alarm KESTABILAN ke admin (gate config.upstreamMonitor.alarmKestabilan.enabled,
        // default MATI). Terpisah dari alerter jalur-SAKIT: yang ini menjawab "cukup stabil untuk
        // game?" dengan ambang terukur, bukan "jalurnya rusak?" dengan ambang loss 5%.
        try {
            const alarmKualitas = deps.alarmKualitas || require("./quality-alarm");
            await alarmKualitas.evaluasiKestabilan(cfg, deps.alarmKualitasDeps || {});
        } catch (_e) {
            // Alarm tidak boleh mengganggu siklus probe.
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

/**
 * Gabungkan beberapa IP milik SATU layanan jadi satu baris target.
 *
 * !! KENAPA (#b264). Dulu tiap layanan diwakili SATU IP, jadi satu IP yang kebetulan bermasalah
 * mewakili seluruh layanan — dan lewat vonis jalur, mewakili seluruh jaringan kita di mata
 * pelanggan. Satu alamat bukan sampel yang sah untuk sebuah layanan.
 *
 * Loss digabung dari HITUNGAN PAKET (`sent`/`received`), bukan rata-rata persentase: satu probe
 * cuma 3-5 paket, jadi persentase per baris terkuantisasi ~20 poin dan merata-ratakannya
 * menggelembungkan hasilnya (pelajaran #b255). RTT/jitter dirata-rata BERBOBOT jumlah sampel,
 * supaya IP yang jarang terprobe tak menyeret angka layanan.
 */
function gabungkanTargetSelayanan(rows) {
    const per = new Map();
    for (const row of rows) {
        const key = String(row.target_key || row.target || "?");
        if (!per.has(key)) {
            per.set(key, {
                target_key: key, alamat: [], samples: 0, sent: 0, received: 0,
                rttBobot: 0, jitBobot: 0, bobot: 0, baselineBobot: 0, baselineB: 0,
                last_probed_at: null, punyaPaket: false, lossPct: []
            });
        }
        const e = per.get(key);
        const n = Number(row.samples) || 0;
        if (row.target) e.alamat.push(String(row.target));
        e.samples += n;
        const sent = Number(row.sent_sum), rec = Number(row.received_sum);
        if (Number.isFinite(sent) && Number.isFinite(rec) && sent > 0) {
            e.sent += sent; e.received += Math.min(rec, sent); e.punyaPaket = true;
        } else if (row.loss_avg != null) {
            e.lossPct.push(Number(row.loss_avg));
        }
        if (row.rtt_avg != null && n > 0) { e.rttBobot += Number(row.rtt_avg) * n; e.bobot += n; }
        if (row.jitter_avg != null && n > 0) { e.jitBobot += Number(row.jitter_avg) * n; }
        const base = row.baseline && row.baseline.rtt_avg != null ? Number(row.baseline.rtt_avg) : null;
        if (base != null && n > 0) { e.baselineBobot += base * n; e.baselineB += n; }
        if (!e.last_probed_at || String(row.last_probed_at) > String(e.last_probed_at)) {
            e.last_probed_at = row.last_probed_at || e.last_probed_at;
        }
    }
    const out = [];
    for (const e of per.values()) {
        const loss = e.punyaPaket && e.sent > 0
            ? 100 * (1 - e.received / e.sent)
            : (e.lossPct.length ? e.lossPct.reduce((a, b) => a + b, 0) / e.lossPct.length : null);
        out.push({
            target: e.alamat.length === 1 ? e.alamat[0] : `${e.alamat.length} alamat`,
            alamat: e.alamat,
            target_key: e.target_key,
            samples: e.samples,
            loss_avg: loss,
            rtt_avg: e.bobot ? e.rttBobot / e.bobot : null,
            jitter_avg: e.bobot ? e.jitBobot / e.bobot : null,
            baseline: e.baselineB ? { rtt_avg: e.baselineBobot / e.baselineB } : null,
            last_probed_at: e.last_probed_at
        });
    }
    return out;
}

/**
 * Vonis jalur dari KESEPAKATAN antar target, bukan dari target terburuk.
 *
 * !! KENAPA BUKAN `worstVerdict` (#b264). Satu target yang buruk berarti TUJUAN ITU bermasalah,
 * bukan jalur kita. Terukur di produksi Tanjungharjo 2026-08-24, jalur `main`:
 *
 *     cloudflare 0%  ·  garena 0%  ·  youtube 0%  ·  akamai 0%  ·  moonton 1,5%  ·  google 0%
 *     meta      24,6%  <-- sendirian membuat SELURUH jalur divonis GANGGUAN
 *
 * `meta` (157.240.x) kronis buruk di SEMUA jalur — itu masalah peering ke Meta, bukan kualitas
 * jalur kita. Akibatnya `anyDegraded` menyala hampir selalu, dan SETIAP pelanggan yang mengetik
 * "cek koneksi" diberi tahu "sebagian jalur jaringan kami sedang terganggu" padahal jaringannya
 * sehat. Membantah pelanggan yang benar sudah buruk; memberi tahu gangguan yang tidak ada
 * membuat mereka berhenti percaya saat gangguannya nyata.
 *
 * Aturannya: jalur mengambil tingkat terburuk yang DISEPAKATI minimal `minSepakat` target.
 * Dengan 2, satu pencilan diabaikan tapi dua target yang sepakat tetap dilaporkan — lebih peka
 * daripada median, tetap kebal terhadap satu target kronis.
 *
 * Pola yang sama dengan #b255 (median antar target untuk vonis kestabilan): satu target menyimpang
 * tak boleh menentukan nasib seluruh jalur.
 */
function verdictBySepakat(verdicts, minSepakat = 2) {
    const daftar = (verdicts || []).filter(Boolean);
    if (!daftar.length) return "UNKNOWN";
    // Dengan target sedikit, tuntutan kesepakatan tak boleh melebihi jumlah yang ada.
    const butuh = Math.max(1, Math.min(minSepakat, daftar.length));
    const hitung = {};
    for (const v of daftar) hitung[v] = (hitung[v] || 0) + 1;

    // Dari paling parah ke paling ringan: tingkat pertama yang jumlah target-nya (termasuk yang
    // LEBIH parah) mencapai `butuh` adalah vonisnya.
    const urut = Object.keys(SEVERITY_ORDER).sort((a, b) => SEVERITY_ORDER[b] - SEVERITY_ORDER[a]);
    let kumulatif = 0;
    for (const tingkat of urut) {
        kumulatif += hitung[tingkat] || 0;
        if (kumulatif >= butuh && SEVERITY_ORDER[tingkat] > 0) return tingkat;
    }
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
 * Deteksi failover per mark multi-gateway. Rung yang benar-benar membawa trafik = rung AKTIF
 * dengan distance terkecil; failover=true bila rung itu BUKAN rung utama.
 *
 * !! Versi lama menebak cadangan lewat `sorted[sorted.length - 1]` — asumsi tangga 2 rung
 * (MNI→SF). Sejak tangga nyata jadi 3 rung di Dander (GMDP→GMDP2→MNI) dan 5 rung di
 * Tanjungharjo (VLAN62→VLAN401→radio→Indibiz→GMDP plain), pindah ke rung TENGAH tak pernah
 * terdeteksi: primary inactive tapi rung TERAKHIR juga inactive → failover selamanya false,
 * sehingga peringatan "BACKUP AKTIF" tak pernah menyala dan redundansi bisa habis diam-diam.
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
        // ECMP: bila lebih dari satu rung aktif, yang distance-nya terkecil yang dipakai.
        const active = sorted.find((r) => r.active) || null;
        const failover = Boolean(active) && active !== primary;
        // `backup_*` dipertahankan demi pemakai lama (panel + ringkasan WA): saat failover ia
        // menunjuk rung yang SEDANG dipakai, saat normal ia menunjuk cadangan pertama.
        const backup = failover ? active : sorted[1];
        result[mark] = {
            primary_gateway: primary.gateway,
            primary_active: Boolean(primary.active),
            primary_distance: primary.distance != null ? primary.distance : null,
            active_gateway: active ? active.gateway : null,
            active_distance: active && active.distance != null ? active.distance : null,
            backup_gateway: backup ? backup.gateway : null,
            backup_active: Boolean(backup && backup.active),
            failover
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
        // Beberapa IP milik satu layanan digabung DULU (#b264) — satu alamat bukan sampel
        // yang sah untuk sebuah layanan, apalagi untuk menilai seluruh jaringan.
        const targetRows = gabungkanTargetSelayanan(summary.filter((s) => s.path === p.key));
        const targets = targetRows.map((row) => ({
            target: row.target,
            alamat: row.alamat || (row.target ? [row.target] : []),
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
            // KESEPAKATAN, bukan target terburuk (#b264) — satu target kronis (`meta`) tak boleh
            // membuat seluruh jalur divonis terganggu di mata pelanggan.
            status: targets.length ? verdictBySepakat(targets.map((t) => t.verdict), cfg.minTargetSepakat) : "UNKNOWN",
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
 * Pilih TUJUAN trace: target yang benar-benar sedang memburuk di jalur itu, bukan target pertama.
 *
 * !! TERUKUR: 78 dari 78 trace produksi menuju 8.8.4.4 (target pertama), karena pemanggil tak
 * pernah mengoper alamat. Akibatnya bukti selalu bercerita tentang jalur ke Google — padahal
 * keluhan yang mau dibuktikan soal GAME. Bukti ke tujuan yang salah tidak bisa dipakai berdebat.
 *
 * Loss dihitung dari PAKET (sent/received) per target, bukan rata-rata persen per baris — alasan
 * yang sama dengan #b255: probe 3-5 paket membuat persentase per baris terkuantisasi ~20 poin.
 */
async function pilihTargetTerburuk(cfg, pathKey, deps = {}) {
    try {
        const repo = deps.repo || getUpstreamQualityRepository();
        if (typeof repo.getRecentProbes !== "function") return null;
        const menit = Math.max(1, Number(cfg.traceLookbackMinutes) || 10);
        const sinceIso = new Date(Date.now() - menit * 60 * 1000).toISOString();
        const rows = await repo.getRecentProbes({ sinceIso, path: pathKey, limit: 500 });
        const per = new Map();
        for (const r of rows || []) {
            const k = String(r.target_key || "");
            if (!k || k === "gateway") continue; // hop pertama itu milik kita, bukan bahan komplain ISP
            const e = per.get(k) || { sent: 0, received: 0 };
            const s = Number(r.sent), t = Number(r.received);
            if (Number.isFinite(s) && Number.isFinite(t) && s > 0) { e.sent += s; e.received += Math.min(t, s); }
            per.set(k, e);
        }
        let terburuk = null;
        for (const [k, e] of per) {
            if (e.sent <= 0) continue;
            const loss = 100 * (1 - e.received / e.sent);
            if (!terburuk || loss > terburuk.loss) terburuk = { key: k, loss };
        }
        if (!terburuk || terburuk.loss <= 0) return null;
        const t = (cfg.targets || []).find((x) => x.key === terburuk.key);
        return t ? { address: t.address, key: t.key, loss: Math.round(terburuk.loss * 100) / 100 } : null;
    } catch (_e) {
        return null; // gagal memilih != gagal trace; pemanggil jatuh ke target pertama.
    }
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

        // Tujuan trace: target yang sedang MEMBURUK; jatuh ke target pertama bila tak terpilih.
        const terburuk = targetAddress ? null : await pilihTargetTerburuk(cfg, pathKey, deps);
        const address = targetAddress || (terburuk && terburuk.address)
            || (cfg.targets[0] && cfg.targets[0].address) || "8.8.4.4";
        const targetKey = terburuk ? terburuk.key : ((cfg.targets.find((t) => t.address === address) || {}).key || null);
        const spec = {
            mode: "trace",
            address,
            routingTable: pathCfg.routingTable || null,
            connectTimeoutSeconds: cfg.connectTimeoutSeconds,
            // Probe per hop; di bawah ini loss per hop cuma bisa 0% atau 100% (lihat bridge PHP).
            count: Math.max(1, Math.min(30, Number(cfg.traceCount) || 10))
        };
        const runBridge = deps.runBridge || ((c, s) => runBridgeSpec(c, s, 60_000));
        const envelope = await runBridge(cfg, spec);
        if (!envelope || envelope.status !== "success" || !envelope.data) {
            return { ok: false, error: (envelope && envelope.message) || "Trace gagal tanpa pesan." };
        }

        const hops = Array.isArray(envelope.data.hops) ? envelope.data.hops : [];
        // !! JANGAN memakai `hops.find(h => h.address && h.loss_pct >= 50)` — itu versi lama, dan
        // ia memulangkan null pada 78 DARI 78 trace produksi: hop yang loss 100% justru yang
        // alamatnya KOSONG (router membatasi ICMP), sementara hop beralamat loss-nya 0.
        // Analisa sekarang memisahkan ronde tertumpuk, memakai snapshot terakhir, dan hanya
        // menuduh hop bila loss-nya BERTAHAN sampai tujuan. Lihat lib/traceroute-analyzer.js.
        const analisa = analisaTrace(hops, cfg.ambangHopTrace || {});
        const firstBadHop = analisa.hopBermasalah;
        const repo = deps.repo || getUpstreamQualityRepository();
        if (typeof repo.addIncident === "function") {
            await repo.addIncident({
                path: pathKey,
                kind: "trace",
                detail: {
                    target: address,
                    target_key: targetKey,
                    target_loss_pct: terburuk ? terburuk.loss : null,
                    routing_table: pathCfg.routingTable || null,
                    first_bad_hop: firstBadHop,
                    // `sebab` selalu ikut — kalau tak ada hop yang dituduh, pembacanya tetap tahu
                    // KENAPA (jalur sehat / loss pulih / trace miskin), bukan cuma melihat null.
                    sebab: analisa.sebab,
                    lonjakan_rtt: analisa.lonjakanRtt,
                    jalur: analisa.jalur,
                    ronde: analisa.jumlahRonde,
                    hops
                }
            });
        }
        // hops + target ikut dikembalikan supaya alerter bisa menampilkan bukti hop DI DALAM pesan.
        return {
            ok: true, firstBadHop, sebab: analisa.sebab, lonjakanRtt: analisa.lonjakanRtt,
            jalur: analisa.jalur, ronde: analisa.jumlahRonde,
            hopCount: analisa.jalur.length, hops, target: address, targetKey,
            routingTable: pathCfg.routingTable || null
        };
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
    _internal: { verdictForTarget, worstVerdict, verdictBySepakat, gabungkanTargetSelayanan, detectFailover, runProbeBridge, runBridgeSpec, DEFAULT_PATHS, DEFAULT_TARGETS, DEFAULT_THRESHOLDS, DEFAULT_REPORT, normalizeReport, prevLinkCounters }
};
