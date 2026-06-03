/**
 * Header Doc
 * Purpose: Guardrail test untuk memastikan service payment-approval memakai repository dan runtime DB via deps.
 * Caller: Jest test runner.
 * Deps: `../payment-approval.service`.
 * MainFuncs: Memverifikasi bulk approval membaca user/account dari repository injection.
 * SideEffects: Tidak ada.
 */
"use strict";

const { createPaymentApprovalService } = require("../payment-approval.service");

describe("payment-approval.service runtime boundary", () => {
    test("bulkApproveRequests uses injected repositories for users and accounts", async () => {
        const userRepository = {
            getById: jest.fn(() => ({
                id: 1,
                name: "Mbah Uti",
                send_invoice: 1,
                subscription: "12Mbps"
            }))
        };
        const accountRepository = {
            getById: jest.fn(() => ({ id: 7, username: "teknisi-1" }))
        };
        const db = {
            all: jest.fn((_sql, callback) => callback(null, [{ name: "send_invoice" }])),
            run: jest.fn((_sql, _params, callback) => callback(null))
        };
        const service = createPaymentApprovalService({
            getDb: jest.fn(() => db),
            userRepository,
            accountRepository,
            loadJSON: jest.fn(() => [{
                id: "REQ-1",
                userId: 1,
                status: "pending",
                newStatus: true,
                requested_by_teknisi_id: 7,
                period_month: 4,
                period_year: 2026,
                amount_paid: 150000,
                amount_due: 150000,
                payment_method: "CASH"
            }]),
            saveJSON: jest.fn(),
            applyPaymentStatusChange: jest.fn().mockResolvedValue({ action: "paid" }),
            handlePaidStatusChange: jest.fn(),
            sendTechnicianNotification: jest.fn(),
            getPeriodParts: jest.fn(() => ({ periodMonth: 4, periodYear: 2026 })),
            getEffectivePrice: jest.fn(() => 150000),
            normalizeUserPaymentMethod: jest.fn(() => "CASH")
        });

        await service.bulkApproveRequests({
            requestIds: ["REQ-1"],
            actor: { username: "raf", role: "admin" }
        });

        expect(userRepository.getById).toHaveBeenCalledWith(1);
        expect(accountRepository.getById).toHaveBeenCalledWith(7);
    });
});
