/**
 * Header Doc
 * Purpose: Agregator sinyal komplain pelanggan — merekam "cek koneksi" & tiket lemot per jalur
 *          upstream (resolve IP PPPoE → path via lib/customer-path-resolver LIVE 3-lapis, sama
 *          dengan cek-koneksi & panel steering — bukan peta pool statis lagi), dedup per
 *          pelanggan, lalu saat ≥N pelanggan BERBEDA komplain pada jalur yang sama dalam jendela
 *          waktu, kirim SATU alert WA ke admin/owner berisi kondisi jalur + saran tindakan.
 *          Menjawab "tidak ada admin yang standby": komplain individual tetap dilayani bot,
 *          komplain MENUMPUK naik sendiri ke owner dengan konteks presisi.
 * Caller: `message/handlers/connection-check-handler.js` (source cek_koneksi, fire-and-forget)
 *         dan `lib/report-orchestration-service.js` (source tiket_lemot, saat laporan lemot).
 * Deps: `lib/customer-path-resolver.resolveCustomerPath` (LIVE 3-lapis, fail-closed → null=unknown),
 *       lazy `lib/mikrotik.getActivePPPoEUsers`
 *       (fallback resolusi IP), lazy `lib/upstream-quality-poller.buildStatusReport` (pengaya
 *       kondisi jalur), `lib/whatsapp-critical-delivery.sendCritical` (payload WAJIB { text }),
 *       `lib/admin-recipients.getAdminJids`, `lib/response-template-helper`,
 *       `repositories/upstream-quality.repository.addIncident` (jejak insiden, best-effort).
 * MainFuncs: `recordComplaint`, `getComplaintConfig`, `getComplaintStats`, `resetForTest`.
 * SideEffects: Kirim WA admin saat klaster terpenuhi (never-throw); tulis insiden
 *              `complaint_cluster`; state sinyal in-memory (single-instance, hilang saat restart).
 */
"use strict";

// Sinyal in-memory: { atMs, userId, name, source, path }. Jendela pendek → tidak butuh DB.
let signals = [];
const lastByUser = new Map(); // userId → atMs (dedup per pelanggan)
const lastAlertByPath = new Map(); // path → atMs (cooldown alert per jalur)

// Cache ringan daftar PPPoE aktif utk resolusi IP saat pemanggil tidak membawa addr.
let activeAddrCache = { at: 0, addrByUser: null };
const ACTIVE_CACHE_TTL_MS = 30000;

function defaultDeps() {
    return {
        send: (jid, payload, opts) => require("./whatsapp-critical-delivery").sendCritical(jid, payload, opts),
        getAdminJids: () => require("./admin-recipients").getAdminJids(),
        renderResponseTemplate: (key, fallback, data) => require("./response-template-helper").renderResponseTemplate(key, fallback, data),
        resolveCustomerPath: (ip) => require("./customer-path-resolver").resolveCustomerPath(ip),
        getActivePPPoEUsers: (args) => require("./mikrotik").getActivePPPoEUsers(args),
        getStatusReport: () => require("./upstream-quality-poller").buildStatusReport(),
        addIncident: (payload) => require("../repositories/upstream-quality.repository").getUpstreamQualityRepository().addIncident(payload),
        getComplaintConfig,
        nowMs: () => Date.now()
    };
}

/** Config agregator ber-default aman: OFF; ambang 3 pelanggan berbeda / 15 menit. */
function getComplaintConfig() {
    const cfg = (global.config && global.config.complaintSignals) || {};
    return {
        enabled: cfg.enabled === true,
        windowMinutes: Math.max(5, Math.min(120, Number(cfg.windowMinutes) || 15)),
        minDistinctCustomers: Math.max(2, Number(cfg.minDistinctCustomers) || 3),
        perCustomerCooldownMinutes: Math.max(5, Number(cfg.perCustomerCooldownMinutes) || 30),
        alertCooldownMinutes: Math.max(10, Number(cfg.alertCooldownMinutes) || 30),
        notifyAdmins: cfg.notifyAdmins !== false,
        recipients: Array.isArray(cfg.recipients) ? cfg.recipients : []
    };
}

