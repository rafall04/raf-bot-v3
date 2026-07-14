/**
 * Header Doc
 * Purpose: Agregasi "Owner Cockpit" — ringkasan sekali-baca owner: Pemasukan (net_paid + hari ini +
 *          tunggakan + tingkat pelunasan + MRR), Status ISP (+trafik agregat), PSB (belum kepasang +
 *          terpasang + komisi), Tiket (aktif + per-status + lama), Outage OLT (LOS + offline),
 *          Pelanggan (aktif/isolir/baru/PPPoE online), dan Perlu Tindakan (bukti bayar/ganti paket/topup).
 *          Tiap kartu BEST-EFFORT & TERISOLASI: satu sumber gagal → kartu itu `{ok:false}` tapi kartu lain
 *          tetap terisi (halaman tak pernah 500). Read-only; data dari service existing.
 * Caller: `routes/admin-owner-cockpit-routes.js` (GET /api/owner/cockpit).
 * Deps (lazy + guard, injectable utk test): payment-finance-service (getPaymentReportForPeriod/
 *       getEffectivePrice/getCurrentBillingPeriod), services/arrears.service, upstream-quality-poller
 *       (buildStatusReport/getMonitorConfig), psb-schedule-service.getScheduleSummary, global.reports,
 *       olt-los-broadcaster.getLosState, lib/mikrotik.getPppStats (DI-CACHE 90s — mahal), global.users +
 *       account-classification.isInfrastructure, payment-proof.repository, saldo-manager.getPendingTopupRequests,
 *       global.{packageChangeRequests,requests}.
 * MainFuncs: `buildCockpit`.
 * SideEffects: Cache in-memory PPP stats (TTL) — bukan tulis DB.
 */
"use strict";

// PPP stats (MikroTik) MAHAL (spawn PHP + RouterOS, ~12s, tanpa cache internal). Cockpit auto-refresh 60s
// & bisa dibuka banyak admin → cache pendek supaya RouterOS tak dihajar tiap refresh. Dipakai kartu
// Pelanggan (online) & OLT (offline) dari SATU panggilan.
let _pppCache = { at: 0, data: null };
async function getPppStatsCached() {
    const now = Date.now();
    if (_pppCache.data && now - _pppCache.at < 90000) return _pppCache.data;
    const r = await require("./mikrotik").getPppStats({ caller: "owner.cockpit.ppp" });
    _pppCache = { at: now, data: r };
    return r;
}

function defaultDeps() {
    const pf = () => require("./payment-finance-service");
    return {
        getCurrentBillingPeriod: () => pf().getCurrentBillingPeriod(),
        getPaymentReport: (m, y) => pf().getPaymentReportForPeriod(m, y),
        getEffectivePrice: (u) => pf().getEffectivePrice(u),
        getArrears: (period) => require("../services/arrears.service").createArrearsService().getArrearsReadModel(period),
        buildStatusReport: () => require("./upstream-quality-poller").buildStatusReport(),
        getMonitorConfig: () => require("./upstream-quality-poller").getMonitorConfig(),
        getScheduleSummary: () => require("./psb-schedule-service").getScheduleSummary(),
        getReports: () => (typeof global !== "undefined" && Array.isArray(global.reports) ? global.reports : []),
        getLosState: () => require("./olt-los-broadcaster").getLosState(),
        getPppStats: getPppStatsCached,
        getUsers: () => (typeof global !== "undefined" && Array.isArray(global.users) ? global.users : []),
        isInfrastructure: (u) => { try { return require("./account-classification").isInfrastructure(u); } catch (_e) { return false; } },
        getPendingProofs: () => require("../repositories/payment-proof.repository").createPaymentProofRepository().listPending(),
        getPendingTopups: () => require("./saldo-manager").getPendingTopupRequests(),
        getPackageChangeRequests: () => (typeof global !== "undefined" && Array.isArray(global.packageChangeRequests) ? global.packageChangeRequests : []),
        getRequests: () => (typeof global !== "undefined" && Array.isArray(global.requests) ? global.requests : []),
        nowMs: () => Date.now()
    };
}

const BAD_ISP = new Set(["GANGGUAN", "PUTUS"]);
const WARN_ISP = new Set(["DEGRADASI"]);
const DONE_TICKET = new Set(["completed", "closed", "cancelled", "canceled", "done", "selesai", "batal", "resolved", "dibatalkan", "ditutup"]);
const OPEN_TICKET = new Set(["reported", "pending", "open", "menunggu", "new", "baru", ""]);

function toInt(v) { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : 0; }
function isIsolir(u) { return String((u && u.status) || "").toLowerCase() === "isolir"; }
function pctRound(part, whole) { return whole > 0 ? Math.round((part / whole) * 100) : null; }

