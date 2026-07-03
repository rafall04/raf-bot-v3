/**
 * Header Doc
 * Purpose: Factory Express untuk SITE PUBLIK ANONIM yang berjalan di listener HTTP kedua (port
 *   terpisah) dalam PROSES yang SAMA. Hanya memuat surface anonim (landing, registrasi, beli
 *   voucher) — SENGAJA tanpa auth-gate, tanpa view-engine `.php`, tanpa Socket.IO, tanpa cookie —
 *   sehingga tak ada permukaan login/admin yang bisa di-brute-force di port ini.
 * Caller: `index.js` (composition root) — dibuat sekali, lalu `http.createServer(app).listen(PUBLIC_PORT)`.
 * Deps: `./http-app` (createHttpApp/trust-proxy), `./http-security` (buildHelmetOptions/createGlobalLimiter),
 *   `./error-handler`, `body-parser`, router `routes/public-site` + `routes/public-anonymous`.
 * MainFuncs: `createPublicSiteApp`.
 * SideEffects: Tidak ada saat pembuatan (mount middleware/route saja). TIDAK memanggil
 *   initializeBackgroundServices()/startWhatsApp()/Socket.IO — invariant single-instance terjaga.
 */
"use strict";

const helmet = require("helmet");
const bodyParser = require("body-parser");
const { createHttpApp } = require("./http-app");
const { buildHelmetOptions, createGlobalLimiter } = require("./http-security");
const { errorHandler } = require("./error-handler");

function createPublicSiteApp(runtime, express, { projectRoot } = {}) {
    // Reuse factory app utama → `trust proxy` loopback benar di belakang Cloudflare Tunnel.
    const app = createHttpApp(runtime, express);

    // Helmet dengan CSP yang mengizinkan Cloudflare Turnstile (script/iframe form registrasi).
    // CSP portal admin TIDAK terpengaruh (builder terpisah, allowTurnstile:true khusus di sini).
    app.use(helmet(buildHelmetOptions({ allowTurnstile: true })));

    // CORS SENGAJA tidak dipasang: seluruh request site publik bersifat same-origin (form & fetch
    // dari halaman itu sendiri). Tanpa header CORS, request lintas-origin ditolak browser by default
    // — paling ketat. Tidak ada cookie/kredensial yang dibagi lintas port.

    // Rate limit umum (300/15mnt/IP) anti-flood. Endpoint registrasi punya limiter lebih ketat sendiri.
    app.use(createGlobalLimiter());

    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({ extended: true }));

    // Static subset: HANYA aset publik. Sengaja TANPA /uploads penuh & /temp (perkecil surface).
    // Hanya /uploads/logos yang dibuka (logo perusahaan di landing = branding publik).
    app.use("/static", express.static(`${projectRoot}/static`));
    app.use("/css", express.static(`${projectRoot}/static/css`));
    app.use("/js", express.static(`${projectRoot}/static/js`));
    app.use("/img", express.static(`${projectRoot}/static/img`));
    app.use("/vendor", express.static(`${projectRoot}/static/vendor`));
    app.use("/uploads/logos", express.static(`${projectRoot}/uploads/logos`));

    // Router publik. TIDAK ada registerHttpAuth / handler .php / Socket.IO di app ini.
    app.use("/", require("../routes/public-site"));       // landing GET / + registrasi self-service
    app.use("/", require("../routes/public-anonymous"));  // /voucher + /app/* (beli voucher)

    app.use(errorHandler);
    return app;
}

module.exports = { createPublicSiteApp };
