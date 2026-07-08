/**
 * Header Doc
 * Purpose: Route admin steering pelanggan per-ISP — overview live (pelanggan × jalur), steer
 *          per-pelanggan, kelola entri pool (freedns/lokaldns), dan setup rule override router.
 *          Aksi TULIS dibatasi role admin/owner/superadmin (teknisi boleh lihat overview).
 * Caller: `routes/admin-router.js`.
 * Deps: `lib/customer-steering-service`, `ensureAuthenticatedStaff`, `lib/error-handler.asyncHandler`.
 * MainFuncs: `registerAdminCustomerSteeringRoutes`.
 * SideEffects: Endpoint tulis mengubah address-list/mangle router via service (audit insiden).
 */
"use strict";

const { asyncHandler } = require("../lib/error-handler");
const steering = require("../lib/customer-steering-service");

const ADMIN_ROLES = ["admin", "owner", "superadmin"];

function requireAdminOwner(req, res, next) {
    const role = req.user && String(req.user.role || "").toLowerCase();
    if (!role || !ADMIN_ROLES.includes(role)) {
        return res.status(403).json({ success: false, message: "Aksi steering hanya untuk admin/owner." });
    }
    next();
}

function actorFromReq(req) {
    const u = req.user || {};
    return `${u.role || "admin"}:${u.name || u.username || u.id || "-"}`;
}

function registerAdminCustomerSteeringRoutes(router, deps) {
    const { ensureAuthenticatedStaff } = deps;

    // Overview live: pelanggan online → jalur intended/actual + entri pool + intent steering.
    router.get("/api/customer-steering/overview", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        const role = req.user && String(req.user.role || "").toLowerCase();
        const data = await steering.buildSteeringOverview();
        res.json({ success: data.ok !== false, data: { ...data, canEdit: ADMIN_ROLES.includes(role) } });
    }));

    // Steer satu pelanggan ({ userId, path: gmdp|ih|mni|sf|null }) — null = kembali ke default.
    router.post("/api/customer-steering/steer", ensureAuthenticatedStaff, requireAdminOwner, asyncHandler(async (req, res) => {
        const { userId, path: targetPath } = req.body || {};
        const result = await steering.steerCustomer({ userId, path: targetPath || null, actor: actorFromReq(req) });
        res.status(result.ok ? 200 : 400).json({ success: result.ok === true, data: result });
    }));

    // Kelola entri pool (freedns/lokaldns): { action: toggle|add|remove, list, id?, address?, disabled? }.
    router.post("/api/customer-steering/pool-entry", ensureAuthenticatedStaff, requireAdminOwner, asyncHandler(async (req, res) => {
        const { action, list, id, address, disabled } = req.body || {};
        const result = await steering.poolEntryAction({ action, list, id, address, disabled, actor: actorFromReq(req) });
        res.status(result.ok ? 200 : 400).json({ success: result.ok === true, data: result });
    }));

    // Pasang/cek rule override RAF-CUSTSTEER (idempoten; ?check=1 read-only).
    router.post("/api/customer-steering/setup", ensureAuthenticatedStaff, requireAdminOwner, asyncHandler(async (req, res) => {
        const check = String(req.query.check || "") === "1";
        const result = await steering.setupSteeringRules({ check, actor: actorFromReq(req) });
        res.status(result.ok ? 200 : 400).json({ success: result.ok === true, data: result });
    }));
}

module.exports = { registerAdminCustomerSteeringRoutes };
