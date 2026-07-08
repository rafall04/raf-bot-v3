/**
 * Header Doc
 * Purpose: Rangkuman data ISP on-demand untuk perintah WA owner/admin ("data gmdp", "data isp",
 *          "rapor isp") — gabungan: status terkini per jalur (vonis + segmen + loss/RTT per arah
 *          + gateway + utilisasi), matriks layanan populer (TCP+TLS via prober), rapor 24 jam &
 *          7 hari (availability/loss/RTT/sakit%/flap dari getIspReport), kondisi alert
 *          (SEHAT/SAKIT sejak kapan), insiden terakhir, dan VONIS keseluruhan "OK / perlu
 *          perhatian". READ-ONLY murni — tidak menyentuh router/saldo/state.
 * Caller: `message/handlers/raf-intent-dispatch/owner-admin-intents.js` (intent `DATA_ISP`).
 * Deps: lazy `lib/upstream-quality-poller` (getMonitorConfig/buildStatusReport),
 *       `repositories/upstream-quality.repository` (getIspReport/getIncidents),
 *       `lib/upstream-quality-alerter` (getAlertStates + formatter arah/kesimpulan/layanan).
 * MainFuncs: `buildIspDataSummary`, `buildIspOverview`, `resolvePathArg`.
 * SideEffects: Tidak ada (query SQLite + baca state in-memory saja).
 */
"use strict";

const STATUS_EMOJI = { NORMAL: "🟢", DEGRADASI: "🟠", GANGGUAN: "🔴", PUTUS: "⛔", UNKNOWN: "⚪" };

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
        nowMs: () => Date.now()
    };
}

function fmt(n, digits = 0) {
    return n == null ? "-" : Number(n).toFixed(digits);
}

function fmtTime(ms) {
    return new Date(ms).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" });
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

function parseDetail(raw) {
    if (raw == null) return null;
    if (typeof raw === "object") return raw;
    try { return JSON.parse(raw); } catch (_e) { return null; }
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

        const report = await deps.buildStatusReport();
        const entry = (report.paths || []).find((p) => p.key === pathKey) || null;
        const status = (entry && entry.status) || "UNKNOWN";

        const repo = deps.getRepo();
        let isp24 = null;
        let isp7 = null;
        try {
            const rows24 = await repo.getIspReport({ sinceIso: new Date(nowMs - 24 * 60 * 60 * 1000).toISOString(), lossWarnPct: (cfg.thresholds || {}).lossWarnPct || 5 });
            isp24 = (rows24 || []).find((r) => r.path === pathKey) || null;
            const rows7 = await repo.getIspReport({ sinceIso: new Date(nowMs - 7 * 24 * 60 * 60 * 1000).toISOString(), lossWarnPct: (cfg.thresholds || {}).lossWarnPct || 5 });
            isp7 = (rows7 || []).find((r) => r.path === pathKey) || null;
        } catch (_e) { /* rapor best-effort */ }

        // Kondisi alert (SAKIT sejak kapan) dari state alerter.
        let alertLine = "";
        try {
            const st = (deps.getAlertStates() || {})[pathKey];
            if (st && st.condition === "SICK") {
                alertLine = `\n⚠️ Status alert: *SEDANG GANGGUAN* sejak ${st.sickSince ? fmtTime(st.sickSince) : "-"} (level ${st.lastLevel || "-"})`;
            }
        } catch (_e) { /* state best-effort */ }

        const vonis = overallVerdict({ status, isp24 });

        let out = `${STATUS_EMOJI[status] || "⚪"} *DATA JALUR ${String(label).toUpperCase()}*` +
            (pathCfg.tunnelType ? ` _(tunnel ${String(pathCfg.tunnelType).toUpperCase()})_` : "") +
            `\n\n📋 *Keseluruhan: ${vonis.ok ? "✅" : "🔴"} ${vonis.text}*` +
            (pathCfg.affects ? `\n• Terdampak: ${pathCfg.affects}` : "") +
            `\n• Status kini: *${status}*${entry && entry.segment_label && entry.segment !== "SEHAT" && entry.segment !== "UNKNOWN" ? ` — ${entry.segment_label}` : ""}` +
            alertLine;

        // Rincian arah + utilisasi (formatter sama dengan alert → konsisten dibaca owner).
        try { out += deps.buildDirectionText(cfg, pathKey, entry); } catch (_e) { /* best-effort */ }
        // Matriks layanan populer via jalur ini (IG/FB/WA/TikTok/dll).
        try { out += await deps.buildServiceSection(pathKey); } catch (_e) { /* best-effort */ }
        // Kesimpulan segmen lugas bila sedang tidak sehat.
        try { out += deps.buildConclusionText(cfg, pathKey, entry); } catch (_e) { /* best-effort */ }

        out += `\n\n📈 *Rapor ${label}:*` + raporLine("24 jam", isp24) + raporLine("7 hari", isp7);

        // Insiden terakhir jalur ini (maks 3) — jejak kronologis.
        try {
            const incidents = await repo.getIncidents({ limit: 200 });
            const mine = (incidents || []).filter((i) => i.path === pathKey).slice(0, 3);
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

            out += `\n\n${STATUS_EMOJI[status] || "⚪"} *${p.label || p.key}* — ${vonis.ok ? "✅" : "🔴"} ${vonis.text}` +
                `\n   kini: loss ${fmt(lossNow)}% • RTT ${fmt(rttNow)}ms` +
                (entry && entry.segment_label && entry.segment !== "SEHAT" && entry.segment !== "UNKNOWN" ? ` • ${entry.segment_label}` : "") +
                (st && st.condition === "SICK" ? `\n   ⚠️ gangguan berjalan sejak ${st.sickSince ? fmtTime(st.sickSince) : "-"}` : "") +
                (isp24 ? `\n   24 jam: avail ${fmt(isp24.availability_pct, 1)}% • bermasalah ${fmt(isp24.sick_pct)}% waktu • flap ${isp24.flaps || 0}×` : `\n   24 jam: belum ada data`);
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
    _internal: { overallVerdict, raporLine, STATUS_EMOJI }
};
