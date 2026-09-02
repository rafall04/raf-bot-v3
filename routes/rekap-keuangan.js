/**
 * Header Doc
 * Purpose: Route HTTP halaman Rekap Keuangan — menyajikan laporan pemasukan/pengeluaran
 *          berbasis `financial_ledger`, beserta ringkasan per metode/domain/sumber.
 * Caller: `lib/routes-registry.js` (mount `/api/rekap-keuangan`), dipakai
 *          `views/sb-admin/rekap-keuangan.php` + `static/js/rekap-keuangan.js`.
 * Deps: `lib/financial-ledger.js`, `lib/payment-method-vocab.js`, `lib/activity-logger.js`.
 * MainFuncs: `mapMethodSummary`, `mapSourceSummary`, `mapEntry`, handler GET/POST router.
 * SideEffects: Membaca `financial_ledger` (users.sqlite) & menulis log aktivitas;
 *          `syncFinancialLedgerSources()` menyinkronkan sumber sebelum melaporkan.
 */

const express = require("express");
const router = express.Router();
const { loadJSON } = require("../lib/database");
const { normalisasiMetode, ejaanUntukEmber } = require("../lib/payment-method-vocab");
const { logActivity } = require("../lib/activity-logger");
const {
    ensureFinancialLedgerTable,
    syncFinancialLedgerSources,
    createManualAdjustment,
    getFinancialLedgerEntries,
    getFinancialLedgerReport,
    buildCashflowSummary
} = require("../lib/financial-ledger");
const { getExpenseSummary } = require("../lib/expense-manager");
const {
    getPaymentDiagnostics,
    getPaymentPositionForPeriod,
    getEffectivePrice,
    normalizePaymentRequestScope
} = require("../lib/payment-finance-service");

function ensureAdmin(req, res, next) {
    if (!req.user || !["admin", "owner", "superadmin"].includes(req.user.role)) {
        return res.status(403).json({ status: 403, message: "Akses ditolak. Hanya admin yang diizinkan." });
    }
    next();
}

function mapMethodSummary(raw) {
    // Enam ember lama tetap disemai nol supaya kartu yang biasa tampil tak hilang saat
    // belum ada transaksinya. Ember baru (online/reversal) hanya muncul bila ada isinya.
    const output = {
        cash: { count: 0, amount: 0 },
        transfer: { count: 0, amount: 0 },
        topup: { count: 0, amount: 0 },
        saldo: { count: 0, amount: 0 },
        agent: { count: 0, amount: 0 },
        payroll: { count: 0, amount: 0 }
    };

    // MENJUMLAH, bukan menimpa.
    //
    // Versi lama menulis `output[normalized] = {...}`, sehingga dua ejaan yang menormal
    // ke ember yang sama saling membunuh — yang tersisip TERAKHIR menang. Terukur di
    // produksi Tanjungharjo: ledger berisi "TRANSFER_BANK" (69 transaksi, Rp8.985.000)
    // DAN "transfer" (1 transaksi, Rp10.000). Karena entri diurut
    // `occurred_at DESC` (lib/financial-ledger.js), "transfer" tersisip belakangan dan
    // MENANG — layar Rekap Keuangan menampilkan Transfer = Rp10.000, menyembunyikan
    // Rp8.985.000 pemasukan yang benar-benar diterima.
    //
    // Ejaan campur itu wajar terjadi: ledger diisi banyak penulis (approval admin,
    // callback gateway, konfirmasi bukti, pembalikan) yang kosakata metodenya belum
    // seragam. Karena itu peringkasnya harus tahan terhadap ejaan baru, bukan
    // mengandalkan semua penulis kebetulan sepakat.
    Object.entries(raw || {}).forEach(([key, value]) => {
        const normalized = normalisasiMetode(key) || "lainnya";
        if (!output[normalized]) {
            // Ejaan di luar 6 ember baku (mis. "qris", "reversal", "mpm") tetap
            // ditampilkan apa adanya daripada dibuang diam-diam — uang yang tak
            // terkategori harus tetap terlihat oleh pemilik usaha.
            output[normalized] = { count: 0, amount: 0 };
        }
        output[normalized].count += value.count || 0;
        output[normalized].amount += value.amount || 0;
    });

    return output;
}

function mapSourceSummary(raw) {
    return {
        admin: raw.admin || { count: 0, amount: 0 },
        teknisi: raw.teknisi || { count: 0, amount: 0 },
        system: raw.system || { count: 0, amount: 0 }
    };
}

