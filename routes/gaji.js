/**
 * Gaji Teknisi Routes
 * Payroll period final untuk teknisi
 */

const express = require('express');
const router = express.Router();
const { logActivity } = require('../lib/activity-logger');
const { rateLimit } = require('../lib/security');
const {
    ensureFinanceTables,
    getKasbonSummary,
    getCollectionPayableSummary,
    createPayrollDraft,
    getPayrollList,
    getPayrollRecord,
    getPayrollSummary,
    updatePayrollDraft,
    finalizePayroll,
    payPayroll
} = require('../lib/technician-finance-service');

function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        global.db.run(sql, params, function onRun(err) {
            if (err) {
                reject(err);
                return;
            }
            resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

function ensureAdmin(req, res, next) {
    if (!req.user || !['admin', 'owner', 'superadmin'].includes(req.user.role)) {
        return res.status(403).json({ status: 403, message: 'Akses ditolak. Hanya admin yang diizinkan.' });
    }
    next();
}

function normalizeMoney(value) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
}

function getActor(req) {
    return {
        id: req.user?.id || null,
        username: req.user?.username || null,
        name: req.user?.name || req.user?.username || null
    };
}

function mapRowForResponse(row) {
    return {
        ...row,
        bonus: row.bonus_manual,
        total_gaji: row.net_amount
    };
}

ensureFinanceTables().catch(console.error);

router.get('/teknisi', ensureAdmin, async (req, res) => {
    try {
        const teknisiList = (global.accounts || [])
            .filter((account) => account.role === 'teknisi')
            .map((account) => ({
                id: account.id,
                name: account.name || account.username,
                username: account.username,
                phone_number: account.phone_number
            }));

        res.json({ status: 200, data: teknisiList });
    } catch (error) {
        console.error('[GAJI_GET_TEKNISI_ERROR]', error);
        res.status(500).json({ status: 500, message: 'Gagal mengambil data teknisi' });
    }
});

router.get('/', ensureAdmin, async (req, res) => {
    try {
        const rows = await getPayrollList({
            id: req.query.id,
            month: req.query.month,
            year: req.query.year,
            teknisiId: req.query.teknisi_id,
            status: req.query.status
        });
        res.json({ status: 200, data: rows.map(mapRowForResponse) });
    } catch (error) {
        console.error('[GAJI_GET_ERROR]', error);
        res.status(500).json({ status: 500, message: 'Gagal mengambil data gaji' });
    }
});

router.get('/summary', ensureAdmin, async (req, res) => {
    try {
        const month = parseInt(req.query.month, 10) || new Date().getMonth() + 1;
        const year = parseInt(req.query.year, 10) || new Date().getFullYear();
        const summary = await getPayrollSummary({ month, year });
        res.json({ status: 200, data: summary });
    } catch (error) {
        console.error('[GAJI_SUMMARY_ERROR]', error);
        res.status(500).json({ status: 500, message: 'Gagal mengambil summary gaji' });
    }
});

router.get('/kasbon-summary/:teknisiId', ensureAdmin, async (req, res) => {
    try {
        const teknisiId = parseInt(req.params.teknisiId, 10);
        const month = parseInt(req.query.month, 10) || new Date().getMonth() + 1;
        const year = parseInt(req.query.year, 10) || new Date().getFullYear();
        const [kasbon, collection] = await Promise.all([
            getKasbonSummary({ teknisiId }),
            getCollectionPayableSummary({ teknisiId, periodMonth: month, periodYear: year })
        ]);

        res.json({
            status: 200,
            data: {
                total_kasbon: kasbon.total_outstanding,
                kasbon_count: kasbon.active_count,
                total_terbayar: kasbon.total_paid,
                max_potongan: kasbon.total_outstanding,
                komisi_collection: collection.net_total,
                collection_credit: collection.total_credit,
                collection_debit: collection.total_debit
            }
        });
    } catch (error) {
        console.error('[GAJI_KASBON_SUMMARY_ERROR]', error);
        res.status(500).json({ status: 500, message: 'Gagal mengambil summary kasbon teknisi' });
    }
});

router.post('/', ensureAdmin, rateLimit('create-gaji', 20, 60000), async (req, res) => {
    try {
        const payload = {
            teknisiId: req.body.teknisi_id,
            periodMonth: req.body.period_month,
            periodYear: req.body.period_year,
            gajiPokok: normalizeMoney(req.body.gaji_pokok),
            bonusManual: normalizeMoney(req.body.bonus ?? req.body.bonus_manual),
            potonganKasbon: normalizeMoney(req.body.potongan_kasbon),
            potonganLain: normalizeMoney(req.body.potongan_lain),
            potonganLainKeterangan: req.body.potongan_lain_keterangan || '',
            notes: req.body.notes || ''
        };

        if (!payload.teknisiId || !payload.periodMonth || !payload.periodYear) {
            return res.status(400).json({ status: 400, message: 'teknisi_id, period_month, dan period_year wajib diisi' });
        }

        const result = await createPayrollDraft(payload, getActor(req));
        if (!result.created && result.conflict) {
            return res.status(409).json({ status: 409, message: 'Payroll teknisi untuk periode ini sudah ada' });
        }

        logActivity({
            userId: req.user.id,
            username: req.user.username,
            role: req.user.role,
            actionType: 'CREATE',
            resourceType: 'payroll_teknisi',
            resourceId: String(result.id),
            resourceName: `Payroll ${result.draft.teknisi_name} ${result.draft.period_month}/${result.draft.period_year}`,
            description: `Membuat draft payroll teknisi ${result.draft.teknisi_name}`,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent']
        }).catch(console.error);

        res.status(201).json({
            status: 201,
            message: 'Draft payroll berhasil dibuat',
            data: mapRowForResponse({
                id: result.id,
                status: 'draft',
                ...result.draft
            })
        });
    } catch (error) {
        console.error('[GAJI_CREATE_ERROR]', error);
        res.status(500).json({ status: 500, message: 'Gagal membuat payroll teknisi' });
    }
});

router.put('/:id', ensureAdmin, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const result = await updatePayrollDraft(id, {
            gaji_pokok: normalizeMoney(req.body.gaji_pokok),
            bonus_manual: normalizeMoney(req.body.bonus ?? req.body.bonus_manual),
            potongan_kasbon: normalizeMoney(req.body.potongan_kasbon),
            potongan_lain: normalizeMoney(req.body.potongan_lain),
            potongan_lain_keterangan: req.body.potongan_lain_keterangan || '',
            notes: req.body.notes || ''
        });

        if (!result.updated && result.reason === 'not_found') {
            return res.status(404).json({ status: 404, message: 'Data payroll tidak ditemukan' });
        }
        if (!result.updated && result.reason === 'locked') {
            return res.status(400).json({ status: 400, message: 'Payroll yang sudah finalized/paid tidak dapat diubah' });
        }

        logActivity({
            userId: req.user.id,
            username: req.user.username,
            role: req.user.role,
            actionType: 'UPDATE',
            resourceType: 'payroll_teknisi',
            resourceId: String(id),
            resourceName: `Payroll teknisi #${id}`,
            description: `Mengubah draft payroll teknisi #${id}`,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent']
        }).catch(console.error);

        res.json({
            status: 200,
            message: 'Draft payroll berhasil diupdate',
            data: mapRowForResponse(result.draft)
        });
    } catch (error) {
        console.error('[GAJI_UPDATE_ERROR]', error);
        res.status(500).json({ status: 500, message: 'Gagal mengupdate payroll teknisi' });
    }
});

