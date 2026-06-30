/**
 * Tripay Payment Gateway Client (API v2) — adapter ke-2 (selain iPaymu).
 *
 * - createCharge(props): buat transaksi CLOSED (1 metode) → balikan `checkoutUrl` (halaman
 *   Tripay yang AUTO-SETTLE) + qrUrl/payCode + reference (id Tripay). Beda dgn iPaymu yg
 *   sering "Unsettled/klarifikasi" — Tripay cair otomatis (T+1).
 * - getChannels(): daftar channel aktif (GET /merchant/payment-channel).
 * - checkTransaction(reference): VERIFIKASI server-to-server status transaksi (GET
 *   /transaction/detail) — dipakai callback sebelum kredit, JANGAN percaya body callback mentah.
 * - verifyCallbackSignature(rawBody, sig): cek X-Callback-Signature = HMAC-SHA256(rawBody, privateKey).
 *
 * Auth Tripay: header `Authorization: Bearer <apiKey>`.
 * Signature create: HMAC-SHA256( merchantCode + merchantRef + amount , privateKey ) hex.
 *
 * Header Doc
 * Purpose: Klien gateway Tripay (charge/channels/verify/callback-signature) untuk multi-gateway.
 * Caller: lib/payment-gateways (selector), routes/bill-payment.js, routes callback Tripay.
 * Deps: crypto-js, global fetch (Node18+), global.config (tripayApiKey/tripayPrivateKey/tripayMerchantCode/tripayProduction).
 * MainFuncs: createCharge, getChannels, checkTransaction, verifyCallbackSignature, _buildSignature, _resolveCreds.
 * SideEffects: HTTP ke API Tripay (tak menulis state lokal).
 */
"use strict";

const CryptoJs = require("crypto-js");

const SANDBOX_BASE = "https://tripay.co.id/api-sandbox";
const PROD_BASE = "https://tripay.co.id/api";

const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_RETRIES = 1;

function isRetryableError(err) {
    if (!err) return false;
    if (err.name === "AbortError" || err.name === "TypeError") return true;
    const sig = `${err.code || ""} ${err.message || ""}`;
    return /ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|socket|fetch failed/i.test(sig);
}

function getConfig() {
    return global.config || {};
}

/**
 * Kredensial + base URL sesuai mode. `forceSandbox` memaksa sandbox per-panggilan
 * (uji) tanpa mengubah `tripayProduction` global. Sandbox tetap pakai kredensial owner
 * (Tripay TIDAK menyediakan demo-creds publik seperti iPaymu — owner wajib isi sandbox key).
 */
function resolveCreds(forceSandbox = false) {
    const cfg = getConfig();
    const production = forceSandbox ? false : cfg.tripayProduction === true;
    return {
        production,
        base: production ? PROD_BASE : SANDBOX_BASE,
        apiKey: cfg.tripayApiKey || "",
        privateKey: cfg.tripayPrivateKey || "",
        merchantCode: cfg.tripayMerchantCode || "",
    };
}

// Signature pembuatan transaksi: HMAC-SHA256(merchantCode + merchantRef + amount, privateKey).
function buildSignature(merchantCode, merchantRef, amount, privateKey) {
    const data = `${merchantCode}${merchantRef}${amount}`;
    return CryptoJs.enc.Hex.stringify(CryptoJs.HmacSHA256(data, privateKey));
}

/**
 * Verifikasi signature callback Tripay. WAJIB pakai RAW body (string mentah persis yang
 * dikirim Tripay) — bukan hasil re-stringify JSON (urutan/spasi bisa beda → signature meleset).
 * @returns {boolean}
 */
function verifyCallbackSignature(rawBody, signatureHeader) {
    const { privateKey } = resolveCreds();
    if (!privateKey || !signatureHeader) return false;
    const expected = CryptoJs.enc.Hex.stringify(CryptoJs.HmacSHA256(String(rawBody == null ? "" : rawBody), privateKey));
    // Bandingkan konstan-waktu sederhana (panjang sama → XOR akumulatif).
    const a = String(signatureHeader);
    if (a.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i += 1) diff |= a.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
}

// Satu percobaan request (koneksi fresh tiap attempt agar retry tak reuse socket basi).
async function tripayAttempt(path, { method = "GET", form = null, query = null, sandbox = false }, timeoutMs) {
    const { base, apiKey } = resolveCreds(sandbox);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        let url = `${base}${path}`;
        if (query) url += `?${new URLSearchParams(query).toString()}`;
        const fetchOpts = {
            method,
            headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
            signal: controller.signal,
        };
        if (form && method !== "GET" && method !== "HEAD") {
            fetchOpts.headers["Content-Type"] = "application/x-www-form-urlencoded";
            fetchOpts.body = form.toString();
        }
        const response = await fetch(url, fetchOpts);
        let json;
        try {
            json = await response.json();
        } catch (_parseErr) {
            throw new Error(`Respons Tripay bukan JSON valid (HTTP ${response.status}).`);
        }
        return json;
    } finally {
        clearTimeout(timer);
    }
}

