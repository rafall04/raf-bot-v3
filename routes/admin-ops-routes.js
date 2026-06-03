/**
 * Header Doc
 * Purpose: Registrar route admin untuk utility destruktif yang sudah dipisah dari router legacy.
 * Caller: `routes/admin-router.js`.
 * Deps: Router Express, middleware auth staf, `services/admin-ops.service`, dan activity logger.
 * MainFuncs: `registerAdminOpsRoutes`.
 * SideEffects: Menghapus entitas database/JSON, menghapus semua pelanggan, dan membersihkan foto yatim.
 */
"use strict";

const { asyncHandler, createError, ErrorTypes } = require("../lib/error-handler");
const { createAdminOpsService } = require("../services/admin-ops.service");

function registerAdminOpsRoutes(router, deps) {
    const {
        ensureAuthenticatedStaff,
        logActivity
    } = deps;

    const adminOpsService = createAdminOpsService(deps);

    function buildActorContext(req) {
        return {
            id: req.user?.id || null,
            username: req.user?.username || "system",
            role: req.user?.role || null,
            rawUser: req.user || null
        };
    }

    function requireAdmin(req) {
        if (!req.user || !["admin", "owner", "superadmin"].includes(req.user.role)) {
            throw createError(ErrorTypes.AUTHORIZATION_ERROR, "Akses ditolak.", 403);
        }
    }

    router.delete("/api/:category/:id", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        requireAdmin(req);
        const result = await adminOpsService.deleteEntityByCategory({
            category: req.params.category,
            id: req.params.id
        }, buildActorContext(req), {
            ipAddress: req.ip || req.connection?.remoteAddress || req.headers["x-forwarded-for"],
            userAgent: req.headers["user-agent"] || ""
        }, logActivity);
        return res.status(result.status).json(result);
    }));

    router.post("/api/admin/delete-all-users", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        requireAdmin(req);
        const result = await adminOpsService.deleteAllUsers({
            password: req.body?.password
        }, buildActorContext(req));
        return res.status(result.status).json(result);
    }));

    router.post("/api/admin/cleanup-orphaned-photos", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        requireAdmin(req);
        const result = await adminOpsService.cleanupOrphanedPhotos({
            password: req.body?.password
        }, buildActorContext(req));
        return res.status(result.status).json(result);
    }));
}

module.exports = {
    registerAdminOpsRoutes
};