function normalizeUsername(value) {
    return String(value || "").trim().toLowerCase();
}

function unwrapMikrotikList(result) {
    if (Array.isArray(result)) return result;
    if (Array.isArray(result && result.data)) return result.data;
    if (Array.isArray(result && result.data && result.data.data)) return result.data.data;
    if (Array.isArray(result && result.items)) return result.items;
    return [];
}

/** Resolusi jalur upstream pelanggan: pakai addr bila dibawa pemanggil, else lihat PPP active. */
async function resolvePathForUser(user, addr, deps) {
    try {
        let ip = addr || null;
        if (!ip) {
            const uname = normalizeUsername(user && user.pppoe_username);
            if (!uname) return "unknown";
            const now = deps.nowMs();
            if (!activeAddrCache.addrByUser || now - activeAddrCache.at >= ACTIVE_CACHE_TTL_MS) {
                const list = unwrapMikrotikList(await deps.getActivePPPoEUsers({ router_id: "default" }));
                const addrByUser = new Map();
                for (const item of list) {
                    const name = normalizeUsername(item.name || item.user || item.username);
                    const address = item.address || item.ip || null;
                    if (name && address) addrByUser.set(name, String(address));
                }
                activeAddrCache = { at: now, addrByUser };
            }
            ip = activeAddrCache.addrByUser.get(uname) || null;
        }
        if (!ip) return "unknown";
        // Resolver LIVE 3-lapis (RAF-STEER → profil pool freedns/lokaldns → jaring pengaman peta
        // pool). `null` = router tak terbaca (fail-closed) → "unknown". Klaster "unknown" sengaja
        // TETAP bisa alert (anti-diam: 3 pelanggan komplain walau jalur tak teridentifikasi).
        const resolved = await deps.resolveCustomerPath(ip);
        return resolved || "unknown";
    } catch (_e) {
        return "unknown";
    }
}

function normalizeRecipients(list) {
    const out = [];
    (Array.isArray(list) ? list : []).forEach((raw) => {
        const s = String(raw || "").trim();
        if (!s) return;
        if (s.endsWith("@s.whatsapp.net") || s.endsWith("@g.us")) { out.push(s); return; }
        let digits = s.replace(/\D/g, "");
        if (digits.startsWith("0")) digits = `62${digits.slice(1)}`;
        if (digits.length >= 10 && digits.startsWith("62")) out.push(`${digits}@s.whatsapp.net`);
    });
    return out;
}

async function deliver(deps, cfg, text) {
    const recipients = new Set();
    if (cfg.notifyAdmins !== false) {
        try { (deps.getAdminJids() || []).forEach((j) => recipients.add(j)); } catch (_e) { /* best-effort */ }
    }
    normalizeRecipients(cfg.recipients).forEach((j) => recipients.add(j));
    let delivered = 0;
    for (const jid of recipients) {
        try {
            // Kontrak sendCritical: payload WAJIB objek { text }.
            const result = await deps.send(jid, { text }, { label: "complaint-cluster", waitForReadyMs: 8000 });
            if (!result || result.delivered !== false) delivered += 1;
        } catch (err) {
            console.warn(`[Complaint-Signal] Gagal kirim ke ${jid}: ${err.message}`);
        }
    }
    return delivered;
}

/** Label jalur dari config monitor; 'unknown' → frasa manusiawi. */
function pathLabelOf(pathKey) {
    if (pathKey === "unknown") return "belum teridentifikasi";
    const paths = (global.config && global.config.upstreamMonitor && global.config.upstreamMonitor.paths) || [];
    const p = paths.find((x) => x && x.key === pathKey);
    return (p && p.label) || pathKey;
}

