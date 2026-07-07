/**
 * Header Doc
 * Purpose: Alert WhatsApp saat jalur upstream sakit beruntun (loss-based, anti-flap) dan notif
 *          pulih — transisi state per jalur: SEHAT → (N siklus sakit beruntun) → alert SAKIT →
 *          (M siklus sehat beruntun) → notif PULIH. Termasuk saran steer saat jalur MNI sakit
 *          sementara backup SF sehat (router TIDAK failover otomatis pada degradasi kualitas —
 *          route interface tetap "active" selama tunnel hidup walau lossy).
 * Caller: `lib/upstream-quality-poller.js` (setelah tiap siklus sukses; gate
 *         `config.upstreamMonitor.alerts.enabled === true`, default MATI).
 * Deps: `repositories/upstream-quality.repository`, `lib/whatsapp-critical-delivery.sendCritical`,
 *       `lib/admin-recipients.getAdminJids`, `lib/response-template-helper.renderResponseTemplate`.
 * MainFuncs: `evaluateAfterCycle`, `getAlertStates`, `resetAlertStatesForTest`.
 * SideEffects: Kirim pesan WhatsApp ke admin (+ grup opsional); state transisi in-memory
 *              (single-instance). Tidak pernah throw ke caller.
 */
"use strict";

const SICK_LEVELS = { PUTUS: 3, GANGGUAN: 2, DEGRADASI: 1, NORMAL: 0 };

// State per jalur: { condition: 'HEALTHY'|'SICK', sickSince, lastAlertAt, lastLevel }
const pathStates = new Map();

function defaultDeps() {
    return {
        getRepo: () => require("../repositories/upstream-quality.repository").getUpstreamQualityRepository(),
        send: (jid, text, opts) => require("./whatsapp-critical-delivery").sendCritical(jid, text, opts),
        getAdminJids: () => require("./admin-recipients").getAdminJids(),
        renderResponseTemplate: (key, fallback, data) => require("./response-template-helper").renderResponseTemplate(key, fallback, data),
        nowMs: () => Date.now()
    };
}

/** Level sakit satu SIKLUS satu jalur dari rata-rata loss lintas target (alert loss-based v1). */
function cycleLevel(lossAvg, thresholds) {
    if (lossAvg == null) return "NORMAL";
    if (lossAvg >= 99) return "PUTUS";
    if (lossAvg >= thresholds.lossCritPct) return "GANGGUAN";
    if (lossAvg >= thresholds.lossWarnPct) return "DEGRADASI";
    return "NORMAL";
}

/** Kelompokkan baris probe → per jalur: deret siklus terurut waktu naik [{at, lossAvg, rttAvg}]. */
function buildCycleSeries(rows) {
    const byPathCycle = new Map();
    for (const r of rows) {
        const key = `${r.path}|${r.probed_at}`;
        if (!byPathCycle.has(key)) {
            byPathCycle.set(key, { path: r.path, at: r.probed_at, losses: [], rtts: [] });
        }
        const c = byPathCycle.get(key);
        if (r.loss_pct != null) c.losses.push(Number(r.loss_pct));
        if (r.rtt_avg_ms != null) c.rtts.push(Number(r.rtt_avg_ms));
    }
    const perPath = new Map();
    for (const c of byPathCycle.values()) {
        if (!perPath.has(c.path)) perPath.set(c.path, []);
        perPath.get(c.path).push({
            at: c.at,
            lossAvg: c.losses.length ? c.losses.reduce((a, b) => a + b, 0) / c.losses.length : null,
            rttAvg: c.rtts.length ? c.rtts.reduce((a, b) => a + b, 0) / c.rtts.length : null
        });
    }
    for (const series of perPath.values()) {
        series.sort((a, b) => a.at.localeCompare(b.at));
    }
    return perPath;
}

function pathLabel(cfg, key) {
    const p = (cfg.paths || []).find((x) => x.key === key);
    return (p && p.label) || key;
}

function fmt(n, digits = 0) {
    return n == null ? "-" : Number(n).toFixed(digits);
}

function formatDurationMin(ms) {
    const menit = Math.max(1, Math.round(ms / 60000));
    if (menit < 60) return `${menit} menit`;
    return `${Math.floor(menit / 60)} jam ${menit % 60} menit`;
}

/** Normalisasi daftar penerima config (nomor 08x/62x/JID) → JID unik. */
function normalizeRecipients(list) {
    const out = [];
    (Array.isArray(list) ? list : []).forEach((raw) => {
        const s = String(raw || "").trim();
        if (!s) return;
        if (s.endsWith("@s.whatsapp.net") || s.endsWith("@g.us")) {
            out.push(s);
            return;
        }
        let digits = s.replace(/\D/g, "");
        if (digits.startsWith("0")) digits = `62${digits.slice(1)}`;
        if (digits.length >= 10 && digits.startsWith("62")) out.push(`${digits}@s.whatsapp.net`);
    });
    return out;
}

