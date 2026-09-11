/**
 * Header Doc
 * Purpose: Guard ekstraksi sub-router KONTEN publik (FASE 3 pecah public.js). Pastikan 5 rute konten
 *   (wifi-name, announcements(+recent), news(+recent)) TETAP terdaftar di routes/public/content.js
 *   dan public.js me-mount-nya via facade (path tak boleh hilang saat dipindah).
 * Caller: Jest.
 * Deps: routes/public/content (introspeksi router.stack), fs (scan facade di public.js).
 * SideEffects: -
 */
"use strict";

const fs = require("fs");
const path = require("path");

test("sub-router konten mendaftarkan 5 path GET yang diharapkan", () => {
    const router = require("../public/content");
    const paths = router.stack.filter((l) => l.route).map((l) => l.route.path);
    ["/api/wifi-name", "/api/announcements", "/api/announcements/recent", "/api/news", "/api/news/recent"].forEach((p) => {
        expect(paths).toContain(p);
    });
});

test("public.js me-mount sub-router konten via facade (router.use) dan TIDAK lagi punya route konten inline", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "public.js"), "utf8");
    expect(src).toMatch(/router\.use\(require\('\.\/public\/content'\)\)/);
    expect(src).not.toMatch(/router\.get\('\/api\/wifi-name'/);
    expect(src).not.toMatch(/router\.get\('\/api\/news'/);
});
