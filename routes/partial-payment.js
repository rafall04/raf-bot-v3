/**
 * Header Doc
 * Purpose: Mengelola pembayaran parsial pelanggan dan notifikasi approval/admin terkait.
 * Caller: Express route registry/API admin/teknisi.
 * Deps: Database JSON, activity logger, security rate-limit/input validation, request lock, domain events, gateway readiness, payment finance service, dan helper timing WA.
 * MainFuncs: Router request/history/report pembayaran parsial dan helper notifikasi admin.
 * SideEffects: Membaca/menulis request pembayaran, update ledger/status pembayaran, log activity, dan emit event notifikasi WhatsApp.
 */

const express = require('express');
const router = express.Router();
const { loadJSON, saveJSON } = require('../lib/database');
const { logActivity } = require('../lib/activity-logger');
const { rateLimit, validateInput } = require('../lib/security');
const { withLock } = require('../lib/request-lock');
const { DOMAIN_EVENTS, emitAsync } = require('../lib/domain-events');
const { initializeDomainNotificationListeners } = require('../lib/domain-notification-listeners');
const { isReady } = require('../lib/whatsapp-gateway');
const { waitForWhatsAppDelay } = require('../lib/wa-timing');
const {
    applyPaymentStatusChange,
    getEffectivePrice,
    getPaymentPositionForPeriod,
    syncUserPaidStatusForCurrentPeriod,
    getPaymentTimelineForPeriod,
    getPaymentReportForPeriod,
    normalizePaymentRequestScope,
    normalizeUserPaymentMethod
} = require('../lib/payment-finance-service');

initializeDomainNotificationListeners();

// Middleware for staff authentication
function ensureAuthenticatedStaff(req, res, next) {
    if (!req.user) {
        return res.status(403).json({ status: 403, message: "Akses ditolak. User tidak terautentikasi." });
    }
    if (!['admin', 'owner', 'superadmin', 'teknisi'].includes(req.user.role)) {
        return res.status(403).json({ status: 403, message: "Akses ditolak. Role tidak diizinkan." });
    }
    next();
}

// Middleware for admin only
function ensureAdmin(req, res, next) {
    if (!req.user || !['admin', 'owner', 'superadmin'].includes(req.user.role)) {
        return res.status(403).json({ status: 403, message: "Akses ditolak. Hanya admin yang diizinkan." });
    }
    next();
}

// GET /api/partial-payment/history/:userId - Get payment history for a user
router.get('/history/:userId', ensureAuthenticatedStaff, async (req, res) => {
    const { userId } = req.params;

    try {
        const month = req.query.month ? parseInt(req.query.month, 10) : null;
        const year = req.query.year ? parseInt(req.query.year, 10) : null;
        const timeline = await getPaymentTimelineForPeriod(
            userId,
            Number.isInteger(month) && Number.isInteger(year) ? month : null,
            Number.isInteger(month) && Number.isInteger(year) ? year : null
        );

        res.json({
            status: 200,
            data: timeline.entries,
            summary: timeline.summary
        });
    } catch (error) {
        console.error('[PAYMENT_HISTORY_ERROR]', error);
        res.status(500).json({ status: 500, message: 'Terjadi kesalahan server' });
    }
});

// GET /api/partial-payment/outstanding/:userId - Get outstanding balance for a user
router.get('/outstanding/:userId', ensureAuthenticatedStaff, async (req, res) => {
    const { userId } = req.params;
    
    const user = global.users.find(u => String(u.id) === String(userId));
    if (!user) {
        return res.status(404).json({ status: 404, message: 'User tidak ditemukan' });
    }
    
    // Use effective price (after discount)
    const packagePrice = getEffectivePrice(user);
    const currentMonth = new Date().getMonth() + 1;
    const currentYear = new Date().getFullYear();
    
    try {
        const position = await getPaymentPositionForPeriod(user, currentMonth, currentYear, {
            amountDue: packagePrice
        });
        if (Boolean(user.paid) !== Boolean(position.is_fully_paid)) {
            await syncUserPaidStatusForCurrentPeriod({ user, amountDue: packagePrice });
        }

        res.json({
            status: 200,
            data: {
                user_id: userId,
                user_name: user.name,
                package_name: user.subscription,
                package_price: packagePrice,
                total_paid: position.net_paid,
                gross_paid: position.gross_paid,
                total_reversal: position.total_reversal,
                outstanding: position.outstanding,
                is_fully_paid: position.is_fully_paid,
                period: `${currentMonth}/${currentYear}`
            }
        });
    } catch (error) {
        console.error('[OUTSTANDING_ERROR]', error);
        res.status(500).json({ status: 500, message: 'Terjadi kesalahan server' });
    }
});