async function deliver(deps, alertsCfg, text) {
    const recipients = new Set();
    if (alertsCfg.notifyAdmins !== false) {
        try {
            (deps.getAdminJids() || []).forEach((j) => recipients.add(j));
        } catch (_e) { /* daftar admin best-effort */ }
    }
    normalizeRecipients(alertsCfg.recipients).forEach((j) => recipients.add(j));
    if (alertsCfg.groupJid && String(alertsCfg.groupJid).endsWith("@g.us")) {
        recipients.add(String(alertsCfg.groupJid));
    }
    if (!recipients.size) {
        console.warn("[UPQ-Alert] TIDAK ADA PENERIMA — isi phone_number akun admin (accounts.json) atau upstreamMonitor.alerts.recipients.");
        return 0;
    }
    let delivered = 0;
    for (const jid of recipients) {
        try {
            // PENTING: payload WAJIB objek { text } (kontrak sendCritical/gateway.sendPayload)
            // — string polos membuat Baileys crash "Cannot use 'in' operator" (bug 07-07,
            // alert masuk dead-letter database/failed_critical_deliveries.json).
            const result = await deps.send(jid, { text }, { label: "upq-alert", waitForReadyMs: 8000 });
            if (!result || result.delivered !== false) delivered += 1;
        } catch (err) {
            // Notifikasi tidak boleh menjatuhkan alur — log lalu lanjut.
            console.warn(`[UPQ-Alert] Gagal kirim ke ${jid}: ${err.message}`);
        }
    }
    console.log(`[UPQ-Alert] terkirim ${delivered}/${recipients.size} penerima`);
    return delivered;
}

/**
 * Evaluasi setelah satu siklus probe tersimpan. Gate: cfg.alerts.enabled === true.
 * `deps` bisa dioverride untuk test. Tidak pernah throw.
 */
