"use strict";

/**
 * Header Doc
 * Purpose: Guardrail callback Tripay (`POST /callback/tripay`) di routes/bill-payment.js — pastikan
 *   keamanannya sekuat callback iPaymu: VERIFIKASI server-to-server (tripay.checkTransaction) +
 *   cross-check merchant_ref & amount SEBELUM settle/mark-paid; status non-PAID & record bukan-Tripay
 *   di-ACK tanpa kredit; idempotent. Plus selector gateway dipakai di GET /bayar/:token.
 * Caller: Jest (`npx jest routes/__tests__/bill-payment-tripay.test.js`).
 * Deps: fs, path; scan source routes/bill-payment.js + lib/http-auth-bootstrap.js (tidak dieksekusi).
 * MainFuncs: -
 * SideEffects: Tidak ada.
 */

const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "bill-payment.js"), "utf8");
const authSource = fs.readFileSync(path.join(__dirname, "..", "..", "lib", "http-auth-bootstrap.js"), "utf8");

const cbIdx = source.indexOf('router.post("/callback/tripay"');
const cbBlock = cbIdx > -1 ? source.slice(cbIdx, cbIdx + 3200) : "";

describe("bill-payment multi-gateway + callback Tripay", () => {
    test("GET /bayar/:token pilih gateway aktif (selector) untuk alur redirect", () => {
        expect(source).toMatch(/useRedirectFlow[\s\S]{0,120}getActiveName\(\)\s*===\s*"tripay"/);
        expect(source).toContain("gateways.getActive()");
        expect(source).toContain("gw.chargeRedirect(");
    });

    test("callback Tripay terdaftar + ACK {success:true}", () => {
        expect(cbIdx).toBeGreaterThan(-1);
        expect(cbBlock).toMatch(/res\.json\(\{\s*success:\s*true\s*\}\)/);
    });

    test("status non-PAID → ACK tanpa kredit (tak settle)", () => {
        expect(cbBlock).toMatch(/status\s*!==\s*"PAID"[\s\S]{0,60}res\.json\(\{\s*success:\s*true/);
    });

    test("hanya proses record gateway 'tripay' (anti cross-gateway)", () => {
        expect(cbBlock).toMatch(/v\.gateway\s*===\s*"tripay"/);
    });

    test("idempotent: sudah paid → ACK, tak settle ulang", () => {
        expect(cbBlock).toMatch(/checkStatusPayment\(merchantRef\)\s*===\s*true/);
    });

    test("VERIFIKASI S2S (checkTransaction) SEBELUM settle + reject bila belum paid", () => {
        const idxVerify = cbBlock.indexOf("tripay.checkTransaction");
        const idxSettle = cbBlock.indexOf("settleTagihanPayment");
        const idxRejectVerify = cbBlock.indexOf("TRIPAY_CALLBACK_REJECT");
        expect(idxVerify).toBeGreaterThan(-1);
        expect(idxSettle).toBeGreaterThan(idxVerify); // verify dulu, settle kemudian
        expect(idxRejectVerify).toBeGreaterThan(idxVerify);
    });

    test("cross-check merchant_ref & amount (anti substitusi/short-pay)", () => {
        expect(cbBlock).toContain("merchant_ref Tripay tidak cocok");
        expect(cbBlock).toContain("amount Tripay kurang dari tagihan");
    });

    test("settle SEBELUM updateStatusPayment(paid) — fail-closed", () => {
        const idxSettle = cbBlock.indexOf("settleTagihanPayment");
        const idxMarkPaid = cbBlock.indexOf("updateStatusPayment(merchantRef, true)");
        expect(idxSettle).toBeGreaterThan(-1);
        expect(idxMarkPaid).toBeGreaterThan(idxSettle);
    });

    test("/callback/tripay publik di PUBLIC_PATHS", () => {
        expect(authSource).toContain('"/callback/tripay"');
    });
});