function mapEntry(entry) {
    let metadata = {};
    try {
        metadata = entry.metadata_json ? JSON.parse(entry.metadata_json) : {};
    } catch (_error) {
        metadata = {};
    }

    return {
        id: entry.id,
        domain: entry.domain,
        reference_type: entry.reference_type,
        reference_id: entry.reference_id,
        user_id: entry.user_id,
        counterparty_id: entry.counterparty_id,
        amount: entry.amount,
        direction: entry.direction,
        payment_method: entry.payment_method,
        period_month: entry.period_month,
        period_year: entry.period_year,
        status: entry.status,
        occurred_at: entry.occurred_at,
        created_by: entry.created_by,
        notes: entry.notes,
        source: entry.source,
        metadata
    };
}

function formatPeriodLabel(month, year) {
    return `${String(month).padStart(2, "0")}/${year}`;
}

async function buildApprovalConsistency(month, year) {
    const requests = loadJSON("database/requests.json")
        .map(normalizePaymentRequestScope)
        .filter((request) =>
            parseInt(request.period_year, 10) === year
            && (month === null || parseInt(request.period_month, 10) === month)
            && ["payment_status_change", "partial_payment"].includes(request.request_type)
        );

    const summary = {
        scoped_requests: requests.length,
        approved_without_effect: 0,
        pending_obsolete: 0,
        orphaned_requests: 0
    };

    for (const request of requests) {
        const user = (global.users || []).find((item) => String(item.id) === String(request.userId));
        if (!user) {
            summary.orphaned_requests += 1;
            continue;
        }

        const requestMonth = parseInt(request.period_month, 10);
        const requestYear = parseInt(request.period_year, 10);
        const amountDue = request.amount_due || getEffectivePrice(user);
        const position = await getPaymentPositionForPeriod(user, requestMonth, requestYear, { amountDue });

        const approvedExpectedEffect = request.newStatus === true
            ? (request.request_type === "partial_payment" ? position.net_paid > 0 : position.is_fully_paid)
            : (position.total_reversal > 0 || !position.is_fully_paid);

        const pendingObsolete = request.newStatus === true
            ? position.is_fully_paid
            : !position.is_fully_paid;

        if (request.status === "approved" && !approvedExpectedEffect) {
            summary.approved_without_effect += 1;
        }
        if (request.status === "pending" && pendingObsolete) {
            summary.pending_obsolete += 1;
        }
    }

    return summary;
}

async function buildMonthlyTrend({ month, year }) {
    const anchor = month ? new Date(year, month - 1, 1) : new Date(year, new Date().getMonth(), 1);
    const periods = [];

    for (let offset = 5; offset >= 0; offset -= 1) {
        const current = new Date(anchor.getFullYear(), anchor.getMonth() - offset, 1);
        periods.push({
            month: current.getMonth() + 1,
            year: current.getFullYear()
        });
    }

    const trend = [];
    for (const period of periods) {
        const report = await getFinancialLedgerReport({
            month: period.month,
            year: period.year
        });
        const summary = buildCashflowSummary(report.entries);
        trend.push({
            ...period,
            label: formatPeriodLabel(period.month, period.year),
            totalIncome: summary.totalIncome,
            totalExpense: summary.totalExpense,
            netTotal: summary.netTotal
        });
    }
    return trend;
}

function buildCashflowHealth(report, expenseSummary) {
    const warnings = [];
    const totalIncome = report.summary.totalIncome || 0;
    const totalExpense = report.summary.totalExpense || 0;
    const largestExpense = (expenseSummary.largest || [])[0] || null;
    const otherAmount = expenseSummary.by_category?.other?.amount || 0;
    const otherPercentage = totalExpense > 0 ? Math.round((otherAmount / totalExpense) * 100) : 0;

    if (totalExpense > totalIncome) {
        warnings.push({
            code: "expense_over_income",
            message: "Pengeluaran periode ini lebih besar dari pemasukan."
        });
    }
    if (otherPercentage >= 30) {
        warnings.push({
            code: "other_category_high",
            message: `Kategori 'other' menyumbang ${otherPercentage}% pengeluaran. Perlu review klasifikasi.`
        });
    }
    if (largestExpense && largestExpense.amount >= 5000000) {
        warnings.push({
            code: "large_expense_detected",
            message: `Ada pengeluaran besar ${largestExpense.title} senilai Rp ${largestExpense.amount.toLocaleString("id-ID")}.`
        });
    }

    return {
        status: warnings.length > 0 ? "warning" : "healthy",
        warnings,
        totalIncome,
        totalExpense,
        netTotal: report.summary.netTotal || 0
    };
}

ensureFinancialLedgerTable().catch(console.error);