async function evaluateAfterCycle(cfg, depsOverride = {}) {
    try {
        const alertsCfg = cfg && cfg.alerts;
        if (!alertsCfg || alertsCfg.enabled !== true) {
            return { skipped: true, reason: "disabled" };
        }
        const deps = { ...defaultDeps(), ...depsOverride };
        const thresholds = cfg.thresholds || { lossWarnPct: 5, lossCritPct: 20 };
        const needSick = Math.max(1, Number(alertsCfg.consecutiveCycles) || 3);
        const needHealthy = Math.max(1, Number(alertsCfg.recoveryCycles) || 3);
        const cooldownMs = (Math.max(0, Number(alertsCfg.cooldownMinutes) || 120)) * 60 * 1000;
        const nowMs = deps.nowMs();

        // Ambil siklus secukupnya (window longgar 2× kebutuhan agar aman dari jitter interval).
        const lookbackMs = Math.max(needSick, needHealthy) * (cfg.intervalMs || 60000) * 2 + 5 * 60 * 1000;
        const repo = deps.getRepo();
        const rows = await repo.getRecentProbes({
            sinceIso: new Date(nowMs - lookbackMs).toISOString(),
            limit: 5000
        });
        const perPath = buildCycleSeries(rows);
        const namaLayanan = (global.config && global.config.nama) || "RAF NET";
        const actions = [];

        for (const [pathKey, series] of perPath.entries()) {
            const state = pathStates.get(pathKey) || { condition: "HEALTHY", sickSince: null, lastAlertAt: 0, lastLevel: "NORMAL" };
            const levels = series.map((c) => cycleLevel(c.lossAvg, thresholds));
            const latest = series[series.length - 1];

            if (state.condition === "HEALTHY") {
                const tail = levels.slice(-needSick);
                const allSick = tail.length >= needSick && tail.every((l) => SICK_LEVELS[l] >= SICK_LEVELS.DEGRADASI);
                if (allSick && nowMs - state.lastAlertAt >= cooldownMs) {
                    // Level alert = level terburuk pada deret pemicu.
                    const worst = tail.reduce((w, l) => (SICK_LEVELS[l] > SICK_LEVELS[w] ? l : w), "DEGRADASI");

                    // Isi slot ${saran}: (1) perkiraan SEGMEN penyebab + loss gateway + utilisasi
                    // (dari laporan status — membedakan link penuh vs last-mile vs sisi ISP),
                    // (2) saran steer MNI→SF, (3) info traceroute bukti. Semua best-effort.
                    let saran = "";
                    if (typeof deps.getPathStatus === "function") {
                        try {
                            const entry = await deps.getPathStatus(pathKey);
                            if (entry && entry.segment_label && entry.segment !== "SEHAT" && entry.segment !== "UNKNOWN") {
                                saran += `\n• Perkiraan segmen: *${entry.segment_label}*`;
                            }
                            if (entry && entry.gateway && entry.gateway.loss_avg_pct != null) {
                                saran += `\n• Loss ke gateway ISP: ${entry.gateway.loss_avg_pct}%`;
                            }
                            if (entry && entry.wan && (entry.wan.util_down_max_pct != null || entry.wan.util_up_max_pct != null)) {
                                const dn = entry.wan.util_down_max_pct == null ? "-" : `${entry.wan.util_down_max_pct}%`;
                                const up = entry.wan.util_up_max_pct == null ? "-" : `${entry.wan.util_up_max_pct}%`;
                                saran += `\n• Utilisasi link: ↓${dn} / ↑${up}`;
                            }
                        } catch (_e) { /* enrich best-effort */ }
                    }
                    // Saran steer: MNI sakit sementara SF sehat pada siklus terakhir.
                    if (alertsCfg.includeSteerSuggestion !== false && pathKey === "mni") {
                        const sfSeries = perPath.get("sf") || [];
                        const sfLatest = sfSeries[sfSeries.length - 1];
                        if (sfLatest && cycleLevel(sfLatest.lossAvg, thresholds) === "NORMAL") {
                            saran += `\n💡 Backup *SF* terpantau sehat (loss ${fmt(sfLatest.lossAvg)}%, RTT ${fmt(sfLatest.rttAvg)}ms). Router TIDAK failover otomatis saat degradasi (hanya saat tunnel mati) — pertimbangkan steer manual MNI→SF bila berlanjut.`;
                        }
                    }
                    if (typeof deps.requestTrace === "function") {
                        saran += "\n🔎 Traceroute bukti hop dijalankan otomatis — lihat *Insiden* di halaman /upstream-quality.";
                    }
                    const teks = deps.renderResponseTemplate(
                        "upq_alert_down",
                        `🚨 *JALUR UPSTREAM ${worst} — ${namaLayanan}*\n\n` +
                        `Jalur *${pathLabel(cfg, pathKey)}* terpantau bermasalah ${needSick} siklus beruntun:\n` +
                        `• Loss: ${fmt(latest.lossAvg)}%\n` +
                        `• RTT: ${fmt(latest.rttAvg)}ms\n` +
                        `• Sejak: ${new Date(series[Math.max(0, series.length - needSick)].at).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "medium" })}${saran}\n\n` +
                        `Detail: halaman */upstream-quality* di panel admin.`,
                        {
                            jalur: pathLabel(cfg, pathKey),
                            level: worst,
                            loss: fmt(latest.lossAvg),
                            rtt: fmt(latest.rttAvg),
                            saran,
                            nama_layanan: namaLayanan
                        }
                    );
                    const sentTo = await deliver(deps, alertsCfg, teks);
                    pathStates.set(pathKey, { condition: "SICK", sickSince: nowMs, lastAlertAt: nowMs, lastLevel: worst });
                    actions.push({ path: pathKey, action: "alert", level: worst, sentTo });

                    // Bukti + kronologi: traceroute otomatis (fire-and-forget) & insiden alert.
                    if (typeof deps.requestTrace === "function") {
                        try { Promise.resolve(deps.requestTrace(pathKey)).catch(() => {}); } catch (_e) { /* best-effort */ }
                    }
                    try {
                        const repo = deps.getRepo();
                        if (repo && typeof repo.addIncident === "function") {
                            await repo.addIncident({
                                path: pathKey,
                                kind: "alert",
                                detail: { level: worst, loss_avg: latest.lossAvg, rtt_avg: latest.rttAvg }
                            });
                        }
                    } catch (_e) { /* insiden best-effort */ }
                } else {
                    pathStates.set(pathKey, state);
                }
            } else {
                const tail = levels.slice(-needHealthy);
                const allHealthy = tail.length >= needHealthy && tail.every((l) => l === "NORMAL");
                if (allHealthy) {
                    const durasi = state.sickSince ? formatDurationMin(nowMs - state.sickSince) : "-";
                    const teks = deps.renderResponseTemplate(
                        "upq_alert_recovered",
                        `✅ *JALUR UPSTREAM PULIH — ${namaLayanan}*\n\n` +
                        `Jalur *${pathLabel(cfg, pathKey)}* kembali normal (loss ${fmt(latest.lossAvg)}%, RTT ${fmt(latest.rttAvg)}ms).\n` +
                        `Durasi gangguan: ±${durasi}.`,
                        {
                            jalur: pathLabel(cfg, pathKey),
                            loss: fmt(latest.lossAvg),
                            rtt: fmt(latest.rttAvg),
                            durasi,
                            nama_layanan: namaLayanan
                        }
                    );
                    const sentTo = await deliver(deps, alertsCfg, teks);
                    pathStates.set(pathKey, { condition: "HEALTHY", sickSince: null, lastAlertAt: state.lastAlertAt, lastLevel: "NORMAL" });
                    actions.push({ path: pathKey, action: "recovered", sentTo });
                } else {
                    pathStates.set(pathKey, state);
                }
            }
        }

        return { skipped: false, actions };
    } catch (err) {
        console.warn(`[UPQ-Alert] Evaluasi gagal: ${err.message}`);
        return { skipped: true, reason: "error", error: err.message };
    }
}

function getAlertStates() {
    const out = {};
    for (const [k, v] of pathStates.entries()) out[k] = { ...v };
    return out;
}

function resetAlertStatesForTest() {
    pathStates.clear();
}

module.exports = {
    evaluateAfterCycle,
    getAlertStates,
    resetAlertStatesForTest,
    _internal: { cycleLevel, buildCycleSeries, normalizeRecipients }
};
