/**
 * Header Doc
 * Purpose: Alert WhatsApp saat jalur upstream sakit beruntun (loss-based, anti-flap) dan notif
 *          pulih — transisi state per jalur: SEHAT → (N siklus sakit beruntun) → alert SAKIT →
 *          (M siklus sehat beruntun) → notif PULIH. Isi alert SPESIFIK-ARAH: rincian loss per
 *          target (Google/Cloudflare) vs gateway ISP, kesimpulan segmen bahasa lugas (termasuk
 *          "blip singkat" jujur saat window 15mnt mayoritas bersih — anti kontradiksi), konteks
 *          flap tunnel (re-dial 24 jam), HASIL
 *          traceroute inline (hop pertama yang loss), daftar solusi konkret per-ISP, dan opsi
 *          switch (cek kesehatan backup dulu). Level siklus dihitung dari target JAUH saja
 *          (ping gateway dipisah — kalau dicampur, loss headline terdilusi gateway yang bersih).
 *          State alert di-rehidrasi dari insiden supaya restart bot tidak menyebabkan alert dobel.
 * Caller: `lib/upstream-quality-poller.js` (setelah tiap siklus sukses; gate
 *         `config.upstreamMonitor.alerts.enabled === true`, default MATI).
 * Deps: `repositories/upstream-quality.repository`, `lib/whatsapp-critical-delivery.sendCritical`,
 *       `lib/admin-recipients.getAdminJids`, `lib/response-template-helper.renderResponseTemplate`,
 *       lazy `lib/upstream-affected-service.getAffectedSet` (baris "Terdampak" LIVE menggantikan
 *       string statis `paths[].affects`; best-effort, absen/gagal → fallback statis),
 *       lazy `lib/service-reachability-prober.buildServiceReport` (seksi layanan populer per jalur
 *       — Meta/TikTok/Google via TCP+TLS; gate `config.serviceMonitor.enabled`).
 * MainFuncs: `evaluateAfterCycle`, `getAlertStates`, `resetAlertStatesForTest`.
 * SideEffects: Kirim pesan WhatsApp ke admin (+ grup opsional); menunggu traceroute terbatas
 *              (`alerts.traceWaitSeconds`, sekali per alert — bisa menunda 1 siklus poll);
 *              tulis insiden kind `alert`/`alert_recovered`; state in-memory (single-instance).
 *              Tidak pernah throw ke caller.
 */
"use strict";

const SICK_LEVELS = { PUTUS: 3, GANGGUAN: 2, DEGRADASI: 1, NORMAL: 0 };

// State per jalur: { condition: 'HEALTHY'|'SICK', sickSince, lastAlertAt, lastLevel }
const pathStates = new Map();
let rehydrated = false;

function defaultDeps() {
    return {
        getRepo: () => require("../repositories/upstream-quality.repository").getUpstreamQualityRepository(),
        send: (jid, text, opts) => require("./whatsapp-critical-delivery").sendCritical(jid, text, opts),
        getAdminJids: () => require("./admin-recipients").getAdminJids(),
        renderResponseTemplate: (key, fallback, data) => require("./response-template-helper").renderResponseTemplate(key, fallback, data),
        // Himpunan pelanggan terdampak LIVE (siapa yang jalur-nya di sini sekarang) — menggantikan
        // string statis paths[].affects. Best-effort: never-throw, absen dep → fallback statis.
        getAffectedSet: (path) => require("./upstream-affected-service").getAffectedSet(path),
        nowMs: () => Date.now()
    };
}

/** Ambil himpunan terdampak LIVE (best-effort). Absen dep / gagal → null (pemanggil fallback statis). */
async function resolveAffected(deps, pathKey) {
    if (!deps || typeof deps.getAffectedSet !== "function") return null;
    try {
        return await deps.getAffectedSet(pathKey);
    } catch (_e) {
        return null;
    }
}

/** Level sakit satu SIKLUS satu jalur dari rata-rata loss lintas target JAUH. */
function cycleLevel(lossAvg, thresholds) {
    if (lossAvg == null) return "NORMAL";
    if (lossAvg >= 99) return "PUTUS";
    if (lossAvg >= thresholds.lossCritPct) return "GANGGUAN";
    if (lossAvg >= thresholds.lossWarnPct) return "DEGRADASI";
    return "NORMAL";
}

/**
 * Kelompokkan baris probe → per jalur: deret siklus terurut waktu naik [{at, lossAvg, rttAvg}].
 * HANYA target jauh (target_key != 'gateway') — gateway bersih tidak boleh mendilusi loss.
 */
