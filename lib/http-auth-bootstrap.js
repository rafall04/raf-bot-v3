/**
 * Header Doc
 * Purpose: Memusatkan middleware autentikasi HTTP untuk admin/customer agar bootstrap Express tidak menumpuk di `index.js`.
 * Caller: `index.js`.
 * Deps: `jsonwebtoken`, `./auth-cache`, dan runtime repositories/state.
 * MainFuncs: `registerHttpAuth`.
 * SideEffects: Menetapkan `req.user`/`req.customer`, membersihkan cookie token invalid, dan redirect guest ke login bila perlu.
 */
"use strict";

const jwt = require("jsonwebtoken");
const { verifyInternalServiceToken, INTERNAL_SERVICE_HEADER } = require("./internal-service-token");

const PUBLIC_PATHS = [
    "/login",
    "/api/login",
    "/api/otp",
    "/api/otpverify",
    "/api/customer/login",
    "/api/auth/login",
    "/api/auth/otp/request",
    "/api/auth/otp/verify",
    "/app/",
    "/callback/payment",
    "/api/wifi-name",
    "/api/packages",
    "/api/speed-boost/packages",
    // /api/monitoring/* DIHAPUS dari daftar publik: dulu mengekspos data jaringan/traffic/
    // user-stats tanpa autentikasi. Konsumen sah = dashboard staf yang fetch same-origin
    // (cookie httpOnly terkirim otomatis) sehingga tetap berfungsi setelah di-auth.
    "/.well-known/"
];

function getStateCollection(runtime, key, fallback = []) {
    try {
        return runtime.getRepository(key).getAll();
    } catch (__error) {
        return Array.isArray(global[key]) ? global[key] : fallback;
    }
}

function isPublicPath(req) {
    const isPublicAnnouncementsOrNews = req.method === "GET" && (
        req.path === "/api/announcements" ||
        req.path === "/api/news" ||
        req.path.startsWith("/api/announcements/recent") ||
        req.path.startsWith("/api/news/recent")
    );

    return isPublicAnnouncementsOrNews || PUBLIC_PATHS.some((path) => {
        if (req.path === path) return true;
        if (path.endsWith("/")) {
            return req.path.startsWith(path);
        }
        return req.path.startsWith(`${path}/`);
    });
}

function ensureAuthLogCache() {
    if (!global.authLogCache) {
        global.authLogCache = new Set();
        setInterval(() => {
            global.authLogCache.clear();
        }, 3600000);
    }
}