// POST /api/partial-payment/request - Create partial payment request (teknisi/admin)
router.post('/request', ensureAuthenticatedStaff, rateLimit('partial-payment', 30, 60000), async (req, res) => {
    // Allow both teknisi and admin to create partial payment requests
    const isAdmin = ['admin', 'owner', 'superadmin'].includes(req.user.role);
    const isTeknisi = req.user.role === 'teknisi';
    
    if (!isAdmin && !isTeknisi) {
        return res.status(403).json({ status: 403, message: "Akses ditolak." });
    }
    
    let { userId, amountPaid, notes } = req.body;
    
    // Validate
    try {
        userId = validateInput(userId, 'id', { required: true });
        amountPaid = parseInt(amountPaid);
        if (isNaN(amountPaid) || amountPaid <= 0) {
            return res.status(400).json({ status: 400, message: 'Nominal pembayaran harus lebih dari 0' });
        }
    } catch (error) {
        return res.status(400).json({ status: 400, message: 'Input tidak valid' });
    }
    
    const user = global.users.find(u => String(u.id) === String(userId));
    if (!user) {
        return res.status(404).json({ status: 404, message: 'User tidak ditemukan' });
    }
    
    // Use lock to prevent race condition for same user payment
    try {
        return await withLock(`partial-payment-${userId}`, async () => {
            const packagePrice = getEffectivePrice(user);
            const currentMonth = new Date().getMonth() + 1;
            const currentYear = new Date().getFullYear();
            const position = await getPaymentPositionForPeriod(user, currentMonth, currentYear, {
                amountDue: packagePrice
            });
            const totalPaidBefore = position.net_paid;
            const outstanding = position.outstanding;

            if (outstanding <= 0) {
                return res.status(400).json({
                    status: 400,
                    message: 'Pelanggan sudah lunas untuk periode ini'
                });
            }

            if (amountPaid > outstanding) {
                return res.status(400).json({
                    status: 400,
                    message: `Nominal melebihi sisa tagihan (Rp ${outstanding.toLocaleString('id-ID')})`
                });
            }

            const isPartial = amountPaid < outstanding;
            const amountRemaining = outstanding - amountPaid;
            const isFullyPaid = amountRemaining === 0;
            const allRequests = loadJSON('database/requests.json').map(normalizePaymentRequestScope);

            if (!isAdmin) {
                const existingPending = allRequests.find((request) =>
                    String(request.userId) === String(userId)
                    && request.status === 'pending'
                    && request.request_type === 'partial_payment'
                    && parseInt(request.period_month, 10) === currentMonth
                    && parseInt(request.period_year, 10) === currentYear
                );

                if (existingPending) {
                    return res.status(409).json({
                        status: 409,
                        message: 'Sudah ada pengajuan partial payment yang menunggu approval untuk pelanggan dan periode ini'
                    });
                }
            }

            let paymentMethod = null;
            if (isTeknisi) {
                paymentMethod = 'CASH';
            } else {
                paymentMethod = normalizeUserPaymentMethod(req.body.paymentMethod);
                if (!paymentMethod) {
                    return res.status(400).json({
                        status: 400,
                        message: 'Metode pembayaran admin wajib dipilih: CASH atau TRANSFER_BANK'
                    });
                }
            }
            const newRequest = {
                id: Date.now(),
                userId: userId,
                userName: user.name,
                newStatus: isFullyPaid,
                status: isAdmin ? 'approved' : 'pending',
                request_type: 'partial_payment',
                payment_method: paymentMethod,
                is_partial_payment: true,
                amount_due: packagePrice,
                amount_paid: amountPaid,
                amount_remaining: amountRemaining,
                total_paid_before: totalPaidBefore,
                period_month: currentMonth,
                period_year: currentYear,
                notes: notes || '',
                created_at: new Date().toISOString(),
                updated_at: isAdmin ? new Date().toISOString() : null,
                updated_by: isAdmin ? req.user.id : null,
                requested_by_teknisi_id: isTeknisi ? req.user.id : null,
                requested_by_admin_id: isAdmin ? req.user.id : null
            };

            allRequests.push(newRequest);
            saveJSON('database/requests.json', allRequests);

            const roleText = isAdmin ? 'Admin' : 'Teknisi';
            logActivity({
                userId: req.user.id,
                username: req.user.username,
                role: req.user.role,
                actionType: 'CREATE',
                resourceType: 'partial_payment',
                resourceId: newRequest.id.toString(),
                resourceName: `Pembayaran ${user.name}`,
                description: `${roleText} ${isAdmin ? 'memproses' : 'mengajukan'} pembayaran ${isPartial ? 'sebagian' : 'penuh'} Rp ${amountPaid.toLocaleString('id-ID')} untuk ${user.name}`,
                ipAddress: req.ip,
                userAgent: req.headers['user-agent']
            }).catch(console.error);

            if (isAdmin) {
                try {
                    await applyPaymentStatusChange({
                        user,
                        paid: true,
                        periodMonth: currentMonth,
                        periodYear: currentYear,
                        amountPaid,
                        amountDue: packagePrice,
                        isPartial,
                        paymentMethod,
                        notes: notes || '',
                        createdBy: req.user.username,
                        sourceAdminAction: `partial-payment-request:${newRequest.id}`,
                        onFinalPaid: async () => {
                            const { handlePaidStatusChange } = require('../lib/approval-logic');
                            await handlePaidStatusChange(user, {
                                paidDate: new Date().toISOString(),
                                method: paymentMethod,
                                approvedBy: req.user.username,
                                notes: `Pembayaran ${isPartial ? 'sebagian (lunas)' : 'penuh'} via admin panel`,
                                isPartial,
                                amountPaid,
                                amountRemaining: 0
                            });
                        }
                    });
                    console.log(`[ADMIN_PARTIAL_PAYMENT] Payment recorded for ${user.name}: Rp ${amountPaid.toLocaleString('id-ID')}`);
                } catch (processError) {
                    console.error('[ADMIN_PARTIAL_PAYMENT_ERROR]', processError);
                }
            } else {
                notifyAdminsPartialPayment(req.user, user, amountPaid, packagePrice, amountRemaining, newRequest.id);
            }

            return res.status(201).json({
                status: 201,
                message: isAdmin
                    ? `Pembayaran ${isPartial ? 'sebagian' : 'penuh'} berhasil diproses`
                    : `Pengajuan pembayaran ${isPartial ? 'sebagian' : 'penuh'} berhasil dibuat`,
                data: {
                    request_id: newRequest.id,
                    amount_paid: amountPaid,
                    amount_remaining: amountRemaining,
                    is_partial: isPartial,
                    will_be_fully_paid: isFullyPaid,
                    auto_approved: isAdmin
                }
            });
        });
    } catch (error) {
        console.error('[PARTIAL_PAYMENT_LOCK_ERROR]', error);
        return res.status(500).json({ 
            status: 500, 
            message: error.message?.includes('Could not acquire lock') 
                ? 'Request sedang diproses. Silakan coba lagi.'
                : 'Terjadi kesalahan server'
        });
    }
});

