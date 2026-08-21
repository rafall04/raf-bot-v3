/**
 * Header Doc
 * Purpose: SATU modul kebijakan peran untuk lapisan HTTP. Menyediakan predikat peran
 *          (`isAdmin`/`isTeknisi`) dan gerbang GAGAL-TERTUTUP untuk router admin
 *          (`buatGerbangTeknisi`) — teknisi hanya boleh menyentuh jalur yang DIDAFTARKAN
 *          eksplisit, sisanya ditolak 403.
 * Caller: `routes/admin-router.js` (gerbang), dan siapa pun yang butuh predikat peran.
 * Deps: Tidak ada (murni; `global.config` dibaca lewat parameter `bacaMode`).
 * MainFuncs: `isAdmin`, `isTeknisi`, `cocokkanJalur`, `buatGerbangTeknisi`.
 * SideEffects: Menulis log `[AUTHZ_TEKNISI_DITOLAK]` / `[AUTHZ_TEKNISI_LAPOR]`.
 *
 * KENAPA ADA (#b253): gerbang bawaan seluruh router admin adalah `ensureAuthenticatedStaff`,
 * dan isinya MEMASUKKAN peran `teknisi`. Router-nya dipasang polos (`app.use("/", adminApiRouter)`),
 * jadi setiap endpoint admin BARU lahir TERBUKA untuk teknisi; menutupnya bergantung pada ingatan
 * penulis menambah cek kedua di dalam handler. Terukur: 119 dari 185 rute hidup tak punya cek
 * kedua. Akibat terburuknya sudah terbukti live — kredensial router inti terbaca akun teknisi
 * (#b252). Lapisan HALAMAN sudah lama gagal-tertutup (`routes/pages.js`); modul ini memberi
 * lapisan API padanannya.
 */
"use strict";

const PERAN_ADMIN = ["admin", "owner", "superadmin"];

function peranDari(user) {
    return String((user && user.role) || "").toLowerCase();
}

function isAdmin(user) {
    return PERAN_ADMIN.includes(peranDari(user));
}

function isTeknisi(user) {
    return peranDari(user) === "teknisi";
}

/**
 * Cocokkan jalur permintaan dengan pola ber-parameter (`/api/ssid/:deviceId`).
 * Sengaja TIDAK memakai regex bebas: pola hanya boleh literal + segmen `:param`, supaya
 * daftar izin tak bisa diperlebar diam-diam oleh pola yang terlalu longgar.
 */
function cocokkanJalur(pola, jalur) {
    const a = String(pola).replace(/\/+$/, "").split("/");
    const b = String(jalur).replace(/\?.*$/, "").replace(/\/+$/, "").split("/");
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
        if (a[i].startsWith(":")) {
            if (!b[i]) return false;
            continue;
        }
        if (a[i].toLowerCase() !== b[i].toLowerCase()) return false;
    }
    return true;
}

function diizinkan(daftarIzin, method, jalur) {
    const m = String(method || "").toUpperCase();
    return daftarIzin.some((izin) => {
        const metodeCocok = !izin.method || String(izin.method).toUpperCase() === m;
        return metodeCocok && cocokkanJalur(izin.jalur, jalur);
    });
}

/**
 * Gerbang gagal-tertutup untuk peran TEKNISI di router admin.
 *
 * Sengaja HANYA bertindak saat pemanggilnya benar-benar teknisi. Peran lain (admin/owner/
 * superadmin, sesi pelanggan, tanpa sesi) dilewatkan APA ADANYA supaya gerbang ini tidak
 * mengubah perilaku selain yang dituju — `ensureAuthenticatedStaff` per-rute tetap penentu
 * bagi mereka. Blast radius sempit itu disengaja.
 *
 * Mode (config `authz.gerbangTeknisi`):
 *   "tegakkan" (bawaan) → tolak 403
 *   "laporkan"          → JANGAN tolak, cuma catat (untuk mengukur trafik nyata dulu)
 *   "mati"              → lewati sama sekali
 */
function buatGerbangTeknisi(daftarIzin, opsi = {}) {
    const izin = Array.isArray(daftarIzin) ? daftarIzin : [];
    const bacaMode = opsi.bacaMode || (() => {
        const cfg = (global.config && global.config.authz) || {};
        return cfg.gerbangTeknisi || "tegakkan";
    });
    const logger = opsi.logger || console;

    return function gerbangTeknisi(req, res, next) {
        const mode = String(bacaMode() || "tegakkan").toLowerCase();
        if (mode === "mati") return next();
        if (!isTeknisi(req.user)) return next();

        const jalur = req.path || req.url || "";
        if (diizinkan(izin, req.method, jalur)) return next();

        const jejak = `${req.method} ${jalur} oleh ${(req.user && req.user.username) || "?"}`;
        if (mode === "laporkan") {
            logger.warn?.(`[AUTHZ_TEKNISI_LAPOR] ${jejak} — AKAN ditolak saat mode tegakkan`);
            return next();
        }
        logger.warn?.(`[AUTHZ_TEKNISI_DITOLAK] ${jejak}`);
        return res.status(403).json({
            status: 403,
            message: "Akses ditolak. Halaman ini bukan bagian dari pekerjaan teknisi.",
            errorCode: "AUTHORIZATION_ERROR"
        });
    };
}

module.exports = {
    PERAN_ADMIN,
    isAdmin,
    isTeknisi,
    cocokkanJalur,
    diizinkan,
    buatGerbangTeknisi
};
