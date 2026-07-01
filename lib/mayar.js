/**
 * Mayar Payment Gateway Client (Headless API /hl/v1) — adapter ke-3 (selain iPaymu & Tripay).
 *
 * - createInvoice(props): buat invoice → balikan `url` (halaman bayar Mayar yang AUTO-SETTLE,
 *   dari field `data.link`) + `reference` (id invoice Mayar). Nominal via items[].rate.
 * - checkTransaction(invoiceId): VERIFIKASI server-to-server status invoice (GET /invoice/{id})
 *   — dipakai callback SEBELUM kredit; jangan percaya body webhook mentah.
 * - registerWebhook(url): daftarkan URL webhook (sekali setup).
 *
 * Auth Mayar: header `Authorization: Bearer <apiKey>`.
 * Base: prod https://api.mayar.id/hl/v1 · sandbox https://api.mayar.club/hl/v1.
 *
 * ⚠️ DUA HAL YANG WAJIB DIKONFIRMASI LEWAT UJI SANDBOX sebelum kredit uang produksi
 *    (docs resmi tak memastikan; jangan flip gateway ke 'mayar' sebelum ini beres):
 *    1) FIELD STATUS "LUNAS" pada GET /invoice/{id} → sesuaikan PAID_STATUS + path field.
 *    2) FIELD KORELASI pada payload webhook payment.received (id apa yang cocok dgn invoice kita)
 *       → dipakai routes/bill-payment.js POST /callback/mayar.
 *
 * Header Doc
 * Purpose: Klien gateway Mayar (createInvoice/checkTransaction/registerWebhook) untuk multi-gateway.
 * Caller: lib/payment-gateways (selector), routes/bill-payment.js (callback Mayar).
 * Deps: global fetch (Node18+), global.config (mayarApiKey/mayarSandbox).
 * MainFuncs: createInvoice, checkTransaction, registerWebhook, _resolveCreds.
 * SideEffects: HTTP ke API Mayar (tak menulis state lokal).
 */
"use strict";

const SANDBOX_BASE = "https://api.mayar.club/hl/v1";
const PROD_BASE = "https://api.mayar.id/hl/v1";

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_RETRIES = 1;

// Status invoice/transaksi Mayar yang dianggap LUNAS. ⚠️ VERIFIKASI di sandbox — nilai persisnya
// (mis. "paid"/"SUCCESS"/"settled"/"closed") harus dicocokkan dgn respons asli.
const PAID_STATUS = /^(paid|success|settled|complete|completed)$/i;

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
 * Kredensial + base URL sesuai mode. `forceSandbox` memaksa sandbox per-panggilan (uji)
 * tanpa mengubah `mayarSandbox` global. Mayar memakai satu API key (Bearer) per environment;
 * key sandbox (api.mayar.club) BEDA dari key produksi (api.mayar.id).
 */
function resolveCreds(forceSandbox = false) {
    const cfg = getConfig();
    // Sandbox aktif bila dipaksa per-panggilan ATAU config.mayarSandbox === true.
    const sandbox = forceSandbox === true || cfg.mayarSandbox === true;
    return {
        sandbox,
        base: sandbox ? SANDBOX_BASE : PROD_BASE,
        apiKey: (sandbox ? cfg.mayarSandboxApiKey : cfg.mayarApiKey) || cfg.mayarApiKey || "",
    };
}

// Satu percobaan request (koneksi fresh tiap attempt agar retry tak reuse socket basi — anti dual-WAN).
async function mayarAttempt(path, { method = "GET", body = null, query = null, sandbox = false }, timeoutMs) {
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
        if (body && method !== "GET" && method !== "HEAD") {
            fetchOpts.headers["Content-Type"] = "application/json";
            fetchOpts.body = JSON.stringify(body);
        }
        const response = await fetch(url, fetchOpts);
        let json;
        try {
            json = await response.json();
        } catch (_parseErr) {
            throw new Error(`Respons Mayar bukan JSON valid (HTTP ${response.status}).`);
        }
        return { httpStatus: response.status, json };
    } finally {
        clearTimeout(timer);
    }
}

async function mayarRequest(path, options = {}) {
    const { apiKey } = resolveCreds(options.sandbox === true);
    if (!apiKey) throw new Error("Kredensial Mayar belum disetel (mayarApiKey / mayarSandboxApiKey).");
    const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    const maxRetries = options.retries == null ? DEFAULT_RETRIES : options.retries;
    let lastErr;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        try {
            return await mayarAttempt(path, options, timeoutMs);
        } catch (err) {
            lastErr = err;
            if (attempt < maxRetries && isRetryableError(err)) continue;
            throw err;
        }
    }
    throw lastErr;
}