function buildCycleSeries(rows) {
    const byPathCycle = new Map();
    for (const r of rows) {
        if (String(r.target_key || "") === "gateway") continue;
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

function pathCfgOf(cfg, key) {
    return ((cfg && cfg.paths) || []).find((x) => x.key === key) || null;
}

function pathLabel(cfg, key) {
    const p = pathCfgOf(cfg, key);
    return (p && p.label) || key;
}

function targetLabelOf(cfg, targetKey, address) {
    const t = ((cfg && cfg.targets) || []).find((x) => (x.key || x.address) === targetKey);
    return (t && t.label) || targetKey || address || "target";
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
            // PENTING: payload WAJIB objek { text } (kontrak sendCritical/gateway.sendPayload).
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

function parseDetail(raw) {
    if (raw == null) return null;
    if (typeof raw === "object") return raw;
    try { return JSON.parse(raw); } catch (_e) { return null; }
}

/**
 * Rehidrasi state dari insiden alert/alert_recovered TERAKHIR per jalur (sekali per proses):
 * restart bot saat jalur masih SAKIT tidak boleh memicu alert dobel, dan notif PULIH tetap
 * terkirim setelah restart.
 */
async function rehydrateFromIncidents(deps) {
    if (rehydrated) return;
    rehydrated = true;
    try {
        const repo = deps.getRepo();
        if (!repo || typeof repo.getIncidents !== "function") return;
        const incidents = await repo.getIncidents({ limit: 200 }); // terurut DESC
        const seen = new Set();
        for (const inc of incidents) {
            if (inc.kind !== "alert" && inc.kind !== "alert_recovered") continue;
            if (seen.has(inc.path)) continue;
            seen.add(inc.path);
            const atMs = Date.parse(inc.created_at);
            if (!Number.isFinite(atMs)) continue;
            const d = parseDetail(inc.detail) || {};
            if (inc.kind === "alert") {
                pathStates.set(inc.path, {
                    condition: "SICK",
                    sickSince: atMs,
                    lastAlertAt: atMs,
                    lastLevel: d.level || "DEGRADASI"
                });
            } else {
                pathStates.set(inc.path, {
                    condition: "HEALTHY",
                    sickSince: null,
                    lastAlertAt: Number(d.last_alert_at) || atMs,
                    lastLevel: "NORMAL"
                });
            }
        }
    } catch (err) {
        console.warn(`[UPQ-Alert] Rehidrasi state gagal (lanjut state kosong): ${err.message}`);
    }
}

/** Tunggu traceroute terbatas waktu — hasil null bila belum selesai/gagal (alert tetap jalan). */
function awaitTraceBounded(promise, waitMs) {
    if (waitMs <= 0) return Promise.resolve(null);
    return Promise.race([
        Promise.resolve(promise).catch(() => null),
        new Promise((resolve) => {
            const t = setTimeout(() => resolve(null), waitMs);
            if (t.unref) t.unref();
        })
    ]);
}

/** Baris "🔎 Traceroute …" dari hasil runTraceProbe (hops inline; fallback pointer Insiden). */
function buildTraceText(cfg, pathKey, trace) {
    const jalur = pathLabel(cfg, pathKey);
    if (!trace || trace.ok !== true) {
        return `\n🔎 Traceroute otomatis dijalankan — hasil tersimpan di *Insiden* halaman /upstream-quality.`;
    }
    const target = trace.target || "target";
    const hops = Array.isArray(trace.hops) ? trace.hops : [];
    if (trace.firstBadHop && trace.firstBadHop.address) {
        const idx = hops.findIndex((h) => h && h.address === trace.firstBadHop.address);
        const nomor = idx >= 0 ? idx + 1 : "?";
        const sebelum = idx > 0 ? hops[idx - 1] : null;
        const sebelumText = sebelum && sebelum.address
            ? ` Hop sebelumnya (${sebelum.address}) bersih ${fmt(sebelum.loss_pct)}% loss.`
            : "";
        return `\n🔎 Traceroute via ${jalur} → ${target}: loss MULAI di hop ${nomor} ` +
            `(${trace.firstBadHop.address}, loss ${fmt(trace.firstBadHop.loss_pct)}%).${sebelumText}`;
    }
    if (hops.length) {
        return `\n🔎 Traceroute via ${jalur} → ${target}: ${hops.length} hop terbalas, tak ada hop dengan loss ≥50% ` +
            `pada 1 putaran — indikasi loss intermiten. Detail hop di *Insiden* /upstream-quality.`;
    }
    return `\n🔎 Traceroute via ${jalur} → ${target}: tidak ada hop terbaca (kemungkinan jalur buntu total). Detail di *Insiden*.`;
}

/**
 * Baris "Terdampak" berbasis data LIVE (siapa yang jalur-nya di sini sekarang), menggantikan string
 * statis `paths[].affects`. `affected` dari `lib/upstream-affected-service.getAffectedSet`:
 * - confidence 'live'    → jumlah + beberapa nama contoh (atau "0 pelanggan" bila kosong);
 * - confidence 'unknown' → jujur "tak bisa dipastikan" (router tak terbaca) — fail-closed;
 * - null/absen (mis. unit test tanpa dep) → fallback ke `paths[].affects` statis (kompat mundur).
 */
function buildAffectedLine(cfg, pathKey, affected) {
    if (affected && affected.confidence === "live" && affected.count != null) {
        if (affected.count === 0) {
            return `\n• Terdampak: *0 pelanggan* aktif di jalur ini saat ini`;
        }
        const names = (affected.customers || []).map((c) => c && c.name).filter(Boolean).slice(0, 3);
        const sisa = affected.count - names.length;
        const namesTxt = names.length ? ` — ${names.join(", ")}${sisa > 0 ? ` +${sisa} lagi` : ""}` : "";
        return `\n• Terdampak: *${affected.count} pelanggan* aktif di jalur ini${namesTxt}`;
    }
    if (affected && affected.confidence === "unknown") {
        return `\n• Terdampak: tak bisa dipastikan (router tak terbaca saat cek)`;
    }
    const pathCfg = pathCfgOf(cfg, pathKey);
    return pathCfg && pathCfg.affects ? `\n• Terdampak: ${pathCfg.affects}` : "";
}

/** Rincian arah: loss/RTT per target jauh + gateway ISP (dari laporan status). */
function buildDirectionText(cfg, pathKey, entry, affected) {
    if (!entry) return "";
    let out = "";
    const targets = Array.isArray(entry.targets) ? entry.targets.filter((t) => t.samples > 0) : [];
    if (targets.length) {
        out += `\n\n📍 *Rincian arah (${cfg.statusWindowMinutes || 15} mnt terakhir):*`;
        for (const t of targets) {
            const label = targetLabelOf(cfg, t.target_key, t.target);
            const baseline = t.baseline_rtt_ms != null && t.rtt_avg_ms != null && t.rtt_avg_ms >= t.baseline_rtt_ms * 1.5
                ? ` (normal ${fmt(t.baseline_rtt_ms)}ms)`
                : "";
            out += `\n• → ${label} (${t.target}): loss *${fmt(t.loss_avg_pct)}%* • RTT ${fmt(t.rtt_avg_ms)}ms${baseline}`;
        }
    }
    if (entry.gateway && entry.gateway.samples > 0) {
        out += `\n• → Gateway ${pathLabel(cfg, pathKey)}${entry.gateway.target ? ` (${entry.gateway.target})` : ""}: ` +
            `loss *${fmt(entry.gateway.loss_avg_pct, 1)}%* • RTT ${fmt(entry.gateway.rtt_avg_ms)}ms`;
    }
    if (entry.wan && (entry.wan.util_down_max_pct != null || entry.wan.util_up_max_pct != null)) {
        const dn = entry.wan.util_down_max_pct == null ? "-" : `${entry.wan.util_down_max_pct}%`;
        const up = entry.wan.util_up_max_pct == null ? "-" : `${entry.wan.util_up_max_pct}%`;
        out += `\n• Utilisasi link: ↓${dn} / ↑${up}`;
    }
    // Konteks flap untuk jalur TUNNEL: bedakan "tunnel re-dial (bounce)" dari "murni upstream".
    // Berbasis telemetri (bukan tebakan): recon P1 menunjukkan sebagian loss tunnel = re-dial.
    const pathCfgDir = pathCfgOf(cfg, pathKey);
    if (pathCfgDir && pathCfgDir.tunnelType && entry.wan && Number(entry.wan.flaps_24h) > 0) {
        out += `\n🔁 Tunnel ${pathCfgDir.iface || pathLabel(cfg, pathKey)} re-dial *${entry.wan.flaps_24h}×* dlm 24 jam — sebagian loss bisa dari bounce tunnel, bukan murni masalah upstream.`;
    }
    out += buildAffectedLine(cfg, pathKey, affected);
    return out;
}

const SVC_VERDICT_ORDER = { DOWN: 0, TERGANGGU: 1, LAMBAT: 2, OK: 3, UNKNOWN: 4 };
const SVC_VERDICT_EMOJI = { DOWN: "⛔", TERGANGGU: "🔴", LAMBAT: "🟠", OK: "🟢", UNKNOWN: "⚪" };

function reportPathLabel(report, key) {
    const p = ((report && report.paths) || []).find((x) => x.key === key);
    return (p && p.label) || key;
}

/**
 * Seksi "layanan populer via <jalur>" dari matriks prober TCP+TLS (Meta/TikTok memblokir ICMP —
 * ini satu-satunya ukuran nyata per layanan). Terburuk dulu; layanan bermasalah diberi pembanding
 * jalur tersehat; bila SEMUA jalur gagal ke layanan itu → vonis gangguan global layanan, bukan ISP.
 * Best-effort: prober mati / jalur tak dipantau → string kosong.
 */
async function buildServiceSectionText(pathKey, deps) {
    try {
        const smCfg = global.config && global.config.serviceMonitor;
        if (!smCfg || smCfg.enabled !== true) return "";
        const getReport = deps.getServiceReport
            || (() => require("./service-reachability-prober").buildServiceReport());
        const report = await getReport();
        if (!report || !Array.isArray(report.services) || !report.services.length) return "";
        if (!((report.paths || []).some((p) => p.key === pathKey))) return "";

        const items = [];
        for (const svc of report.services) {
            const cell = (svc.cells || []).find((c) => c.path === pathKey);
            if (!cell || !cell.samples) continue;
            const sehatLain = (svc.cells || [])
                .filter((c) => c.path !== pathKey && c.verdict === "OK" && c.tls_ms != null);
            const best = sehatLain.length
                ? sehatLain.reduce((m, c) => (c.tls_ms < m.tls_ms ? c : m))
                : null;
            const badEverywhere = (svc.cells || []).length > 1 && (svc.cells || [])
                .every((c) => !c.samples || ["DOWN", "TERGANGGU"].includes(c.verdict));
            items.push({ svc, cell, best, badEverywhere });
        }
        if (!items.length) return "";
        items.sort((a, b) => (SVC_VERDICT_ORDER[a.cell.verdict] ?? 9) - (SVC_VERDICT_ORDER[b.cell.verdict] ?? 9));

        const lines = items.map(({ svc, cell, best, badEverywhere }) => {
            const emoji = SVC_VERDICT_EMOJI[cell.verdict] || "⚪";
            let line = `\n${emoji} ${svc.label}: ${cell.verdict}`;
            if (cell.verdict === "OK") {
                if (cell.tls_ms != null) line += ` (${cell.tls_ms}ms)`;
            } else if (cell.verdict === "LAMBAT") {
                if (cell.tls_ms != null) {
                    line += best
                        ? ` (${cell.tls_ms}ms — via ${reportPathLabel(report, best.path)} cuma ${best.tls_ms}ms)`
                        : ` (${cell.tls_ms}ms)`;
                }
            } else { // DOWN / TERGANGGU / UNKNOWN
                if (cell.ok_pct != null) line += ` (berhasil ${cell.ok_pct}%)`;
                if (badEverywhere) {
                    line += ` — SEMUA jalur gagal → indikasi gangguan ${svc.label} global, BUKAN masalah ISP`;
                } else if (best) {
                    line += ` — via ${reportPathLabel(report, best.path)} normal (${best.tls_ms}ms)`;
                }
            }
            return line;
        });
        return `\n\n🌐 *Layanan populer via ${reportPathLabel(report, pathKey)} (${report.window_minutes || 10} mnt):*` + lines.join("");
    } catch (_e) {
        return "";
    }
}

/** Kesimpulan segmen dalam bahasa lugas — "masalahnya DI MANA". */
function buildConclusionText(cfg, pathKey, entry) {
    if (!entry || !entry.segment) return "";
    const isp = pathLabel(cfg, pathKey);
    const gwLoss = entry.gateway && entry.gateway.loss_avg_pct != null ? `${entry.gateway.loss_avg_pct}%` : "-";
    const pathCfg = pathCfgOf(cfg, pathKey);
    const viaTunnel = pathCfg && pathCfg.tunnelType ? ` (tunnel ${String(pathCfg.tunnelType).toUpperCase()})` : "";
    if (entry.segment === "SEHAT") {
        // Trigger dari 3 siklus terakhir TAPI window 15mnt mayoritas bersih (classifySegment: far<warn)
        // = blip singkat/intermiten. Jujur sebutkan — JANGAN diam (dulu terasa kontradiktif: headline
        // GANGGUAN tanpa kesimpulan). Aman: tetap terkirim, tak menyembunyikan outage.
        const farVals = (entry.targets || []).map((t) => t.loss_avg_pct).filter((v) => v != null);
        const farAvg = farVals.length ? Math.round((farVals.reduce((a, b) => a + b, 0) / farVals.length) * 10) / 10 : null;
        return `\n\n🧭 *Kesimpulan:* dalam ${cfg.statusWindowMinutes || 15} mnt terakhir ${isp} mayoritas BERSIH` +
            `${farAvg != null ? ` (loss rata *${farAvg}%*)` : ""} — pemicu ini *blip singkat/intermiten*, ` +
            `belum tentu gangguan berkelanjutan. Tercatat utk pola; pantau bila berulang.`;
    }
    if (entry.segment === "UPSTREAM_ISP") {
        return `\n\n🧭 *Kesimpulan:* gateway ${isp} BERSIH (loss ${gwLoss}) tapi tujuan luar loss — ` +
            `masalah di SISI ATAS/upstream ${isp}, bukan link Anda dan bukan kejenuhan.`;
    }
    if (entry.segment === "LINK_ISP") {
        return `\n\n🧭 *Kesimpulan:* loss SUDAH terjadi di gateway ${isp} (${gwLoss})${viaTunnel} — ` +
            `masalah di link/last-mile menuju ${isp}, sebelum sampai internet luar.`;
    }
    if (entry.segment === "JENUH") {
        const util = entry.wan
            ? Math.max(entry.wan.util_down_max_pct || 0, entry.wan.util_up_max_pct || 0)
            : null;
        return `\n\n🧭 *Kesimpulan:* link ${isp} PENUH (utilisasi ${util != null ? `${util}%` : "tinggi"}) — ` +
            `loss karena kejenuhan trafik, bukan gangguan ISP.`;
    }
    return "";
}

/**
 * Daftar solusi konkret bernomor per segmen + opsi switch (cek kesehatan backup dulu).
 * `perPath` = deret siklus far utk menilai backup; global.config utk peta switch (best-effort).
 */
function buildSolutionText({ cfg, thresholds, pathKey, entry, perPath, worst }) {
    const isp = pathLabel(cfg, pathKey);
    const langkah = [];
    const segment = entry && entry.segment;
    const gwLoss = entry && entry.gateway && entry.gateway.loss_avg_pct != null ? `${entry.gateway.loss_avg_pct}%` : null;
    const pathCfg = pathCfgOf(cfg, pathKey);

    if (worst === "PUTUS") {
        langkah.push(`Jalur MATI TOTAL — cek interface/tunnel ${isp} di router dan perangkat/link fisiknya sekarang.`);
    } else if (segment === "LINK_ISP") {
        if (pathCfg && pathCfg.tunnelType) {
            langkah.push(`Cek tunnel ${String(pathCfg.tunnelType).toUpperCase()} ke ${isp}: loss ${gwLoss || "-"} sudah terjadi di ujung tunnel — koordinasikan dengan pemilik server tunnel (bukti: ping gateway tunnel).`);
        } else {
            langkah.push(`Cek link fisik ke ${isp} (kabel/perangkat) lalu komplain ${isp} — loss ${gwLoss || "-"} sudah muncul di gateway mereka.`);
        }
    } else if (segment === "UPSTREAM_ISP") {
        langkah.push(`Komplain ke ${isp} dengan bukti: loss ke tujuan luar tinggi sementara gateway bersih (${gwLoss || "0%"}) — masalah murni di upstream mereka.`);
    } else if (segment === "JENUH") {
        langkah.push(`Link ${isp} penuh — kurangi/alihkan sebagian beban atau tambah kapasitas. Komplain ke ISP tidak akan membantu untuk kasus jenuh.`);
    }

    // Opsi switch: pakai peta rule failover bila ada; fallback legacy MNI→SF.
    let switchLabel = null;
    let backupKey = null;
    try {
        const rules = (global.config && global.config.wanFailover && global.config.wanFailover.rules) || [];
        const rule = rules.find((r) => r && r.sickPath === pathKey && r.switchId && r.targetPath);
        if (rule) {
            backupKey = rule.targetPath;
            const switches = (global.config && global.config.wanSwitch && global.config.wanSwitch.switches) || [];
            const sw = switches.find((s) => s && s.id === rule.switchId);
            switchLabel = (sw && (sw.label || sw.id)) || rule.switchId;
        }
    } catch (_e) { /* peta switch best-effort */ }
    if (!backupKey && pathKey === "mni" && perPath.has("sf")) {
        backupKey = "sf";
        switchLabel = "MNI → SF (backup)";
    }
    if (backupKey) {
        const backupSeries = perPath.get(backupKey) || [];
        const backupLatest = backupSeries[backupSeries.length - 1] || null;
        const backupLevel = backupLatest ? cycleLevel(backupLatest.lossAvg, thresholds) : null;
        const backupLabel = pathLabel(cfg, backupKey);
        if (backupLevel === "NORMAL") {
            langkah.push(`Alihkan sementara: balas *switch koneksi* → pilih *${switchLabel || backupLabel}* — backup ${backupLabel} SEHAT (loss ${fmt(backupLatest.lossAvg)}%).`);
        } else if (backupLatest) {
            langkah.push(`⚠️ JANGAN buru-buru switch: backup ${backupLabel} juga bermasalah (loss ${fmt(backupLatest.lossAvg)}%) — mengalihkan tidak menolong, fokus perbaikan ${isp}.`);
        }
    }

    if (!langkah.length) return "";
    return `\n\n🛠️ *Solusi jalur ini:*` + langkah.map((l, i) => `\n${i + 1}. ${l}`).join("");
}

/**
 * Rekap gangguan untuk notif PULIH — bahan siap-kirim komplain ke ISP: agregat loss/RTT per
 * ARAH selama jendela gangguan (sickSince→pulih), layanan yang sempat terdampak (TCP+TLS dari
 * service_probes: "Instagram gagal 70%", "TikTok TLS sampai 900ms"), bukti traceroute, dan
 * vonis segmen saat alert. Semua bagian best-effort — tanpa data → dilewati, tidak pernah throw.
 */
async function buildRecoveryRecap({ deps, cfg, pathKey, state, nowMs, affected }) {
    try {
        const sinceMs = state.sickSince || (nowMs - 60 * 60 * 1000);
        const sinceIso = new Date(sinceMs).toISOString();
        const repo = deps.getRepo();
        const thresholds = cfg.thresholds || { lossWarnPct: 5 };
        const fmtTime = (ms) => new Date(ms).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" });
        const pathCfg = pathCfgOf(cfg, pathKey);

        let out = `\n\n📊 *Rekap gangguan (bahan laporan ke ISP):*` +
            `\n• Jalur: ${pathLabel(cfg, pathKey)}${pathCfg && pathCfg.tunnelType ? ` (tunnel ${String(pathCfg.tunnelType).toUpperCase()})` : ""}` +
            buildAffectedLine(cfg, pathKey, affected) +
            `\n• Terdeteksi: ${fmtTime(sinceMs)} → Pulih: ${fmtTime(nowMs)}` +
            `\n• Level terburuk: ${state.lastLevel || "-"}`;

        // Agregat per-ARAH dari probe mentah selama jendela gangguan (far vs gateway).
        try {
            const rows = await repo.getRecentProbes({ sinceIso, path: pathKey, limit: 10000 });
            const far = new Map();
            let gw = null;
            for (const r of rows || []) {
                if (r.path !== pathKey || !r.target) continue;
                if (String(r.target_key || "") === "gateway") {
                    if (!gw) gw = { losses: [], rtts: [], target: r.target };
                    if (r.loss_pct != null) gw.losses.push(Number(r.loss_pct));
                    if (r.rtt_avg_ms != null) gw.rtts.push(Number(r.rtt_avg_ms));
                } else {
                    if (!far.has(r.target)) far.set(r.target, { losses: [], rtts: [], target: r.target, target_key: r.target_key });
                    const b = far.get(r.target);
                    if (r.loss_pct != null) b.losses.push(Number(r.loss_pct));
                    if (r.rtt_avg_ms != null) b.rtts.push(Number(r.rtt_avg_ms));
                }
            }
            const agg = (arr) => (arr.length ? { avg: arr.reduce((a, b) => a + b, 0) / arr.length, max: Math.max(...arr) } : null);
            const farLines = [];
            for (const b of far.values()) {
                const L = agg(b.losses);
                if (!L) continue;
                const R = agg(b.rtts);
                farLines.push(`\n  - → ${targetLabelOf(cfg, b.target_key, b.target)} (${b.target}): loss rata *${fmt(L.avg)}%* • puncak *${fmt(L.max)}%*` +
                    (R ? ` • RTT rata ${fmt(R.avg)}ms (puncak ${fmt(R.max)}ms)` : ""));
            }
            if (farLines.length) out += `\n• Loss per arah selama gangguan:` + farLines.join("");
            if (gw) {
                const L = agg(gw.losses);
                if (L) {
                    const bersih = L.avg <= (thresholds.lossWarnPct || 5);
                    out += `\n  - → Gateway (${gw.target}): loss rata ${fmt(L.avg, 1)}% • puncak ${fmt(L.max)}%` +
                        (bersih
                            ? ` → gateway BERSIH: bukti masalah di upstream ISP`
                            : ` → loss ikut di gateway: masalah link/last-mile ke ISP`);
                }
            }
        } catch (_e) { /* agregat arah best-effort */ }

        // Layanan yang sempat terdampak (TCP+TLS) selama jendela gangguan.
        try {
            const smCfg = global.config && global.config.serviceMonitor;
            if (smCfg && smCfg.enabled === true && typeof repo.getServiceHistory === "function") {
                const hist = await repo.getServiceHistory({ sinceIso, path: pathKey, limit: 20000 });
                const bySvc = new Map();
                for (const h of hist || []) {
                    if (h.path !== pathKey) continue;
                    const b = bySvc.get(h.service) || { total: 0, ok: 0, tlsMax: null };
                    b.total += 1;
                    if (h.ok) {
                        b.ok += 1;
                        if (h.tls_ms != null) b.tlsMax = Math.max(b.tlsMax || 0, Number(h.tls_ms));
                    }
                    bySvc.set(h.service, b);
                }
                const labelOf = (key) => {
                    try {
                        const svcs = require("./service-reachability-prober").getServiceConfig().services;
                        const s = svcs.find((x) => x.key === key);
                        return (s && s.label) || key;
                    } catch (_e) { return key; }
                };
                const impacted = [];
                for (const [key, b] of bySvc.entries()) {
                    if (!b.total) continue;
                    const okPct = (b.ok / b.total) * 100;
                    if (okPct < 80) {
                        impacted.push(`\n  - ${labelOf(key)}: gagal *${fmt(100 - okPct)}%* percobaan (${b.total} sampel)`);
                    } else if (b.tlsMax != null && b.tlsMax >= 500) {
                        impacted.push(`\n  - ${labelOf(key)}: sempat LAMBAT (TLS sampai ${fmt(b.tlsMax)}ms)`);
                    }
                }
                if (impacted.length) out += `\n• Layanan sempat terdampak via jalur ini:` + impacted.join("");
                else if (bySvc.size) out += `\n• Layanan (IG/FB/WA/TikTok/dll): tidak ada yang gagal signifikan via jalur ini.`;
            }
        } catch (_e) { /* layanan best-effort */ }

        // Bukti trace + vonis segmen dari insiden DALAM jendela gangguan.
        try {
            if (typeof repo.getIncidents === "function") {
                const incidents = await repo.getIncidents({ limit: 200 });
                const inWindow = (incidents || []).filter((i) =>
                    i.path === pathKey && Number.isFinite(Date.parse(i.created_at)) && Date.parse(i.created_at) >= sinceMs - 60000);
                const traceInc = inWindow.find((i) => i.kind === "trace");
                if (traceInc) {
                    const d = parseDetail(traceInc.detail);
                    if (d && d.first_bad_hop && d.first_bad_hop.address) {
                        out += `\n• Bukti traceroute: loss mulai di ${d.first_bad_hop.address} (loss ${fmt(d.first_bad_hop.loss_pct)}%) — tercatat ${fmtTime(Date.parse(traceInc.created_at))}`;
                    }
                }
                const alertInc = inWindow.find((i) => i.kind === "alert");
                if (alertInc) {
                    const d = parseDetail(alertInc.detail);
                    if (d && d.segment) {
                        const segLabel = {
                            UPSTREAM_ISP: "masalah di sisi ISP (upstream)",
                            LINK_ISP: "masalah link ke ISP (last-mile)",
                            JENUH: "link jenuh/penuh"
                        }[d.segment] || d.segment;
                        out += `\n• Vonis segmen saat gangguan: ${segLabel}`;
                    }
                }
            }
        } catch (_e) { /* insiden best-effort */ }

        out += `\n\nData mentah & grafik: */upstream-quality* (riwayat + Insiden).`;
        return out;
    } catch (_e) {
        return "";
    }
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
        const traceWaitMs = Math.max(0, Math.min(90, Number(alertsCfg.traceWaitSeconds != null ? alertsCfg.traceWaitSeconds : 45))) * 1000;
        const nowMs = deps.nowMs();

        await rehydrateFromIncidents(deps);

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

                    // ===== Isi alert spesifik-arah =====
                    // 1) Laporan status jalur (target/gateway/utilisasi/segmen) — best-effort.
                    let entry = null;
                    if (typeof deps.getPathStatus === "function") {
                        try { entry = await deps.getPathStatus(pathKey); } catch (_e) { entry = null; }
                    }
                    // 2) Traceroute bukti hop: tunggu terbatas supaya HASILNYA ikut di pesan
                    //    (menunda alert ± traceWaitSeconds; siklus poll berikutnya bisa ter-skip
                    //    sekali — harga yang diambil demi alert yang actionable).
                    let trace = null;
                    if (typeof deps.requestTrace === "function") {
                        trace = await awaitTraceBounded(deps.requestTrace(pathKey), traceWaitMs);
                    }

                    // Himpunan pelanggan terdampak LIVE (menggantikan affects statis). Best-effort.
                    const affected = await resolveAffected(deps, pathKey);
                    let saran = "";
                    saran += buildDirectionText(cfg, pathKey, entry, affected);
                    saran += await buildServiceSectionText(pathKey, deps);
                    saran += buildConclusionText(cfg, pathKey, entry);
                    if (typeof deps.requestTrace === "function") {
                        saran += buildTraceText(cfg, pathKey, trace);
                    }
                    saran += buildSolutionText({ cfg, thresholds, pathKey, entry, perPath, worst });

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

                    try {
                        const repoInc = deps.getRepo();
                        if (repoInc && typeof repoInc.addIncident === "function") {
                            await repoInc.addIncident({
                                path: pathKey,
                                kind: "alert",
                                detail: {
                                    level: worst,
                                    loss_avg: latest.lossAvg,
                                    rtt_avg: latest.rttAvg,
                                    segment: entry && entry.segment ? entry.segment : null,
                                    gw_loss: entry && entry.gateway ? entry.gateway.loss_avg_pct : null
                                }
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
                    // Rekap insiden (arah, puncak loss, layanan terdampak, trace, segmen) —
                    // bahan siap-kirim untuk komplain ke ISP. Best-effort, "" bila tanpa data.
                    const affected = await resolveAffected(deps, pathKey);
                    let rekap = "";
                    try {
                        rekap = await buildRecoveryRecap({ deps, cfg, pathKey, state, nowMs, affected });
                    } catch (_e) { rekap = ""; }
                    const teks = deps.renderResponseTemplate(
                        "upq_alert_recovered",
                        `✅ *JALUR UPSTREAM PULIH — ${namaLayanan}*\n\n` +
                        `Jalur *${pathLabel(cfg, pathKey)}* kembali normal (loss ${fmt(latest.lossAvg)}%, RTT ${fmt(latest.rttAvg)}ms).\n` +
                        `Durasi gangguan: ±${durasi}.${rekap}`,
                        {
                            jalur: pathLabel(cfg, pathKey),
                            loss: fmt(latest.lossAvg),
                            rtt: fmt(latest.rttAvg),
                            durasi,
                            rekap,
                            nama_layanan: namaLayanan
                        }
                    );
                    const sentTo = await deliver(deps, alertsCfg, teks);
                    pathStates.set(pathKey, { condition: "HEALTHY", sickSince: null, lastAlertAt: state.lastAlertAt, lastLevel: "NORMAL" });
                    actions.push({ path: pathKey, action: "recovered", sentTo });
                    try {
                        const repoInc = deps.getRepo();
                        if (repoInc && typeof repoInc.addIncident === "function") {
                            // last_alert_at ikut disimpan supaya rehidrasi pasca-restart tetap
                            // menghormati cooldown alert sebelumnya.
                            await repoInc.addIncident({
                                path: pathKey,
                                kind: "alert_recovered",
                                detail: { last_alert_at: state.lastAlertAt, duration_ms: state.sickSince ? nowMs - state.sickSince : null }
                            });
                        }
                    } catch (_e) { /* insiden best-effort */ }
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
    rehydrated = false;
}

module.exports = {
    evaluateAfterCycle,
    getAlertStates,
    resetAlertStatesForTest,
    _internal: {
        cycleLevel,
        buildCycleSeries,
        normalizeRecipients,
        buildTraceText,
        buildAffectedLine,
        buildDirectionText,
        buildConclusionText,
        buildSolutionText,
        buildServiceSectionText,
        buildRecoveryRecap
    }
};
