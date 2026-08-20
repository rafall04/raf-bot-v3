/**
 * Header Doc
 * Purpose: Prober reachability per-LAYANAN per-JALUR (Instagram/Facebook/WA/Google/YouTube/
 *          Cloudflare × GMDP/IH/MNI/SF). Mengukur pengalaman NYATA pelanggan: TCP+TLS handshake
 *          ke tiap layanan lewat tiap ISP, dengan MENGIKAT source-IP alias server yang di-router
 *          di-steer ke jalur berbeda (server di belakang router = trafik di-forward+NAT seperti
 *          pelanggan, menghindari jebakan probe router-originated). Meta memblokir ICMP → TCP-443
 *          adalah satu-satunya cara akurat melihat "bisakah user buka Instagram via MNI".
 * Caller: `lib/app-runtime.js` (start saat boot) dan `routes/admin-upstream-quality-routes.js`.
 * Deps: `net`/`tls`/`dns`, `repositories/upstream-quality.repository` (tabel service_probes),
 *       config `global.config.serviceMonitor`. Alert via `lib/whatsapp-critical-delivery.sendCritical`.
 * MainFuncs: `startServiceProber`, `stopServiceProber`, `probeCycle`, `buildServiceReport`,
 *            `getProberStats`, `getServiceConfig`.
 * SideEffects: DNS resolve + koneksi TCP/TLS keluar dari source-IP alias per jalur; tulis SQLite;
 *              kirim WA admin saat jalur-layanan down beruntun (never-throw). Timer unref.
 */
"use strict";

const net = require("net");
const tls = require("tls");
const dns = require("dns");
const { getUpstreamQualityRepository } = require("../repositories/upstream-quality.repository");

const DEFAULT_INTERVAL_MS = 60_000;
const MIN_INTERVAL_MS = 30_000;

const DEFAULT_SERVICES = [
    { key: "instagram", label: "Instagram", host: "www.instagram.com" },
    { key: "facebook", label: "Facebook", host: "www.facebook.com" },
    { key: "whatsapp", label: "WhatsApp", host: "web.whatsapp.com" },
    { key: "tiktok", label: "TikTok", host: "www.tiktok.com" },
    { key: "google", label: "Google", host: "www.google.com" },
    { key: "youtube", label: "YouTube", host: "www.youtube.com" },
    { key: "cloudflare", label: "Cloudflare", host: "www.cloudflare.com" }
];

let pollTimer = null;
let pruneTimer = null;
let initialTimer = null;
let isRunning = false;
let isPolling = false;

// State alert per jalur (mostly-down transition). In-memory single-instance.
const pathAlertState = new Map();

const stats = {
    started_at: null,
    poll_count: 0,
    last_poll_at: null,
    last_poll_duration_ms: null,
    last_rows: 0,
    last_error: null
};

function getServiceConfig() {
    const cfg = (global.config && global.config.serviceMonitor) || {};
    const intervalSeconds = Number(cfg.intervalSeconds);
    const intervalMs = Number.isFinite(intervalSeconds) && intervalSeconds * 1000 >= MIN_INTERVAL_MS
        ? intervalSeconds * 1000
        : DEFAULT_INTERVAL_MS;
    const services = Array.isArray(cfg.services) && cfg.services.length
        ? cfg.services.filter((s) => s && s.key && s.host)
        : DEFAULT_SERVICES;
    const paths = Array.isArray(cfg.paths) ? cfg.paths.filter((p) => p && p.key && p.srcIp) : [];
    return {
        enabled: cfg.enabled === true,
        intervalMs,
        timeoutMs: Math.max(1500, Math.min(20000, Number(cfg.timeoutMs) || 6000)),
        tlsCheck: cfg.tlsCheck !== false,
        statusWindowMinutes: Math.max(3, Math.min(120, Number(cfg.statusWindowMinutes) || 10)),
        retentionDays: Math.max(1, Math.min(180, Number(cfg.retentionDays) || 14)),
        services,
        paths,
        alerts: {
            enabled: false,
            consecutiveCycles: 3,
            cooldownMinutes: 120,
            minServicesDown: 2,
            notifyAdmins: true,
            recipients: [],
            ...(cfg.alerts || {})
        },
        // Valid bila ada minimal 1 jalur ber-srcIp (butuh alias server + mangle router).
        valid: paths.length > 0
    };
}

function resolveHost(host, deps) {
    const lookup = deps.lookup || dns.lookup;
    return new Promise((resolve) => {
        try {
            lookup(host, { family: 4 }, (err, address) => resolve(err ? null : address));
        } catch (_e) {
            resolve(null);
        }
    });
}

