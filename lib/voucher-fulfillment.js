/**
 * Header Doc
 * Purpose: Fulfillment voucher BERBAYAR (pasca-callback gateway) — generate `qty` voucher
 *   sekuensial, format daftar kode untuk pesan WhatsApp, parse kembali kode dari field `ket`
 *   payment, baca gate multi-beli (`config.voucherMultiPurchase`) + gate username kustom
 *   (`config.voucherCustomCreds`), dan cek ketersediaan username kustom pra-charge
 *   (`assertVoucherUsernameAvailable` — reservasi pending + pre-check MikroTik).
 *   getvoucher NON-IDEMPOTENT (MikroTik membuat username acak tiap panggilan) → batch TIDAK
 *   auto-retry dan berhenti di kegagalan pertama; sisa kegagalan dicatat caller sebagai
 *   orphan untuk fulfill manual admin.
 * Caller: `routes/public/payment-callback.js` (settle buynow/buynowweb/buynowpanel),
 *   `routes/public-anonymous.js` (validasi qty/custom + proyeksi `codes` di statustrx),
 *   `services/payment-flow.service.js` (gate + batas qty `buynow` + parse kredensial kustom),
 *   `services/customer-voucher.service.js` (custom creds jalur panel).
 * Deps: `getvoucher`/`cekHotspotUser` di-inject per pemanggil (file ini murni orchestrator).
 * MainFuncs: `generateVoucherBatch`, `formatVoucherCodeList`, `parseVoucherCodesFromKet`,
 *   `voucherMultiBuyConfig`, `voucherCustomCredsConfig`, `assertVoucherUsernameAvailable`.
 * SideEffects: Tiap pemanggilan `getvoucher` membuat user hotspot BARU di MikroTik — panggil hanya
 *   setelah pembayaran terverifikasi & belum settle.
 */
"use strict";

const DEFAULT_MAX_QTY = 10;

/**
 * Berapa lama record pembayaran PENDING memegang reservasi username kustom.
 * QRIS iPaymu kedaluwarsa ±15-30 menit; 60 menit = batas aman atas supaya nama
 * yang dibayar-tapi-batal tidak mengunci selamanya. Setelah lewat TTL, record
 * pending basi dianggap tidak menahan nama lagi.
 */
const VOUCHER_USERNAME_TTL_MS = 60 * 60 * 1000;

/** Username kustom: huruf/angka kecil + `-`/`_`, 3-16 karakter, diawali alnum. */
const VOUCHER_USERNAME_RE = /^[a-z0-9][a-z0-9_-]{2,15}$/;

/**
 * Gate multi-beli voucher (baca `config.voucherMultiPurchase` dari global.config).
 * Default OFF (deploy gelap): enabled=false + maxQty=10.
 */
function voucherMultiBuyConfig(config) {
    const cfg = (config && config.voucherMultiPurchase) || {};
    return {
        enabled: cfg.enabled === true,
        maxQty: Math.max(1, parseInt(cfg.maxQty, 10) || DEFAULT_MAX_QTY)
    };
}

/**
 * Gate voucher username/password kustom (baca `config.voucherCustomCreds` dari
 * global.config). Default OFF (deploy gelap).
 */
function voucherCustomCredsConfig(config) {
    const cfg = (config && config.voucherCustomCreds) || {};
    return { enabled: cfg.enabled === true };
}

/**
 * Normalisasi username kustom: trim + lowercase. Return null bila kosong/tak valid —
 * lowercase dipaksakan supaya "Adi" vs "adi" tak bisa jadi dua voucher berbeda
 * (cek MikroTik `?name=` bersifat case-sensitive).
 */
function normalizeVoucherUsername(raw) {
    const s = String(raw || "").trim().toLowerCase();
    return VOUCHER_USERNAME_RE.test(s) ? s : null;
}

/**
 * Normalisasi password kustom: trim; kosong → null (berarti password = username).
 * Password harus 3-64 karakter tanpa spasi — sejalan validasi adduserhotspot.php.
 */
function normalizeVoucherPassword(raw) {
    const s = String(raw || "").trim();
    if (!s) return null;
    return /^\S{3,64}$/.test(s) ? s : null;
}

/**
 * Apakah username kustom sedang DIPEGANG record pembayaran pending (belum lunas &
 * masih dalam TTL reservasi). Record yang sudah paid/expired TIDAK menahan nama —
 * nama bebas lagi walau voucher lama pernah memakainya (user bisa saja sudah
 * dihapus dari MikroTik; cek router yang memutuskan).
 */
