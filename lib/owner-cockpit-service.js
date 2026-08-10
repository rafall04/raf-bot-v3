/**
 * Header Doc
 * Purpose: Agregasi "Owner Cockpit" — ringkasan sekali-baca owner: Pemasukan (net_paid + hari ini +
 *          tunggakan + tingkat pelunasan + MRR), Status ISP (+trafik agregat), PSB (belum kepasang +
 *          terpasang + komisi), Tiket (aktif + per-status + lama), Outage OLT (LOS + offline),
 *          Pelanggan (aktif/isolir/baru/PPPoE online/offline), dan Perlu Tindakan (bukti bayar/ganti paket/topup).
 *          Tiap kartu BEST-EFFORT & TERISOLASI: satu sumber gagal → kartu itu `{ok:false}` tapi kartu lain
 *          tetap terisi (halaman tak pernah 500). Read-only; data dari service existing.
 *          ISOLIR dibaca dari PROFIL PPPoE LIVE MikroTik (== config.isolir_profile), BUKAN `users.status`
 *          (kolom itu tak pernah ditulis 'isolir' → selalu 0). Tak terbaca → `isolir: null` (jujur "tak bisa
 *          dipastikan"), tak pernah 0 palsu.
 * Caller: `routes/admin-owner-cockpit-routes.js` (GET /api/owner/cockpit).
 * Deps (lazy + guard, injectable utk test): payment-finance-service (getPaymentReportForPeriod/
 *       getEffectivePrice/getCurrentBillingPeriod), services/arrears.service, upstream-quality-poller
 *       (buildStatusReport/getMonitorConfig), psb-schedule-service.getScheduleSummary, global.reports,
 *       olt-los-broadcaster.getLosState, lib/mikrotik.getPppStats (DI-CACHE 90s — mahal),
 *       services/isolir-service.buildProfileMap (peta profil PPPoE live; DI-CACHE 90s — mahal),
 *       global.users + account-classification.isInfrastructure, payment-proof.repository,
 *       saldo-manager.getPendingTopupRequests, global.{packageChangeRequests,requests}.
 * MainFuncs: `buildCockpit`.
 * SideEffects: Cache in-memory PPP stats + peta profil PPPoE (TTL 90s) — bukan tulis DB.
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

// Peta profil PPPoE LIVE (pppoe_username → profil) dari MikroTik. INI sumber kebenaran ISOLIR —
// BUKAN `users.status`: tak ada satu pun kode non-test yang menulis `status='isolir'` (status
// selamanya 'active'), jadi hitungan berbasis status SELALU 0. Cron `lib/cron/jobs/isolir.js` hanya
// PUSH profil ke MikroTik, dan `isolir-notification.js` pun menentukan "siapa terisolir" dari profil
// LIVE. Reuse `IsolirService.buildProfileMap` (1 sumber kebenaran). Mahal (RouterOS) → cache 90s.
let _profileCache = { at: 0, data: null };
async function getIsolirProfileMapCached() {
    const now = Date.now();
    if (_profileCache.data && now - _profileCache.at < 90000) return _profileCache.data;
    const map = await require("./services/isolir-service").buildProfileMap();
    _profileCache = { at: now, data: map };
    return map;
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
        getProfileMap: getIsolirProfileMapCached,
        getIsolirProfile: () => ((typeof global !== "undefined" && global.config && global.config.isolir_profile) || ""),
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
// NISAN: `isIsolir(u)` berbasis `users.status` DIHAPUS — SELALU false karena tak ada satu pun kode
// non-test yang menulis `status='isolir'`. JANGAN dihidupkan lagi. Isolir = profil PPPoE LIVE
// (config.isolir_profile) → lihat getIsolirProfileMapCached + buildCustomerCard.
function pppoeOf(u) { return String((u && (u.pppoe_username || u.username || u.user)) || "").toLowerCase(); }
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
    // MRR/target bulanan = SELURUH pelanggan tagih (non-infra). Pelanggan TERISOLIR tetap dihitung:
    // mereka diisolir justru KARENA belum bayar — tagihannya masih berjalan. (Dulu di-filter
    // `!isIsolir(u)` berbasis users.status yang TAK PERNAH bernilai 'isolir' → efektif tak memfilter
    // apa pun. Kini eksplisit, supaya niatnya jelas dan tak berubah diam-diam saat isolir diperbaiki.)
    const mrr = cust.reduce((s, u) => s + (toInt(deps.getEffectivePrice(u)) || 0), 0);
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

async function buildCustomerCard(deps, ppp) {
    const now = new Date(deps.nowMs());
    const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const cust = (deps.getUsers() || []).filter((u) => !deps.isInfrastructure(u));
    const baru = cust.filter((u) => String((u && u.created_at) || "").slice(0, 7) === prefix).length;
    const pppoeOnline = (ppp && ppp.ok && ppp.data && ppp.data.online != null) ? toInt(ppp.data.online) : null;

    // ISOLIR = profil PPPoE LIVE == config.isolir_profile (mis. "ISOLIR"), BUKAN users.status.
    // Tak terbaca (MikroTik mati / isolir_profile tak diset) → isolirSet null → `isolir: null`
    // = JUJUR "tak bisa dipastikan", BUKAN 0 yang berbohong "aman".
    // Prinsip proyek: "cannot observe" ≠ "observed good".
    let isolirSet = null;
    try {
        const target = String((deps.getIsolirProfile && deps.getIsolirProfile()) || "").trim().toLowerCase();
        const map = deps.getProfileMap ? await deps.getProfileMap() : null;
        if (target && map && typeof map.forEach === "function") {
            const set = new Set();
            map.forEach((profile, pppoe) => {
                if (String(profile || "").trim().toLowerCase() === target) set.add(String(pppoe).toLowerCase());
            });
            isolirSet = set;
        }
    } catch (_e) { isolirSet = null; }

    const isIsolirLive = (u) => Boolean(isolirSet && isolirSet.has(pppoeOf(u)));
    const isolir = isolirSet ? cust.filter(isIsolirLive).length : null;
    const aktif = cust.length - (isolir || 0);
    // Presisi "pelanggan offline": pelanggan AKTIF (non-infra & non-isolir) yang pppoe_username-nya ada di
    // daftar sesi PPPoE mati (inactive_users_list) — bukan sekadar total secret offline (yang ikut hitung
    // isolir yang memang sengaja mati + akun infra). Butuh inactive_users_list; absen → null.
    // Butuh DUA bukti: daftar sesi mati (ppp) DAN peta isolir. Tanpa peta isolir, angka ini ikut
    // menghitung pelanggan yang SENGAJA diisolir sebagai "offline" → alarm merah palsu. Bukan
    // "offline presisi" lagi, jadi lebih baik `null` ("—") daripada angka yang menyesatkan owner.
    let offline = null;
    if (isolirSet && ppp && ppp.ok && ppp.data && Array.isArray(ppp.data.inactive_users_list)) {
        const off = new Set(ppp.data.inactive_users_list
            .map((x) => String((x && (x.username || x.name || x.user)) || x || "").toLowerCase())
            .filter(Boolean));
        offline = cust.filter((u) => {
            if (isIsolirLive(u)) return false; // isolir memang SENGAJA dimatikan, bukan gangguan
            const pu = pppoeOf(u);
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
 *
 * `card` = jalur ASYNC (di-await), `safe` = jalur SINKRON. Kartu async WAJIB lewat `card`: kalau
 * dititipkan ke `safe`, yang balik adalah Promise — lolos tanpa error, lalu jadi `{}` di JSON
 * respons (kartu kosong senyap, tanpa jejak apa pun).
 */
