/**
 * Header Doc
 * Purpose: Resolusi daftar JID admin untuk alert operasional (voucher gagal, reaktivasi
 *   tagihan gagal) + link "verifikasi ke admin". SUMBER TUNGGAL = accounts.json (akun ber-role
 *   admin/owner/superadmin). SENGAJA tidak pakai config.telfon (itu nomor BOT sendiri) atau
 *   config.ownerNumber (di prod sering placeholder `62xxxxxxxxxx`).
 * Caller: routes/public.js (alertAdmins), routes/bill-payment.js (link verifikasi admin).
 * Deps: global.accounts (di-load dari database/accounts.json saat startup, lib/database.js:243).
 * MainFuncs: getAdminJids, getFirstAdminNumber.
 * SideEffects: Tidak ada (murni baca accounts).
 */
"use strict";

const ADMIN_ROLES = ["admin", "owner", "superadmin"];

function normalizeDigits(raw) {
    let digits = String(raw || "").replace(/\D/g, "");
    // Normalisasi lokal → internasional supaya nomor "08xxx" tetap valid sebagai JID.
    if (digits.startsWith("0")) digits = `62${digits.slice(1)}`;
    return digits;
}

/**
 * @param {Array} [accounts] - default global.accounts.
 * @returns {string[]} JID admin valid & unik dari accounts.json. Mis. ["6285233047094@s.whatsapp.net"].
 *   Hanya role admin/owner/superadmin; nomor < 10 digit / non-62 dibuang.
 */
function getAdminJids(accounts = (typeof global !== "undefined" ? global.accounts : null)) {
    const out = new Set();
    (Array.isArray(accounts) ? accounts : []).forEach((a) => {
        if (!a || !ADMIN_ROLES.includes(String(a.role || "").toLowerCase())) return;
        const digits = normalizeDigits(a.phone_number);
        if (digits.length >= 10 && digits.startsWith("62")) out.add(`${digits}@s.whatsapp.net`);
    });
    return Array.from(out);
}

/**
 * Nomor (digit, tanpa @s.whatsapp.net) admin pertama — untuk link wa.me. "" bila tak ada.
 */
function getFirstAdminNumber(accounts) {
    const jid = getAdminJids(accounts)[0];
    return jid ? jid.replace("@s.whatsapp.net", "") : "";
}

module.exports = { getAdminJids, getFirstAdminNumber };
