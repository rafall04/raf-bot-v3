/**
 * Header Doc
 * Purpose: Route Owner Cockpit — GET /api/owner/cockpit mengembalikan ringkasan sekali-baca untuk
 *          owner (pemasukan, status ISP, tiket, pipeline PSB, outage OLT) dari
 *          `lib/owner-cockpit-service.buildCockpit` (best-effort per kartu). READ-ONLY, admin/owner.
 * Caller: `routes/admin-router.js`.
 * Deps: Express router, `ensureAuthenticatedStaff`, `lib/owner-cockpit-service.buildCockpit`,
 *       `lib/error-handler.asyncHandler`.
 * MainFuncs: `registerAdminOwnerCockpitRoutes`.
 * SideEffects: Tidak ada (hanya baca agregasi).
 */
"use strict";

const { asyncHandler } = require("../lib/error-handler");
const { buildCockpit } = require("../lib/owner-cockpit-service");

const COCKPIT_ROLES = ["owner", "admin", "superadmin"];

function registerAdminOwnerCockpitRoutes(router, deps = {}) {
    const ensureAuthenticatedStaff = deps.ensureAuthenticatedStaff || ((_req, _res, next) => next());

    router.get("/api/owner/cockpit", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        const role = req.user && String(req.user.role || "").toLowerCase();
        if (req.user && !COCKPIT_ROLES.includes(role)) {
            return res.status(403).json({ success: false, message: "Owner Cockpit khusus admin/owner." });
        }
        const data = await buildCockpit();
        res.json({ success: true, data });
    }));
}

module.exports = { registerAdminOwnerCockpitRoutes };