async function buildCockpit(depsOverride = {}) {
    const deps = { ...defaultDeps(), ...depsOverride };
    const card = async (fn, arg) => { try { return await fn(deps, arg); } catch (err) { return { ok: false, error: (err && err.message) || "gagal" }; } };
    const safe = (fn, arg) => { try { return fn(deps, arg); } catch (err) { return { ok: false, error: (err && err.message) || "gagal" }; } };

    let ppp = null;
    try { ppp = await deps.getPppStats(); } catch (_e) { ppp = null; }

    // buildCustomerCard ASYNC (butuh peta profil PPPoE live utk isolir) → ikut Promise.all.
    const [income, isp, psb, customers] = await Promise.all([
        card(buildIncomeCard),
        card(buildIspCard),
        card(buildPsbCard),
        card(buildCustomerCard, ppp),
    ]);
    const tickets = safe(buildTicketCard);
    const olt = safe(buildOltCard, ppp);
    const actions = safe(buildActionCard);

    return { generatedAt: new Date(deps.nowMs()).toISOString(), income, isp, psb, tickets, olt, customers, actions };
}

/**
 * HANYA kartu Pemasukan. Dipakai ringkasan uang di grup kas: `buildCockpit()` ikut memanggil
 * MikroTik `getPppStats` (spawn PHP + RouterOS, ~12 dtk) yang sama sekali tak dibutuhkan angka
 * uang — memakainya untuk sebuah balasan WhatsApp berarti menghajar RouterOS demi teks.
 * Sama-sama best-effort: gagal → `{ ok:false }`, bukan melempar.
 */
