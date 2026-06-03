/**
 * Header Doc
 * Purpose: Guardrail test untuk memastikan approval payment request memakai ledger helper dan tidak lagi mengandalkan writer `users.paid` langsung.
 * Caller: Jest test runner.
 * Deps: `../payment-approval.service`.
 * MainFuncs: Memverifikasi bulk approval sukses memakai `applyPaymentStatusChange` dan persistence request JSON tetap sinkron.
 * SideEffects: Tidak ada.
 */
"use strict";

const { createPaymentApprovalService } = require("../payment-approval.service");

describe("payment-approval.service", () => {
    test("bulk approval memproses ledger write dan persist request update", async () => {
        global.users = [{
            id: 1,
            name: "Mbah Uti",
            send_invoice: 1,
            subscription: "12Mbps"
        }];
        global.accounts = [];
        global.db = {
            all: jest.fn((_sql, callback) => callback(null, [{ name: "send_invoice" }])),
            run: jest.fn((_sql, _params, callback) => callback(null))
        };

        const requests = [{
            id: "REQ-1",
            userId: 1,
            status: "pending",
            newStatus: true,
            period_month: 4,
            period_year: 2026,
            amount_paid: 150000,
            amount_due: 150000,
            payment_method: "CASH"
        }];
        const saveJSON = jest.fn();
        const applyPaymentStatusChange = jest.fn().mockResolvedValue({ action: "paid" });
        const handlePaidStatusChange = jest.fn().mockResolvedValue();
        const sendTechnicianNotification = jest.fn().mockResolvedValue();
        const service = createPaymentApprovalService({
            loadJSON: jest.fn().mockReturnValue(requests),
            saveJSON,
            applyPaymentStatusChange,
            handlePaidStatusChange,
            sendTechnicianNotification,
            getPeriodParts: jest.fn().mockReturnValue({ periodMonth: 4, periodYear: 2026 }),
            getEffectivePrice: jest.fn().mockReturnValue(150000),
            normalizeUserPaymentMethod: jest.fn().mockReturnValue("CASH")
        });

        const result = await service.bulkApproveRequests({
            requestIds: ["REQ-1"],
            actor: { username: "raf", role: "admin" }
        });

        expect(applyPaymentStatusChange).toHaveBeenCalledWith(expect.objectContaining({
            user: expect.objectContaining({ id: 1 }),
            paid: true,
            paymentMethod: "CASH",
            sourceRequestId: "REQ-1",
            onFinalPaid: expect.any(Function)
        }));
        expect(handlePaidStatusChange).not.toHaveBeenCalled();
        expect(sendTechnicianNotification).toHaveBeenCalledWith(
            true,
            expect.objectContaining({ id: "REQ-1", status: "approved" }),
            expect.objectContaining({ id: 1 })
        );
        expect(saveJSON).toHaveBeenCalledWith(
            "database/requests.json",
            [expect.objectContaining({ id: "REQ-1", status: "approved", updated_by: "raf" })]
        );
        expect(result.results.approved).toEqual([
            expect.objectContaining({ id: "REQ-1", userName: "Mbah Uti", newStatus: true })
        ]);
    });
});
