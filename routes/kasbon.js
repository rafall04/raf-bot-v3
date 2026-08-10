/**
 * Header Doc
 * Purpose: Route kasbon (hutang) teknisi — pengajuan, persetujuan/penolakan, tandai lunas, dan
 *   ledger saldo/cicilannya. Kasbon yang disetujui akan dipotong dari gaji lewat payroll.
 * Caller: `lib/routes-registry.js` (mount admin + staf).
 * Deps: `express`, `lib/activity-logger`, `lib/security` (rateLimit), `lib/request-lock`,
 *   `lib/technician-finance-service`, `lib/whatsapp-critical-delivery` (kabar ke teknisi).
 * MainFuncs: router GET/POST/PUT kasbon (`PUT /:id/approve` = titik keputusan).
 * SideEffects: Menulis `technician_kasbon` + ledger-nya, activity log, dan mengirim WhatsApp
 *   ke teknisi saat pengajuannya diputuskan (never-throw).
 */

const express = require('express');
const router = express.Router();
const { logActivity } = require('../lib/activity-logger');
const { rateLimit } = require('../lib/security');
const { withLock } = require('../lib/request-lock');
const {
    ensureFinanceTables,
    getKasbonList,
    getKasbonById,
    getKasbonSummary,
    createKasbonApprovalEntry,
    settleKasbonManually
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

function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        global.db.get(sql, params, (err, row) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(row || null);
        });
    });
}

function ensureAuthenticatedStaff(req, res, next) {
    if (!req.user) {
        return res.status(403).json({ status: 403, message: 'Akses ditolak. User tidak terautentikasi.' });
    }
    if (!['admin', 'owner', 'superadmin', 'teknisi'].includes(req.user.role)) {
        return res.status(403).json({ status: 403, message: 'Akses ditolak. Role tidak diizinkan.' });
    }
    next();
}

function ensureAdmin(req, res, next) {
    if (!req.user || !['admin', 'owner', 'superadmin'].includes(req.user.role)) {
        return res.status(403).json({ status: 403, message: 'Akses ditolak. Hanya admin yang diizinkan.' });
    }
    next();
}

/**
 * Mengabari teknisi bahwa pengajuan kasbonnya disetujui atau ditolak.
 *
 * Jalur kasbon sebelumnya NOL notifikasi: teknisi mengajukan lalu menunggu tanpa kabar. Untuk
 * yang disetujui itu lebih buruk lagi — uangnya akan dipotong dari gaji tanpa ia pernah tahu
 * kapan keputusannya diambil, jadi potongan di struk gaji datang sebagai kejutan.
 */
async function kabariTeknisiKasbon({ kasbon, approved, notes, oleh }) {
    const { resolveTechnicianPhones } = require('../lib/services/payroll-receipt');
    const { sendCritical } = require('../lib/whatsapp-critical-delivery');
    const { renderResponseTemplate } = require('../message/handlers/template-helpers');

    const nomor = resolveTechnicianPhones(kasbon.teknisi_id, global.accounts);
    if (!nomor || nomor.length === 0) {
        console.warn(`[KASBON_NOTIF] Teknisi #${kasbon.teknisi_id} tak punya nomor WA — keputusan kasbon tak diberitahukan.`);
        return { terkirim: false };
    }

    const nominal = 'Rp' + (Number(kasbon.amount) || 0).toLocaleString('id-ID');
    const data = {
        nama: kasbon.teknisi_name || 'Teknisi',
        nominal,
        keperluan: kasbon.description || '-',
        catatan: String(notes || '').trim() || '-',
        oleh: oleh || 'admin'
    };

    const teks = approved
        ? renderResponseTemplate('kasbon_teknisi_disetujui', [
            '✅ *KASBON DISETUJUI*',
            '',
            'Halo ${nama},',
            'Pengajuan kasbon Anda sebesar *${nominal}* disetujui.',
            'Keperluan: ${keperluan}',
            'Catatan admin: ${catatan}',
            '',
            '_Nominal ini akan dipotong dari gaji Anda. Rinciannya muncul di struk gaji._'
        ].join('\n'), data)
        : renderResponseTemplate('kasbon_teknisi_ditolak', [
            '❌ *KASBON DITOLAK*',
            '',
            'Halo ${nama},',
            'Pengajuan kasbon Anda sebesar *${nominal}* belum bisa disetujui.',
            'Keperluan: ${keperluan}',
            'Alasan: ${catatan}',
            '',
            '_Silakan bicarakan dengan admin bila perlu._'
        ].join('\n'), data);

    let terkirim = false;
    for (const ph of nomor) {
        const r = await sendCritical(ph, { text: teks }, { label: 'kasbon_keputusan' });
        if (r && r.delivered === true) terkirim = true;
    }
    return { terkirim };
}

