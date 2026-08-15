/**
 * Header Doc
 * Purpose: Memusatkan bootstrap security middleware HTTP seperti Helmet, CORS, dan rate limiting global/auth.
 * Caller: `index.js`.
 * Deps: `helmet`, `cors`, `express-rate-limit`, dan konfigurasi port/runtime.
 * MainFuncs: `registerHttpSecurity`.
 * SideEffects: Mendaftarkan middleware keamanan dan rate limiter ke Express app.
 */
"use strict";

const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { ipKeyGenerator } = require("express-rate-limit");
const { normalizePhone } = require("./phone-validator");

// Host tujuan request, menghormati proxy/tunnel (Cloudflare Tunnel mengisi
// X-Forwarded-Host dengan domain publik asli).
function getRequestHost(req) {
    const forwarded = req.headers["x-forwarded-host"];
    const raw = (forwarded ? String(forwarded).split(",")[0] : req.headers.host) || "";
    return raw.trim().split(":")[0].toLowerCase();
}

// Request same-origin: panel memanggil server-nya sendiri (Origin == Host).
// Ini selalu aman diizinkan, tanpa perlu konfigurasi domain manual.
function isSameOriginRequest(origin, req) {
    if (!origin) {
        return true; // GET same-origin biasanya tanpa header Origin
    }
    try {
        const originHost = new URL(origin).hostname.toLowerCase();
        const requestHost = getRequestHost(req);
        return !!requestHost && originHost === requestHost;
    } catch (_e) {
        return false;
    }
}

function createGlobalLimiter() {
    return rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 300,
        message: {
            status: 429,
            message: "Terlalu banyak permintaan dari IP ini, silakan coba lagi nanti."
        },
        standardHeaders: true,
        legacyHeaders: false,
        skip: (req) => {
            if (req.path.match(/\.(jpg|jpeg|png|gif|svg|css|js|ico|woff|woff2|ttf|eot)$/i)) {
                return true;
            }
            const monitoringPaths = [
                "/api/monitoring/live",
                "/api/monitoring/live-data",
                "/api/monitoring/traffic-history",
                "/api/monitoring/health",
                "/api/monitoring/traffic",
                "/api/monitoring/users",
                "/api/monitoring/history",
                "/api/stats"
            ];
            if (monitoringPaths.some((path) => req.path.startsWith(path))) {
                return true;
            }
            return Boolean(req.user || req.customer);
        }
    });
}

// Kunci limiter login pada IDENTITAS, bukan IP.
//
// KENAPA: portal pelanggan (raff-panel-2) adalah BFF — browser tidak pernah menyentuh
// backend, semua login & permintaan OTP ditembakkan dari satu proses Next.js. Backend
// karenanya melihat SATU IP untuk SELURUH pelanggan, dan portal tidak mengirim
// X-Forwarded-For (trust proxy di sini juga hanya "loopback", lihat lib/http-app.js).
// Dengan key bawaan (req.ip), 5 percobaan gagal — dari pelanggan mana pun, tercampur —
// mengunci login SEMUA pelanggan selama 15 menit. Untuk ISP dengan ratusan pelanggan,
// 5 salah ketik dalam 15 menit itu kejadian harian, bukan serangan.
//
// Key per-identitas juga LEBIH kuat terhadap credential stuffing terdistribusi: penyerang
// yang memutar IP tidak lagi mendapat jatah baru untuk akun yang sama.
function resolveAuthLimiterKey(req) {
    const username = typeof req.body?.username === "string"
        ? req.body.username.trim().toLowerCase()
        : "";
    if (username) {
        return `auth_user_${username}`;
    }

    // Dinormalkan supaya 08xx / 62xx / +62xx tidak jadi tiga jatah terpisah untuk satu akun
    // — lubang yang sama dengan lockout OTP di lib/otp.js yang memakai string mentah.
    const phone = typeof req.body?.phoneNumber === "string"
        ? normalizePhone(req.body.phoneNumber)
        : "";
    if (phone) {
        return `auth_phone_${phone}`;
    }

    // Body tanpa identitas (request cacat; validator akan menolaknya juga). Jatuh ke IP —
    // lewat ipKeyGenerator agar subnet IPv6 ditangani benar (wajib sejak express-rate-limit v7).
    return `auth_ip_${ipKeyGenerator(req.ip || "0.0.0.0")}`;
}

function createAuthLimiter() {
    return rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 5,
        message: {
            status: 429,
            message: "Terlalu banyak percobaan login, silakan coba lagi dalam 15 menit."
        },
        standardHeaders: true,
        legacyHeaders: false,
        skipSuccessfulRequests: true,
        keyGenerator: resolveAuthLimiterKey
    });
}

// Origin script/iframe Cloudflare Turnstile (CAPTCHA form registrasi publik).
const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