async function buildIncomeOnly(depsOverride = {}) {
    const deps = { ...defaultDeps(), ...depsOverride };
    try {
        return await buildIncomeCard(deps);
    } catch (err) {
        return { ok: false, error: (err && err.message) || "gagal" };
    }
}

/**
 * Omset yang MASIH BISA DITAGIH — pelanggan terisolir DIKELUARKAN.
 *
 * Beda sengaja dari `mrr` di kartu Pemasukan, yang IKUT menghitung yang terisolir karena
 * tagihan mereka memang masih berjalan. Dua angka ini menjawab pertanyaan berbeda:
 *   `mrr`        = potensi penuh kalau semua orang membayar;
 *   `omsetAktif` = yang realistis masuk bulan ini, untuk mengelola arus kas.
 * Karena itu keduanya dipulangkan bersama beserta selisihnya — dua angka bernama "omset"
 * yang beda tanpa penjelasan adalah cara tercepat membuat pemiliknya tak percaya keduanya.
 *
 * ISOLIR dibaca dari PROFIL PPPoE LIVE (== config.isolir_profile), BUKAN `users.status`.
 * Peta itu MAHAL (RouterOS) → memakai cache 90 dtk yang sama dengan cockpit.
 * Tak terbaca ⇒ `isolirTerbaca:false` dan `omsetAktif` SAMA DENGAN mrr; jangan pernah
 * diam-diam mengurangi apa pun berdasarkan tebakan.
 */
async function buildOmsetAktif(depsOverride = {}) {
    const deps = { ...defaultDeps(), ...depsOverride };
    const cust = (deps.getUsers() || []).filter((u) => !deps.isInfrastructure(u));

    let isolirSet = null;
    try {
        const target = String(deps.getIsolirProfile() || "").trim().toLowerCase();
        const map = deps.getProfileMap ? await deps.getProfileMap() : null;
        if (target && map && typeof map.forEach === "function") {
            const set = new Set();
            map.forEach((profile, pppoe) => {
                if (String(profile || "").trim().toLowerCase() === target) set.add(String(pppoe).toLowerCase());
            });
            isolirSet = set;
        }
    } catch (_e) {
        isolirSet = null;
    }

    const harga = (u) => toInt(deps.getEffectivePrice(u)) || 0;
    const terisolir = (u) => {
        if (!isolirSet) return false;
        const p = String(u && u.pppoe_username ? u.pppoe_username : "").toLowerCase();
        return p ? isolirSet.has(p) : false;
    };

    let mrr = 0;
    let omsetAktif = 0;
    let isolirJumlah = 0;
    let isolirNilai = 0;
    for (const u of cust) {
        const h = harga(u);
        mrr += h;
        if (terisolir(u)) {
            isolirJumlah += 1;
            isolirNilai += h;
        } else {
            omsetAktif += h;
        }
    }

    return {
        ok: true,
        isolirTerbaca: isolirSet !== null,
        totalPelanggan: cust.length,
        mrr,
        omsetAktif,
        isolirJumlah: isolirSet ? isolirJumlah : null,
        isolirNilai: isolirSet ? isolirNilai : null
    };
}

module.exports = {
    buildCockpit,
    buildIncomeOnly,
    buildOmsetAktif,
    _internal: { buildIncomeCard, buildIspCard, buildPsbCard, buildTicketCard, buildOltCard, buildCustomerCard, buildActionCard }
};