async function tripayRequest(path, options = {}) {
    const { apiKey } = resolveCreds(options.sandbox === true);
    if (!apiKey) throw new Error("Kredensial Tripay belum disetel (tripayApiKey).");
    const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    const maxRetries = options.retries == null ? DEFAULT_RETRIES : options.retries;
    let lastErr;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        try {
            return await tripayAttempt(path, options, timeoutMs);
        } catch (err) {
            lastErr = err;
            if (attempt < maxRetries && isRetryableError(err)) continue;
            throw err;
        }
    }
    throw lastErr;
}

/**
 * Buat transaksi CLOSED (1 metode terpilih). Balikan ternormalisasi seragam dgn adapter lain.
 * @param {{amount, reffId, comment, name, phone, email, method, returnUrl, expiredHours?, sandbox?}} props
 * @returns {Promise<{url, reference, reffId, qrUrl, payCode, status, total, expired, sandbox, gateway}>}
 */
async function createCharge(props) {
    const { merchantCode, privateKey } = resolveCreds(props && props.sandbox === true);
    let { amount, reffId, comment, name, phone, email, method, returnUrl, expiredHours, sandbox } = props || {};
    amount = parseInt(amount, 10);
    sandbox = sandbox === true;

    if (isNaN(amount) || !reffId || !name || !email || !method) {
        throw new Error("Tripay createCharge: amount, reffId, name, email, method wajib diisi.");
    }
    if (!merchantCode || !privateKey) {
        throw new Error("Kredensial Tripay belum lengkap (tripayMerchantCode / tripayPrivateKey).");
    }

    const form = new URLSearchParams();
    form.append("method", method);
    form.append("merchant_ref", reffId);
    form.append("amount", String(amount));
    form.append("customer_name", name || "Pelanggan");
    form.append("customer_email", email);
    if (phone) form.append("customer_phone", phone);
    // Tepat 1 item (tagihan) — bracket notation sesuai konvensi Tripay.
    form.append("order_items[0][name]", comment || "Pembayaran");
    form.append("order_items[0][price]", String(amount));
    form.append("order_items[0][quantity]", "1");
    if (returnUrl) form.append("return_url", returnUrl);
    if (expiredHours) form.append("expired_time", String(Math.floor(Date.now() / 1000) + expiredHours * 3600));
    form.append("signature", buildSignature(merchantCode, reffId, amount, privateKey));

    const res = await tripayRequest("/transaction/create", { method: "POST", form, sandbox });
    if (!res || res.success !== true || !res.data) {
        throw new Error((res && res.message) || "Transaksi Tripay gagal dibuat.");
    }
    const d = res.data;
    if (!d.checkout_url) throw new Error("Tripay tidak mengembalikan checkout_url.");
    return {
        url: d.checkout_url,
        reference: d.reference,
        reffId,
        qrUrl: d.qr_url || null,
        payCode: d.pay_code || null,
        status: d.status || null,
        total: d.amount != null ? d.amount : amount,
        expired: d.expired_time || null,
        sandbox,
        gateway: "tripay",
    };
}

/**
 * Daftar channel aktif. Balikan dinormalisasi {method, name, group, fee, logo, active}.
 */
async function getChannels(options = {}) {
    const res = await tripayRequest("/merchant/payment-channel", { method: "GET", sandbox: options.sandbox === true });
    if (!res || res.success !== true) {
        throw new Error((res && res.message) || "Gagal mengambil channel Tripay.");
    }
    return (res.data || [])
        .filter((c) => c.active !== false)
        .map((c) => ({
            method: c.code,
            name: c.name,
            group: c.group || null,
            logo: c.icon_url || null,
            fee: c.total_fee?.flat ?? c.fee_customer?.flat ?? null,
            feePercent: c.total_fee?.percent ?? c.fee_customer?.percent ?? null,
        }));
}

// Status Tripay yang dianggap LUNAS.
const PAID_STATUS = /^paid$/i;

/**
 * VERIFIKASI server-to-server: status transaksi langsung ke Tripay (pakai `reference` Tripay).
 * TIDAK throw — return envelope (sejajar dgn ipaymu.checkTransaction).
 * @returns {Promise<{ok, paid, status, referenceId, amount, error?, raw?}>}
 */
async function checkTransaction(reference, options = {}) {
    if (reference === undefined || reference === null || reference === "") {
        return { ok: false, paid: false, error: "reference kosong" };
    }
    try {
        const json = await tripayRequest("/transaction/detail", { method: "GET", query: { reference: String(reference) }, sandbox: options.sandbox === true });
        if (!json || json.success !== true || !json.data) {
            return { ok: false, paid: false, error: json?.message || "Gagal cek transaksi Tripay", raw: json };
        }
        const d = json.data;
        return {
            ok: true,
            paid: PAID_STATUS.test(String(d.status || "")),
            status: d.status,
            referenceId: d.merchant_ref != null ? String(d.merchant_ref) : null,
            amount: d.amount != null ? parseInt(d.amount, 10) : null,
            raw: d,
        };
    } catch (err) {
        return { ok: false, paid: false, error: err.message };
    }
}

module.exports = {
    createCharge,
    getChannels,
    checkTransaction,
    verifyCallbackSignature,
    _buildSignature: buildSignature,
    _resolveCreds: resolveCreds,
};
