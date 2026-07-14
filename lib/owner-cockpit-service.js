/**
 * Header Doc
 * Purpose: Agregasi "Owner Cockpit" — satu ringkasan sekali-baca untuk owner: pemasukan bulan ini,
 *          status jalur ISP (upstream), tiket aktif, pipeline PSB (belum kepasang), dan outage OLT.
 *          Tiap kartu BEST-EFFORT & terisolasi: satu sumber gagal → kartu itu `{ok:false}` tapi kartu
 *          lain tetap terisi (halaman tak pernah kosong/500). Data dari service existing, TANPA menulis.
 * Caller: `routes/admin-owner-cockpit-routes.js` (GET /api/owner/cockpit).
 * Deps (semua lazy + di-guard, injectable utk test): `lib/payment-finance-service.getPaymentReportForPeriod`,
 *       `lib/upstream-quality-poller.{buildStatusReport,getMonitorConfig}`, `lib/psb-schedule-service.getScheduleSummary`,
 *       `global.reports` (tiket in-memory), `lib/olt-los-broadcaster.getLosState`.
 * MainFuncs: `buildCockpit`.
 * SideEffects: Tidak ada (hanya baca).
 */
"use strict";

function defaultDeps() {
    return {
        getPaymentReport: (m, y) => require("./payment-finance-service").getPaymentReportForPeriod(m, y),
        buildStatusReport: () => require("./upstream-quality-poller").buildStatusReport(),
        getMonitorConfig: () => require("./upstream-quality-poller").getMonitorConfig(),
        getScheduleSummary: () => require("./psb-schedule-service").getScheduleSummary(),
        getReports: () => (typeof global !== "undefined" && Array.isArray(global.reports) ? global.reports : []),
        getLosState: () => require("./olt-los-broadcaster").getLosState(),
        nowMs: () => Date.now()
    };
}

// Status jalur yang dianggap bermasalah (selaras upstream-quality).
const BAD_ISP = new Set(["GANGGUAN", "PUTUS"]);
const WARN_ISP = new Set(["DEGRADASI"]);
// Tiket yang dianggap SELESAI/tak-aktif.
const DONE_TICKET = new Set(["completed", "closed", "cancelled", "canceled", "done", "selesai", "batal"]);
// Tiket yang belum diambil teknisi (masih antre).
const OPEN_TICKET = new Set(["reported", "pending", "open", "menunggu", "new", "baru", ""]);

function toInt(v) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n) : 0;
}

async function buildIncomeCard(deps) {
    const now = new Date(deps.nowMs());
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    const rep = await deps.getPaymentReport(month, year);
    const summary = (rep && rep.summary) || {};
    const txs = Array.isArray(rep && rep.transactions) ? rep.transactions : [];
    const todayPrefix = `${year}-${String(month).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    let todayCount = 0;
    let todayAmount = 0;
    for (const t of txs) {
        if (t && t.type === "payment" && String(t.created_at || "").slice(0, 10) === todayPrefix) {
            todayCount += 1;
            todayAmount += toInt(t.amount);
        }
    }
    return {
        ok: true,
        period: `${month}/${year}`,
        netPaid: toInt(summary.net_paid),
        paymentTransactions: toInt(summary.payment_transactions),
        todayCount,
        todayAmount
    };
}

async function buildIspCard(deps) {
    const cfg = deps.getMonitorConfig();
    if (!cfg || cfg.enabled !== true) {
        return { ok: true, enabled: false, overall: "OFF", paths: [] };
    }
    const report = await deps.buildStatusReport();
    const paths = (report && Array.isArray(report.paths) ? report.paths : []).map((p) => ({
        key: p.key,
        label: p.label || p.key,
        status: p.status || "UNKNOWN"
    }));
    let overall = "OK";
    if (paths.some((p) => BAD_ISP.has(p.status))) overall = "DOWN";
    else if (paths.some((p) => WARN_ISP.has(p.status))) overall = "WARN";
    return { ok: true, enabled: true, overall, paths };
}

async function buildPsbCard(deps) {
    const s = (await deps.getScheduleSummary()) || {};
    const menunggu = toInt(s.menunggu);
    const ditugaskan = toInt(s.ditugaskan);
    const belumKepasang = s.belumKepasang != null ? toInt(s.belumKepasang) : (menunggu + ditugaskan);
    const terpasangBulanIni = toInt(
        s.terpasangBulanIni != null ? s.terpasangBulanIni
            : (s.terpasang_bulan_ini != null ? s.terpasang_bulan_ini : s.terpasang)
    );
    return { ok: true, belumKepasang, menunggu, ditugaskan, terpasangBulanIni };
}

function buildTicketCard(deps) {
    const reports = deps.getReports() || [];
    let active = 0;
    let belumDiambil = 0;
    for (const r of reports) {
        const status = String((r && r.status) || "").toLowerCase();
        if (DONE_TICKET.has(status)) continue;
        active += 1;
        if (OPEN_TICKET.has(status) || !(r && (r.teknisiId || r.teknisi_id))) belumDiambil += 1;
    }
    return { ok: true, active, belumDiambil };
}

function buildOltCard(deps) {
    const st = deps.getLosState() || {};
    return {
        ok: true,
        activeOutage: toInt(st.activeIncidentCount),
        recovering: toInt(st.recoveringCount),
        pending: toInt(st.pendingCount)
    };
}

/**
 * Susun seluruh cockpit. Tiap kartu terisolasi try/catch → tak pernah throw.
 */
async function buildCockpit(depsOverride = {}) {
    const deps = { ...defaultDeps(), ...depsOverride };
    const card = async (fn) => {
        try { return await fn(deps); }
        catch (err) { return { ok: false, error: (err && err.message) || "gagal" }; }
    };
    const [income, isp, psb] = await Promise.all([
        card(buildIncomeCard), card(buildIspCard), card(buildPsbCard)
    ]);
    let tickets;
    let olt;
    try { tickets = buildTicketCard(deps); } catch (err) { tickets = { ok: false, error: err.message }; }
    try { olt = buildOltCard(deps); } catch (err) { olt = { ok: false, error: err.message }; }
    return {
        generatedAt: new Date(deps.nowMs()).toISOString(),
        income, isp, psb, tickets, olt
    };
}

module.exports = {
    buildCockpit,
    _internal: { buildIncomeCard, buildIspCard, buildPsbCard, buildTicketCard, buildOltCard }
};