/**
 * Buat invoice Mayar (hosted). Nominal disampaikan lewat 1 item (quantity 1, rate = amount).
 * Balikan dinormalisasi seragam dgn adapter lain.
 * @param {{amount, name, phone, email, comment, returnUrl, sandbox?}} props
 * @returns {Promise<{url, reference, transactionId, status, total, sandbox, gateway, raw}>}
 */
async function createInvoice(props) {
    let { amount, name, phone, email, comment, returnUrl, sandbox } = props || {};
    amount = parseInt(amount, 10);
    sandbox = sandbox === true;

    if (isNaN(amount) || amount < 1 || !name || !email) {
        throw new Error("Mayar createInvoice: amount, name, email wajib diisi.");
    }

    const body = {
        name: name || "Pelanggan",
        email,
        mobile: phone || "",
        redirectUrl: returnUrl || undefined,
        description: comment || "Pembayaran",
        items: [
            { quantity: 1, rate: amount, description: comment || "Pembayaran" },
        ],
    };

    const { json } = await mayarRequest("/invoice/create", { method: "POST", body, sandbox });
    const d = (json && json.data) || null;
    if (!d) {
        throw new Error((json && (json.messages || json.message)) || "Invoice Mayar gagal dibuat.");
    }
    // Field URL halaman bayar Mayar = `link` (bisa juga `paymentLink`/`url` di beberapa versi → defensif).
    const url = d.link || d.paymentLink || d.url || null;
    if (!url) throw new Error("Mayar tidak mengembalikan link pembayaran (data.link).");
    return {
        url,
        reference: d.id != null ? String(d.id) : null,
        transactionId: d.transactionId != null ? String(d.transactionId) : null,
        status: d.status || null,
        total: d.amount != null ? d.amount : amount,
        sandbox,
        gateway: "mayar",
        raw: d,
    };
}

/**
 * VERIFIKASI server-to-server: status invoice langsung ke Mayar (pakai id invoice).
 * TIDAK throw — return envelope (sejajar dgn ipaymu/tripay.checkTransaction).
 * ⚠️ Paid-detection (PAID_STATUS + path field status) WAJIB diverifikasi di sandbox.
 * @returns {Promise<{ok, paid, status, referenceId, amount, error?, raw?}>}
 */
async function checkTransaction(invoiceId, options = {}) {
    if (invoiceId === undefined || invoiceId === null || invoiceId === "") {
        return { ok: false, paid: false, error: "invoiceId kosong" };
    }
    try {
        const { json } = await mayarRequest(`/invoice/${encodeURIComponent(String(invoiceId))}`, {
            method: "GET",
            sandbox: options.sandbox === true,
        });
        const d = (json && json.data) || null;
        if (!d) {
            return { ok: false, paid: false, error: (json && (json.messages || json.message)) || "Gagal cek invoice Mayar", raw: json };
        }
        // Status bisa di d.status atau d.transactionStatus (defensif) — konfirmasi di sandbox.
        const statusValue = d.status || d.transactionStatus || d.paymentStatus || "";
        return {
            ok: true,
            paid: PAID_STATUS.test(String(statusValue)),
            status: statusValue,
            referenceId: d.id != null ? String(d.id) : null,
            amount: d.amount != null ? parseInt(d.amount, 10) : null,
            raw: d,
        };
    } catch (err) {
        return { ok: false, paid: false, error: err.message };
    }
}

/**
 * Daftarkan URL webhook (sekali setup). CLI resmi memakai GET /webhook/register body {urlHook};
 * karena GET-with-body tak konsisten di Node fetch, kirim urlHook via query DAN body (defensif).
 * @returns {Promise<{ok, error?, raw?}>}
 */
async function registerWebhook(urlHook, options = {}) {
    if (!urlHook) return { ok: false, error: "urlHook kosong" };
    try {
        const { json, httpStatus } = await mayarRequest("/webhook/register", {
            method: "POST",
            body: { urlHook },
            query: { urlHook },
            sandbox: options.sandbox === true,
        });
        return { ok: httpStatus >= 200 && httpStatus < 300, raw: json };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

module.exports = {
    createInvoice,
    checkTransaction,
    registerWebhook,
    _resolveCreds: resolveCreds,
    SANDBOX_BASE,
    PROD_BASE,
};
