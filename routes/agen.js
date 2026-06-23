/**
 * Header Doc
 * Purpose: API untuk role "agen" (penagih pembayaran berbasis fee) dan panel admin terkait:
 *          daftar pelanggan yang ditugaskan, ringkasan fee agen, penugasan pelanggan->agen,
 *          dan laporan komisi agen.
 * Caller: Mounted di `lib/routes-registry.js` pada prefix `/api/agen`. Dipakai halaman
 *         `/agen-pembayaran`, `/penugasan-agen`, `/laporan-agen`.
 * Deps: `lib/account-classification` (isBillableCustomer), `lib/agen-collection-settlement`
 *       (report/config), `lib/payment-finance-service` (getEffectivePrice), `lib/activity-logger`,
 *       `lib/security` (rateLimit), serta `global.db`/`global.users`/`global.accounts`.
 * MainFuncs: GET /customers, GET /summary, GET /report, GET /list, GET /assignments, POST /assign.
 * SideEffects: Menulis kolom `users.assigned_agen_id` (DB + cache runtime), activity log penugasan.
 */
"use strict";

const express = require('express');
const router = express.Router();
const { isBillableCustomer } = require('../lib/account-classification');
const { getEffectivePrice } = require('../lib/payment-finance-service');
const { logActivity } = require('../lib/activity-logger');
const { rateLimit } = require('../lib/security');
const {
    ensureSettlementTable,
    getSettlementReport,
    getCommissionConfig
} = require('../lib/agen-collection-settlement');

function ensureAgen(req, res, next) {
    if (!req.user || req.user.role !== 'agen') {
        return res.status(403).json({ status: 403, message: 'Akses ditolak. Hanya agen yang diizinkan.' });
    }
    next();
}

function ensureAdmin(req, res, next) {
    if (!req.user || !['admin', 'owner', 'superadmin'].includes(req.user.role)) {
        return res.status(403).json({ status: 403, message: 'Akses ditolak. Hanya admin yang diizinkan.' });
    }
    next();
}

function isPaid(user) {
    return user.paid === true || user.paid === 1 || user.paid === 'true';
}

function mapCustomer(user) {
    return {
        id: user.id,
        name: user.name,
        phone_number: user.phone_number || '',
        subscription: user.subscription || '',
        address: user.address || '',
        paid: isPaid(user),
        package_price: getEffectivePrice(user)
    };
}

function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        if (!global.db) {
            reject(new Error('Database not initialized'));
            return;
        }
        global.db.run(sql, params, function onRun(err) {
            if (err) {
                reject(err);
                return;
            }
            resolve({ changes: this.changes });
        });
    });
}

// GET /api/agen/customers — pelanggan billable yang ditugaskan ke agen yang login.
router.get('/customers', ensureAgen, (req, res) => {
    try {
        const customers = (global.users || [])
            .filter((user) => String(user.assigned_agen_id || '') === String(req.user.id))
            .filter(isBillableCustomer)
            .map(mapCustomer);
        return res.json({ status: 200, data: customers });
    } catch (error) {
        console.error('[AGEN_CUSTOMERS_ERROR]', error);
        return res.status(500).json({ status: 500, message: 'Gagal memuat pelanggan agen' });
    }
});

// GET /api/agen/summary — ringkasan fee agen sendiri (atau agen tertentu untuk admin).
router.get('/summary', async (req, res) => {
    if (!req.user || !['agen', 'admin', 'owner', 'superadmin'].includes(req.user.role)) {
        return res.status(403).json({ status: 403, message: 'Akses ditolak.' });
    }
    try {
        await ensureSettlementTable();
        const month = req.query.month ? parseInt(req.query.month, 10) : (new Date().getMonth() + 1);
        const year = req.query.year ? parseInt(req.query.year, 10) : new Date().getFullYear();
        const agenId = req.user.role === 'agen'
            ? String(req.user.id)
            : (req.query.agen_id ? String(req.query.agen_id) : null);

        const report = await getSettlementReport({ month, year, agenId });
        const ownSummary = agenId
            ? report.summary.find((item) => String(item.agen_id) === String(agenId)) || {
                agen_id: String(agenId),
                agen_name: req.user.name || req.user.username || 'Agen',
                total_credit: 0,
                total_debit: 0,
                net_total: 0,
                entry_count: 0,
                latest_entry_at: null,
                unique_paid_customers: 0
            }
            : null;

        return res.json({
            status: 200,
            data: {
                period: `${month}/${year}`,
                commission_per_customer: getCommissionConfig().amount,
                totals: report.totals,
                summary: agenId ? ownSummary : report.summary
            }
        });
    } catch (error) {
        console.error('[AGEN_SUMMARY_ERROR]', error);
        return res.status(500).json({ status: 500, message: 'Gagal memuat ringkasan fee agen' });
    }
});

// GET /api/agen/report — laporan komisi agen per periode (admin).
router.get('/report', ensureAdmin, async (req, res) => {
    try {
        await ensureSettlementTable();
        const month = req.query.month ? parseInt(req.query.month, 10) : null;
        const year = req.query.year ? parseInt(req.query.year, 10) : null;
        const agenId = req.query.agen_id ? String(req.query.agen_id) : null;
        const report = await getSettlementReport({ month, year, agenId });
        return res.json({
            status: 200,
            data: {
                period: month && year ? `${month}/${year}` : 'all',
                commission_per_customer: getCommissionConfig().amount,
                totals: report.totals,
                summary: report.summary,
                entries: report.entries
            }
        });
    } catch (error) {
        console.error('[AGEN_REPORT_ERROR]', error);
        return res.status(500).json({ status: 500, message: 'Gagal memuat laporan komisi agen' });
    }
});

