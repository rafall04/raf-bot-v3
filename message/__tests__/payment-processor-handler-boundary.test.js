/**
 * Header Doc
 * Purpose: Guardrail boundary untuk memastikan handler payment processor menjadi adapter tipis ke payment flow service.
 * Caller: Jest test runner.
 * Deps: `fs`, `path`, dan source `message/handlers/payment-processor-handler.js`.
 * MainFuncs: Memverifikasi handler payment mendelegasikan orchestration aktif ke `services/payment-flow.service.js`.
 * SideEffects: Membaca source file lokal tanpa memodifikasi runtime.
 */
"use strict";

const fs = require("fs");
const path = require("path");

describe("payment processor handler boundary", () => {
    test("payment processor delegates active orchestration to payment flow service", () => {
        const source = fs.readFileSync(
            path.join(__dirname, "..", "handlers", "payment-processor-handler.js"),
            "utf8"
        );

        expect(source).toContain("createPaymentFlowService");
        expect(source).toContain("paymentFlowService.handleTopupSaldoPayment(context)");
        expect(source).toContain("paymentFlowService.handleBeliVoucher");
        expect(source).toContain("paymentFlowService.processVoucherPurchase");
        expect(source).toContain("paymentFlowService.handleVoucherChoiceState");
        expect(source).not.toContain("qr-image");
        expect(source).not.toContain("await addPayment(");
        expect(source).not.toContain("await pay(");
        expect(source).not.toContain("global.voucher.forEach");
        expect(source).not.toContain("new Intl.NumberFormat");
        expect(source).not.toContain("ASK_VOUCHER_CHOICE");
        expect(source).not.toContain("voucherFlow");
    });
});
