/**
 * Header Doc
 * Purpose: Registrar route admin untuk kandidat isolir, riwayat isolir, dan operasi isolir manual/open.
 * Caller: `routes/admin-router.js`.
 * Deps: Router Express, middleware auth staf, `lib/services/isolir-service`, activity logger, dan global error handler.
 * MainFuncs: `registerAdminIsolirRoutes`.
 * SideEffects: Membaca histori isolir, menjalankan isolir/buka isolir, dan menulis activity log.
 */
"use strict";

const { asyncHandler } = require("../lib/error-handler");
const IsolirService = require('../lib/services/isolir-service');

function registerAdminIsolirRoutes({ router, ensureAuthenticatedStaff, logActivity }) {
    router.get('/api/isolir/candidates', ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        if (!req.user || !['admin', 'owner', 'superadmin'].includes(req.user.role)) {
            return res.status(403).json({ status: 403, message: 'Akses ditolak.' });
        }

        try {
            const result = await IsolirService.listCandidates({
                search: req.query.search || '',
                onlyIsolated: req.query.onlyIsolated === 'true',
                isCurrentlyIsolated: req.query.isCurrentlyIsolated === 'true'
                    ? true
                    : req.query.isCurrentlyIsolated === 'false'
                        ? false
                        : null,
                subscription: req.query.subscription || '',
                profile: req.query.profile || '',
                page: req.query.page || 1,
                limit: req.query.limit || 20,
            });
            return res.status(200).json({
                status: 200,
                message: result.message,
                data: {
                    items: result.data.items,
                    pagination: result.data.pagination,
                },
                meta: {
                    policy: result.data.policy,
                    availableProfiles: result.data.availableProfiles,
                    availableSubscriptions: result.data.availableSubscriptions,
                    summary: result.data.summary,
                },
            });
        } catch (error) {
            return res.status(error.statusCode || 500).json({
                status: error.statusCode || 500,
                message: error.message || 'Gagal mengambil kandidat isolir.',
                errorCode: error.errorCode || 'ISOLIR_CANDIDATES_ERROR',
            });
        }
    }));

    router.get('/api/isolir/history', ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        if (!req.user || !['admin', 'owner', 'superadmin'].includes(req.user.role)) {
            return res.status(403).json({ status: 403, message: 'Akses ditolak.' });
        }

        try {
            const includeResults = req.query.includeResults === 'true';
            const result = await IsolirService.getHistory({
                actionType: req.query.actionType || '',
                page: req.query.page || 1,
                limit: req.query.limit || 15,
                includeResults,
            });
            return res.status(200).json({
                status: 200,
                message: result.message,
                data: result.data.items,
                meta: {
                    pagination: result.data.pagination,
                },
            });
        } catch (error) {
            return res.status(500).json({
                status: 500,
                message: error.message || 'Gagal mengambil riwayat isolir.',
            });
        }
    }));

    router.get('/api/isolir/history/:id', ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        if (!req.user || !['admin', 'owner', 'superadmin'].includes(req.user.role)) {
            return res.status(403).json({ status: 403, message: 'Akses ditolak.' });
        }

        try {
            const result = await IsolirService.getHistoryById(req.params.id);
            return res.status(200).json({
                status: 200,
                message: result.message,
                data: result.data,
            });
        } catch (error) {
            return res.status(error.statusCode || 500).json({
                status: error.statusCode || 500,
                message: error.message || 'Gagal mengambil detail riwayat isolir.',
                errorCode: error.errorCode || 'ISOLIR_HISTORY_DETAIL_ERROR',
            });
        }
    }));

    router.post('/api/isolir/manual', ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        if (!req.user || !['admin', 'owner', 'superadmin'].includes(req.user.role)) {
            return res.status(403).json({ status: 403, message: 'Akses ditolak.' });
        }

        try {
            const result = await IsolirService.manualIsolir(req.body || {}, req);
            await logActivity({
                userId: req.user.id,
                username: req.user.username,
                role: req.user.role,
                action: 'custom_isolir_manual',
                category: 'ISOLIR',
                targetType: 'USER',
                description: `Manual isolir untuk ${Array.isArray(req.body?.userIds) ? req.body.userIds.length : 0} pelanggan`,
                metadata: {
                    targetProfile: req.body?.targetProfile || null,
                    disconnect: req.body?.disconnect,
                    reboot: req.body?.reboot,
                    reason: req.body?.reason || '',
                    historyId: result.data.historyId,
                },
            });
            return res.status(200).json({
                status: 200,
                message: result.message,
                data: {
                    historyId: result.data.historyId,
                    summary: result.data.summary,
                    results: result.data.results,
                },
            });
        } catch (error) {
            return res.status(error.statusCode || 500).json({
                status: error.statusCode || 500,
                message: error.message || 'Gagal menjalankan isolir manual.',
                errorCode: error.errorCode || 'ISOLIR_MANUAL_ERROR',
            });
        }
    }));

    router.post('/api/isolir/open', ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        if (!req.user || !['admin', 'owner', 'superadmin'].includes(req.user.role)) {
            return res.status(403).json({ status: 403, message: 'Akses ditolak.' });
        }

        try {
            const result = await IsolirService.openUsers(req.body || {}, req);
            await logActivity({
                userId: req.user.id,
                username: req.user.username,
                role: req.user.role,
                action: 'custom_isolir_open',
                category: 'ISOLIR',
                targetType: 'USER',
                description: `Buka isolir untuk ${Array.isArray(req.body?.userIds) ? req.body.userIds.length : 0} pelanggan`,
                metadata: {
                    reboot: req.body?.reboot,
                    reason: req.body?.reason || '',
                    historyId: result.data.historyId,
                },
            });
            return res.status(200).json({
                status: 200,
                message: result.message,
                data: {
                    historyId: result.data.historyId,
                    summary: result.data.summary,
                    results: result.data.results,
                },
            });
        } catch (error) {
            return res.status(error.statusCode || 500).json({
                status: error.statusCode || 500,
                message: error.message || 'Gagal membuka isolir.',
                errorCode: error.errorCode || 'ISOLIR_OPEN_ERROR',
            });
        }
    }));
}

module.exports = {
    registerAdminIsolirRoutes,
};