/** Ringkas kondisi jalur dari laporan status poller (best-effort, "" bila tak tersedia). */
async function buildPathConditionText(pathKey, deps) {
    try {
        const upCfg = global.config && global.config.upstreamMonitor;
        if (!upCfg || upCfg.enabled !== true || pathKey === "unknown") return "";
        const report = await deps.getStatusReport();
        const entry = report && Array.isArray(report.paths) ? report.paths.find((p) => p.key === pathKey) : null;
        if (!entry) return "";
        const targets = Array.isArray(entry.targets) ? entry.targets.filter((t) => t.samples > 0) : [];
        const lossVals = targets.map((t) => t.loss_avg_pct).filter((v) => v != null);
        const loss = lossVals.length ? (lossVals.reduce((a, b) => a + b, 0) / lossVals.length).toFixed(0) : "-";
        let out = `\n• Kondisi jalur: *${entry.status}* (loss ${loss}%)`;
        if (entry.segment_label && entry.segment !== "SEHAT" && entry.segment !== "UNKNOWN") {
            out += `\n• Perkiraan segmen: *${entry.segment_label}*`;
        }
        if (entry.wan && (entry.wan.util_down_max_pct != null || entry.wan.util_up_max_pct != null)) {
            const dn = entry.wan.util_down_max_pct == null ? "-" : `${entry.wan.util_down_max_pct}%`;
            const up = entry.wan.util_up_max_pct == null ? "-" : `${entry.wan.util_up_max_pct}%`;
            out += `\n• Utilisasi link: ↓${dn} / ↑${up}`;
        }
        return out;
    } catch (_e) {
        return "";
    }
}

/** Saran tindakan: bila ada rule failover utk jalur ini, arahkan ke switch-nya. */
function buildSuggestionText(pathKey) {
    try {
        const rules = (global.config && global.config.wanFailover && global.config.wanFailover.rules) || [];
        const rule = rules.find((r) => r && r.sickPath === pathKey && r.switchId);
        const swEnabled = global.config && global.config.wanSwitch && global.config.wanSwitch.enabled === true;
        if (rule && swEnabled) {
            return `\n\n➡️ Cek lalu alihkan bila perlu: balas *switch koneksi*, atau buka panel */upstream-quality*.`;
        }
        if (swEnabled) {
            return `\n\n➡️ Cek panel */upstream-quality* untuk detail, atau balas *switch koneksi*.`;
        }
        return `\n\n➡️ Cek panel */upstream-quality* untuk detail.`;
    } catch (_e) {
        return "";
    }
}

/**
 * Rekam satu sinyal komplain lalu evaluasi klaster jalurnya. Fire-and-forget friendly:
 * TIDAK PERNAH throw, aman dipanggil tanpa await. `lineStatus` 'offline' dilewati
 * (gangguan putus ditangani alur outage/LOS, bukan agregator lemot).
 * @param {{user:object, source:string, addr?:string, lineStatus?:string, app?:string}} payload
 */