function registerHttpAuth(app, { runtime, config, authCache, loadJSON }) {
    app.use(async (req, res, next) => {
        // Lewati hanya aset statis. (Dulu URL `.php` ikut dilewati di sini — itu membuat
        // SEMUA halaman/endpoint .php dapat diakses tanpa autentikasi. Kini .php diproses
        // auth seperti request lain, lalu di-guard staf pada handler catch-all `.php`.)
        if (req.path.match(/\.(jpg|jpeg|png|gif|svg|css|js|ico|woff|woff2|ttf|eot)$/i)) {
            return next();
        }

        // Panggilan internal server-to-server (Node -> endpoint .php aplikasi sendiri, mis.
        // lib/mikrotik.js) memakai token layanan turunan JWT secret. Perlakukan sebagai
        // service terautentikasi tanpa cookie browser — TIDAK membuka akses tak-terautentikasi
        // dari luar (penyerang tak punya JWT secret untuk membuat token yang valid).
        if (verifyInternalServiceToken(req.headers[INTERNAL_SERVICE_HEADER], config.jwt)) {
            req.internalService = true;
            return next();
        }

        if (isPublicPath(req)) {
            return next();
        }

        let token = null;
        if (req.cookies && req.cookies.token) {
            token = req.cookies.token;
        } else if (req.headers && req.headers.authorization) {
            token = req.headers.authorization.replace("Bearer ", "").trim();
        }

        ensureAuthLogCache();

        if (token) {
            try {
                const decoded = authCache.getJWTVerification(token, () => jwt.verify(token, config.jwt));

                if (!decoded) {
                    throw new Error("Token verification failed");
                }

                if (decoded.role) {
                    let accounts = getStateCollection(runtime, "accounts");
                    if (accounts.length === 0) {
                        try {
                            const reloadedAccounts = await authCache.reloadAccounts();
                            accounts = Array.isArray(reloadedAccounts) ? reloadedAccounts : [];
                            runtime.getRepository("accounts").setAll(accounts);
                        } catch (reloadErr) {
                            console.error("[AUTH_CRITICAL] Failed to reload accounts.json:", reloadErr);
                        }
                    }

                    let account = authCache.getAccountById(decoded.id, () => (
                        accounts.find((item) => String(item.id) === String(decoded.id)) || null
                    ));

                    if (!account) {
                        try {
                            const reloadedAccounts = loadJSON("accounts.json");
                            if (Array.isArray(reloadedAccounts)) {
                                runtime.getRepository("accounts").setAll(reloadedAccounts);
                                authCache.invalidateAccount(decoded.id);
                                account = authCache.getAccountById(decoded.id, () => (
                                    reloadedAccounts.find((item) => String(item.id) === String(decoded.id)) || null
                                ));
                            }
                        } catch (retryErr) {
                            console.error("[AUTH_RETRY_ERROR] Failed to reload accounts during retry:", retryErr);
                        }
                    }

                    if (account) {
                        req.user = {
                            id: account.id,
                            username: account.username,
                            name: account.name || account.username,
                            role: account.role,
                            photo: account.photo || null
                        };
                        const cacheKey = `admin_${account.id}`;
                        if (!global.authLogCache.has(cacheKey)) {
                            console.log(`[AUTH] Admin ${account.username} (${account.role}) authenticated. Path: ${req.path}`);
                            global.authLogCache.add(cacheKey);
                        }
                    }
                } else if (decoded.name) {
                    const users = getStateCollection(runtime, "users");
                    const customer = authCache.getUserById(decoded.id, () => (
                        users.find((item) => String(item.id) === String(decoded.id)) || null
                    ));

                    if (customer) {
                        req.customer = customer;
                        const cacheKey = `customer_${customer.id}`;
                        if (!global.authLogCache.has(cacheKey)) {
                            console.log(`[AUTH] Customer ${customer.name} authenticated`);
                            global.authLogCache.add(cacheKey);
                        }
                    } else {
                        console.log(`[AUTH_FAIL] Customer not found for ID ${decoded.id}. Path: ${req.path}`);
                    }
                } else {
                    res.cookie("token", "", { httpOnly: true, maxAge: 0, path: "/" });
                }
            } catch (err) {
                console.log(`[AUTH_ERROR] Invalid token. Error: ${err.message}. Path: ${req.path}`);
                if (err.name === "TokenExpiredError" || err.name === "JsonWebTokenError") {
                    res.cookie("token", "", { httpOnly: true, maxAge: 0, path: "/" });
                }
            }
        }

        if (req.user || req.customer) {
            return next();
        }

        if (req.path.startsWith("/api/")) {
            return res.status(401).json({ status: 401, message: "Unauthorized" });
        }

        if (req.path === "/login") {
            return next();
        }

        if (req.xhr || req.headers.accept?.indexOf("json") > -1) {
            return res.status(401).json({ status: 401, message: "Unauthorized" });
        }

        console.log(`[AUTH_REDIRECT_GUEST] No token and not a public path. Path: ${req.path}. Redirecting to /login.`);
        return res.redirect("/login");
    });
}

/**
 * Guard untuk handler catch-all `.php` (halaman/endpoint server-rendered admin/teknisi).
 * Hanya akun staf (`req.user`) yang boleh; tamu tak login sudah di-redirect oleh middleware
 * auth sebelum mencapai sini, dan guard ini menutup akses customer (`req.customer`).
 * Navigasi staf normal memakai clean-URL (mis. /teknisi-tiket) yang TIDAK melewati catch-all,
 * sehingga guard ini hanya mengenai akses `.php` langsung.
 */
function requirePhpPageAuth(req, res, next) {
    if (req.user || req.internalService) {
        return next();
    }
    if (req.xhr || (req.headers.accept && req.headers.accept.indexOf("json") > -1)) {
        return res.status(401).json({ status: 401, message: "Unauthorized" });
    }
    if (req.customer) {
        return res.status(403).send("Akses ditolak. Halaman ini khusus staf.");
    }
    return res.redirect("/login");
}

module.exports = {
    registerHttpAuth,
    requirePhpPageAuth,
    PUBLIC_PATHS
};
