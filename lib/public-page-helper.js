/**
 * Header Doc
 * Purpose: Helper murni (read-only) untuk halaman publik server-rendered: ambil info bisnis dari
 *   `global.config`, daftar paket publik dari `global.packages`, escape HTML, format Rupiah, dan
 *   bangun link WhatsApp. Menyeragamkan sumber data landing dengan halaman legal.
 * Caller: `routes/public-site.js` (landing). Catatan: `routes/legal-pages.js` masih punya salinan
 *   lokal setara (`biz`/`publicPackages`/`esc`/`waLink`) — kandidat unifikasi berikutnya.
 * Deps: `global.config`, `global.packages`.
 * MainFuncs: esc, formatRupiah, getBusinessInfo, getPublicPackages, waLink.
 * SideEffects: Tidak ada.
 */
"use strict";

// Escape entitas HTML agar nilai dinamis dari config/paket aman disisipkan ke markup.
function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
}

// Format angka ke "Rp1.234.567"; kembalikan null bila bukan angka positif (paket disembunyikan).
function formatRupiah(value) {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n) || n <= 0) return null;
    return "Rp" + n.toLocaleString("id-ID");
}

// Info bisnis dari config dengan fallback berlapis; abaikan nilai placeholder ("ISI_...").
function getBusinessInfo() {
    const cfg = global.config || {};
    const c = cfg.company || {};
    const clean = (v) => {
        const s = String(v == null ? "" : v).trim();
        return /^ISI_/i.test(s) || s === "" ? "" : s;
    };
    const phone = clean(c.phone) || clean(cfg.telfon) || clean(cfg.adminPhone);
    return {
        name: clean(c.name) || clean(cfg.nama) || "RAF NET",
        address: clean(c.address),
        phone,
        email: clean(c.email),
        website: clean(c.website),
        logo: clean(c.logoPath)
    };
}

// Daftar paket publik untuk tampilan tarif — buang voucher/whitelist/tanpa harga valid.
function getPublicPackages(limit = 12) {
    const pkgs = Array.isArray(global.packages) ? global.packages : [];
    return pkgs
        .filter((p) => p && p.name && p.name !== "PAKET-VOUCHER" && p.whitelist !== true)
        .map((p) => ({ name: String(p.name), price: formatRupiah(p.price) }))
        .filter((p) => p.price)
        .slice(0, limit);
}

// Bangun link wa.me dari nomor mentah (normalisasi ke format internasional 62...).
function waLink(phone) {
    const d = String(phone || "").replace(/\D/g, "");
    if (!d) return "";
    const intl = d.startsWith("0") ? `62${d.slice(1)}` : d.startsWith("62") ? d : `62${d}`;
    return `https://wa.me/${intl}`;
}

module.exports = { esc, formatRupiah, getBusinessInfo, getPublicPackages, waLink };