function actorName(req) {
    return req.user?.name || req.user?.username || 'system';
}

ensureFinanceTables().catch(console.error);

router.get('/', ensureAuthenticatedStaff, async (req, res) => {
    try {
        const teknisiId = req.user.role === 'teknisi' ? req.user.id : (req.query.teknisi_id || null);
        const rows = await getKasbonList({ teknisiId });
        res.json({ status: 200, data: rows });
    } catch (error) {
        console.error('[KASBON_GET_ERROR]', error);
        res.status(500).json({ status: 500, message: 'Gagal mengambil data kasbon' });
    }
});

router.get('/summary', ensureAuthenticatedStaff, async (req, res) => {
    try {
        const teknisiId = req.user.role === 'teknisi' ? req.user.id : req.query.teknisi_id;
        if (!teknisiId) {
            return res.status(400).json({ status: 400, message: 'teknisi_id diperlukan' });
        }
        const summary = await getKasbonSummary({ teknisiId });
        res.json({
            status: 200,
            data: {
                total_kasbon: summary.total_kasbon,
                pending_amount: summary.pending_amount,
                pending_count: summary.pending_count,
                approved_amount: summary.total_outstanding,
                approved_count: summary.active_count,
                paid_amount: summary.total_paid,
                paid_count: summary.paid_count,
                outstanding: summary.total_outstanding,
                total_terbayar: summary.total_paid
            }
        });
    } catch (error) {
        console.error('[KASBON_SUMMARY_ERROR]', error);
        res.status(500).json({ status: 500, message: 'Gagal mengambil summary kasbon' });
    }
});

