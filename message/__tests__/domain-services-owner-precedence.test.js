/**
 * Header Doc
 * Purpose: Guardrail test untuk memastikan domain-services memprioritaskan repository owner untuk saldo, ticket, dan voucher.
 * Caller: Jest test runner.
 * Deps: `../handlers/domain-services` dan mock repository owner.
 * MainFuncs: Memverifikasi helper repo-first menembak repository runtime, bukan helper persistence langsung.
 * SideEffects: Tidak ada.
 */
"use strict";

const voucherRepository = {
    getVoucherCatalog: jest.fn(() => [{ prof: "VC-1" }]),
    findVoucherProfile: jest.fn(() => ({ prof: "VC-1" }))
};
const saldoRepository = {
    getSaldoUser: jest.fn(() => 25000),
    createSaldoUser: jest.fn(() => "created")
};
const ticketRepository = {
    saveReportDraft: jest.fn((reports) => reports),
    generateTicketId: jest.fn(() => "TKT-1")
};

const {
    getVoucherCatalogFromRepository,
    findVoucherProfileFromRepository,
    getSaldoUserFromRepository,
    createSaldoUserFromRepository,
    saveReportDraftFromRepository,
    generateTicketIdFromRepository
} = require("../handlers/domain-services");

describe("domain services owner precedence", () => {
    beforeEach(() => {
        voucherRepository.getVoucherCatalog.mockClear();
        voucherRepository.findVoucherProfile.mockClear();
        saldoRepository.getSaldoUser.mockClear();
        saldoRepository.createSaldoUser.mockClear();
        ticketRepository.saveReportDraft.mockClear();
        ticketRepository.generateTicketId.mockClear();
    });

    test("repo-first helpers prefer runtime repository owners for saldo ticket and voucher", () => {
        const runtime = {
            repositories: {
                saldo: saldoRepository,
                ticket: ticketRepository,
                voucherRepository
            }
        };
        const reports = [{ ticketId: "TKT-1" }];

        expect(getVoucherCatalogFromRepository(runtime)).toEqual([{ prof: "VC-1" }]);
        expect(findVoucherProfileFromRepository(runtime, "VC-1")).toEqual({ prof: "VC-1" });
        expect(getSaldoUserFromRepository(runtime, "6281@s.whatsapp.net")).toBe(25000);
        expect(createSaldoUserFromRepository(runtime, "6281@s.whatsapp.net", "Raf")).toBe("created");
        expect(saveReportDraftFromRepository(runtime, reports)).toBe(reports);
        expect(generateTicketIdFromRepository(runtime)).toBe("TKT-1");

        expect(voucherRepository.getVoucherCatalog).toHaveBeenCalledTimes(1);
        expect(voucherRepository.findVoucherProfile).toHaveBeenCalledWith("VC-1");
        expect(saldoRepository.getSaldoUser).toHaveBeenCalledWith("6281@s.whatsapp.net");
        expect(saldoRepository.createSaldoUser).toHaveBeenCalledWith("6281@s.whatsapp.net", "Raf");
        expect(ticketRepository.saveReportDraft).toHaveBeenCalledWith(reports);
        expect(ticketRepository.generateTicketId).toHaveBeenCalledTimes(1);
    });
});
