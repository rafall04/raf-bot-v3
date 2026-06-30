"use strict";

/**
 * Header Doc
 * Purpose: Guardrail mode HOSTED bayar tagihan (config.billPaymentHosted) di routes/bill-payment.js —
 *   pastikan: default tetap portal (serve HTML), mode redirect lewat selector gateway (gw.chargeRedirect)
 *   + 302 redirect, record tag 'tagihan' bawa gateway + reference, landing /bayar-status publik.
 * Caller: Jest (`npx jest routes/__tests__/bill-payment-hosted.test.js`).
 * Deps: fs, path, source routes/bill-payment.js + lib/http-auth-bootstrap.js (scan, tidak dieksekusi).
 * MainFuncs: -
 * SideEffects: Tidak ada.
 */

const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "bill-payment.js"), "utf8");
const authSource = fs.readFileSync(path.join(__dirname, "..", "..", "lib", "http-auth-bootstrap.js"), "utf8");

describe("bill-payment mode hosted (config.billPaymentHosted)", () => {
    test("flag dibaca dari config.billPaymentHosted", () => {
        expect(source).toMatch(/billPaymentHostedEnabled[\s\S]{0,80}config[\s\S]{0,40}billPaymentHosted/);
    });

    test("default (gateway ipaymu + flag off) tetap serve portal HTML sendiri", () => {
        // useRedirectFlow false (ipaymu non-hosted) → portal HTML.
        expect(source).toMatch(/if\s*\(\s*!useRedirectFlow\(\)\s*\)[\s\S]{0,120}bill-payment\.html/);
        // useRedirectFlow tetap menghormati billPaymentHostedEnabled untuk iPaymu.
        expect(source).toMatch(/useRedirectFlow[\s\S]{0,160}billPaymentHostedEnabled\(\)/);
    });

    test("mode redirect: charge lewat selector gateway lalu 302 redirect", () => {
        const idxCharge = source.indexOf("gw.chargeRedirect(");
        const idxRedirect = source.indexOf("res.redirect(302, charge.url)");
        expect(idxCharge).toBeGreaterThan(-1);
        expect(idxRedirect).toBeGreaterThan(idxCharge);
    });

    test("record redirect: addPayment tag 'tagihan' bawa reference gateway + field gateway", () => {
        expect(source).toMatch(/addPayment\(\s*reff\s*,\s*charge\.reference\s*,[\s\S]{0,120}"tagihan"/);
        expect(source).toMatch(/gateway:\s*gw\.name/);
    });

    test("resolveBillContext dipakai di branch redirect (cross-check dari token)", () => {
        const idxRedirectFn = source.indexOf("useRedirectFlow()");
        const idxCtx = source.indexOf("resolveBillContext(req.params.token)", idxRedirectFn);
        expect(idxCtx).toBeGreaterThan(-1);
    });

    test("/bayar-status (landing returnUrl) terdaftar publik di PUBLIC_PATHS", () => {
        expect(source).toContain('router.get("/bayar-status"');
        expect(authSource).toContain('"/bayar-status"');
    });
});
