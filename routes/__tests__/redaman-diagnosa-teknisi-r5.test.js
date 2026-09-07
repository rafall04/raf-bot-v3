/**
 * Header Doc
 * Purpose: Guard Fase 2 ronde 5 (#b351) — endpoint agregator diagnosa redaman 1-klik utk panel tiket
 *   teknisi: (a) route GET /api/teknisi/diagnosa-redaman/:userId terdaftar & STAFF-GATED
 *   (ensureAuthenticatedStaff), memanggil service fondasi #b350 (getRedamanDiagnosisService); (b) panel
 *   tiket punya tombol "Cek Redaman" 1-klik (showRedamanModal) yang fetch endpoint itu dgn cookie.
 *   Read-only, reuse service — nol filter manual.
 * Caller: Jest.
 * Deps: fs, path (baca sumber, tidak eksekusi).
 * SideEffects: -
 */
"use strict";
const fs = require("fs");
const path = require("path");
const read = (rel) => fs.readFileSync(path.join(__dirname, "..", "..", rel), "utf8");

describe("Fase 2 — endpoint agregator diagnosa redaman teknisi (#b351)", () => {
    const src = read("routes/admin-wifi-ops-routes.js");
    test("route GET /api/teknisi/diagnosa-redaman/:userId terdaftar + ensureAuthenticatedStaff", () => {
        const re = /router\.get\(\s*["']\/api\/teknisi\/diagnosa-redaman\/:userId["']\s*,\s*ensureAuthenticatedStaff/;
        expect(src).toMatch(re);
    });
    test("memanggil service fondasi getRedamanDiagnosisService().diagnoseCustomer (bukan logika baru)", () => {
        expect(src).toMatch(/getRedamanDiagnosisService\(\)\.diagnoseCustomer\(/);
    });
    test("lookup user by :userId (repo runtime / global.users), 404 bila tak ada", () => {
        const i = src.indexOf("/api/teknisi/diagnosa-redaman/:userId");
        const blok = src.slice(i, i + 1400);
        expect(blok).toMatch(/getRepository\(["']users["']\)|global\.users/);
        expect(blok).toMatch(/404/);
    });
});

describe("Fase 2 — tombol Cek Redaman di panel tiket (#b351)", () => {
    const js = read("static/js/teknisi-tiket.js");
    test("renderActionButtons punya tombol showRedamanModal(row.user_id)", () => {
        expect(js).toMatch(/showRedamanModal\('\$\{esc\(String\(row\.user_id\)\)\}'\)/);
    });
    test("showRedamanModal fetch endpoint diagnosa dgn credentials cookie", () => {
        const i = js.indexOf("function loadRedaman");
        const blok = js.slice(i, i + 900);
        expect(blok).toMatch(/\/api\/teknisi\/diagnosa-redaman\//);
        expect(blok).toMatch(/credentials:\s*['"]include['"]/);
    });
    test("modal dibuat dinamis (tak bergantung edit .php)", () => {
        expect(js).toMatch(/function ensureRedamanModal/);
        expect(js).toMatch(/id="redamanModal"/);
    });
});
