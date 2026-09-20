/**
 * Header Doc
 * Purpose: Read-model pembayaran — timeline, laporan periode, diagnostics.
 * Caller: facade `lib/payment-finance-service.js` (re-export; jangan require langsung kecuali test).
 * Deps: ./ledger, ./account-classification, ./database.
 * MainFuncs: `getPaymentTimelineForPeriod`, `getPaymentReportForPeriod`, `getPaymentDiagnostics`.
 * SideEffects: sama seperti lib/payment-finance-service.js asli (split #b394 — murni pemindahan kode).
 */
"use strict";

const { getRuntimeRepository, readerGet, readerAll, withReaderContext, toInteger, getCurrentBillingPeriod, ensurePaymentFinanceTables, getPaymentPositionForPeriod } = require('./ledger');
const { loadJSON } = require("../database");
const { isInfrastructure } = require("../account-classification");

async function getPaymentTimelineForPeriod(userId, periodMonth = null, periodYear = null) {
    await ensurePaymentFinanceTables();
    const params = [userId];
    const where = ["user_id = ?"];

    if (Number.isInteger(periodMonth) && Number.isInteger(periodYear)) {
        where.push("period_month = ?", "period_year = ?");
        params.push(periodMonth, periodYear);
    }

    const { paymentRows, reversalRows } = await withReaderContext(async (context) => ({
        paymentRows: await readerAll(
            `SELECT
                ph.id,
                ph.user_id,
                ph.amount_paid,
                ph.amount_due,
                ph.is_partial,
                ph.period_month,
                ph.period_year,
                ph.payment_method,
                ph.notes,
                ph.created_by,
                ph.created_at,
                u.name AS user_name,
                u.subscription,
                u.phone_number
             FROM payment_history ph
             LEFT JOIN users u ON ph.user_id = u.id
             WHERE ${where.join(" AND ")}
             ORDER BY datetime(ph.created_at) DESC, ph.id DESC`,
            params,
            context
        ),
        reversalRows: await readerAll(
            `SELECT
                pr.id,
                pr.user_id,
                pr.amount_reversed,
                pr.period_month,
                pr.period_year,
                pr.reason,
                pr.created_by,
                pr.created_at,
                pr.source_request_id,
                pr.source_admin_action,
                u.name AS user_name,
                u.subscription,
                u.phone_number
             FROM payment_reversals pr
             LEFT JOIN users u ON pr.user_id = u.id
             WHERE ${where.join(" AND ")} AND pr.status = 'completed'
             ORDER BY datetime(pr.created_at) DESC, pr.id DESC`,
            params,
            context
        )
    }));

    const entries = [
        ...paymentRows.map((row) => ({
            type: "payment",
            id: row.id,
            user_id: row.user_id,
            user_name: row.user_name || null,
            subscription: row.subscription || null,
            phone_number: row.phone_number || null,
            amount: toInteger(row.amount_paid),
            signed_amount: toInteger(row.amount_paid),
            amount_due: toInteger(row.amount_due),
            is_partial: Boolean(row.is_partial),
            payment_method: row.payment_method || null,
            notes: row.notes || "",
            created_by: row.created_by || "system",
            created_at: row.created_at,
            period_month: toInteger(row.period_month),
            period_year: toInteger(row.period_year)
        })),
        ...reversalRows.map((row) => ({
            type: "reversal",
            id: row.id,
            user_id: row.user_id,
            user_name: row.user_name || null,
            subscription: row.subscription || null,
            phone_number: row.phone_number || null,
            amount: toInteger(row.amount_reversed),
            signed_amount: -Math.abs(toInteger(row.amount_reversed)),
            amount_due: 0,
            is_partial: false,
            payment_method: "REVERSAL",
            notes: row.reason || "",
            created_by: row.created_by || "system",
            created_at: row.created_at,
            period_month: toInteger(row.period_month),
            period_year: toInteger(row.period_year),
            source_request_id: row.source_request_id || null,
            source_admin_action: row.source_admin_action || null
        }))
    ].sort((left, right) => {
        const timeDiff = new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
        if (timeDiff !== 0) {
            return timeDiff;
        }
        return toInteger(right.id) - toInteger(left.id);
    });

    const grossPaid = paymentRows.reduce((sum, row) => sum + toInteger(row.amount_paid), 0);
    const totalReversal = reversalRows.reduce((sum, row) => sum + toInteger(row.amount_reversed), 0);

    return {
        entries,
        summary: {
            payment_transactions: paymentRows.length,
            reversal_transactions: reversalRows.length,
            total_transactions: entries.length,
            gross_paid: grossPaid,
            total_reversal: totalReversal,
            net_paid: Math.max(0, grossPaid - totalReversal)
        }
    };
}


