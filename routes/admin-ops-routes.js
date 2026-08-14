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

    // Kategori LEGACY yang memang tak punya pemilik lain. Sengaja allowlist, bukan blocklist:
    // router ini di-mount PALING AWAL (lib/routes-registry.js baris 57), jadi pola
    // `/api/:category/:id` menangkap apa pun yang huruf-per-huruf cocok — termasuk milik
    // router yang di-mount SETELAHNYA.
    //
    // Yang dulu terbayangi dan kini dikembalikan ke pemiliknya:
    //   - `users`    → services/api-users/delete-user-by-id.js (memutus sesi PPPoE, MENGHAPUS
    //                  secret di MikroTik, menghitung ulang port ODP, dan melaporkan `langkah`).
    //                  Selama terbayangi, jalur web hanya menghapus baris SQLite: secret PPPoE
    //                  tertinggal di router = "modem hantu" yang harus dibersihkan manual, dan
    //                  static/js/users.js menampilkan semua langkah sebagai "–" karena respons
    //                  catch-all tak membawa `langkah`.
    //   - `accounts` → routes/accounts.js (adminOnly + pembersihan turunannya).
    //   - `packages` → routes/packages.js.
    const KATEGORI_LEGACY_TANPA_PEMILIK = new Set([
        "payment", "statik", "voucher", "atm", "payment-method", "mikrotik-devices"
    ]);

    // Gerbang kepemilikan dipasang SEBELUM auth: kalau kategorinya bukan milik router ini,
    // biarkan pemilik sebenarnya yang memutuskan otorisasinya. `next("router")` keluar dari
    // adminApiRouter dan mengembalikan kendali ke app — bukan `next()`/`next("route")`, yang
    // dua-duanya tetap berada di dalam router ini.
    function lepaskanKePemilikSebenarnya(req, res, next) {
        if (!KATEGORI_LEGACY_TANPA_PEMILIK.has(req.params.category)) {
            return next("router");
        }
        return next();
    }

    router.delete("/api/:category/:id", lepaskanKePemilikSebenarnya, ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
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
