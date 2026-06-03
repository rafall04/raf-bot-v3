/**
 * Header Doc
 * Purpose: Guardrail baseline untuk boundary handler payment/topup setelah orchestration aktif dipindahkan ke payment flow service.
 * Caller: Jest test runner.
 * Deps: `fs`, `path`, dan source handler payment/topup aktif.
 * MainFuncs: Memverifikasi handler payment/topup tetap tipis, mendelegasikan orchestration ke service owner, dan tidak mengembalikan helper/payment primitive lama ke layer bot.
 * SideEffects: Membaca source file lokal tanpa memodifikasi runtime.
 */
"use strict";

const fs = require("fs");
const path = require("path");

function readSource(relativePath) {
    return fs.readFileSync(path.join(__dirname, "..", "handlers", relativePath), "utf8");
}

describe("payment topup boundary baseline", () => {
    test("payment processor and topup handler delegate active orchestration to payment flow service", () => {
        const paymentProcessorSource = readSource("payment-processor-handler.js");
        const topupHandlerSource = readSource("topup-handler.js");

        expect(paymentProcessorSource).toContain("createPaymentFlowService");
        expect(paymentProcessorSource).toContain("paymentFlowService.handleTopupSaldoPayment(context)");
        expect(paymentProcessorSource).toContain("paymentFlowService.handleBeliVoucher");
        expect(paymentProcessorSource).toContain("paymentFlowService.processVoucherPurchase");
        expect(paymentProcessorSource).toContain("paymentFlowService.handleVoucherChoiceState");
        expect(paymentProcessorSource).not.toContain("qr-image");
        expect(paymentProcessorSource).not.toContain("await addPayment(");
        expect(paymentProcessorSource).not.toContain("await pay(");
        expect(paymentProcessorSource).not.toContain("global.voucher.forEach");
        expect(paymentProcessorSource).not.toContain("new Intl.NumberFormat");
        expect(paymentProcessorSource).not.toContain("require('../../lib/saldo-manager')");

        expect(topupHandlerSource).toContain("const saldoManager = require(\"../../lib/saldo-manager\")");
        expect(topupHandlerSource).toContain("const { createPaymentRepository } = require(\"../../repositories/payment.repository\")");
        expect(topupHandlerSource).toContain("createPaymentFlowService");
        expect(topupHandlerSource).toContain("paymentFlowService.handleTopupPaymentProof");
        expect(topupHandlerSource).toContain("paymentFlowService.notifyAdminsWithProof");
        expect(topupHandlerSource).toContain("paymentFlowService.getAdminRecipients");
        expect(topupHandlerSource).not.toContain("paymentRepository.getPendingTransferTopupRequests");
        expect(topupHandlerSource).not.toContain("paymentRepository.saveTopupProofUpdate");
        expect(topupHandlerSource).not.toContain("downloadMedia(msg");
    });
});