router.get("/", ensureAdmin, async (req, res) => {
    try {
        await syncFinancialLedgerSources();
        const month = req.query.type === "year" ? null : (req.query.month ? parseInt(req.query.month, 10) : new Date().getMonth() + 1);
        const year = req.query.year ? parseInt(req.query.year, 10) : new Date().getFullYear();
        const report = await getFinancialLedgerReport({
            month,
            year,
            domain: req.query.domain || null,
            direction: req.query.direction || null,
            // Filter dikirim sebagai EMBER (mis. "cash"), lalu dimekarkan ke SEMUA ejaan
            // mentahnya ("cash", "CASH", "TUNAI"). Versi lama mencocokkan satu ejaan
            // persis, sehingga memilih "Cash" melewatkan baris yang tersimpan dengan
            // ejaan lain — terukur di produksi, kolom ini memuat lima kosakata berbeda.
            paymentMethod: req.query.payment_method ? ejaanUntukEmber(req.query.payment_method) : null,
            source: req.query.source || null
        });
        const expenseSummary = await getExpenseSummary({ month, year });
        const monthlyTrend = await buildMonthlyTrend({ month, year });
        const cashflowSummary = buildCashflowSummary(report.entries);
        const recentExpenses = (expenseSummary.recent || []).map((item) => ({
            id: item.id,
            title: item.title,
            category: item.category,
            amount: item.amount,
            expense_date: item.expense_date,
            payment_method: item.payment_method,
            vendor_or_counterparty: item.vendor_or_counterparty,
            status: item.status
        }));
        const largestExpenses = (expenseSummary.largest || []).map((item) => ({
            id: item.id,
            title: item.title,
            category: item.category,
            amount: item.amount,
            expense_date: item.expense_date,
            payment_method: item.payment_method,
            vendor_or_counterparty: item.vendor_or_counterparty,
            status: item.status
        }));

        // #b311 (T1): biaya rutin (internet/listrik/cicilan) yang BELUM dibukukan periode ini.
        // Tanpa ini halaman menampilkan laba tampak "bersih" padahal biaya tetap terbesar belum
        // dikurangkan (laba fiktif). Hanya bermakna untuk PERIODE BERJALAN (penanda settled per-periode).
        let recurringUnbooked = null;
        try {
            const now = new Date();
            const isPeriodeBerjalan = month != null && month === (now.getMonth() + 1) && year === now.getFullYear();
            if (isPeriodeBerjalan) {
                const rec = require("../lib/recurring-expense");
                const semua = await rec.listAll();
                const periode = rec.periodeSekarang(now);
                const hariTerakhir = new Date(year, month, 0).getDate();
                const hariIni = now.getDate();
                let total = 0;
                let count = 0;
                let overdue = 0;
                const byKategori = {};
                for (const r of semua) {
                    if (!r.aktif) continue;
                    if (r.last_settled_period === periode) continue;
                    const n = Number(r.perkiraan) || 0;
                    total += n;
                    count += 1;
                    byKategori[r.kategori] = (byKategori[r.kategori] || 0) + n;
                    if (Math.min(Number(r.tanggal) || 1, hariTerakhir) < hariIni) overdue += 1;
                }
                recurringUnbooked = { total, count, overdue, byKategori };
            }
        } catch (recErr) {
            console.error("[REKAP_RECURRING_UNBOOKED_ERROR]", recErr && recErr.message);
        }

        const cashflowHealth = buildCashflowHealth({ summary: cashflowSummary }, expenseSummary);
        if (recurringUnbooked && recurringUnbooked.total > 0) {
            cashflowHealth.status = "warning";
            cashflowHealth.warnings.push({
                code: "recurring_unbooked",
                message: `Ada Rp ${recurringUnbooked.total.toLocaleString("id-ID")} biaya rutin (${recurringUnbooked.count} tagihan${recurringUnbooked.overdue ? `, ${recurringUnbooked.overdue} lewat tanggal` : ""}) BELUM dibukukan bulan ini — laba di atas belum dikurangi biaya ini. Konfirmasi di halaman Kas Usaha.`
            });
        }

        res.json({
            status: 200,
            data: {
                period: month ? `${month}/${year}` : `Tahun ${year}`,
                summary: cashflowSummary,
                domainSummary: report.domainSummary,
                methodSummary: mapMethodSummary(report.methodSummary),
                sourceSummary: mapSourceSummary(report.sourceSummary),
                expenseCategorySummary: expenseSummary.by_category || {},
                recentExpenses,
                largestExpenses,
                monthlyTrend,
                cashflowHealth,
                recurringUnbooked,
                transactions: report.entries.map(mapEntry)
            }
        });
    } catch (error) {
        console.error("[REKAP_KEUANGAN_ERROR]", error);
        res.status(500).json({ status: 500, message: "Gagal mengambil rekap keuangan" });
    }
});

