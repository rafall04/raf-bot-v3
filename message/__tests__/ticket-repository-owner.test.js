/**
 * Header Doc
 * Purpose: Guardrail unit test untuk memastikan compatibility ticket handler mendelegasikan persistence ke ticket repository owner.
 * Caller: Jest test runner.
 * Deps: `../handlers/ticket-creation-handler` dan mock `../../repositories/ticket.repository`.
 * MainFuncs: Memverifikasi `saveReportsToFile` dan `generateTicketId` memanggil repository owner aktif.
 * SideEffects: Tidak ada.
 */
"use strict";

const mockSaveReportDraft = jest.fn((reports) => reports);
const mockGenerateTicketId = jest.fn(() => "TKT-OWNER-1");

jest.mock("../../repositories/ticket.repository", () => ({
    createTicketRepository: jest.fn(() => ({
        saveReportDraft: mockSaveReportDraft,
        generateTicketId: mockGenerateTicketId
    }))
}));

jest.mock("../../lib/report-orchestration-service", () => ({
    createCustomerReportTicket: jest.fn()
}));

const { saveReportsToFile, generateTicketId } = require("../handlers/ticket-creation-handler");

describe("ticket repository owner", () => {
    beforeEach(() => {
        mockSaveReportDraft.mockClear();
        mockGenerateTicketId.mockClear();
    });

    test("legacy ticket compatibility handler delegates report draft persistence to repository owner", () => {
        const reports = [{ ticketId: "TKT-1" }];

        expect(saveReportsToFile(reports)).toBe(reports);
        expect(mockSaveReportDraft).toHaveBeenCalledWith(reports);
    });

    test("legacy ticket compatibility handler delegates ticket id generation to repository owner", () => {
        expect(generateTicketId()).toBe("TKT-OWNER-1");
        expect(mockGenerateTicketId).toHaveBeenCalledTimes(1);
    });
});
