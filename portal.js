/**
 * Header Doc
 * Purpose: Entrypoint proses PORTAL PUBLIK TERPADU (`rafnet-portal`) — proses PM2 KE-3 yang berdiri
 *   sendiri (BUKAN bot). Memuat `portal.config.json`, membangun app portal (`lib/portal-app`), dan
 *   membuka HTTP server. SENGAJA TIDAK memuat `index.js`/WhatsApp/cron/DB → stateless, tidak
 *   melanggar invariant single-instance (yang berlaku per-BOT).
 * Caller: Node.js runtime (`node portal.js`) / PM2 (`pm2 start portal.js --name rafnet-portal`).
 * Deps: fs, path, http, express, `lib/portal-app`.
 * MainFuncs: loadPortalConfig, bootstrap.
 * SideEffects: Membuka HTTP server portal; menyetel `global.config` (brand/turnstile/areas).
 */
"use strict";

process.env.TZ = "Asia/Jakarta";

const fs = require("fs");
const path = require("path");
const http = require("http");
const express = require("express");
const { createPortalApp } = require("./lib/portal-app");

// Muat portal.config.json (gitignored). Bila belum ada, auto-bootstrap dari contoh — pola sama
// dengan config.json bot. Lalu isi kredensial Turnstile & daftar area lalu jalankan ulang.
function loadPortalConfig() {
    const real = path.join(__dirname, "portal.config.json");
    const example = path.join(__dirname, "portal.config.example.json");
    if (!fs.existsSync(real)) {
        if (fs.existsSync(example)) {
            fs.copyFileSync(example, real);
            console.warn("[PORTAL] portal.config.json dibuat dari contoh — ISI areas/turnstile lalu jalankan ulang.");
        } else {
            console.error("[PORTAL_FATAL] portal.config.json & portal.config.example.json tidak ada.");
            process.exit(1);
        }
    }
    try {
        return JSON.parse(fs.readFileSync(real, "utf8"));
    } catch (e) {
        console.error("[PORTAL_FATAL] portal.config.json rusak (bukan JSON valid):", e.message);
        process.exit(1);
    }
}

const portalConfig = loadPortalConfig();

// Set global.config agar `lib/turnstile` (baca `global.config.turnstile`) & helper render membaca
// konfigurasi portal. Portal tak punya config bot — `company` = brand portal.
global.config = {
    company: (portalConfig.portal && portalConfig.portal.brand) || {},
    turnstile: portalConfig.turnstile || { enabled: false },
    portal: portalConfig.portal || {}
};

const PORT = process.env.PORT || (portalConfig.portal && portalConfig.portal.port) || 3300;
const HOST = process.env.HOST || (portalConfig.portal && portalConfig.portal.host) || "0.0.0.0";

// Runtime minimal untuk createHttpApp (trust proxy). Portal tak butuh runtime bot penuh.
const runtime = { config: global.config, getConfig() { return global.config; } };

const app = createPortalApp(runtime, express, { projectRoot: __dirname });
const server = http.createServer(app);

server.on("error", (err) => {
    console.error(`[PORTAL_FATAL] Gagal bind ${HOST}:${PORT}: ${err.message}`);
    process.exit(1);
});
server.listen(PORT, HOST, () => {
    console.log(`[PORTAL] rafnet-portal listening on ${HOST}:${PORT}`);
});

function shutdown(signal) {
    console.log(`[PORTAL] ${signal} diterima — menutup server…`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