/**
 * Satu probe TCP(+TLS) ke `ip:443` DARI source-IP `srcIp` (yang di-router di-steer ke jalur).
 * Kembalikan { ok, connect_ms, tls_ms, error }. Tidak pernah reject.
 */
function probeConnect({ ip, host, srcIp, timeoutMs, tlsCheck }, deps = {}) {
    const netMod = deps.net || net;
    const tlsMod = deps.tls || tls;
    const now = deps.now || (() => Date.now());
    return new Promise((resolve) => {
        const t0 = now();
        let connectMs = null;
        let socket = null;
        let settled = false;
        const finish = (r) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try { if (socket) socket.destroy(); } catch (_e) { /* abaikan */ }
            resolve(r);
        };
        const timer = setTimeout(() => finish({ ok: false, connect_ms: connectMs, tls_ms: null, error: "timeout" }), timeoutMs);
        try {
            if (tlsCheck) {
                socket = tlsMod.connect({
                    host: ip, port: 443, servername: host, localAddress: srcIp,
                    rejectUnauthorized: false, ALPNProtocols: ["http/1.1"]
                });
                socket.once("connect", () => { connectMs = now() - t0; });
                socket.once("secureConnect", () => finish({ ok: true, connect_ms: connectMs, tls_ms: now() - t0, error: null }));
            } else {
                socket = netMod.connect({ host: ip, port: 443, localAddress: srcIp });
                socket.once("connect", () => finish({ ok: true, connect_ms: now() - t0, tls_ms: null, error: null }));
            }
            socket.once("error", (e) => finish({ ok: false, connect_ms: connectMs, tls_ms: null, error: (e && (e.code || e.message)) || "error" }));
        } catch (e) {
            finish({ ok: false, connect_ms: null, tls_ms: null, error: e.message });
        }
    });
}

/**
 * Satu siklus: resolve tiap layanan lalu probe ke SEMUA jalur (bind source-IP). `deps` untuk test.
 * Tidak pernah throw.
 */
async function probeCycle(deps = {}) {
    if (isPolling) return { skipped: true, reason: "in-flight" };
    isPolling = true;
    const startedAt = Date.now();
    const cfg = deps.config || getServiceConfig();
    try {
        if (!cfg.valid) {
            stats.last_error = { at: new Date().toISOString(), message: "serviceMonitor: belum ada jalur ber-srcIp (butuh alias server + mangle router)." };
            return { ok: false, error: stats.last_error.message };
        }
        const repo = deps.repo || getUpstreamQualityRepository();
        const probedAt = deps.nowIso || new Date().toISOString();

        const rows = [];
        for (const svc of cfg.services) {
            const ip = await resolveHost(svc.host, deps);
            if (!ip) {
                for (const p of cfg.paths) rows.push({ service: svc.key, path: p.key, target_ip: null, connect_ms: null, tls_ms: null, ok: false, error: "dns-fail" });
                continue;
            }
            const results = await Promise.all(cfg.paths.map((p) =>
                probeConnect({ ip, host: svc.host, srcIp: p.srcIp, timeoutMs: cfg.timeoutMs, tlsCheck: cfg.tlsCheck }, deps)
                    .then((r) => ({ service: svc.key, path: p.key, target_ip: ip, connect_ms: r.connect_ms, tls_ms: r.tls_ms, ok: r.ok, error: r.error }))
            ));
            rows.push(...results);
        }

        await repo.insertServiceProbes(probedAt, rows);
        stats.poll_count += 1;
        stats.last_poll_at = probedAt;
        stats.last_poll_duration_ms = Date.now() - startedAt;
        stats.last_rows = rows.length;
        stats.last_error = null;

        // Alert per-jalur (mostly-down) — never-throw.
        try { await evaluateAlerts(cfg, rows, probedAt, deps); } catch (_e) { /* alert tak boleh ganggu */ }

        return { ok: true, rows: rows.length };
    } catch (err) {
        stats.last_error = { at: new Date().toISOString(), message: err.message };
        console.error("[SvcProber] siklus error:", err.message);
        return { ok: false, error: err.message };
    } finally {
        isPolling = false;
    }
}

function normalizeRecipients(list) {
    const out = [];
    (Array.isArray(list) ? list : []).forEach((raw) => {
        const s = String(raw || "").trim();
        if (!s) return;
        if (s.endsWith("@s.whatsapp.net") || s.endsWith("@g.us")) { out.push(s); return; }
        let d = s.replace(/\D/g, "");
        if (d.startsWith("0")) d = `62${d.slice(1)}`;
        if (d.length >= 10 && d.startsWith("62")) out.push(`${d}@s.whatsapp.net`);
    });
    return out;
}