async function recordComplaint(payload = {}, depsOverride = {}) {
    try {
        const deps = { ...defaultDeps(), ...depsOverride };
        const cfg = deps.getComplaintConfig();
        if (!cfg.enabled) return { recorded: false, reason: "disabled" };
        const user = payload.user;
        if (!user || user.id == null) return { recorded: false, reason: "no-user" };
        if (payload.lineStatus === "offline") return { recorded: false, reason: "offline" };

        const nowMs = deps.nowMs();
        const userId = String(user.id);

        // Dedup per pelanggan: pelanggan yang sama bolak-balik cek dalam cooldown = 1 sinyal.
        const lastAt = lastByUser.get(userId) || 0;
        if (nowMs - lastAt < cfg.perCustomerCooldownMinutes * 60 * 1000) {
            return { recorded: false, reason: "user-cooldown" };
        }

        const pathKey = await resolvePathForUser(user, payload.addr || null, deps);
        lastByUser.set(userId, nowMs);
        signals.push({
            atMs: nowMs,
            userId,
            name: user.name || user.pppoe_username || `#${userId}`,
            source: String(payload.source || "lainnya"),
            path: pathKey,
            app: payload.app || null
        });

        // Prune: simpan maksimal 4× jendela supaya memori tetap kecil.
        const pruneBefore = nowMs - cfg.windowMinutes * 4 * 60 * 1000;
        signals = signals.filter((s) => s.atMs >= pruneBefore);
        for (const [uid, at] of lastByUser.entries()) {
            if (at < pruneBefore) lastByUser.delete(uid);
        }

        // Evaluasi klaster utk jalur sinyal ini.
        const windowStart = nowMs - cfg.windowMinutes * 60 * 1000;
        const inWindow = signals.filter((s) => s.path === pathKey && s.atMs >= windowStart);
        const distinct = new Map();
        inWindow.forEach((s) => distinct.set(s.userId, s));
        if (distinct.size < cfg.minDistinctCustomers) {
            return { recorded: true, path: pathKey, clustered: false, count: distinct.size };
        }
        const lastAlertAt = lastAlertByPath.get(pathKey) || 0;
        if (nowMs - lastAlertAt < cfg.alertCooldownMinutes * 60 * 1000) {
            return { recorded: true, path: pathKey, clustered: true, alerted: false, reason: "alert-cooldown" };
        }

        const namaLayanan = (global.config && global.config.nama) || "RAF NET";
        const daftar = [...distinct.values()]
            .slice(-8)
            .map((s) => `  - ${s.name} (${s.source === "tiket_lemot" ? "tiket lemot" : "cek koneksi"}${s.app ? `, soal ${s.app}` : ""})`)
            .join("\n");
        // Bila mayoritas mengeluhkan APP yang sama, sebut di alert ("mayoritas: TikTok") — presisi.
        const appCount = {};
        [...distinct.values()].forEach((s) => { if (s.app) appCount[s.app] = (appCount[s.app] || 0) + 1; });
        const topApp = Object.entries(appCount).sort((a, b) => b[1] - a[1])[0] || null;
        const appNote = topApp && topApp[1] >= 2 ? `\n🎯 Mayoritas menyebut: *${topApp[0]}* (${topApp[1]} pelanggan)` : "";
        const kondisi = (await buildPathConditionText(pathKey, deps)) + appNote;
        const saran = buildSuggestionText(pathKey);
        const teks = deps.renderResponseTemplate(
            "complaint_cluster_alert",
            `📢 *KOMPLAIN MENUMPUK — ${namaLayanan}*\n\n` +
            `${distinct.size} pelanggan BERBEDA mengeluh koneksi lambat dalam ${cfg.windowMinutes} menit terakhir ` +
            `pada jalur *${pathLabelOf(pathKey)}*:\n${daftar}${kondisi}${saran}`,
            {
                jumlah: distinct.size,
                jendela: cfg.windowMinutes,
                jalur_label: pathLabelOf(pathKey),
                daftar,
                kondisi,
                saran,
                nama_layanan: namaLayanan
            }
        );
        const sentTo = await deliver(deps, cfg, teks);
        lastAlertByPath.set(pathKey, nowMs);
        try {
            await deps.addIncident({
                path: pathKey,
                kind: "complaint_cluster",
                detail: {
                    count: distinct.size,
                    window_minutes: cfg.windowMinutes,
                    users: [...distinct.values()].map((s) => ({ id: s.userId, name: s.name, source: s.source }))
                }
            });
        } catch (_e) { /* insiden best-effort */ }
        return { recorded: true, path: pathKey, clustered: true, alerted: true, sentTo };
    } catch (err) {
        console.warn(`[Complaint-Signal] recordComplaint gagal: ${err.message}`);
        return { recorded: false, reason: "error", error: err.message };
    }
}

function getComplaintStats() {
    return {
        signals: signals.map((s) => ({ ...s })),
        lastAlertByPath: Object.fromEntries(lastAlertByPath.entries())
    };
}

function resetForTest() {
    signals = [];
    lastByUser.clear();
    lastAlertByPath.clear();
    activeAddrCache = { at: 0, addrByUser: null };
}

module.exports = {
    recordComplaint,
    getComplaintConfig,
    getComplaintStats,
    resetForTest,
    _internal: { resolvePathForUser, normalizeRecipients, pathLabelOf }
};
