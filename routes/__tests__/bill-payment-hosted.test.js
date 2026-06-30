"use strict";

/**
 * Header Doc
 * Purpose: Guardrail mode HOSTED bayar tagihan (config.billPaymentHosted) di routes/bill-payment.js —
 *   pastikan: default tetap portal (serve HTML), mode hosted buat sesi payHosted + 302 redirect ke
 *   iPaymu, record tag 'tagihan' trxId null (TransactionId via callback), landing /bayar-status publik.
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

    test("default (flag off) tetap serve portal HTML sendiri", () => {
        expect(source).toMatch(/if\s*\(\s*!billPaymentHostedEnabled\(\)\s*\)[\s\S]{0,120}bill-payment\.html/);
    });

    test("mode hosted: buat sesi payHosted lalu 302 redirect ke URL iPaymu", () => {
        const idxHosted = source.indexOf("ipaymu.payHosted");
        const idxRedirect = source.indexOf("res.redirect(302, session.url)");
        expect(idxHosted).toBeGreaterThan(-1);
        expect(idxRedirect).toBeGreaterThan(idxHosted);
    });

    test("record hosted: addPayment tag 'tagihan' dengan trxId NULL (TransactionId via callback)", () => {
        // addPayment(reff, null, ... "tagihan" ...) — trxId null = penanda hosted.
        expect(source).toMatch(/addPayment\(\s*reff\s*,\s*null\s*,[\s\S]{0,80}"tagihan"/);
        expect(source).toMatch(/hosted:\s*true/);
    });

    test("notifyUrl callback & cross-check tetap dari token (resolveBillContext dipakai di branch hosted)", () => {
        const idxHostedFn = source.indexOf("billPaymentHostedEnabled()");
        const idxCtx = source.indexOf("resolveBillContext(req.params.token)", idxHostedFn);
        expect(idxCtx).toBeGreaterThan(-1);
    });

    test("/bayar-status (landing returnUrl) terdaftar publik di PUBLIC_PATHS", () => {
        expect(source).toContain('router.get("/bayar-status"');
        expect(authSource).toContain('"/bayar-status"');
    });
});
