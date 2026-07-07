/**
 * Header Doc
 * Purpose: Route admin switch koneksi WAN — status semua switch + terapkan/kembalikan. Aksi tulis
 *          (memindah trafik pelanggan) DIBATASI role admin/owner/superadmin (bukan teknisi).
 * Caller: `routes/admin-router.js`.
 * Deps: `lib/wan-switch-service`, `ensureAuthenticatedStaff`, `lib/error-handler.asyncHandler`.
 * MainFuncs: `registerAdminWanSwitchRoutes`.
 * SideEffects: Endpoint apply/restore memicu perubahan route di router gateway.
 */
"use strict";

const { asyncHandler } = require("../lib/error-handler");
const wanSwitch = require("../lib/wan-switch-service");

const ADMIN_ROLES = ["admin", "owner", "superadmin"];

function requireAdminOwner(req, res, next) {
    const role = req.user && String(req.user.role || "").toLowerCase();
    if (!role || !ADMIN_ROLES.includes(role)) {
        return res.status(403).json({ success: false, message: "Aksi switch koneksi hanya untuk admin/owner." });
    }
    next();
}

function actorFromReq(req) {
    const u = req.user || {};
    return { label: `${u.role || "admin"}:${u.name || u.username || u.id || "-"}`, role: u.role, name: u.name || u.username };
}

function registerAdminWanSwitchRoutes(router, deps) {
    const { ensureAuthenticatedStaff } = deps;

    // Status semua switch (baca) — teknisi boleh lihat, tak boleh apply.
    router.get("/api/wan-switch/status", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        const status = await wanSwitch.getStatus();
        res.json({ success: status.ok !== false, data: status });
    }));

    router.post("/api/wan-switch/apply/:id", ensureAuthenticatedStaff, requireAdminOwner, asyncHandler(async (req, res) => {
        const result = await wanSwitch.applySwitch(String(req.params.id || ""), "apply", actorFromReq(req));
        res.json({ success: result.ok === true, data: result });
    }));

    router.post("/api/wan-switch/restore/:id", ensureAuthenticatedStaff, requireAdminOwner, asyncHandler(async (req, res) => {
        const result = await wanSwitch.restoreSwitch(String(req.params.id || ""), actorFromReq(req));
        res.json({ success: result.ok === true, data: result });
    }));
}

module.exports = { registerAdminWanSwitchRoutes };
