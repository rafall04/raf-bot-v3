/**
 * Header Doc
 * Purpose: Guardrail contract test untuk repository payment/topup.
 * Caller: Jest test runner.
 * Deps: `../payment.repository`.
 * MainFuncs: Memverifikasi repository payment mengekspose create request, pending lookup, dan update bukti topup.
 * SideEffects: Tidak ada; helper payment dan saldo manager dimock in-memory.
 */
"use strict";

const { createPaymentRepository } = require("../payment.repository");

describe("payment repository contract", () => {
    test("payment repository exposes request creation and topup proof helpers", () => {
        const addPayment = jest.fn();
        const saveTopupRequests = jest.fn();
        const requests = [
            { id: "REQ-1", userId: "6281@s.whatsapp.net", status: "pending", paymentMethod: "transfer" },
            { id: "REQ-2", userId: "6281@s.whatsapp.net", status: "verified", paymentMethod: "transfer" },
            { id: "REQ-3", userId: "6281@s.whatsapp.net", status: "waiting_verification", paymentMethod: "transfer" }
        ];
        const repository = createPaymentRepository({
            addPayment,
            saldoManager: {
                getUserTopupRequests: jest.fn().mockReturnValue(requests),
                saveTopupRequests
            }
        });

        expect(repository.createPaymentRequest).toEqual(expect.any(Function));
        expect(repository.getUserTopupRequests).toEqual(expect.any(Function));
        expect(repository.getPendingTransferTopupRequests).toEqual(expect.any(Function));
        expect(repository.saveTopupProofUpdate).toEqual(expect.any(Function));

        repository.createPaymentRequest("REF-1", "TRX-1", "6281@s.whatsapp.net", "topup", 10000, "QRIS", "Topup");
        expect(addPayment).toHaveBeenCalledWith("REF-1", "TRX-1", "6281@s.whatsapp.net", "topup", 10000, "QRIS", "Topup", {});

        expect(repository.getPendingTransferTopupRequests("6281@s.whatsapp.net")).toEqual([
            requests[0],
            requests[2]
        ]);

        const updated = repository.saveTopupProofUpdate(requests[0], {
            fileName: "proof.jpg",
            uploadedAt: "2026-04-23T00:00:00.000Z"
        });

        expect(updated).toEqual(expect.objectContaining({
            paymentProof: "proof.jpg",
            proofUploadedAt: "2026-04-23T00:00:00.000Z",
            status: "waiting_verification"
        }));
        expect(saveTopupRequests).toHaveBeenCalled();
    });
});