async function getPaymentReportForPeriod(periodMonth, periodYear) {
    await ensurePaymentFinanceTables();

    const { payments, reversals } = await withReaderContext(async (context) => ({
        payments: await readerAll(
            `SELECT
                ph.*,
                u.name AS user_name,
                u.subscription,
                u.phone_number
             FROM payment_history ph
             LEFT JOIN users u ON ph.user_id = u.id
             WHERE ph.period_month = ? AND ph.period_year = ?
             ORDER BY datetime(ph.created_at) DESC, ph.id DESC`,
            [periodMonth, periodYear],
            context
        ),
        reversals: await readerAll(
            `SELECT
                pr.*,
                u.name AS user_name,
                u.subscription,
                u.phone_number
             FROM payment_reversals pr
             LEFT JOIN users u ON pr.user_id = u.id
             WHERE pr.period_month = ? AND pr.period_year = ? AND pr.status = 'completed'
             ORDER BY datetime(pr.created_at) DESC, pr.id DESC`,
            [periodMonth, periodYear],
            context
        )
    }));

    const transactions = [
        ...payments.map((row) => ({
            type: "payment",
            id: row.id,
            user_id: row.user_id,
            user_name: row.user_name || null,
            subscription: row.subscription || null,
            phone_number: row.phone_number || null,
            amount: toInteger(row.amount_paid),
            signed_amount: toInteger(row.amount_paid),
            amount_due: toInteger(row.amount_due),
            is_partial: Boolean(row.is_partial),
            payment_method: row.payment_method || null,
            notes: row.notes || "",
            created_by: row.created_by || "system",
            created_at: row.created_at,
            period_month: toInteger(row.period_month),
            period_year: toInteger(row.period_year)
        })),
        ...reversals.map((row) => ({
            type: "reversal",
            id: row.id,
            user_id: row.user_id,
            user_name: row.user_name || null,
            subscription: row.subscription || null,
            phone_number: row.phone_number || null,
            amount: toInteger(row.amount_reversed),
            signed_amount: -Math.abs(toInteger(row.amount_reversed)),
            amount_due: 0,
            is_partial: false,
            payment_method: "REVERSAL",
            notes: row.reason || "",
            created_by: row.created_by || "system",
            created_at: row.created_at,
            period_month: toInteger(row.period_month),
            period_year: toInteger(row.period_year),
            source_request_id: row.source_request_id || null,
            source_admin_action: row.source_admin_action || null
        }))
    ].sort((left, right) => {
        const timeDiff = new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
        if (timeDiff !== 0) {
            return timeDiff;
        }
        return toInteger(right.id) - toInteger(left.id);
    });

    const grossPaid = payments.reduce((sum, row) => sum + toInteger(row.amount_paid), 0);
    const totalReversal = reversals.reduce((sum, row) => sum + toInteger(row.amount_reversed), 0);

    return {
        period_month: periodMonth,
        period_year: periodYear,
        summary: {
            payment_transactions: payments.length,
            reversal_transactions: reversals.length,
            total_transactions: transactions.length,
            gross_paid: grossPaid,
            total_reversal: totalReversal,
            net_paid: Math.max(0, grossPaid - totalReversal),
            partial_payments: payments.filter((row) => Boolean(row.is_partial)).length,
            full_payments: payments.filter((row) => !Boolean(row.is_partial)).length
        },
        transactions
    };
}


async function getPaymentDiagnostics({ periodMonth, periodYear } = {}) {
    await ensurePaymentFinanceTables();

    const date = new Date();
    const month = Number.isInteger(periodMonth) ? periodMonth : date.getMonth() + 1;
    const year = Number.isInteger(periodYear) ? periodYear : date.getFullYear();

    const reversalRow = await withReaderContext((context) => readerGet(
        `SELECT COUNT(*) AS total, COALESCE(SUM(amount_reversed), 0) AS amount
         FROM payment_reversals
         WHERE period_month = ? AND period_year = ? AND status = 'completed'`,
        [month, year],
        context
    ));

    const currentBilling = getCurrentBillingPeriod();
    const mismatches = [];
    const usersRepo = getRuntimeRepository("users");
    const users = usersRepo ? usersRepo.getAll() : (global.users || []);
    // Lewati akun infra & paket whitelist (gratis/immun billing) — SAMA dengan filter reconcile
    // (`paid-flag-reconcile.js`). Flag `users.paid` mereka memang tak dipelihara (selalu 0), sedangkan
    // ledger-nya lunas (tagihan Rp0), jadi membandingkannya hanya menghasilkan "mismatch" palsu yang
    // mengaburkan drift nyata.
    const packagesRepo = getRuntimeRepository("packages");
    const packagesDb = packagesRepo ? packagesRepo.getAll() : loadJSON("database/packages.json");
    const whitelistedNames = new Set((packagesDb || []).filter((pkg) => pkg && pkg.whitelist === true).map((pkg) => pkg.name));
    for (const user of users) {
        if (isInfrastructure(user) || whitelistedNames.has(user.subscription)) {
            continue;
        }
        const position = await getPaymentPositionForPeriod(user, currentBilling.periodMonth, currentBilling.periodYear);
        if (Boolean(toInteger(user.paid)) !== Boolean(position.is_fully_paid)) {
            mismatches.push({
                user_id: String(user.id),
                user_name: user.name,
                paid_flag: Boolean(toInteger(user.paid)),
                is_fully_paid: position.is_fully_paid,
                net_paid: position.net_paid,
                outstanding: position.outstanding,
                period_month: currentBilling.periodMonth,
                period_year: currentBilling.periodYear
            });
        }
    }

    return {
        period_month: month,
        period_year: year,
        current_period_month: currentBilling.periodMonth,
        current_period_year: currentBilling.periodYear,
        reversal_count: toInteger(reversalRow?.total),
        reversal_amount: toInteger(reversalRow?.amount),
        mismatched_paid_status: mismatches
    };
}


module.exports = {
    isInfrastructure,
    getPaymentTimelineForPeriod,
    getPaymentReportForPeriod,
    getPaymentDiagnostics,
};
