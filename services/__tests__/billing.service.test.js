/**
 * Header Doc
 * Purpose: Guardrail test untuk service billing hasil decoupling approval payment dan bulk payment status update.
 * Caller: Jest test runner.
 * Deps: `../billing.service`.
 * MainFuncs: Verifikasi hasil mixed bulk approve dan sinkronisasi cache saat bulk payment update.
 * SideEffects: Tidak ada.
 */
"use strict";

jest.mock("../../repositories/billing.repository", () => ({
    createBillingRepository: jest.fn(() => ({}))
}));
jest.mock("../../lib/approval-logic", () => ({
    handlePaidStatusChange: jest.fn(),
    sendTechnicianNotification: jest.fn()
}));
jest.mock("../../lib/technician-collection-settlement", () => ({
    getPeriodParts: jest.fn()
}));
jest.mock("../../lib/payment-finance-service", () => ({
    applyPaymentStatusChange: jest.fn(),
    getEffectivePrice: jest.fn(),
    normalizeUserPaymentMethod: jest.fn()
}));
jest.mock("../../lib/activity-logger", () => ({
    logActivity: jest.fn()
}));

const { createBillingService } = require("../billing.service");

describe("billing.service", () => {
    test("memproses hasil mixed pada bulk approve payment requests", async () => {
        const requests = [
            { id: "REQ-1", userId: 1, status: "pending", newStatus: true },
            { id: "REQ-2", userId: 2, status: "approved", newStatus: true },
            { id: "REQ-3", userId: 3, status: "pending", newStatus: false }
        ];
        const repository = {
            ensureDatabaseReady: jest.fn(),
            loadApprovalRequests: jest.fn().mockReturnValue(requests),
            persistApprovalRequests: jest.fn(),
            getCachedUserById: jest.fn((userId) => {
                if (String(userId) === "1") {
                    return { id: 1, name: "A", paid: false };
                }
                return null;
            })
        };
        const applyPaymentStatusChange = jest.fn().mockResolvedValue({ action: "paid" });
        const service = createBillingService({
            repository,
            applyPaymentStatusChange,
            getEffectivePrice: jest.fn().mockReturnValue(100000),
            handlePaidStatusChange: jest.fn(),
            sendTechnicianNotification: jest.fn(),
            logActivity: jest.fn(),
            normalizeUserPaymentMethod: jest.fn().mockReturnValue("TRANSFER_BANK"),
            getPeriodParts: jest.fn().mockReturnValue({ periodMonth: 4, periodYear: 2026 })
        });

        const result = await service.bulkApprovePaymentRequests(
            { requestIds: ["REQ-1", "REQ-2", "REQ-404"] },
            { id: 9, username: "admin", role: "admin" }
        );

        expect(result.results.approved).toEqual(["REQ-1"]);
        expect(result.results.failed).toHaveLength(1);
        expect(result.results.notFound).toEqual(["REQ-404"]);
        expect(repository.persistApprovalRequests).toHaveBeenCalledWith(requests);
        expect(applyPaymentStatusChange).toHaveBeenCalled();
    });

    test("bulk update payment status memakai payment ledger helper", async () => {
        const repository = {
            ensureDatabaseReady: jest.fn(),
            getUserFromDatabase: jest.fn().mockResolvedValue({
                id: 7,
                name: "User B",
                paid: 0,
                phone_number: "08123",
                subscription: "Basic",
                send_invoice: 1,
                pppoe_username: "ppp-b",
                address: "Jalan",
                bulk: "[]"
            }),
            getCachedUserById: jest.fn().mockReturnValue({ id: 7, name: "User B" })
        };
        const applyPaymentStatusChange = jest.fn().mockResolvedValue({ action: "paid" });
        const service = createBillingService({
            repository,
            applyPaymentStatusChange,
            getEffectivePrice: jest.fn().mockReturnValue(100000),
            handlePaidStatusChange: jest.fn(),
            normalizeUserPaymentMethod: jest.fn().mockReturnValue("CASH"),
            logActivity: jest.fn(),
            getPeriodParts: jest.fn().mockReturnValue({ periodMonth: 4, periodYear: 2026 })
        });

        const result = await service.bulkUpdatePaymentStatus(
            { userIds: [7], paid: true, triggerNotification: true, paymentMethod: "CASH" },
            { id: 1, username: "admin", role: "admin" }
        );

        expect(result.updated).toBe(1);
        expect(applyPaymentStatusChange).toHaveBeenCalledWith(expect.objectContaining({
            user: expect.objectContaining({ id: 7 }),
            paid: true,
            periodMonth: 4,
            periodYear: 2026,
            paymentMethod: "CASH"
        }));
    });
});