// GET /api/agen/list — daftar akun agen (admin), untuk dropdown penugasan & laporan.
router.get('/list', ensureAdmin, (req, res) => {
    try {
        const agents = (global.accounts || [])
            .filter((account) => account.role === 'agen')
            .map((account) => ({
                id: account.id,
                name: account.name || account.username,
                username: account.username,
                phone_number: account.phone_number || ''
            }));
        return res.json({ status: 200, data: agents });
    } catch (error) {
        console.error('[AGEN_LIST_ERROR]', error);
        return res.status(500).json({ status: 500, message: 'Gagal memuat daftar agen' });
    }
});

// GET /api/agen/assignments — semua pelanggan billable + agen yang ditugaskan (admin).
router.get('/assignments', ensureAdmin, (req, res) => {
    try {
        const agenNameById = new Map(
            (global.accounts || [])
                .filter((account) => account.role === 'agen')
                .map((account) => [String(account.id), account.name || account.username])
        );
        const customers = (global.users || [])
            .filter(isBillableCustomer)
            .map((user) => {
                const assignedId = user.assigned_agen_id ? String(user.assigned_agen_id) : null;
                return {
                    id: user.id,
                    name: user.name,
                    phone_number: user.phone_number || '',
                    subscription: user.subscription || '',
                    assigned_agen_id: assignedId,
                    assigned_agen_name: assignedId ? (agenNameById.get(assignedId) || `Agen ${assignedId}`) : null
                };
            });
        return res.json({ status: 200, data: customers });
    } catch (error) {
        console.error('[AGEN_ASSIGNMENTS_ERROR]', error);
        return res.status(500).json({ status: 500, message: 'Gagal memuat data penugasan agen' });
    }
});

// POST /api/agen/assign — tugaskan/lepas pelanggan ke seorang agen (admin).
// Body: { agenId: number|null, userIds: number[] }. agenId null/0 = lepas penugasan.
router.post('/assign', ensureAdmin, rateLimit('agen-assign', 30, 60000), async (req, res) => {
    try {
        const rawAgenId = req.body.agenId;
        const userIds = Array.isArray(req.body.userIds) ? req.body.userIds : [];

        if (userIds.length === 0) {
            return res.status(400).json({ status: 400, message: 'userIds wajib diisi (minimal 1 pelanggan).' });
        }
        if (userIds.length > 1000) {
            return res.status(400).json({ status: 400, message: 'Maksimal 1000 pelanggan per permintaan.' });
        }

        // agenId null/0/'' berarti melepas penugasan.
        const unassign = rawAgenId === null || rawAgenId === undefined || rawAgenId === '' || parseInt(rawAgenId, 10) === 0;
        let agenId = null;
        if (!unassign) {
            agenId = parseInt(rawAgenId, 10);
            const agenAccount = (global.accounts || []).find(
                (account) => String(account.id) === String(agenId) && account.role === 'agen'
            );
            if (!agenAccount) {
                return res.status(404).json({ status: 404, message: 'Akun agen tidak ditemukan.' });
            }
        }

        let updated = 0;
        const skipped = [];
        for (const rawUserId of userIds) {
            const userId = parseInt(rawUserId, 10);
            const user = (global.users || []).find((item) => String(item.id) === String(userId));
            if (!user) {
                skipped.push({ id: rawUserId, reason: 'tidak ditemukan' });
                continue;
            }
            if (!isBillableCustomer(user)) {
                skipped.push({ id: rawUserId, reason: 'bukan pelanggan billable' });
                continue;
            }
            await dbRun('UPDATE users SET assigned_agen_id = ? WHERE id = ?', [unassign ? null : agenId, userId]);
            // Sinkronkan cache runtime agar /api/agen/* langsung konsisten.
            user.assigned_agen_id = unassign ? null : agenId;
            updated += 1;
        }

        logActivity({
            userId: req.user.id,
            username: req.user.username,
            role: req.user.role,
            actionType: 'UPDATE',
            resourceType: 'agen_assignment',
            resourceId: unassign ? 'unassign' : String(agenId),
            resourceName: unassign ? 'Lepas penugasan agen' : `Penugasan ke agen #${agenId}`,
            description: `${unassign ? 'Melepas' : 'Menugaskan'} ${updated} pelanggan ${unassign ? 'dari agen' : `ke agen #${agenId}`}`,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent']
        }).catch((logErr) => console.error('[AGEN_ASSIGN_LOG_ERROR]', logErr.message));

        return res.json({
            status: 200,
            message: `${updated} pelanggan berhasil ${unassign ? 'dilepas dari agen' : 'ditugaskan ke agen'}.`,
            data: { updated, skipped }
        });
    } catch (error) {
        console.error('[AGEN_ASSIGN_ERROR]', error);
        return res.status(500).json({ status: 500, message: 'Gagal memproses penugasan agen' });
    }
});

module.exports = router;
