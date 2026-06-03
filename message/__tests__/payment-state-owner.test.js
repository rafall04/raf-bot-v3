/**
 * Header Doc
 * Purpose: Source guardrail untuk memastikan state voucher-choice/payment di-own oleh domain payment.
 * Caller: Jest test runner.
 * Deps: `fs`, `path`, source `../handlers/state-domains/payment.state.js`.
 * MainFuncs: Memverifikasi `ASK_VOUCHER_CHOICE` dan fallback payment ringan tidak lagi tercecer di router utama.
 * SideEffects: Tidak ada.
 */
"use strict";

const fs = require("fs");
const path = require("path");

describe("payment state owner", () => {
    test("payment state domain owns voucher choice state", () => {
        const paymentSource = fs.readFileSync(path.join(__dirname, "..", "handlers", "state-domains", "payment.state.js"), "utf8");

        expect(paymentSource).toContain('stateStep === "ASK_VOUCHER_CHOICE"');
        expect(paymentSource).toContain("handleVoucherChoiceState");
    });
});