/**
 * Alert: sebuah JALUR yang tadinya sehat kini gagal ke ≥minServicesDown layanan selama siklus ini
 * → hitung streak; saat streak mencapai consecutiveCycles → alert sekali (cooldown). Pulih → reset.
 */
async function evaluateAlerts(cfg, rows, probedAt, deps) {
    const ac = cfg.alerts;
    if (!ac || ac.enabled !== true) return;
    const nowMs = Date.parse(probedAt) || Date.now();
    const byPath = new Map();
    for (const r of rows) {
        if (!byPath.has(r.path)) byPath.set(r.path, { down: 0, total: 0 });
        const s = byPath.get(r.path);
        s.total += 1;
        if (!r.ok) s.down += 1;
    }
    for (const [pathKey, s] of byPath.entries()) {
        const isDown = s.down >= (Number(ac.minServicesDown) || 2);
        const st = pathAlertState.get(pathKey) || { streak: 0, alerted: false, lastAlertAt: 0 };
        if (isDown) {
            st.streak += 1;
            const cooldownMs = (Number(ac.cooldownMinutes) || 120) * 60 * 1000;
            if (st.streak >= (Number(ac.consecutiveCycles) || 3) && !st.alerted && nowMs - st.lastAlertAt >= cooldownMs) {
                const label = (cfg.paths.find((p) => p.key === pathKey) || {}).label || pathKey;
                const namaLayanan = (global.config && global.config.nama) || "RAF NET";
                const fallback = `🚨 *LAYANAN TERGANGGU via ${label} — ${namaLayanan}*\n\n` +
                    `Jalur *${label}* gagal menjangkau ${s.down}/${s.total} layanan yang dipantau (Instagram/Facebook/Google, dst) beberapa siklus.\n\n` +
                    `Kemungkinan jalur ${label} bermasalah. Detail: halaman */upstream-quality* (matriks Layanan × Jalur).`;
                let text = fallback;
                try {
                    const { renderResponseTemplate } = require("./response-template-helper");
                    text = renderResponseTemplate("svc_alert_down", fallback, {
                        jalur: label, jumlah_down: s.down, jumlah_total: s.total, nama_layanan: namaLayanan
                    });
                } catch (_e) { /* pakai fallback */ }
                await deliver(cfg, text, deps);
                st.alerted = true;
                st.lastAlertAt = nowMs;
                try {
                    const repo = deps.repo || getUpstreamQualityRepository();
                    if (repo && typeof repo.addIncident === "function") {
                        await repo.addIncident({ path: pathKey, kind: "service-down", detail: { down: s.down, total: s.total } });
                    }
                } catch (_e) { /* audit best-effort */ }
            }
        } else {
            st.streak = 0;
            st.alerted = false;
        }
        pathAlertState.set(pathKey, st);
    }
}

async function deliver(cfg, text, deps) {
    try {
        const send = deps.send || require("./whatsapp-critical-delivery").sendCritical;
        const getAdminJids = deps.getAdminJids || require("./admin-recipients").getAdminJids;
        const recipients = new Set();
        if (cfg.alerts.notifyAdmins !== false) (getAdminJids() || []).forEach((j) => recipients.add(j));
        normalizeRecipients(cfg.alerts.recipients).forEach((j) => recipients.add(j));
        for (const jid of recipients) {
            try { await send(jid, { text }, { label: "svc-alert", waitForReadyMs: 8000 }); } catch (_e) { /* lanjut */ }
        }
    } catch (_e) { /* never-throw */ }
}

// Minimum sampel — SELARAS dengan saudara kandungnya, poller jalur (`minSamples: 3`).
//
// Dulu satu-satunya penjaga adalah `!row.samples` (nol sampel). Dengan SATU sampel yang
// kebetulan gagal, okRate = 0 → vonis "DOWN". Satu kegagalan DNS di host prober menandai
// 7 layanan x 4 jalur gagal serentak, lalu setiap pelanggan yang bertanya diberi tahu
// "jaringan kami sedang ada kendala" — padahal yang bermasalah alat ukurnya, bukan jaringan.
//
// "Belum cukup bukti" BUKAN "terlihat buruk": di bawah ambang ini vonisnya UNKNOWN, dan
// pemanggil (app-aware-diagnosis) sudah memperlakukan UNKNOWN sebagai "tak berkomentar".
const MIN_SAMPLES_VERDICT = 3;

function verdictFor(row, timeoutMs) {
    if (!row || !row.samples) return "UNKNOWN";
    if (Number(row.samples) < MIN_SAMPLES_VERDICT) return "UNKNOWN";
    const okRate = Number(row.ok_count) / Number(row.samples);
    if (okRate <= 0.01) return "DOWN";
    if (okRate < 0.8) return "TERGANGGU";
    // Lambat bila TLS handshake mendekati/≥ setengah timeout.
    const tls = row.tls_avg == null ? null : Number(row.tls_avg);
    if (tls != null && tls >= timeoutMs * 0.5) return "LAMBAT";
    return "OK";
}

