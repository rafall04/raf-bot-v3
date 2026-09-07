/**
 * Header Doc
 * Purpose: Guardrail contract test untuk repository saldo dan ticket.
 * Caller: Jest test runner.
 * Deps: `../saldo.repository` dan `../ticket.repository`.
 * MainFuncs: Memverifikasi repository compatibility owner untuk saldo user dan draft laporan.
 * SideEffects: Tidak ada.
 */
"use strict";

jest.mock("../../lib/saldo-manager", () => ({
    getUserSaldo: jest.fn(() => 25000),
    createUserSaldo: jest.fn()
}));

jest.mock("fs", () => ({
    writeFileSync: jest.fn(),
    renameSync: jest.fn(),
    existsSync: jest.fn(() => false),
    unlinkSync: jest.fn()
}));
jest.mock("../../lib/ticket-id", () => ({
    generateTicketId: jest.fn(() => "TKT-001")
}));

const { createSaldoRepository } = require("../saldo.repository");
const { createTicketRepository } = require("../ticket.repository");
const fs = require("fs");

describe("saldo and ticket repository contracts", () => {
    test("saldo repository owns canonical saldo lookups", () => {
        const repository = createSaldoRepository();

        expect(repository.getSaldoUser).toEqual(expect.any(Function));
        expect(repository.createSaldoUser).toEqual(expect.any(Function));
        expect(repository.getSaldoUser("6281@s.whatsapp.net")).toBe(25000);
    });

    test("ticket repository owns report persistence entrypoints", () => {
        const repository = createTicketRepository();
        const reports = [{ ticketId: "TKT-001" }];

        expect(repository.saveReportDraft).toEqual(expect.any(Function));
        expect(repository.generateTicketId).toEqual(expect.any(Function));
        expect(repository.saveReportDraft(reports)).toBe(reports);
        expect(repository.generateTicketId()).toBe("TKT-001");
        // #b345: tulis ATOMIK — writeFileSync ke berkas SEMENTARA (.tmp-<pid>) lalu renameSync
        // ke reports.json final; pembaca tak pernah melihat berkas setengah jadi.
        expect(fs.writeFileSync).toHaveBeenCalledWith(
            expect.stringMatching(/database.*reports\.json\.tmp-/),
            JSON.stringify(reports, null, 2),
            "utf8"
        );
        expect(fs.renameSync).toHaveBeenCalledWith(
            expect.stringMatching(/reports\.json\.tmp-/),
            expect.stringMatching(/database.*reports\.json$/)
        );
    });
});
