/**
 * Header Doc
 * Purpose: Factory router API voucher untuk generate, kirim, dan lacak kredensial/voucher pelanggan.
 * Caller: `routes/api.js` sebagai agregator sub-router voucher.
 * Deps: `express`, templating voucher, history pengiriman voucher, delivery service WhatsApp, serta `voucher-print` service/repository (layout + cetak + impor template Mikhmon).
 * MainFuncs: `createApiVoucherRouter`.
 * SideEffects: Membaca/menulis histori pengiriman voucher, mengirim pesan WhatsApp ke pelanggan, render lembar cetak voucher (HTML/QR), dan menyimpan settings/layout cetak.
 */
const express = require('express');
const { sendMessageToMany, ensureJid } = require('../lib/whatsapp-delivery-service');
const { createApiVoucherRepository } = require('../repositories/api-voucher.repository');
const { createApiVoucherService } = require('../services/api-voucher.service');
const { createVoucherPrintRepository } = require('../repositories/voucher-print.repository');
const { createVoucherPrintService } = require('../services/voucher-print.service');
const { addHotspotUsersBatch } = require('../lib/mikrotik');

function createApiVoucherRouter({
    fs,
    path,
    renderTemplate,
    loadVoucherSentHistory,
    appendVoucherSentHistory,
    resolveVoucherDeliveryStatus,
    buildVoucherSentHistoryEntries,
    getVoucherSentStats,
    findVoucherHistoryByReference,
    ensureAuthenticatedStaff
}) {
    const router = express.Router();

    // Guard staff fail-closed: endpoint voucher (generate/kirim/riwayat kredensial) hanya untuk
    // staff (admin/owner/superadmin/teknisi). Bila guard tidak diinjeksikan, default ini tetap
    // menolak non-staff agar pelanggan tidak bisa men-generate voucher atau membaca kredensial.
    const requireStaff = typeof ensureAuthenticatedStaff === 'function'
        ? ensureAuthenticatedStaff
        : (req, res, next) => {
            if (!req.user || !['admin', 'owner', 'superadmin', 'teknisi'].includes(req.user.role)) {
                const status = req.user ? 403 : 401;
                return res.status(status).json({ status, message: 'Akses ditolak.' });
            }
            return next();
        };

    function getRuntime() {
        return global.__appRuntime || null;
    }

    function getRuntimeStateValue(key, fallbackValue) {
        const runtime = getRuntime();
        if (runtime?.state?.has?.(key)) {
            return runtime.state.get(key);
        }
        if (typeof global[key] !== 'undefined') {
            return global[key];
        }
        return fallbackValue;
    }

    function getVoucherRepo() {
        return getRuntime()?.repositories?.voucher || null;
    }



    function getConfig() {
        return getRuntime()?.getConfig?.() || getRuntimeStateValue('config', {}) || {};
    }

    function getVoucherProfiles() {
        let profiles = getVoucherRepo()?.getAll() || getRuntimeStateValue('voucher', []);

        if (!profiles || profiles.length === 0) {
            const voucherDbPath = path.join(__dirname, '../database/voucher.json');
            if (fs.existsSync(voucherDbPath)) {
                profiles = JSON.parse(fs.readFileSync(voucherDbPath, 'utf8'));
            }
        }

        return Array.isArray(profiles) ? profiles : [];
    }


    const apiVoucherRepository = createApiVoucherRepository({
        runtime: getRuntime(),
        fs,
        path,
        loadVoucherSentHistory,
        appendVoucherSentHistory,
        findVoucherHistoryByReference,
        getVoucherSentStats
    });
    const apiVoucherService = createApiVoucherService({
        repository: apiVoucherRepository,
        getConfig,
        renderTemplate,
        sendMessageToMany,
        ensureJid,
        resolveVoucherDeliveryStatus,
        buildVoucherSentHistoryEntries,
        logger: console
    });

    const voucherPrintService = createVoucherPrintService({
        repository: createVoucherPrintRepository(),
        getConfig,
        addHotspotUsersBatch,
        logger: console
    });

    router.get('/voucher/profiles', requireStaff, async (req, res) => {
        try {
            const result = await apiVoucherService.listVoucherProfiles();
            return res.status(result.status).json(result.body);
        } catch (error) {
            console.error('[VOUCHER_PROFILES_ERROR]', error);
            return res.status(500).json({
                status: 500,
                message: 'Gagal memuat paket voucher',
                error: error.message
            });
        }
    });

    router.post('/voucher/generate-send', requireStaff, async (req, res) => {
        try {
            const result = await apiVoucherService.generateAndSendVouchers({
                ...req.body,
                createdBy: req.user?.username || 'admin'
            });
            return res.status(result.status).json(result.body);
        } catch (error) {
            console.error('[VOUCHER_GENERATE_SEND_ERROR]', error);
            return res.status(500).json({
                status: 500,
                message: 'Terjadi kesalahan',
                error: error.message
            });
        }
    });

    router.get('/voucher/sent-history', requireStaff, (req, res) => {
        try {
            apiVoucherService.listSentHistory({
                limit: parseInt(req.query.limit, 10) || 50
            })
                .then((result) => res.status(result.status).json(result.body))
                .catch((error) => {
                    console.error('[VOUCHER_HISTORY_ERROR]', error);
                    return res.status(500).json({
                        status: 500,
                        message: 'Gagal memuat riwayat',
                        error: error.message
                    });
                });
        } catch (error) {
            console.error('[VOUCHER_HISTORY_ERROR]', error);
            return res.status(500).json({
                status: 500,
                message: 'Gagal memuat riwayat',
                error: error.message
            });
        }
    });

    router.get('/voucher/sent-stats', requireStaff, (req, res) => {
        try {
            apiVoucherService.getSentStats()
                .then((result) => res.status(result.status).json(result.body))
                .catch((error) => {
                    console.error('[VOUCHER_STATS_ERROR]', error);
                    return res.status(500).json({
                        status: 500,
                        message: 'Gagal memuat statistik',
                        error: error.message
                    });
                });
        } catch (error) {
            console.error('[VOUCHER_STATS_ERROR]', error);
            return res.status(500).json({
                status: 500,
                message: 'Gagal memuat statistik',
                error: error.message
            });
        }
    });

    router.post('/member/send-credentials', requireStaff, async (req, res) => {
        try {
            const result = await apiVoucherService.sendMemberCredentials({
                userId: req.body.userId,
                phones: req.body.phones,
                notes: req.body.notes,
                createdBy: req.user?.username || 'admin'
            });
            return res.status(result.status).json(result.body);
        } catch (error) {
            console.error('[MEMBER_CREDENTIALS_ERROR]', error);
            return res.status(500).json({
                status: 500,
                message: 'Terjadi kesalahan',
                error: error.message
            });
        }
    });

    // ===== Cetak Voucher (layout + QR, lepas Mikhmon untuk generate+cetak) =====
    router.get('/voucher/print/layouts', requireStaff, (req, res) => {
        try {
            return res.json({ status: 200, data: voucherPrintService.listLayouts() });
        } catch (error) {
            console.error('[VOUCHER_PRINT_LAYOUTS_ERROR]', error);
            return res.status(500).json({ status: 500, message: 'Gagal memuat layout', error: error.message });
        }
    });

    router.get('/voucher/print/settings', requireStaff, (req, res) => {
        try {
            return res.json({ status: 200, data: voucherPrintService.getSettings() });
        } catch (error) {
            console.error('[VOUCHER_PRINT_SETTINGS_GET_ERROR]', error);
            return res.status(500).json({ status: 500, message: 'Gagal memuat pengaturan', error: error.message });
        }
    });

    router.post('/voucher/print/settings', requireStaff, (req, res) => {
        try {
            const saved = voucherPrintService.saveSettings(req.body || {});
            return res.json({ status: 200, message: 'Pengaturan tersimpan', data: saved });
        } catch (error) {
            console.error('[VOUCHER_PRINT_SETTINGS_SAVE_ERROR]', error);
            return res.status(500).json({ status: 500, message: 'Gagal menyimpan pengaturan', error: error.message });
        }
    });

    router.post('/voucher/print/layout', requireStaff, (req, res) => {
        try {
            if (!req.body || !req.body.id || !req.body.template) {
                return res.status(400).json({ status: 400, message: 'id dan template wajib diisi' });
            }
            const saved = voucherPrintService.saveLayout(req.body);
            return res.json({ status: 200, message: 'Layout tersimpan', data: saved });
        } catch (error) {
            console.error('[VOUCHER_PRINT_LAYOUT_SAVE_ERROR]', error);
            return res.status(500).json({ status: 500, message: 'Gagal menyimpan layout', error: error.message });
        }
    });

    router.delete('/voucher/print/layout/:id', requireStaff, (req, res) => {
        try {
            const result = voucherPrintService.deleteLayout(req.params.id);
            return res.json({ status: 200, message: 'Layout dihapus', data: result });
        } catch (error) {
            console.error('[VOUCHER_PRINT_LAYOUT_DELETE_ERROR]', error);
            return res.status(500).json({ status: 500, message: 'Gagal menghapus layout', error: error.message });
        }
    });

    router.post('/voucher/print/preview-mikhmon', requireStaff, (req, res) => {
        try {
            const result = voucherPrintService.previewMikhmonImport({ php: req.body ? req.body.php : '' });
            return res.json({ status: 200, data: result });
        } catch (error) {
            console.error('[VOUCHER_PRINT_MIKHMON_PREVIEW_ERROR]', error);
            return res.status(500).json({ status: 500, message: 'Gagal konversi template', error: error.message });
        }
    });

    router.post('/voucher/print/import-mikhmon', requireStaff, (req, res) => {
        try {
            const result = voucherPrintService.importMikhmonLayout({
                id: req.body ? req.body.id : undefined,
                name: req.body ? req.body.name : undefined,
                php: req.body ? req.body.php : '',
                mergeColors: !req.body || req.body.mergeColors !== false
            });
            return res.json({ status: 200, message: 'Template Mikhmon diimpor', data: result });
        } catch (error) {
            console.error('[VOUCHER_PRINT_MIKHMON_IMPORT_ERROR]', error);
            return res.status(500).json({ status: 500, message: 'Gagal impor template', error: error.message });
        }
    });

    router.post('/voucher/print/generate', requireStaff, async (req, res) => {
        try {
            const result = await voucherPrintService.generateBatch({
                profile: req.body ? req.body.profile : undefined,
                count: req.body ? req.body.count : undefined,
                length: req.body ? req.body.length : undefined,
                chartype: req.body ? req.body.chartype : undefined,
                prefix: req.body ? req.body.prefix : undefined
            });
            if (!result.ok) {
                return res.status(400).json({ status: 400, message: result.message });
            }
            return res.json({
                status: 200,
                message: `Berhasil generate ${result.created} voucher${result.failed ? `, ${result.failed} gagal` : ''}`,
                data: result
            });
        } catch (error) {
            console.error('[VOUCHER_PRINT_GENERATE_ERROR]', error);
            return res.status(500).json({ status: 500, message: 'Gagal generate voucher batch', error: error.message });
        }
    });

    router.post('/voucher/print/render', requireStaff, async (req, res) => {
        try {
            const result = await voucherPrintService.renderPrint({
                layoutId: req.body ? req.body.layoutId : undefined,
                vouchers: (req.body && req.body.vouchers) || [],
                thermal: Boolean(req.body && req.body.thermal),
                title: req.body ? req.body.title : undefined
            });
            res.set('Content-Type', 'text/html; charset=utf-8');
            return res.send(result.html);
        } catch (error) {
            console.error('[VOUCHER_PRINT_RENDER_ERROR]', error);
            return res.status(500).json({ status: 500, message: 'Gagal render cetak', error: error.message });
        }
    });

    return router;
}

module.exports = createApiVoucherRouter;
