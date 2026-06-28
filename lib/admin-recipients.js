/**
 * Header Doc
 * Purpose: Resolusi daftar JID admin/owner yang VALID untuk alert operasional (mis. voucher
 *   gagal, reaktivasi tagihan gagal). Memfilter nomor placeholder/tak valid (mis.
 *   `62xxxxxxxxxx`) supaya alert benar-benar sampai — bukan terkirim ke JID hantu.
 * Caller: routes/public.js (alert callback), dan jalur notifikasi admin lain.
 * Deps: global.config (ownerNumber/telfon/nomor_admin/adminPhone) + global.accounts (role admin).
 * MainFuncs: getAdminJids.
 * SideEffects: Tidak ada (murni baca config/accounts).
 */
"use strict";

/**
 * @returns {string[]} JID admin valid & unik, mis. ["6289685645956@s.whatsapp.net"].
 *   Nomor < 10 digit (placeholder seperti "62xxxxxxxxxx") otomatis dibuang.
 */
function getAdminJids(config = (typeof global !== "undefined" ? global.config : null), accounts = (typeof global !== "undefined" ? global.accounts : null)) {
    const cfg = config || {};
    const out = new Set();

    const addNum = (raw) => {
        const digits = String(raw || "").replace(/\D/g, "");
        if (digits.length >= 10) out.add(`${digits}@s.whatsapp.net`);
    };

    (Array.isArray(cfg.ownerNumber) ? cfg.ownerNumber : [cfg.ownerNumber]).forEach(addNum);
    addNum(cfg.telfon);
    addNum(cfg.nomor_admin);
    addNum(cfg.adminPhone);

    (Array.isArray(accounts) ? accounts : []).forEach((a) => {
        if (a && ["admin", "owner", "superadmin"].includes(String(a.role || "").toLowerCase())) {
            addNum(a.phone_number);
        }
    });

    return Array.from(out);
}

module.exports = { getAdminJids };
