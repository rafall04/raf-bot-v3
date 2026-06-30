/**
 * Header Doc
 * Purpose: Menyediakan API payment status berbasis ledger periodik untuk bulk update, read model halaman admin, diagnostics mismatch, dan bayar di muka (prabayar cash).
 * Caller: `lib/routes-registry.js` dan frontend `static/js/payment-status.js`.
 * Deps: `lib/payment-finance-service`, `lib/approval-logic`, `lib/services/advance-payment-service`, dan helper periode teknisi.
 * MainFuncs: `POST /bulk-update`, `GET /read-model`, `GET /diagnostics`, `POST /advance`.
 * SideEffects: Menulis histori/reversal pembayaran via payment finance service, mengirim side effect final paid, dan mencatat prabayar + struk WA bila diperlukan.
 */
const express = require('express');
const { handlePaidStatusChange } = require('../lib/approval-logic');
const { getPeriodParts } = require('../lib/technician-collection-settlement');
const {
    applyPaymentStatusChange,
    getEffectivePrice,
    getPaymentDiagnostics,
    getPaymentPositionForPeriod,
    normalizeUserPaymentMethod
} = require('../lib/payment-finance-service');
const { createAdvancePaymentService } = require('../lib/services/advance-payment-service');

const advancePaymentService = createAdvancePaymentService();

const router = express.Router();

// Middleware for admin-only routes
function ensureAdmin(req, res, next) {
    if (!req.user || !['admin', 'owner', 'superadmin'].includes(req.user.role)) {
        return res.status(403).json({ status: 403, message: "Akses ditolak." });
    }
    next();
}

// POST /api/payment-status/bulk-update
router.post('/bulk-update', ensureAdmin, async (req, res) => {
    const { userIds, paid } = req.body;
    console.log('[PAYMENT_STATUS_BULK_UPDATE_ROUTE_HIT]', {
        userCount: Array.isArray(userIds) ? userIds.length : 0,
        paid,
        period_month: req.body.period_month,
        period_year: req.body.period_year,
        actor: req.user ? req.user.username : null
    });
    
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({ message: 'User IDs array is required' });
    }
    
    if (typeof paid !== 'boolean') {
        return res.status(400).json({ message: 'Paid status must be a boolean' });
    }
    const requestPeriodMonth = parseInt(req.body.period_month, 10);
    const requestPeriodYear = parseInt(req.body.period_year, 10);
    if (!Number.isInteger(requestPeriodMonth) || !Number.isInteger(requestPeriodYear)) {
        return res.status(400).json({ message: 'period_month dan period_year wajib diisi' });
    }
    
    const results = {
        success: [],
        failed: []
    };
    
    const actionId = req.body.request_action_id
        || req.headers['x-idempotency-key']
        || `bulk-payment-status:${Date.now()}`;
    for (const userId of userIds) {
        try {
            const user = global.users.find(u => String(u.id) === String(userId));
            if (!user) {
                results.failed.push({ userId, reason: 'User not found' });
                continue;
            }
            
            const { periodMonth, periodYear } = getPeriodParts({
                periodMonth: requestPeriodMonth,
                periodYear: requestPeriodYear,
                date: new Date()
            });

            if (paid) {
                const rawPaymentMethod = req.body.paymentMethod;
                const paymentMethod = normalizeUserPaymentMethod(rawPaymentMethod);
                if (!paymentMethod) {
                    results.failed.push({ userId, reason: 'paymentMethod wajib CASH atau TRANSFER_BANK' });
                    continue;
                }
                const result = await applyPaymentStatusChange({
                    user,
                    paid: true,
                    periodMonth,
                    periodYear,
                    amountPaid: req.body.amount_paid || getEffectivePrice(user),
                    amountDue: req.body.amount_due || getEffectivePrice(user),
                    isPartial: false,
                    paymentMethod,
                    notes: req.body.notes || 'Status pembayaran diperbarui oleh admin',
                    createdBy: req.user.username,
                    sourceAdminAction: `${actionId}:${userId}:paid`,
                    onFinalPaid: async () => {
                        await handlePaidStatusChange(user, {
                            paidDate: new Date().toISOString(),
                            method: paymentMethod,
                            approvedBy: req.user.username,
                            notes: req.body.notes || 'Status pembayaran diperbarui oleh admin'
                        });
                    }
                });
                if (result.action === 'no_change') {
                    results.failed.push({ userId, reason: result.reason || 'no_change' });
                    continue;
                }
            } else {
                const result = await applyPaymentStatusChange({
                    user,
                    paid: false,
                    periodMonth,
                    periodYear,
                    amountDue: req.body.amount_due || getEffectivePrice(user),
                    notes: req.body.notes || 'Status pembayaran dibalik oleh admin',
                    createdBy: req.user.username,
                    sourceAdminAction: `${actionId}:${userId}:unpaid`
                });
                if (result.action !== 'reversed') {
                    results.failed.push({ userId, reason: result.reason || result.action || 'no_change' });
                    continue;
                }
            }
            
            results.success.push(userId);
        } catch (error) {
            console.error(`[BULK_UPDATE_ERROR] Failed to process user ${userId}:`, error);
            results.failed.push({ userId, reason: error.message });
        }
    }

    return res.json({
        status: 200,
        message: `Bulk update completed. Success: ${results.success.length}, Failed: ${results.failed.length}`,
        results
    });
});

