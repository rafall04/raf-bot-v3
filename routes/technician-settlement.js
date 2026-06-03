const express = require('express');
const router = express.Router();
const {
    ensureSettlementTable,
    getSettlementReport,
    getCommissionConfig
} = require('../lib/technician-collection-settlement');

function ensureAuthenticatedStaff(req, res, next) {
    if (!req.user) {
        return res.status(403).json({ status: 403, message: 'Akses ditolak. User tidak terautentikasi.' });
    }
    if (!['admin', 'owner', 'superadmin', 'teknisi'].includes(req.user.role)) {
        return res.status(403).json({ status: 403, message: 'Akses ditolak. Role tidak diizinkan.' });
    }
    next();
}

router.get('/summary', ensureAuthenticatedStaff, async (req, res) => {
    try {
        await ensureSettlementTable();
        const month = req.query.month ? parseInt(req.query.month, 10) : null;
        const year = req.query.year ? parseInt(req.query.year, 10) : null;
        const dateFrom = req.query.dateFrom || null;
        const dateTo = req.query.dateTo || null;
        const teknisiId = req.user.role === 'teknisi'
            ? String(req.user.id)
            : (req.query.teknisi_id ? String(req.query.teknisi_id) : null);

        const report = await getSettlementReport({ month, year, teknisiId, dateFrom, dateTo });
        const ownSummary = teknisiId
            ? report.summary.find((item) => String(item.teknisi_id) === String(teknisiId)) || {
                teknisi_id: String(teknisiId),
                teknisi_name: req.user.name || req.user.username || 'Teknisi',
                total_credit: 0,
                total_debit: 0,
                net_total: 0,
                entry_count: 0,
                latest_entry_at: null,
                unique_paid_customers: 0
            }
            : null;

        res.json({
            status: 200,
            data: {
                period: month && year ? `${month}/${year}` : 'all',
                commission_per_customer: getCommissionConfig().amount,
                totals: report.totals,
                summary: teknisiId ? ownSummary : report.summary
            }
        });
    } catch (error) {
        console.error('[TECHNICIAN_SETTLEMENT_SUMMARY_ERROR]', error);
        res.status(500).json({ status: 500, message: 'Gagal mengambil ringkasan settlement teknisi' });
    }
});

router.get('/entries', ensureAuthenticatedStaff, async (req, res) => {
    try {
        await ensureSettlementTable();
        const month = req.query.month ? parseInt(req.query.month, 10) : null;
        const year = req.query.year ? parseInt(req.query.year, 10) : null;
        const dateFrom = req.query.dateFrom || null;
        const dateTo = req.query.dateTo || null;
        const teknisiId = req.user.role === 'teknisi'
            ? String(req.user.id)
            : (req.query.teknisi_id ? String(req.query.teknisi_id) : null);

        const report = await getSettlementReport({ month, year, teknisiId, dateFrom, dateTo });

        res.json({
            status: 200,
            data: {
                period: month && year ? `${month}/${year}` : 'all',
                commission_per_customer: getCommissionConfig().amount,
                totals: report.totals,
                entries: report.entries
            }
        });
    } catch (error) {
        console.error('[TECHNICIAN_SETTLEMENT_ENTRIES_ERROR]', error);
        res.status(500).json({ status: 500, message: 'Gagal mengambil detail settlement teknisi' });
    }
});

module.exports = router;