router.post('/', ensureAuthenticatedStaff, rateLimit('create-kasbon', 10, 60000), async (req, res) => {
    if (req.user.role !== 'teknisi') {
        return res.status(403).json({ status: 403, message: 'Hanya teknisi yang dapat mengajukan kasbon.' });
    }

    try {
        const amount = parseInt(req.body.amount, 10);
        const description = req.body.description || '';
        const teknisiId = parseInt(req.user.id, 10);
        if (!Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({ status: 400, message: 'Nominal kasbon harus lebih dari 0' });
        }
        if (amount > 10000000) {
            return res.status(400).json({ status: 400, message: 'Nominal kasbon maksimal Rp 10.000.000' });
        }

        const currentSummary = await getKasbonSummary({ teknisiId });
        if (currentSummary.total_outstanding + amount > 5000000) {
            return res.status(400).json({
                status: 400,
                message: `Total kasbon aktif + pengajuan baru melebihi batas Rp 5.000.000`
            });
        }

        return await withLock(`create-kasbon-${teknisiId}`, async () => {
            const existingPending = await dbGet(
                'SELECT id, amount FROM technician_kasbon WHERE teknisi_id = ? AND status = ? ORDER BY datetime(created_at) DESC LIMIT 1',
                [teknisiId, 'pending']
            );
            if (existingPending) {
                return res.status(409).json({
                    status: 409,
                    message: `Anda masih memiliki kasbon pending (ID #${existingPending.id}, Rp ${existingPending.amount.toLocaleString('id-ID')}).`
                });
            }

            const result = await dbRun(
                `INSERT INTO technician_kasbon (
                    teknisi_id, teknisi_name, amount, description, status, created_at, updated_at
                 ) VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
                [teknisiId, actorName(req), amount, description, new Date().toISOString(), new Date().toISOString()]
            );

            logActivity({
                userId: req.user.id,
                username: req.user.username,
                role: req.user.role,
                actionType: 'CREATE',
                resourceType: 'kasbon',
                resourceId: String(result.lastID),
                resourceName: `Kasbon Rp ${amount.toLocaleString('id-ID')}`,
                description: `Mengajukan kasbon Rp ${amount.toLocaleString('id-ID')}`,
                ipAddress: req.ip,
                userAgent: req.headers['user-agent']
            }).catch(console.error);

            res.status(201).json({
                status: 201,
                message: 'Pengajuan kasbon berhasil dibuat',
                data: { id: result.lastID, amount, status: 'pending' }
            });
        });
    } catch (error) {
        console.error('[KASBON_CREATE_ERROR]', error);
        res.status(500).json({ status: 500, message: 'Gagal membuat pengajuan kasbon' });
    }
});

router.put('/:id/approve', ensureAdmin, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const approved = req.body.approved === true || req.body.approved === 'true';
        const notes = req.body.notes || '';
        const kasbon = await dbGet('SELECT * FROM technician_kasbon WHERE id = ?', [id]);
        if (!kasbon) {
            return res.status(404).json({ status: 404, message: 'Kasbon tidak ditemukan' });
        }
        if (kasbon.status !== 'pending') {
            return res.status(400).json({ status: 400, message: `Kasbon sudah di-${kasbon.status}` });
        }

        const newStatus = approved ? 'approved' : 'rejected';
        await dbRun(
            `UPDATE technician_kasbon
             SET status = ?, approved_by = ?, approved_by_name = ?, approved_at = ?, notes = ?, updated_at = ?
             WHERE id = ?`,
            [newStatus, req.user.id, actorName(req), new Date().toISOString(), notes, new Date().toISOString(), id]
        );

        const ledgerResult = await createKasbonApprovalEntry(
            { ...kasbon, status: newStatus },
            {
                approved,
                createdBy: actorName(req),
                notes
            }
        );

        // Kabari TEKNISI-nya. Sampai sekarang jalur kasbon nol notifikasi: teknisi mengajukan
        // lalu menunggu tanpa tahu sudah disetujui atau ditolak — dan kalau disetujui, uangnya
        // akan dipotong dari gajinya tanpa ia pernah diberi tahu kapan keputusannya diambil.
        // NEVER-THROW: gagal kirim tak boleh membatalkan keputusan yang sudah tercatat.
        try {
            await kabariTeknisiKasbon({ kasbon, approved, notes, oleh: actorName(req) });
        } catch (notifErr) {
            console.error('[KASBON_NOTIF_ERROR]', notifErr && notifErr.message);
        }

        logActivity({
            userId: req.user.id,
            username: req.user.username,
            role: req.user.role,
            actionType: 'UPDATE',
            resourceType: 'kasbon',
            resourceId: String(id),
            resourceName: `Kasbon #${id}`,
            description: `Admin ${approved ? 'menyetujui' : 'menolak'} kasbon #${id}`,
            oldValue: { status: 'pending' },
            newValue: { status: newStatus, ledger_applied: ledgerResult.applied },
            ipAddress: req.ip,
            userAgent: req.headers['user-agent']
        }).catch(console.error);

        res.json({
            status: 200,
            message: `Kasbon berhasil di-${approved ? 'setujui' : 'tolak'}`,
            data: await getKasbonById(id)
        });
    } catch (error) {
        console.error('[KASBON_APPROVE_ERROR]', error);
        res.status(500).json({ status: 500, message: 'Gagal memproses kasbon' });
    }
});

router.put('/:id/paid', ensureAdmin, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const notes = req.body.notes || '';
        const result = await settleKasbonManually({ kasbonId: id, actor: req.user, notes });
        if (!result.settled && result.reason === 'not_found') {
            return res.status(404).json({ status: 404, message: 'Kasbon tidak ditemukan' });
        }
        if (!result.settled && result.reason === 'not_active') {
            return res.status(400).json({ status: 400, message: 'Kasbon tidak memiliki saldo aktif untuk dilunasi' });
        }

        logActivity({
            userId: req.user.id,
            username: req.user.username,
            role: req.user.role,
            actionType: 'UPDATE',
            resourceType: 'kasbon',
            resourceId: String(id),
            resourceName: `Kasbon #${id}`,
            description: `Admin melunasi kasbon #${id}`,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent']
        }).catch(console.error);

        res.json({
            status: 200,
            message: 'Kasbon berhasil ditandai lunas',
            data: await getKasbonById(id)
        });
    } catch (error) {
        console.error('[KASBON_SETTLE_ERROR]', error);
        res.status(500).json({ status: 500, message: 'Gagal melunasi kasbon' });
    }
});

router.delete('/:id', ensureAuthenticatedStaff, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const kasbon = await dbGet('SELECT * FROM technician_kasbon WHERE id = ?', [id]);
        if (!kasbon) {
            return res.status(404).json({ status: 404, message: 'Kasbon tidak ditemukan' });
        }
        if (req.user.role === 'teknisi' && String(kasbon.teknisi_id) !== String(req.user.id)) {
            return res.status(403).json({ status: 403, message: 'Anda tidak dapat membatalkan kasbon orang lain' });
        }
        if (kasbon.status !== 'pending') {
            return res.status(400).json({ status: 400, message: 'Hanya kasbon pending yang dapat dibatalkan' });
        }

        await dbRun('DELETE FROM technician_kasbon WHERE id = ?', [id]);
        res.json({ status: 200, message: 'Kasbon berhasil dibatalkan' });
    } catch (error) {
        console.error('[KASBON_DELETE_ERROR]', error);
        res.status(500).json({ status: 500, message: 'Gagal membatalkan kasbon' });
    }
});

module.exports = router;