/** Laporan matriks Layanan × Jalur untuk endpoint/panel. `deps` untuk test. */
async function buildServiceReport(deps = {}) {
    const cfg = deps.config || getServiceConfig();
    const repo = deps.repo || getUpstreamQualityRepository();
    const nowMs = deps.nowMs || Date.now();
    const windowSinceIso = new Date(nowMs - cfg.statusWindowMinutes * 60 * 1000).toISOString();
    const summary = typeof repo.getServiceSummary === "function" ? await repo.getServiceSummary({ windowSinceIso }) : [];
    const byKey = new Map();
    summary.forEach((s) => byKey.set(`${s.service}|${s.path}`, s));

    const services = cfg.services.map((svc) => {
        const cells = cfg.paths.map((p) => {
            const s = byKey.get(`${svc.key}|${p.key}`);
            return {
                path: p.key,
                samples: s ? Number(s.samples) : 0,
                ok_pct: s && s.samples ? Math.round((Number(s.ok_count) / Number(s.samples)) * 1000) / 10 : null,
                connect_ms: s && s.connect_avg != null ? Math.round(Number(s.connect_avg)) : null,
                tls_ms: s && s.tls_avg != null ? Math.round(Number(s.tls_avg)) : null,
                verdict: verdictFor(s, cfg.timeoutMs)
            };
        });
        // Verdict RELATIF: sebuah jalur "OK" tapi jauh lebih lambat dari jalur TERBAIK layanan
        // ini (≥3× best & ≥300ms) → LAMBAT. Menangkap "Facebook via MNI 711ms vs GMDP 68ms".
        const okLat = cells.filter((c) => (c.verdict === "OK" || c.verdict === "LAMBAT") && c.tls_ms != null).map((c) => c.tls_ms);
        if (okLat.length) {
            const best = Math.min(...okLat);
            cells.forEach((c) => {
                if (c.verdict === "OK" && c.tls_ms != null && c.tls_ms >= Math.max(best * 3, 300)) {
                    c.verdict = "LAMBAT";
                }
            });
        }
        return { key: svc.key, label: svc.label || svc.key, host: svc.host, cells };
    });
    return {
        generated_at: new Date(nowMs).toISOString(),
        enabled: cfg.enabled,
        window_minutes: cfg.statusWindowMinutes,
        paths: cfg.paths.map((p) => ({ key: p.key, label: p.label || p.key })),
        services,
        prober: { ...stats }
    };
}

function startServiceProber() {
    if (isRunning) { console.log("[SvcProber] Sudah berjalan"); return; }
    const cfg = getServiceConfig();
    if (!cfg.enabled) { console.log("[SvcProber] Nonaktif (set config.serviceMonitor.enabled=true)"); return; }
    if (!cfg.valid) { console.warn("[SvcProber] Aktif tapi belum ada jalur ber-srcIp — tidak dijalankan."); return; }

    console.log(`[SvcProber] Start (interval ${Math.round(cfg.intervalMs / 1000)}s, ${cfg.services.length} layanan × ${cfg.paths.length} jalur)`);
    stats.started_at = new Date().toISOString();
    isRunning = true;

    initialTimer = setTimeout(() => { probeCycle().catch(() => {}); }, 6000);
    if (initialTimer.unref) initialTimer.unref();
    pollTimer = setInterval(() => { probeCycle().catch(() => {}); }, cfg.intervalMs);
    if (pollTimer.unref) pollTimer.unref();

    const doPrune = () => {
        try { getUpstreamQualityRepository().pruneOld(cfg.retentionDays).catch(() => {}); } catch (_e) { /* jangan jatuhkan */ }
    };
    pruneTimer = setInterval(doPrune, 24 * 60 * 60 * 1000);
    if (pruneTimer.unref) pruneTimer.unref();
}

function stopServiceProber() {
    if (pollTimer) clearInterval(pollTimer);
    if (pruneTimer) clearInterval(pruneTimer);
    if (initialTimer) clearTimeout(initialTimer);
    pollTimer = pruneTimer = initialTimer = null;
    isRunning = false;
}

function getProberStats() {
    return { ...stats, is_running: isRunning, is_polling: isPolling };
}

module.exports = {
    startServiceProber,
    stopServiceProber,
    probeCycle,
    buildServiceReport,
    getProberStats,
    getServiceConfig,
    _internal: { probeConnect, verdictFor, evaluateAlerts, normalizeRecipients, DEFAULT_SERVICES, resetAlertState: () => pathAlertState.clear() }
};
