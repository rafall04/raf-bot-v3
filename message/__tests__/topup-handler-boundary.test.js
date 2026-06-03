/**
 * Header Doc
 * Purpose: Guardrail boundary untuk memastikan handler topup mendelegasikan proof upload ke payment flow service.
 * Caller: Jest test runner.
 * Deps: `fs`, `path`, dan source `message/handlers/topup-handler.js`.
 * MainFuncs: Memverifikasi handler topup tetap menahan verifikasi admin lokal, namun proof upload aktif didelegasikan ke service owner.
 * SideEffects: Membaca source file lokal tanpa memodifikasi runtime.
 */
"use strict";

const fs = require("fs");
const path = require("path");

describe("topup handler boundary", () => {
    test("topup handler delegates proof upload helpers to payment flow service", () => {
        const source = fs.readFileSync(
            path.join(__dirname, "..", "handlers", "topup-handler.js"),
            "utf8"
        );

        expect(source).toContain("createPaymentFlowService");
        expect(source).toContain("paymentFlowService.handleTopupPaymentProof");
        expect(source).toContain("paymentFlowService.notifyAdminsWithProof");
        expect(source).toContain("paymentFlowService.getAdminRecipients");
        expect(source).toContain("async function handleTopupVerification(requestId, approved, adminName, notes = \"\")");
        expect(source).not.toContain("paymentRepository.getPendingTransferTopupRequests");
        expect(source).not.toContain("paymentRepository.saveTopupProofUpdate");
        expect(source).not.toContain("downloadMedia(msg");
        expect(source).not.toContain("normalizeJidForSaldo(sender");
        expect(source).not.toContain("fs.writeFileSync");
    });
});