async function buildIncomeCard(deps) {
    const now = new Date(deps.nowMs());
    let periodMonth;
    let periodYear;
    try { const p = deps.getCurrentBillingPeriod() || {}; periodMonth = p.periodMonth; periodYear = p.periodYear; } catch (_e) { /* fallback bawah */ }
    if (!periodMonth) { periodMonth = now.getMonth() + 1; periodYear = now.getFullYear(); }

    const rep = await deps.getPaymentReport(periodMonth, periodYear);
    const summary = (rep && rep.summary) || {};
    const txs = Array.isArray(rep && rep.transactions) ? rep.transactions : [];
    const todayPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    let todayCount = 0;
    let todayAmount = 0;
    for (const t of txs) {
        if (t && t.type === "payment" && String(t.created_at || "").slice(0, 10) === todayPrefix) {
            todayCount += 1; todayAmount += toInt(t.amount);
        }
    }

    // MRR + jumlah pelanggan (in-memory, hindari infra).
    const cust = (deps.getUsers() || []).filter((u) => !deps.isInfrastructure(u));
    const active = cust.filter((u) => !isIsolir(u));
    const mrr = active.reduce((s, u) => s + (toInt(deps.getEffectivePrice(u)) || 0), 0);
    const lunas = cust.filter((u) => u && (u.paid === true || u.paid === 1)).length;

    // Tunggakan (best-effort di dalam kartu — sumber terpisah, bisa gagal sendiri).
    let arrearsCustomers = null;
    let arrearsOutstanding = null;
    try {
        const ar = await deps.getArrears({ periodMonth, periodYear });
        const s = (ar && ar.summary) || {};
        arrearsCustomers = s.total_customers_in_arrears != null ? toInt(s.total_customers_in_arrears) : null;
        arrearsOutstanding = s.total_outstanding != null ? toInt(s.total_outstanding) : null;
    } catch (_e) { /* tunggakan best-effort */ }

    // Tren vs bulan lalu (net_paid periode sebelumnya). Best-effort.
    let prevNetPaid = null;
    let trendPct = null;
    try {
        let pm = periodMonth - 1;
        let py = periodYear;
        if (pm < 1) { pm = 12; py -= 1; }
        const prevRep = await deps.getPaymentReport(pm, py);
        prevNetPaid = toInt(((prevRep && prevRep.summary) || {}).net_paid);
        if (prevNetPaid > 0) trendPct = Math.round(((toInt(summary.net_paid) - prevNetPaid) / prevNetPaid) * 100);
    } catch (_e) { /* tren best-effort */ }

    return {
        ok: true, period: `${periodMonth}/${periodYear}`,
        netPaid: toInt(summary.net_paid), paymentTransactions: toInt(summary.payment_transactions),
        todayCount, todayAmount,
        mrr, totalCustomers: cust.length, lunas, collectionRate: pctRound(lunas, cust.length),
        arrearsCustomers, arrearsOutstanding,
        prevNetPaid, trendPct
    };
}

async function buildIspCard(deps) {
    const cfg = deps.getMonitorConfig();
    if (!cfg || cfg.enabled !== true) return { ok: true, enabled: false, overall: "OFF", paths: [], rxMbps: null, txMbps: null };
    const report = await deps.buildStatusReport();
    const rawPaths = (report && Array.isArray(report.paths)) ? report.paths : [];
    const paths = rawPaths.map((p) => ({ key: p.key, label: p.label || p.key, status: p.status || "UNKNOWN" }));
    let rx = null;
    let tx = null;
    for (const p of rawPaths) {
        if (p && p.wan) {
            if (p.wan.rx_mbps != null) rx = (rx || 0) + Number(p.wan.rx_mbps);
            if (p.wan.tx_mbps != null) tx = (tx || 0) + Number(p.wan.tx_mbps);
        }
    }
    let overall = "OK";
    if (paths.some((p) => BAD_ISP.has(p.status))) overall = "DOWN";
    else if (paths.some((p) => WARN_ISP.has(p.status))) overall = "WARN";
    return {
        ok: true, enabled: true, overall, paths,
        rxMbps: rx == null ? null : Math.round(rx * 10) / 10,
        txMbps: tx == null ? null : Math.round(tx * 10) / 10
    };
}

async function buildPsbCard(deps) {
    const s = (await deps.getScheduleSummary()) || {};
    const menunggu = toInt(s.menunggu);
    const ditugaskan = toInt(s.ditugaskan);
    const belumKepasang = s.belum_kepasang != null ? toInt(s.belum_kepasang) : (menunggu + ditugaskan);
    const terpasangBulanIni = toInt(s.terpasang_bulan_ini != null ? s.terpasang_bulan_ini : (s.terpasangBulanIni != null ? s.terpasangBulanIni : s.terpasang));
    const komisiBulanIni = toInt(s.komisi_bulan_ini);
    return { ok: true, belumKepasang, menunggu, ditugaskan, terpasangBulanIni, komisiBulanIni };
}

