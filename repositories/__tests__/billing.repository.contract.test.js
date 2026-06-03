/**
 * Header Doc
 * Purpose: Guardrail contract test untuk repository billing.
 * Caller: Jest test runner.
 * Deps: `../billing.repository`.
 * MainFuncs: Memverifikasi repository billing mengekspose entrypoint persistence yang dipakai service.
 * SideEffects: Tidak ada.
 */
"use strict";

const { createBillingRepository } = require("../billing.repository");

describe("billing repository contract", () => {
    test("billing repository exposes approval-request and user payment primitives", () => {
        const repository = createBillingRepository();

        expect(repository.loadApprovalRequests).toEqual(expect.any(Function));
        expect(repository.persistApprovalRequests).toEqual(expect.any(Function));
        expect(repository.getCachedUserById).toEqual(expect.any(Function));
        expect(repository.getUserFromDatabase).toEqual(expect.any(Function));
        expect(repository.updateUserPaidStatus).toEqual(expect.any(Function));
    });
});
