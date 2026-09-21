/**
 * Header Doc
 * Purpose: Fulfillment voucher BERBAYAR (pasca-callback gateway) — generate `qty` voucher
 *   sekuensial, format daftar kode untuk pesan WhatsApp, parse kembali kode dari field `ket`
 *   payment, dan baca gate multi-beli (`config.voucherMultiPurchase`). getvoucher NON-IDEMPOTENT
 *   (MikroTik membuat username acak tiap panggilan) → batch TIDAK auto-retry dan berhenti di
 *   kegagalan pertama; sisa kegagalan dicatat caller sebagai orphan untuk fulfill manual admin.
 * Caller: `routes/public/payment-callback.js` (settle buynow/buynowweb/buynowpanel),
 *   `routes/public-anonymous.js` (validasi qty + proyeksi `codes` di statustrx),
 *   `services/payment-flow.service.js` (gate + batas qty `buynow`).
 * Deps: `getvoucher` di-inject per pemanggil (bukan di-require di sini — file ini murni orchestrator).
 * MainFuncs: `generateVoucherBatch`, `formatVoucherCodeList`, `parseVoucherCodesFromKet`, `voucherMultiBuyConfig`.
 * SideEffects: Tiap pemanggilan `getvoucher` membuat user hotspot BARU di MikroTik — panggil hanya
 *   setelah pembayaran terverifikasi & belum settle.
 */
"use strict";

const DEFAULT_MAX_QTY = 10;

/**
 * Gate pembelian multi-voucher (baca `config.voucherMultiPurchase` dari global.config).
 * Default OFF (deploy gelap): enabled=false, maxQty=DEFAULT_MAX_QTY bila tak diisi.
 */
function voucherMultiBuyConfig(config) {
    const cfg = (config && config.voucherMultiPurchase) || {};
    const maxQty = Math.max(1, parseInt(cfg.maxQty, 10) || DEFAULT_MAX_QTY);
    return { enabled: cfg.enabled === true, maxQty };
}

/**
 * Normalisasi qty dari input pengguna/query — integer >= 1, default 1 bila kosong/tak valid.
 * (Validasi "boleh >1?" adalah tugas caller lewat voucherMultiBuyConfig.)
 */
function normalizeVoucherQty(raw) {
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * Buat `qty` voucher profil yang sama SEKUENSIAL. Tiap item dibungkus try/catch dan batch
 * BERHENTI di kegagalan pertama — error MikroTik umumnya sistemik (koneksi/endpoint down),
 * melanjutkan hanya membuang waktu dan menyulitkan rekonsiliasi. Return { codes, failures }:
 * codes = kode yang BERHASIL terbit, failures = pesan error tiap item yang gagal.
 */
async function generateVoucherBatch({ getvoucher, prof, qty, sender, caller }) {
    const codes = [];
    const failures = [];
    const total = normalizeVoucherQty(qty);
    for (let i = 0; i < total; i++) {
        try {
            const res = await getvoucher(prof, sender, { caller: `${caller}#${i + 1}` });
            const code = res && res.ok === true ? String((res.data && res.data.username) || res.message || "") : "";
            if (code) {
                codes.push(code);
                continue;
            }
            // getvoucher bisa mengembalikan STRING (pesan error langsung, mis. site_url kosong).
            failures.push(typeof res === "string" ? res : ((res && res.message) || "voucher gagal dibuat"));
        } catch (err) {
            failures.push((err && err.message) || "voucher gagal dibuat");
        }
        break; // stop di kegagalan pertama — jangan teruskan memukul MikroTik yang bermasalah.
    }
    return { codes, failures };
}

/** Daftar kode untuk pesan WA/struk: 1 kode → polos; >1 → baris bernomor. */
function formatVoucherCodeList(codes) {
    const list = Array.isArray(codes) ? codes.filter(Boolean).map(String) : [];
    if (list.length <= 1) return list[0] || "";
    return list.map((code, i) => `${i + 1}. ${code}`).join("\n");
}

/**
 * Parse kode voucher dari field `ket` payment. Konvensi: buynow "Voucher: A, B";
 * buynowweb/buynowpanel "A, B"; gagal terbit "GAGAL voucher: ...". Return [] bila kosong/gagal.
 */
function parseVoucherCodesFromKet(ket) {
    if (!ket || typeof ket !== "string") return [];
    const t = ket.trim();
    if (!t || /^GAGAL/i.test(t)) return [];
    const m = t.match(/^Voucher:\s*(.+)$/i);
    const body = (m ? m[1] : t).trim();
    if (!body) return [];
    return body.split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean);
}

module.exports = {
    DEFAULT_MAX_QTY,
    voucherMultiBuyConfig,
    normalizeVoucherQty,
    generateVoucherBatch,
    formatVoucherCodeList,
    parseVoucherCodesFromKet
};
