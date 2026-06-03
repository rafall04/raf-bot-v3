/**
 * Header Doc
 * Purpose: Router admin tipis untuk hotspot billing dan package change yang sudah dipisah ke controller-service.
 * Caller: `routes/admin-router.js`.
 * Deps: `controllers/admin.controller`, `lib/error-handler`, middleware auth admin, dan security rate limit.
 * MainFuncs: `createAdminRoutes`.
 * SideEffects: Mendaftarkan endpoint admin baru sebelum fallback legacy router.
 */
"use strict";

const express = require("express");
const { createAdminController } = require("../controllers/admin.controller");
const { asyncHandler, createError, ErrorTypes } = require("../lib/error-handler");
const { ensureAuthenticatedStaff } = require("./admin-auth");
const { rateLimit } = require("../lib/security");

function createAdminRoutes() {
    const router = express.Router();
    const controller = createAdminController();

    router.post("/api/users/reload", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        if (!req.user || !["admin", "owner", "superadmin"].includes(req.user.role)) {
            throw createError(ErrorTypes.AUTHORIZATION_ERROR, "Akses ditolak.", 403);
        }
        return controller.reloadUsersCache(req, res);
    }));

    router.get("/api/list/users", ensureAuthenticatedStaff, rateLimit("list-users", 30, 60000), asyncHandler(async (req, res) => controller.listUsers(req, res)));

    router.get("/api/list/packages", ensureAuthenticatedStaff, rateLimit("list-packages", 30, 60000), asyncHandler(async (req, res) => controller.listPackages(req, res)));

    router.post("/api/request-package-change", ensureAuthenticatedStaff, rateLimit("request-package-change", 5, 60000), asyncHandler(async (req, res) => {
        if (!req.body.userId || !req.body.newPackageName) {
            throw createError(
                ErrorTypes.VALIDATION_ERROR,
                "Parameter 'userId' dan 'newPackageName' wajib diisi.",
                400
            );
        }
        return controller.requestPackageChange(req, res);
    }));

    router.post("/api/approve-package-change", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        if (!req.body.requestId || !req.body.action) {
            throw createError(
                ErrorTypes.VALIDATION_ERROR,
                "Parameter 'requestId' dan 'action' wajib diisi.",
                400
            );
        }
        return controller.approvePackageChange(req, res);
    }));

    router.get("/api/package-change-requests", ensureAuthenticatedStaff, asyncHandler(async (req, res) => controller.listPackageChangeRequests(req, res)));

    return router;
}

module.exports = {
    createAdminRoutes
};
