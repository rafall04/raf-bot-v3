/**
 * Header Doc
 * Purpose: Memusatkan middleware autentikasi staf admin agar dapat dipakai ulang oleh modul admin yang dipisah.
 * Caller: `routes/admin.js` dan modul admin baru hasil pemecahan bounded context.
 * Deps: `req.user` yang sudah diisi middleware auth global.
 * MainFuncs: `ensureAuthenticatedStaff`.
 * SideEffects: Menulis log debug auth dan mengirim respons 403 bila role tidak sesuai.
 */
"use strict";

function ensureAuthenticatedStaff(req, res, next) {
    if (!req.user) {
        console.log(`[AUTH_DEBUG] ensureAuthenticatedStaff: req.user is null/undefined. Path: ${req.path}, Method: ${req.method}`);
        console.log("[AUTH_DEBUG] Cookies:", req.cookies);
        console.log("[AUTH_DEBUG] Headers:", req.headers.authorization ? "Authorization header present" : "No Authorization header");
        return res.status(403).json({ status: 403, message: "Akses ditolak. User tidak terautentikasi." });
    }

    if (!["admin", "owner", "superadmin", "teknisi"].includes(req.user.role)) {
        console.log(`[AUTH_DEBUG] ensureAuthenticatedStaff: Invalid role. User: ${req.user.username}, Role: ${req.user.role}, Path: ${req.path}`);
        return res.status(403).json({ status: 403, message: "Akses ditolak. Role tidak diizinkan." });
    }

    next();
}

module.exports = {
    ensureAuthenticatedStaff
};
