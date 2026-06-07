/**
 * Header Doc
 * Purpose: Factory router API voucher untuk generate, kirim, dan lacak kredensial/voucher pelanggan.
 * Caller: `routes/api.js` sebagai agregator sub-router voucher.
 * Deps: `express`, templating voucher, history pengiriman voucher, dan delivery service WhatsApp.
 * MainFuncs: `createApiVoucherRouter`.
 * SideEffects: Membaca/menulis histori pengiriman voucher dan mengirim pesan WhatsApp ke pelanggan.
 */
const express = require('express');
const { sendMessageToMany, ensureJid } = require('../lib/whatsapp-delivery-service');
const { createApiVoucherRepository } = require('../repositories/api-voucher.repository');
const { createApiVoucherService } = require('../services/api-voucher.service');

function createApiVoucherRouter({
    fs,
    path,
    renderTemplate,
    loadVoucherSentHistory,
    appendVoucherSentHistory,
    resolveVoucherDeliveryStatus,
    buildVoucherSentHistoryEntries,
    getVoucherSentStats,
    findVoucherHistoryByReference
}) {
    const router = express.Router();

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

    router.get('/voucher/profiles', async (req, res) => {
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

    router.post('/voucher/generate-send', async (req, res) => {
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

    router.get('/voucher/sent-history', (req, res) => {
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

    router.get('/voucher/sent-stats', (req, res) => {
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

    router.post('/member/send-credentials', async (req, res) => {
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

    return router;
}

module.exports = createApiVoucherRouter;
