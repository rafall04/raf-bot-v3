/**
 * Header Doc
 * Purpose: Token bertanda-tangan (HMAC-SHA256) untuk link bayar tagihan TANPA login —
 *          pelanggan tap link dari WhatsApp, halaman /bayar/:token memverifikasi tanpa
 *          OTP. Stateless (tak disimpan) → tahan restart, anti-tebak, ada kedaluwarsa.
 * Caller: routes halaman bayar (GET /bayar/:token, POST /api/bayar/:token/charge),
 *         cron reminder/isolir (membuat link), message/handlers customer (cektagihan).
 * Deps: crypto (HMAC), global.config (secret + base URL).
 * MainFuncs: createBillPayToken, verifyBillPayToken, buildBillPayUrl.
 * SideEffects: Tidak ada (murni hitung).
 */
"use strict";

const crypto = require("crypto");

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 hari

// Secret token. Disarankan set `bill_pay_token_secret` khusus di config; bila belum ada,
// turunkan stabil dari kredensial yang sudah ada (tanpa perlu menulis config).
function getSecret() {
    const cfg = global.config || {};
    if (cfg.bill_pay_token_secret) return String(cfg.bill_pay_token_secret);
    const base = cfg.ipaymuSecret || cfg.jwtSecret || "raf-bill-pay";
    return crypto.createHmac("sha256", String(base)).update("bill-pay-token-v1").digest("hex");
}

function b64urlEncode(str) {
    return Buffer.from(str, "utf8").toString("base64")
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(str) {
    const pad = str.length % 4 ? "=".repeat(4 - (str.length % 4)) : "";
    return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64").toString("utf8");
}
function sign(payloadB64) {
    return crypto.createHmac("sha256", getSecret()).update(payloadB64).digest("base64")
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Buat token bayar tagihan untuk satu pelanggan + periode.
 * @param {{id:(string|number)}} user
 * @param {{periodMonth?:number, periodYear?:number, ttlMs?:number, now?:number}} opts
 * @returns {string} token `<payloadB64>.<sig>`
 */
function createBillPayToken(user, opts = {}) {
    if (!user || user.id === undefined || user.id === null || user.id === "") {
        throw new Error("user.id wajib untuk token bayar tagihan.");
    }
    const now = opts.now || Date.now();
    const payload = {
        uid: String(user.id),
        pm: opts.periodMonth != null ? opts.periodMonth : null,
        py: opts.periodYear != null ? opts.periodYear : null,
        exp: now + (opts.ttlMs || DEFAULT_TTL_MS),
    };
    const payloadB64 = b64urlEncode(JSON.stringify(payload));
    return `${payloadB64}.${sign(payloadB64)}`;
}

/**
 * Verifikasi token. TIDAK throw — selalu return envelope.
 * @returns {{ok:boolean, reason?:string, uid?:string, periodMonth?:number|null, periodYear?:number|null}}
 */
function verifyBillPayToken(token, opts = {}) {
    if (!token || typeof token !== "string" || token.indexOf(".") === -1) {
        return { ok: false, reason: "format" };
    }
    const idx = token.indexOf(".");
    const payloadB64 = token.slice(0, idx);
    const sig = token.slice(idx + 1);
    const expected = sign(payloadB64);

    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return { ok: false, reason: "signature" };
    }

    let payload;
    try {
        payload = JSON.parse(b64urlDecode(payloadB64));
    } catch (_err) {
        return { ok: false, reason: "payload" };
    }

    const now = opts.now || Date.now();
    if (!payload.exp || payload.exp < now) {
        return { ok: false, reason: "expired" };
    }
    return {
        ok: true,
        uid: payload.uid,
        periodMonth: payload.pm != null ? payload.pm : null,
        periodYear: payload.py != null ? payload.py : null,
    };
}

/**
 * URL lengkap halaman bayar: `${base}/bayar/<token>`. base dari config (site_url_bot).
 */
function buildBillPayUrl(user, opts = {}) {
    const cfg = global.config || {};
    const base = String(opts.baseUrl || cfg.site_url_bot || cfg.siteUrl || "").replace(/\/+$/, "");
    return `${base}/bayar/${createBillPayToken(user, opts)}`;
}

module.exports = { createBillPayToken, verifyBillPayToken, buildBillPayUrl };
