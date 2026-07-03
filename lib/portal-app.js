/**
 * Header Doc
 * Purpose: Factory Express untuk PORTAL PUBLIK TERPADU (proses ke-3, port terpisah, satu-satunya
 *   yang diekspos ke internet). Menyajikan halaman terpadu (landing/registrasi/voucher) dengan
 *   pemilih area + mem-proxy ke listener publik bot area. SENGAJA tanpa auth-gate/.php/Socket.IO —
 *   tak ada surface admin/login di portal. Portal STATELESS: tak punya koneksi WA/cron/`global.payment`.
 * Caller: `portal.js` (entrypoint proses portal). Bukan `index.js`.
 * Deps: helmet, body-parser, `./http-app` (createHttpApp/trust-proxy), `./http-security`
 *   (buildHelmetOptions/createGlobalLimiter), `./error-handler`, router `routes/portal`.
 * MainFuncs: `createPortalApp`.
 * SideEffects: Tidak ada saat pembuatan (mount middleware/route saja).
 */
"use strict";

const helmet = require("helmet");
const bodyParser = require("body-parser");
const { createHttpApp } = require("./http-app");
const { buildHelmetOptions, createGlobalLimiter } = require("./http-security");
const { errorHandler } = require("./error-handler");

function createPortalApp(runtime, express, { projectRoot } = {}) {
    // Reuse factory bot → `trust proxy` loopback benar di balik Cloudflare Tunnel/nginx.
    const app = createHttpApp(runtime, express);

    // Helmet dengan CSP mengizinkan Cloudflare Turnstile (form registrasi). Tak ada CSP admin di sini.
    app.use(helmet(buildHelmetOptions({ allowTurnstile: true })));

    // Rate limit umum anti-flood (300/15mnt/IP). Registrasi punya limiter lebih ketat di routernya.
    app.use(createGlobalLimiter());

    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({ extended: true }));

    // Static subset publik (aset opsional halaman). SENGAJA tanpa /uploads & /temp (surface minimal).
    app.use("/static", express.static(`${projectRoot}/static`));
    app.use("/css", express.static(`${projectRoot}/static/css`));
    app.use("/js", express.static(`${projectRoot}/static/js`));
    app.use("/img", express.static(`${projectRoot}/static/img`));
    app.use("/vendor", express.static(`${projectRoot}/static/vendor`));

    app.use("/", require("../routes/portal"));

    app.use(errorHandler);
    return app;
}

module.exports = { createPortalApp };
