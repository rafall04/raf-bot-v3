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
        skipSuccessfulRequests: true
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
    app.use("/temp", express.static(`${projectRoot}/temp`));
    app.use("/uploads", express.static(`${projectRoot}/uploads`));

    return {
        globalLimiter,
        authLimiter
    };
}

module.exports = {
    registerHttpSecurity,
    createGlobalLimiter,
    createAuthLimiter,
    buildCspDirectives,
    buildHelmetOptions
};
