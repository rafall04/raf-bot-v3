/**
 * Header Doc
 * Purpose: Membuat instance Express yang sudah ditandai dengan runtime aplikasi untuk bootstrap HTTP yang lebih tipis,
 *          sekaligus menetapkan `trust proxy` agar `req.ip` & rate limiter benar di belakang Cloudflare Tunnel.
 * Caller: `index.js` sebagai pembuat aplikasi HTTP.
 * Deps: Factory Express yang dipasok caller; `runtime.getConfig()`/`runtime.config` untuk override `trustProxy`.
 * MainFuncs: `createHttpApp`, `resolveTrustProxy`.
 * SideEffects: Menyimpan runtime pada `app.locals.runtime` dan menyetel `app.set('trust proxy', ...)`.
 */
"use strict";

// Default trust proxy: aplikasi berjalan di belakang Cloudflare Tunnel, dan
// cloudflared meneruskan request ke app dari loopback (127.0.0.1/::1). Cukup
// memercayai loopback agar Express membaca IP klien asli dari X-Forwarded-For.
// JANGAN pakai `true` (memercayai semua proxy): klien bisa memalsukan
// X-Forwarded-For sehingga rate limiting jadi mudah di-bypass.
const DEFAULT_TRUST_PROXY = "loopback";

// Resolusi nilai trust proxy dari config (boleh di-override per-deploy, mis. jika
// tunnel berjalan di host lain → pakai hop count angka `1`). `null`/`undefined`
// jatuh ke default; `false`/`0` tetap dihormati untuk mematikan secara eksplisit.
function resolveTrustProxy(runtime) {
    const config =
        (runtime && typeof runtime.getConfig === "function" && runtime.getConfig()) ||
        (runtime && runtime.config) ||
        {};
    return config.trustProxy != null ? config.trustProxy : DEFAULT_TRUST_PROXY;
}

function createHttpApp(runtime, expressFactory) {
    const app = expressFactory();
    app.locals.runtime = runtime;

    // Disetel sebelum middleware apa pun dipasang. Tanpa ini, express-rate-limit
    // menolak header X-Forwarded-For (ERR_ERL_UNEXPECTED_X_FORWARDED_FOR) dan
    // `req.ip` jatuh ke alamat tunnel — semua klien ter-rate-limit sebagai satu IP.
    app.set("trust proxy", resolveTrustProxy(runtime));

    return app;
}

module.exports = {
    createHttpApp,
    resolveTrustProxy
};