router.get("/adjustments", ensureAdmin, async (req, res) => {
    try {
        await ensureFinancialLedgerTable();
        const rows = await getFinancialLedgerEntries({
            month: req.query.type === "year" ? null : req.query.month,
            year: req.query.year,
            domain: "manual_adjustment"
        });
        res.json({ status: 200, data: rows.map(mapEntry) });
    } catch (error) {
        console.error("[REKAP_ADJUSTMENT_GET_ERROR]", error);
        res.status(500).json({ status: 500, message: "Gagal mengambil adjustment" });
    }
});

router.post("/adjustments", ensureAdmin, async (req, res) => {
    try {
        const requestActionId = req.body.request_action_id
            || req.headers["x-idempotency-key"]
            || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const payload = {
            direction: req.body.direction,
            amount: req.body.amount,
            reason: req.body.reason,
            domainTarget: req.body.domain_target,
            periodMonth: parseInt(req.body.period_month, 10),
            periodYear: parseInt(req.body.period_year, 10),
            notes: req.body.notes || "",
            requestActionId
        };
        const result = await createManualAdjustment(payload, {
            id: req.user.id,
            username: req.user.username,
            name: req.user.name || req.user.username
        });

        if (result.status === "created") {
            logActivity({
                userId: req.user.id,
                username: req.user.username,
                role: req.user.role,
                actionType: "CREATE",
                resourceType: "financial_adjustment",
                resourceId: result.id ? String(result.id) : payload.reason,
                resourceName: `Adjustment ${payload.domainTarget}`,
                description: `Membuat manual adjustment ${payload.direction} Rp ${parseInt(payload.amount, 10).toLocaleString("id-ID")} untuk ${payload.domainTarget}`,
                ipAddress: req.ip,
                userAgent: req.headers["user-agent"]
            }).catch(console.error);

            return res.status(201).json({
                status: 201,
                message: "Manual adjustment berhasil dibuat",
                data: { result: "created", request_action_id: result.requestActionId }
            });
        }

        return res.status(200).json({
            status: 200,
            message: "Request adjustment duplikat terdeteksi",
            data: { result: "duplicate_retry", request_action_id: result.requestActionId }
        });
    } catch (error) {
        console.error("[REKAP_ADJUSTMENT_CREATE_ERROR]", error);
        res.status(400).json({ status: 400, message: error.message || "Gagal membuat adjustment" });
    }
});

router.get("/diagnostics", ensureAdmin, async (req, res) => {
    try {
        const isYearScope = req.query.type === "year";
        const month = isYearScope ? null : (req.query.month ? parseInt(req.query.month, 10) : new Date().getMonth() + 1);
        const year = req.query.year ? parseInt(req.query.year, 10) : new Date().getFullYear();
        const syncStats = await syncFinancialLedgerSources();
        const report = await getFinancialLedgerReport({ month, year });
        const summary = buildCashflowSummary(report.entries);
        const recomputedSummary = buildCashflowSummary(report.entries.map((entry) => ({
            ...entry,
            amount: entry.amount,
            direction: entry.direction,
            domain: entry.domain
        })));
        const paymentDiagnostics = await getPaymentDiagnostics({ periodMonth: month, periodYear: year });
        const approvalConsistency = await buildApprovalConsistency(month, year);
        const settlementEntries = report.entries.filter((entry) => entry.domain === "technician_collection_commission");
        const reversalEntries = report.entries.filter((entry) => entry.domain === "customer_payment_reversal");
        const settlementStatus = settlementEntries.reduce((accumulator, entry) => {
            const key = entry.status || "unknown";
            accumulator[key] = (accumulator[key] || 0) + 1;
            return accumulator;
        }, {});

        res.json({
            status: 200,
            data: {
                period: month ? `${month}/${year}` : `Tahun ${year}`,
                paymentReversals: {
                    count: reversalEntries.length,
                    amount: reversalEntries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
                },
                ledgerSync: syncStats,
                paidStatusMismatch: paymentDiagnostics.mismatched_paid_status,
                paidStatusPeriod: {
                    month: paymentDiagnostics.current_period_month,
                    year: paymentDiagnostics.current_period_year
                },
                summaryMismatch: {
                    incomeDifference: summary.totalIncome - recomputedSummary.totalIncome,
                    expenseDifference: summary.totalExpense - recomputedSummary.totalExpense,
                    netDifference: summary.netTotal - recomputedSummary.netTotal
                },
                approvalConsistency,
                settlementStatus
            }
        });
    } catch (error) {
        console.error("[REKAP_DIAGNOSTICS_ERROR]", error);
        res.status(500).json({ status: 500, message: "Gagal mengambil diagnostics keuangan" });
    }
});

module.exports = router;
