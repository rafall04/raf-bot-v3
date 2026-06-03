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

function registerHttpSecurity(app, { express, projectRoot, isAllowedPortalOrigin } = {}) {
    const globalLimiter = createGlobalLimiter();
    const authLimiter = createAuthLimiter();

    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net", "https://unpkg.com", "https://cdnjs.cloudflare.com"],
                scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://unpkg.com"],
                scriptSrcAttr: ["'unsafe-inline'"],
                imgSrc: ["'self'", "data:", "https:", "blob:"],
                fontSrc: ["'self'", "https://fonts.gstatic.com"],
                connectSrc: ["'self'", "https://unpkg.com"],
                frameSrc: ["'none'"],
                objectSrc: ["'none'"],
                upgradeInsecureRequests: null
            }
        },
        hsts: false,
        crossOriginEmbedderPolicy: false,
        crossOriginResourcePolicy: { policy: "cross-origin" }
    }));

    app.use(cors({
        origin: (origin, callback) => {
            if (!isAllowedPortalOrigin || isAllowedPortalOrigin(origin)) {
                callback(null, true);
                return;
            }
            callback(new Error("Origin tidak diizinkan oleh kebijakan CORS."));
        },
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
        credentials: true
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
    createAuthLimiter
};