function buildTicketCard(deps) {
    const reports = deps.getReports() || [];
    const nowMs = deps.nowMs();
    let active = 0;
    let belumDiambil = 0;
    let lama = 0;
    const byStatus = {};
    for (const r of reports) {
        const status = String((r && r.status) || "").toLowerCase();
        if (DONE_TICKET.has(status)) continue;
        active += 1;
        byStatus[status || "?"] = (byStatus[status || "?"] || 0) + 1;
        if (OPEN_TICKET.has(status) || !(r && (r.teknisiId || r.teknisi_id))) belumDiambil += 1;
        const created = Date.parse((r && (r.createdAt || r.created_at || r.timestamp)) || "");
        if (Number.isFinite(created) && nowMs - created > 24 * 60 * 60 * 1000) lama += 1;
    }
    return { ok: true, active, belumDiambil, lama, byStatus };
}

function buildOltCard(deps) {
    const st = deps.getLosState() || {};
    return { ok: true, activeOutage: toInt(st.activeIncidentCount), recovering: toInt(st.recoveringCount), pending: toInt(st.pendingCount) };
}

function buildCustomerCard(deps, ppp) {
    const now = new Date(deps.nowMs());
    const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const cust = (deps.getUsers() || []).filter((u) => !deps.isInfrastructure(u));
    const isolir = cust.filter(isIsolir).length;
    const aktif = cust.length - isolir;
    const baru = cust.filter((u) => String((u && u.created_at) || "").slice(0, 7) === prefix).length;
    const pppoeOnline = (ppp && ppp.ok && ppp.data && ppp.data.online != null) ? toInt(ppp.data.online) : null;
    // Presisi "pelanggan offline": pelanggan AKTIF (non-infra & non-isolir) yang pppoe_username-nya ada di
    // daftar sesi PPPoE mati (inactive_users_list) — bukan sekadar total secret offline (yang ikut hitung
    // isolir yang memang sengaja mati + akun infra). Butuh inactive_users_list; absen → null.
    let offline = null;
    if (ppp && ppp.ok && ppp.data && Array.isArray(ppp.data.inactive_users_list)) {
        const off = new Set(ppp.data.inactive_users_list
            .map((x) => String((x && (x.username || x.name || x.user)) || x || "").toLowerCase())
            .filter(Boolean));
        offline = cust.filter((u) => {
            if (isIsolir(u)) return false;
            const pu = String((u && (u.pppoe_username || u.username || u.user)) || "").toLowerCase();
            return pu && off.has(pu);
        }).length;
    }
    return { ok: true, total: cust.length, aktif, isolir, baru, pppoeOnline, offline };
}

function buildActionCard(deps) {
    let buktiBayar = 0;
    let gantiPaket = 0;
    let topup = 0;
    let bayarApproval = 0;
    try { buktiBayar = (deps.getPendingProofs() || []).length; } catch (_e) { /* best-effort */ }
    try { gantiPaket = (deps.getPackageChangeRequests() || []).filter((r) => r && r.status === "pending").length; } catch (_e) { /* best-effort */ }
    try { topup = (deps.getPendingTopups() || []).length; } catch (_e) { /* best-effort */ }
    try { bayarApproval = (deps.getRequests() || []).filter((r) => r && r.status === "pending").length; } catch (_e) { /* best-effort */ }
    return { ok: true, buktiBayar, gantiPaket, topup, bayarApproval, total: buktiBayar + gantiPaket + topup + bayarApproval };
}

/**
 * Susun cockpit. Tiap kartu terisolasi (try/catch) → tak pernah throw. PPP stats diambil SEKALI
 * (cached) & dibagi ke kartu Pelanggan + OLT.
 */
async function buildCockpit(depsOverride = {}) {
    const deps = { ...defaultDeps(), ...depsOverride };
    const card = async (fn) => { try { return await fn(deps); } catch (err) { return { ok: false, error: (err && err.message) || "gagal" }; } };

    let ppp = null;
    try { ppp = await deps.getPppStats(); } catch (_e) { ppp = null; }

    const [income, isp, psb] = await Promise.all([card(buildIncomeCard), card(buildIspCard), card(buildPsbCard)]);
    const safe = (fn, arg) => { try { return fn(deps, arg); } catch (err) { return { ok: false, error: err.message }; } };
    const tickets = safe(buildTicketCard);
    const olt = safe(buildOltCard, ppp);
    const customers = safe(buildCustomerCard, ppp);
    const actions = safe(buildActionCard);

    return { generatedAt: new Date(deps.nowMs()).toISOString(), income, isp, psb, tickets, olt, customers, actions };
}

module.exports = {
    buildCockpit,
    _internal: { buildIncomeCard, buildIspCard, buildPsbCard, buildTicketCard, buildOltCard, buildCustomerCard, buildActionCard }
};
