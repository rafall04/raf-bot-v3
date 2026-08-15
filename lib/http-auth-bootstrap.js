/**
 * Header Doc
 * Purpose: Memusatkan middleware autentikasi HTTP untuk admin/customer agar bootstrap Express tidak menumpuk di `index.js`.
 * Caller: `index.js`.
 * Deps: `jsonwebtoken`, `./auth-cache`, dan runtime repositories/state.
 * MainFuncs: `registerHttpAuth`, `requirePhpPageAuth`.
 * SideEffects: Menetapkan `req.user`/`req.customer`, membersihkan cookie token invalid, dan redirect guest ke login bila perlu.
 * INVARIAN: `requirePhpPageAuth` HANYA memeriksa "sudah login sebagai staf", ia TIDAK menegakkan peran.
 *           Karena itu ia menutup total jalur `.php` ke halaman panel (`/sb-admin/*.php`) — kebijakan
 *           perannya tinggal di `routes/pages.js`, dan jalur `.php` tak pernah melewatinya.
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
    "/callback/tripay",
    "/callback/mayar",
    // Halaman bayar tagihan + API-nya: publik TANPA login, tapi di-guard token
    // bertanda-tangan (verifyBillPayToken) di dalam handler — token = otorisasinya.
    "/bayar",
    "/bayar-status",
    "/api/bayar",
    "/voucher",
    // Halaman legal/compliance publik (verifikasi merchant gateway pembayaran).
    "/faq",
    "/refund-policy",
    "/syarat-ketentuan",
    "/kontak",
    "/api/wifi-name",
    // HANYA varian `/public` yang publik. Dulu di sini tertulis "/api/packages" polos, dan karena
    // `isPublicPath()` mencocokkan path TANPA memandang HTTP method, entri itu membuka
    // POST/PUT/DELETE katalog paket untuk siapa pun tanpa login — harga paket adalah dasar
    // seluruh tagihan, ledger, rekap tunggakan, dan pemetaan profil isolir.
    // `/api/packages` (varian staf, membawa field `profile` MikroTik internal) kini digerbangi
    // di routes/packages.js. Varian publik ini sudah meredaksi field internalnya sendiri.
    "/api/packages/public",
    "/api/speed-boost/packages",
    // /api/monitoring/* DIHAPUS dari daftar publik: dulu mengekspos data jaringan/traffic/
    // user-stats tanpa autentikasi. Konsumen sah = dashboard staf yang fetch same-origin
    // (cookie httpOnly terkirim otomatis) sehingga tetap berfungsi setelah di-auth.
    //
    // Keuangan pribadi: "publik" HANYA terhadap middleware sesi ADMIN — pola yang sama dengan
    // "/bayar" di atas. Otorisasi sesungguhnya ada di dalam handler lewat cookie `pf_session`
    // (lib/personal-finance-auth), yang ditandatangani rahasia TERPISAH sehingga token admin
    // tak pernah bisa membukanya. Tanpa entri ini, middleware admin akan melempar pemilik ke
    // /login admin — padahal dompet ini justru sengaja tidak memakai akun admin.
    // Penjaganya dipasang per-route DAN di level prefix `/api/keuangan-pribadi` (kecuali
    // login/logout/sesi), jadi route baru tak bisa lolos gara-gara lupa dipasangi gate.
    "/keuangan-pribadi",
    "/api/keuangan-pribadi",
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
        // Lewati hanya aset statis PUBLIK. (Dulu URL `.php` ikut dilewati di sini — itu membuat
        // SEMUA halaman/endpoint .php dapat diakses tanpa autentikasi. Kini .php diproses
        // auth seperti request lain, lalu di-guard staf pada handler catch-all `.php`.)
        //
        // `/uploads` dan `/temp` SENGAJA DIKECUALIKAN dari pelewatan ini. Isinya berkas
        // gambar — foto KTP pelanggan, bukti transfer, foto tiket — jadi ekstensinya cocok
        // dengan pola di bawah. Kalau ikut dilewati, `req.user` TIDAK PERNAH terisi untuk
        // request itu, sehingga gerbang staf di `registerProtectedStatic` menolak SEMUA
        // ORANG termasuk teknisi: lubangnya tertutup tapi fitur foto tiket ikut mati.
        const jalurTerlindungi = /^\/+(uploads|temp)(\/|$)/i.test(req.path);
        if (!jalurTerlindungi && req.path.match(/\.(jpg|jpeg|png|gif|svg|css|js|ico|woff|woff2|ttf|eot)$/i)) {
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
 * Guard untuk handler catch-all `.php` (`app.all(/.+\.php$/, ...)` di index.js).
 *
 * KEBIJAKAN: TIDAK ADA berkas `.php` yang boleh dijangkau lewat HTTP. Semuanya 404.
 *
 * Kenapa boleh sekeras itu — hasil penelusuran seluruh pemanggil:
 *  1. Halaman panel (`views/sb-admin/*.php`) dirender lewat `res.render()`, yaitu VIEW ENGINE
 *     (`app.engine('php', ...)`), jalur yang sama sekali berbeda dari `phpExpress.router`.
 *     Menutup jalur HTTP tak menyentuh rendering halaman.
 *  2. Helper `.php` di `views/` ROOT dipanggil SERVER-SIDE, bukan lewat HTTP:
 *       - `lib/mikrotik.js runPhpMikrotik` → `path.resolve(...)` lalu spawn PHP CLI
 *       - `routes/monitoring-api.js executePHP` → `exec("php <path>")`
 *       - customer-steering / wan-switch / upstream-quality-poller → `child_process.spawn`
 *       - `views/sb-admin/index.php` → PHP `include` lewat `__DIR__`, bukan fetch
 *     Nol berkas `.php` yang di-fetch dari `static/js`.
 *
 * Sebelumnya guard ini hanya menolak awalan `sb-admin/`; selebihnya cukup "ada `req.user`",
 * TANPA cek peran. Akibat nyatanya: peran `agen` pun bisa membuka
 * `/delete_pppoe_secret.php?username=<korban>` (memutus pelanggan + menghapus kredensialnya
 * di router), `/update_pppoe_profile.php?profile=ISOLIR`, `/remove_scripts.php`,
 * `/mikrotik_route_switch.php`, dan `/user-hotspot.php` yang mendump SELURUH username+password
 * voucher hotspot. Tak ada rate limit (globalLimiter hanya di `/api/`) dan tak ada activity log.
 *
 * `req.internalService` tetap dilewatkan: itu penanda pemanggil internal tepercaya, bukan browser.
 */
function requirePhpPageAuth(req, res, next) {
    if (req.internalService) {
        return next();
    }

    // Ditulis ke log supaya kalau ternyata ADA konsumen yang terlewat dari penelusuran,
    // gejalanya langsung terlihat di log PM2 — bukan senyap seperti bug yang ditutupnya.
    console.warn(
        `[PHP_HTTP_DITOLAK] ${req.method} ${req.path} — akses .php lewat HTTP ditutup ` +
        `(peran: ${req.user?.role || (req.customer ? "pelanggan" : "anonim")})`
    );

    // 404, bukan 403: menjawab "ditolak" tetap memberi tahu bahwa berkasnya ada di situ.
    if (req.xhr || (req.headers.accept && req.headers.accept.indexOf("json") > -1)) {
        return res.status(404).json({ status: 404, message: "Not Found" });
    }
    try {
        return res.status(404).render("sb-admin/404.php");
    } catch (_e) {
        return res.status(404).send("Not Found");
    }
}

module.exports = {
    registerHttpAuth,
    requirePhpPageAuth,
    PUBLIC_PATHS
};