router.get('/read-model', ensureAdmin, async (req, res) => {
    const requestPeriodMonth = parseInt(req.query.period_month, 10);
    const requestPeriodYear = parseInt(req.query.period_year, 10);

    if (!Number.isInteger(requestPeriodMonth) || !Number.isInteger(requestPeriodYear)) {
        return res.status(400).json({ status: 400, message: 'period_month dan period_year wajib diisi' });
    }

    try {
        const users = global.users || [];
        const data = await Promise.all(users.map(async (user) => {
            const amountDue = getEffectivePrice(user);
            const position = await getPaymentPositionForPeriod(user, requestPeriodMonth, requestPeriodYear, {
                amountDue
            });

            return {
                ...user,
                paid: position.is_fully_paid ? 1 : 0,
                paid_status_period_month: requestPeriodMonth,
                paid_status_period_year: requestPeriodYear,
                amount_due: amountDue,
                total_paid: position.net_paid,
                outstanding: position.outstanding,
                gross_paid: position.gross_paid,
                total_reversal: position.total_reversal
            };
        }));

        return res.json({
            status: 200,
            data,
            period: {
                month: requestPeriodMonth,
                year: requestPeriodYear
            }
        });
    } catch (error) {
        console.error('[PAYMENT_STATUS_READ_MODEL_ERROR]', error);
        return res.status(500).json({ status: 500, message: 'Gagal memuat read model payment status' });
    }
});

router.get('/diagnostics', ensureAdmin, async (req, res) => {
    const requestPeriodMonth = parseInt(req.query.period_month, 10);
    const requestPeriodYear = parseInt(req.query.period_year, 10);

    try {
        const diagnostics = await getPaymentDiagnostics({
            periodMonth: Number.isInteger(requestPeriodMonth) ? requestPeriodMonth : undefined,
            periodYear: Number.isInteger(requestPeriodYear) ? requestPeriodYear : undefined
        });

        return res.json({
            status: 200,
            data: diagnostics
        });
    } catch (error) {
        console.error('[PAYMENT_STATUS_DIAGNOSTICS_ERROR]', error);
        return res.status(500).json({ status: 500, message: 'Gagal memuat diagnostics payment status' });
    }
});

// POST /api/payment-status/advance — Bayar di Muka (prabayar cash) untuk N bulan ke depan.
// Syarat: tagihan bulan berjalan SUDAH lunas. Idempoten (periode yang sudah dibayar dilewati).
router.post('/advance', ensureAdmin, async (req, res) => {
    const userId = req.body.userId;
    const months = parseInt(req.body.months, 10);

    if (userId === undefined || userId === null || String(userId).trim() === '') {
        return res.status(400).json({ status: 400, message: 'userId wajib diisi' });
    }
    if (!Number.isInteger(months) || months < 1 || months > 12) {
        return res.status(400).json({ status: 400, message: 'months wajib bilangan 1..12' });
    }

    const user = (global.users || []).find(u => String(u.id) === String(userId));
    if (!user) {
        return res.status(404).json({ status: 404, message: 'Pelanggan tidak ditemukan' });
    }
    if (user.subscription === 'PAKET-VOUCHER') {
        return res.status(400).json({ status: 400, message: 'Pelanggan voucher tidak memiliki tagihan bulanan' });
    }
    const pkg = (global.packages || []).find(p => p.name === user.subscription);
    if (pkg && pkg.whitelist === true) {
        return res.status(400).json({ status: 400, message: 'Paket pelanggan ini gratis (whitelist) — tidak ada tagihan' });
    }

    try {
        const summary = await advancePaymentService.recordAdvancePayment({
            user,
            months,
            createdBy: req.user.username
        });

        if (!summary.ok && summary.reason === 'current_unpaid') {
            return res.status(409).json({
                status: 409,
                message: 'Tagihan bulan berjalan belum lunas. Lunasi dulu sebelum bayar di muka.'
            });
        }

        // Struk WA best-effort — kegagalan kirim TIDAK menggagalkan pencatatan.
        const receipt = await advancePaymentService.sendAdvanceReceipt({ user, summary });

        return res.json({
            status: 200,
            message: summary.recorded.length > 0
                ? `Bayar di muka tercatat untuk ${summary.recorded.length} bulan.`
                : 'Tidak ada bulan baru yang dicatat (semua periode sudah lunas).',
            data: {
                recorded: summary.recorded,
                skipped: summary.skipped,
                totalAmount: summary.totalAmount,
                coverageUntil: summary.coverageUntil,
                receiptSent: receipt.sent
            }
        });
    } catch (error) {
        console.error('[PAYMENT_STATUS_ADVANCE_ERROR]', error);
        return res.status(500).json({ status: 500, message: error.message || 'Gagal mencatat bayar di muka' });
    }
});

module.exports = router;
