/**
 * Header Doc
 * Purpose: Guardrail test untuk bridge repository runtime di layer message domain services.
 * Caller: Jest test runner.
 * Deps: `../handlers/domain-services`.
 * MainFuncs: Memverifikasi helper domain dapat menerima repository saldo/ticket/voucher dari runtime.
 * SideEffects: Tidak ada.
 */
"use strict";

jest.mock("../../repositories/saldo.repository", () => ({
    createSaldoRepository: jest.fn(() => ({ getSaldoUser: jest.fn() }))
}));
jest.mock("../../repositories/ticket.repository", () => ({
    createTicketRepository: jest.fn(() => ({ saveReportDraft: jest.fn() }))
}));
jest.mock("../../repositories/voucher.repository", () => ({
    createVoucherRepository: jest.fn(() => ({ getVoucherCatalog: jest.fn() }))
}));

const { resolveDomainRepositories } = require("../handlers/domain-services");

describe("runtime repository bridge", () => {
    test("priority message domains can receive repository-backed helpers from runtime", () => {
        const runtime = {
            repositories: {
                saldo: { getSaldoUser: jest.fn() },
                ticket: { saveReportDraft: jest.fn() },
                voucherRepository: { getVoucherCatalog: jest.fn() }
            }
        };

        const repositories = resolveDomainRepositories(runtime);

        expect(repositories.saldo).toBe(runtime.repositories.saldo);
        expect(repositories.ticket).toBe(runtime.repositories.ticket);
        expect(repositories.voucher).toBe(runtime.repositories.voucherRepository);
    });
});