// Bangun direktif CSP. `allowTurnstile` menambahkan origin Cloudflare Turnstile ke
// script-src/frame-src/connect-src — dipakai HANYA oleh app publik (lib/public-site-app),
// tidak pernah oleh portal admin, agar CSP admin tetap ketat (frameSrc 'none').
function buildCspDirectives({ allowTurnstile = false } = {}) {
    const scriptSrc = ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://unpkg.com"];
    const connectSrc = ["'self'", "https://unpkg.com"];
    let frameSrc = ["'none'"];
    if (allowTurnstile) {
        scriptSrc.push(TURNSTILE_ORIGIN);
        connectSrc.push(TURNSTILE_ORIGIN);
        frameSrc = [TURNSTILE_ORIGIN];
    }
    return {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net", "https://unpkg.com", "https://cdnjs.cloudflare.com"],
        scriptSrc,
        scriptSrcAttr: ["'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:", "blob:"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        connectSrc,
        frameSrc,
        objectSrc: ["'none'"],
        upgradeInsecureRequests: null
    };
}

// Opsi helmet lengkap; app utama memakai default (tanpa Turnstile), app publik pakai
// { allowTurnstile: true }. HSTS off (Cloudflare Tunnel terminasi TLS di edge).
function buildHelmetOptions({ allowTurnstile = false } = {}) {
    return {
        contentSecurityPolicy: {
            directives: buildCspDirectives({ allowTurnstile })
        },
        hsts: false,
        crossOriginEmbedderPolicy: false,
        crossOriginResourcePolicy: { policy: "cross-origin" }
    };
}

function registerHttpSecurity(app, { express, projectRoot, isAllowedPortalOrigin } = {}) {
    const globalLimiter = createGlobalLimiter();
    const authLimiter = createAuthLimiter();

    app.use(helmet(buildHelmetOptions()));

    const corsOptions = {
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
        credentials: true
    };
    app.use(cors((req, callback) => {
        const origin = req.headers.origin;
        // Izinkan bila: tanpa Origin, same-origin (panel ke server sendiri),
        // atau origin terdaftar di PORTAL_ALLOWED_ORIGINS (portal eksternal).
        const allowed =
            isSameOriginRequest(origin, req) ||
            !isAllowedPortalOrigin ||
            isAllowedPortalOrigin(origin);

        if (allowed) {
            callback(null, { ...corsOptions, origin: true });
            return;
        }
        callback(new Error("Origin tidak diizinkan oleh kebijakan CORS."), {
            ...corsOptions,
            origin: false
        });
    }));

    app.use("/static", express.static(`${projectRoot}/static`));
    app.use("/vendor", express.static(`${projectRoot}/static/vendor`));
    app.use("/css", express.static(`${projectRoot}/static/css`));
    app.use("/js", express.static(`${projectRoot}/static/js`));
    app.use("/img", express.static(`${projectRoot}/static/img`));

    // Logo perusahaan = branding publik (dipakai halaman landing & invoice). Sengaja tetap
    // di sini, sebelum auth, karena memang harus terbuka.
    app.use("/uploads/logos", express.static(`${projectRoot}/uploads/logos`));

    // `/uploads` dan `/temp` SENGAJA TIDAK di-mount di sini — lihat `registerProtectedStatic`.
    // Urutan pendaftaran = urutan eksekusi: apa pun yang dipasang di fungsi ini berjalan
    // SEBELUM middleware auth (index.js memanggil registerHttpSecurity lalu registerHttpAuth),
    // jadi memasangnya di sini berarti TANPA autentikasi sama sekali.

    return {
        globalLimiter,
        authLimiter
    };
}

/**
 * Static yang WAJIB dipasang SESUDAH middleware auth.
 *
 * `uploads/` berisi foto KTP pelanggan, bukti transfer, dan foto tiket — data pribadi.
 * Sebelumnya di-mount di `registerHttpSecurity`, yang berjalan SEBELUM `registerHttpAuth`,
 * sehingga seluruh isinya bisa diambil siapa pun yang menebak URL-nya tanpa login. Terukur di
 * produksi: `uploads/psb/` berisi berkas `ktp_photo.jpg` sungguhan.
 *
 * Konsumen sahnya hanya halaman STAF (static/js/tiket.js, teknisi-tiket.js). Kedua app portal
 * (lib/portal-app.js, lib/public-site-app.js) memang sudah sengaja tak memuat `/uploads`.
 */
function registerProtectedStatic(app, { express, projectRoot }) {
    function hanyaStaf(req, res, next) {
        const peran = req.user && req.user.role;
        if (peran && ["admin", "owner", "superadmin", "teknisi"].includes(peran)) {
            return next();
        }
        // 404, bukan 403: membedakan "ada tapi tak boleh" dari "tidak ada" memberi tahu
        // penyerang berkas mana yang benar-benar ada.
        return res.status(404).send("Not Found");
    }

    app.use("/uploads", hanyaStaf, express.static(`${projectRoot}/uploads`));
    app.use("/temp", hanyaStaf, express.static(`${projectRoot}/temp`));
}

module.exports = {
    registerHttpSecurity,
    registerProtectedStatic,
    createGlobalLimiter,
    createAuthLimiter,
    // Diekspor untuk diuji langsung: perilaku "satu jatah per identitas, bukan per IP"
    // adalah yang menjaga login seluruh pelanggan tetap hidup di balik BFF.
    resolveAuthLimiterKey,
    buildCspDirectives,
    buildHelmetOptions
};