function isVoucherUsernameReserved(payments, username, nowMs, ttlMs = VOUCHER_USERNAME_TTL_MS) {
    const list = Array.isArray(payments) ? payments : [];
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    return list.some((p) => {
        if (!p || p.customUser !== username) return false;
        if (p.status === true || p.status === 1 || p.status === "true") return false;
        return now - Number(p.createdAt || 0) <= ttlMs;
    });
}

/**
 * Cek ketersediaan username kustom SEBELUM charge (lapis 1+2 anti-duplikat):
 *   1. reserved  → dipegang transaksi pending lain dalam TTL.
 *   2. taken     → sudah ada di /ip/hotspot/user MikroTik (pre-check `cekHotspotUser`,
 *                  di-inject caller). Gagal koneksi pre-check → reason 'check_failed'
 *                  (fail closed — jangan tagih nama yang tak bisa diverifikasi).
 * Garis terakhir tetap trap DUPLICATE `user/add` di adduserhotspot.php (atomic RouterOS).
 * Return: { ok:true, username } | { ok:false, reason, message }.
 */
async function assertVoucherUsernameAvailable({ payments, cekHotspotUser, username, nowMs, ttlMs }) {
    const name = normalizeVoucherUsername(username);
    if (!name) {
        return { ok: false, reason: "invalid", message: "Username hanya boleh huruf kecil/angka plus - dan _ (3-16 karakter)." };
    }
    if (isVoucherUsernameReserved(payments, name, nowMs, ttlMs)) {
        return { ok: false, reason: "reserved", username: name, message: `Username "${name}" sedang dipakai transaksi lain. Pilih username lain.` };
    }
    if (typeof cekHotspotUser === "function") {
        let res;
        try {
            res = await cekHotspotUser(name, { caller: "voucher-fulfillment.assertVoucherUsernameAvailable" });
        } catch (err) {
            return { ok: false, reason: "check_failed", username: name, message: `Gagal memeriksa username: ${(err && err.message) || err}` };
        }
        if (typeof res === "string" || !res || res.ok !== true) {
            const msg = typeof res === "string" ? res : ((res && res.message) || "cek username gagal");
            return { ok: false, reason: "check_failed", username: name, message: `Gagal memeriksa username: ${msg}` };
        }
        if (res.data && res.data.exists === true) {
            return { ok: false, reason: "taken", username: name, message: `Username "${name}" sudah terdaftar. Pilih username lain.` };
        }
    }
    return { ok: true, username: name };
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
async function generateVoucherBatch({ getvoucher, prof, qty, sender, caller, custom }) {
    const codes = [];
    const failures = [];
    const total = normalizeVoucherQty(qty);
    // Username kustom hanya masuk akal untuk 1 voucher — caller seharusnya sudah
    // menolak custom+qty>1; guard di sini tetap ada supaya N voucher tak berebut
    // satu username (item ke-2+ pasti DUPLICATE).
    if (custom && custom.username && total > 1) {
        return { codes, failures: ["Username kustom hanya untuk pembelian 1 voucher."] };
    }
    for (let i = 0; i < total; i++) {
        try {
            const ctx = { caller: `${caller}#${i + 1}` };
            if (custom && custom.username) ctx.custom = custom;
            const res = await getvoucher(prof, sender, ctx);
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

/**
 * Daftar kode untuk pesan WA/struk: 1 kode → polos; >1 → baris bernomor.
 * `opts.password`: password kustom pembelian qty=1 yang beda dari username —
 * disertakan dalam teks supaya pelanggan dapat login (kode saja tak cukup).
 */
function formatVoucherCodeList(codes, opts = {}) {
    const list = Array.isArray(codes) ? codes.filter(Boolean).map(String) : [];
    const password = typeof opts.password === "string" ? opts.password : "";
    if (list.length <= 1) {
        const code = list[0] || "";
        return code && password && password !== code ? `${code} (password: ${password})` : code;
    }
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
    VOUCHER_USERNAME_TTL_MS,
    VOUCHER_USERNAME_RE,
    voucherMultiBuyConfig,
    voucherCustomCredsConfig,
    normalizeVoucherQty,
    normalizeVoucherUsername,
    normalizeVoucherPassword,
    isVoucherUsernameReserved,
    assertVoucherUsernameAvailable,
    generateVoucherBatch,
    formatVoucherCodeList,
    parseVoucherCodesFromKet
};
