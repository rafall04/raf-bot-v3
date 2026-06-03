/**
 * Header Doc
 * Purpose: Guardrail test untuk memastikan service billing memakai repository sebagai boundary persistence aktif.
 * Caller: Jest test runner.
 * Deps: `../billing.service`.
 * MainFuncs: Memverifikasi jalur bulk approve membaca approval request dan user cache lewat repository injection.
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
    getPeriodParts: jest.fn(() => ({ periodMonth: 4, periodYear: 2026 }))
}));
jest.mock("../../lib/payment-finance-service", () => ({
    applyPaymentStatusChange: jest.fn().mockResolvedValue({ action: "paid" }),
    getEffectivePrice: jest.fn(() => 100000),
    normalizeUserPaymentMethod: jest.fn(() => "TRANSFER_BANK")
}));
jest.mock("../../lib/activity-logger", () => ({
    logActivity: jest.fn()
}));

const { createBillingService } = require("../billing.service");

describe("billing service repository boundary", () => {
    test("bulk approve payment requests reads persistence only via injected repository", async () => {
        const requests = [{ id: "REQ-1", userId: 11, status: "pending", newStatus: true }];
        const repository = {
            ensureDatabaseReady: jest.fn(),
            loadApprovalRequests: jest.fn().mockReturnValue(requests),
            persistApprovalRequests: jest.fn(),
            getCachedUserById: jest.fn().mockReturnValue({ id: 11, name: "User 11", paid: false })
        };
        const service = createBillingService({
            repository,
            handlePaidStatusChange: jest.fn(),
            sendTechnicianNotification: jest.fn(),
            logActivity: jest.fn()
        });

        await service.bulkApprovePaymentRequests(
            { requestIds: ["REQ-1"] },
            { id: 1, username: "admin", role: "admin" }
        );

        expect(repository.ensureDatabaseReady).toHaveBeenCalled();
        expect(repository.loadApprovalRequests).toHaveBeenCalled();
        expect(repository.getCachedUserById).toHaveBeenCalledWith(11);
        expect(repository.persistApprovalRequests).toHaveBeenCalledWith(requests);
    });
});