// GET /api/partial-payment/report - Get partial payment report (admin)
router.get('/report', ensureAdmin, async (req, res) => {
    const { month, year } = req.query;
    const targetMonth = month ? parseInt(month) : new Date().getMonth() + 1;
    const targetYear = year ? parseInt(year) : new Date().getFullYear();

    try {
        const report = await getPaymentReportForPeriod(targetMonth, targetYear);
        res.json({
            status: 200,
            data: {
                period: `${targetMonth}/${targetYear}`,
                summary: report.summary,
                transactions: report.transactions
            }
        });
    } catch (error) {
        console.error('[PARTIAL_PAYMENT_REPORT_ERROR]', error);
        res.status(500).json({ status: 500, message: 'Terjadi kesalahan server' });
    }
});

// Helper: Notify admins about partial payment
async function notifyAdminsPartialPayment(teknisi, user, amountPaid, packagePrice, amountRemaining, requestId) {
    if (!isReady()) return;
    
    const isPartial = amountRemaining > 0;
    const paymentType = isPartial ? 'SEBAGIAN' : 'PENUH';
    
    const message = `🔔 *PENGAJUAN PEMBAYARAN ${paymentType}* 🔔\n\n` +
        `Teknisi *${teknisi.name || teknisi.username}* mengajukan pembayaran:\n\n` +
        `👤 *Pelanggan:* ${user.name}\n` +
        `📦 *Paket:* ${user.subscription || '-'}\n` +
        `💰 *Tagihan:* Rp ${packagePrice.toLocaleString('id-ID')}\n` +
        `✅ *Dibayar:* Rp ${amountPaid.toLocaleString('id-ID')}\n` +
        (isPartial ? `⏳ *Sisa:* Rp ${amountRemaining.toLocaleString('id-ID')}\n` : '') +
        `🆔 *ID Request:* #${requestId}\n` +
        `⏰ *Waktu:* ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}\n\n` +
        `Silakan proses di panel admin.`;
    
    try {
        if (global.config.ownerNumber && Array.isArray(global.config.ownerNumber)) {
            for (const num of global.config.ownerNumber) {
                if (!num) continue;
                const jid = num.endsWith('@s.whatsapp.net') ? num : `${num}@s.whatsapp.net`;
                try {
                    await waitForWhatsAppDelay(1000);
                    await emitAsync(DOMAIN_EVENTS.PARTIAL_PAYMENT_REQUESTED, {
                        recipients: [jid],
                        message: { text: message }
                    });
                } catch (e) {
                    console.error('[PARTIAL_PAYMENT_NOTIF_ERROR]', e.message);
                }
            }
        }
    } catch (error) {
        console.error('[PARTIAL_PAYMENT_NOTIF_ERROR]', error);
    }
}

module.exports = router;