router.put('/:id/finalize', ensureAdmin, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const result = await finalizePayroll(id, getActor(req));
        if (!result.finalized && result.reason === 'not_found') {
            return res.status(404).json({ status: 404, message: 'Data payroll tidak ditemukan' });
        }
        if (!result.finalized && result.reason === 'paid') {
            return res.status(400).json({ status: 400, message: 'Payroll yang sudah dibayar tidak dapat difinalisasi ulang' });
        }

        logActivity({
            userId: req.user.id,
            username: req.user.username,
            role: req.user.role,
            actionType: 'UPDATE',
            resourceType: 'payroll_teknisi',
            resourceId: String(id),
            resourceName: `Payroll teknisi #${id}`,
            description: `Memfinalisasi payroll teknisi #${id}`,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent']
        }).catch(console.error);

        const payroll = await getPayrollRecord(id);
        res.json({
            status: 200,
            message: 'Payroll berhasil difinalisasi',
            data: mapRowForResponse(payroll)
        });
    } catch (error) {
        console.error('[GAJI_FINALIZE_ERROR]', error);
        res.status(500).json({ status: 500, message: 'Gagal memfinalisasi payroll teknisi' });
    }
});

router.put('/:id/pay', ensureAdmin, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const result = await payPayroll(id, getActor(req), req.body.notes || '');
        if (!result.paid && result.reason === 'not_found') {
            return res.status(404).json({ status: 404, message: 'Data payroll tidak ditemukan' });
        }
        if (!result.paid && result.reason === 'already_paid') {
            return res.status(400).json({ status: 400, message: 'Payroll sudah dibayar' });
        }

        logActivity({
            userId: req.user.id,
            username: req.user.username,
            role: req.user.role,
            actionType: 'UPDATE',
            resourceType: 'payroll_teknisi',
            resourceId: String(id),
            resourceName: `Payroll teknisi #${id}`,
            description: `Membayar payroll teknisi #${id}`,
            newValue: { status: 'paid', kasbon_allocations: result.allocations },
            ipAddress: req.ip,
            userAgent: req.headers['user-agent']
        }).catch(console.error);

        const payroll = await getPayrollRecord(id);
        res.json({
            status: 200,
            message: 'Payroll berhasil dibayar',
            data: mapRowForResponse(payroll)
        });
    } catch (error) {
        console.error('[GAJI_PAY_ERROR]', error);
        res.status(500).json({ status: 500, message: 'Gagal membayar payroll teknisi' });
    }
});

router.delete('/:id', ensureAdmin, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const payroll = await getPayrollRecord(id);
        if (!payroll) {
            return res.status(404).json({ status: 404, message: 'Data payroll tidak ditemukan' });
        }
        if (payroll.status !== 'draft') {
            return res.status(400).json({ status: 400, message: 'Hanya draft payroll yang dapat dihapus' });
        }

        await dbRun('DELETE FROM technician_gaji WHERE id = ?', [id]);

        logActivity({
            userId: req.user.id,
            username: req.user.username,
            role: req.user.role,
            actionType: 'DELETE',
            resourceType: 'payroll_teknisi',
            resourceId: String(id),
            resourceName: `Payroll teknisi #${id}`,
            description: `Menghapus draft payroll teknisi #${id}`,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent']
        }).catch(console.error);

        res.json({ status: 200, message: 'Draft payroll berhasil dihapus' });
    } catch (error) {
        console.error('[GAJI_DELETE_ERROR]', error);
        res.status(500).json({ status: 500, message: 'Gagal menghapus draft payroll' });
    }
});

module.exports = router;
