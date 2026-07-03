/**
 * Header Doc
 * Purpose: Verifikasi token Cloudflare Turnstile (anti-bot form registrasi publik) ke endpoint
 *   siteverify secara server-side. FAIL-CLOSED: bila fitur AKTIF dan token kosong/gagal/eror → tolak.
 *   Bila fitur NONAKTIF (config.turnstile.enabled=false) → lolos (skip) agar dev/opsional mudah.
 * Caller: lib/services/public-registration-service.js.
 * Deps: axios, global.config.turnstile (enabled/secretKey).
 * MainFuncs: verifyTurnstile.
 * SideEffects: HTTP POST ke challenges.cloudflare.com (hanya saat fitur aktif).
 */
"use strict";

const axios = require("axios");

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

// Verifikasi token Turnstile. Mengembalikan { ok, skipped?, reason? }.
// - Fitur nonaktif → { ok:true, skipped:true } (tidak ada panggilan jaringan).
// - Fitur aktif tapi secret belum diisi / token kosong / gagal / eror → { ok:false } (FAIL-CLOSED).
async function verifyTurnstile(token, remoteIp) {
    const cfg = (global.config && global.config.turnstile) || {};
    if (!cfg.enabled) {
        return { ok: true, skipped: true };
    }

    const secret = cfg.secretKey;
    if (!secret || /^ISI_/i.test(String(secret))) {
        console.error("[TURNSTILE] enabled=true tetapi secretKey belum diisi — menolak (fail-closed).");
        return { ok: false, reason: "secret_missing" };
    }
    if (!token) {
        return { ok: false, reason: "token_missing" };
    }

    try {
        const params = new URLSearchParams();
        params.append("secret", secret);
        params.append("response", String(token));
        if (remoteIp) params.append("remoteip", String(remoteIp));

        const res = await axios.post(SITEVERIFY_URL, params, {
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            timeout: 8000
        });

        if (res && res.data && res.data.success === true) {
            return { ok: true };
        }
        console.warn("[TURNSTILE] Verifikasi gagal:", res && res.data && res.data["error-codes"]);
        return { ok: false, reason: "verify_failed" };
    } catch (err) {
        console.error("[TURNSTILE] Error verifikasi (fail-closed):", err.message);
        return { ok: false, reason: "verify_error" };
    }
}

module.exports = { verifyTurnstile };
