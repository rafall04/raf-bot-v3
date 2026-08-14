/**
 * Header Doc
 * Purpose: Guard regresi untuk kebijakan "tak ada `.php` yang dijangkau lewat HTTP" pada
 *          handler catch-all `app.all(/.+\.php$/)`, plus token internal-service dan
 *          pemeriksaan PUBLIC_PATHS.
 * Caller: Jest test runner.
 * Deps: `../http-auth-bootstrap`, `../internal-service-token`.
 * MainFuncs: `invoke`.
 * SideEffects: Tidak ada.
 */
"use strict";

const { requirePhpPageAuth, PUBLIC_PATHS } = require("../http-auth-bootstrap");
const { getInternalServiceToken, verifyInternalServiceToken } = require("../internal-service-token");

function invoke(req) {
    const res = {
        statusCode: null,
        redirectedTo: null,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(obj) { this.body = obj; return this; },
        send(payload) { this.body = payload; return this; },
        redirect(url) { this.redirectedTo = url; return this; },
    };
    let nextCalled = false;
    requirePhpPageAuth(req, res, () => { nextCalled = true; });
    return { nextCalled, res };
}

describe("requirePhpPageAuth (guard catch-all .php)", () => {
    // KEBIJAKAN: tak ada berkas .php yang boleh dijangkau lewat HTTP — semuanya 404.
    //
    // Sah karena SELURUH pemanggil .php bersifat server-side: halaman panel lewat
    // `res.render()` (view engine, bukan phpExpress.router), helper MikroTik lewat spawn PHP
    // CLI (`runPhpMikrotik`), endpoint monitoring lewat `exec("php <path>")`, dan
    // views/sb-admin/index.php lewat PHP `include __DIR__`. Nol fetch .php dari static/js
    // (dijaga tes di routes/__tests__/pages-role-guard.test.js).
    //
    // Suite ini dulu menegaskan "staf diizinkan -> next()", yang justru membiarkan peran
    // `agen` membuka /delete_pppoe_secret.php dan /user-hotspot.php (dump seluruh
    // username+password voucher hotspot).
    test.each([
        ["admin", { user: { id: 1, role: "admin" } }],
        ["teknisi", { user: { id: 9, role: "teknisi" } }],
        ["agen", { user: { id: 8, role: "agen" } }],
        ["customer", { customer: { id: 2 } }],
        ["tamu", {}],
    ])("peran %s ditolak 404 dan tidak pernah next()", (_nama, req) => {
        const { nextCalled, res } = invoke({ headers: {}, ...req });
        expect(nextCalled).toBe(false);
        expect(res.statusCode).toBe(404);
        expect(res.redirectedTo).toBeNull();
    });

    // SATU-SATUNYA jalur yang tersisa. Ini penanda pemanggil internal tepercaya
    // (lihat internal-service-token di bawah), bukan browser.
    test("panggilan internal service (req.internalService) diizinkan -> next()", () => {
        const { nextCalled, res } = invoke({ internalService: true, headers: {} });
        expect(nextCalled).toBe(true);
        expect(res.statusCode).toBeNull();
    });

    test("permintaan JSON/XHR dibalas 404 JSON, bukan 401 maupun redirect", () => {
        for (const req of [{ xhr: true, headers: {} }, { headers: { accept: "application/json" } }]) {
            const { nextCalled, res } = invoke(req);
            expect(nextCalled).toBe(false);
            expect(res.statusCode).toBe(404);
            expect(res.redirectedTo).toBeNull();
        }
    });
});

describe("internal service token (Node -> .php server-to-server)", () => {
    test("token valid terverifikasi dengan JWT secret yang sama", () => {
        const token = getInternalServiceToken("rahasia-jwt");
        expect(verifyInternalServiceToken(token, "rahasia-jwt")).toBe(true);
    });

    test("token ditolak bila JWT secret beda / bogus / kosong", () => {
        const token = getInternalServiceToken("rahasia-jwt");
        expect(verifyInternalServiceToken(token, "secret-lain")).toBe(false);
        expect(verifyInternalServiceToken("bogus", "rahasia-jwt")).toBe(false);
        expect(verifyInternalServiceToken("", "rahasia-jwt")).toBe(false);
        expect(verifyInternalServiceToken(undefined, "rahasia-jwt")).toBe(false);
    });
});

describe("PUBLIC_PATHS — endpoint sensitif tidak boleh publik", () => {
    test("tidak ada /api/monitoring/* di daftar publik (wajib auth)", () => {
        const monitoringPublic = PUBLIC_PATHS.filter((p) => p.startsWith("/api/monitoring"));
        expect(monitoringPublic).toEqual([]);
    });
});
