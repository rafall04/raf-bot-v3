/**
 * Header Doc
 * Purpose: Guardrail test untuk facade domain reporting.
 * Caller: Jest test runner.
 * Deps: `../handlers/domains/reporting.domain`.
 * MainFuncs: Memverifikasi facade reporting menjadi owner intent laporan gangguan.
 * SideEffects: Tidak ada.
 */
"use strict";

const mockStartReportFlow = jest.fn();
const mockHandleMenuSelection = jest.fn();

jest.mock("../handlers/smart-report-text-menu", () => ({
    startReportFlow: (...args) => mockStartReportFlow(...args),
    handleMenuSelection: (...args) => mockHandleMenuSelection(...args)
}));

const { handleReportingIntent } = require("../handlers/domains/reporting.domain");

describe("reporting domain", () => {
    beforeEach(() => {
        mockStartReportFlow.mockReset();
        mockHandleMenuSelection.mockReset();
    });

    test("reporting domain owns LAPOR_GANGGUAN", async () => {
        mockStartReportFlow.mockResolvedValue({ message: "ok" });
        const reply = jest.fn();

        const result = await handleReportingIntent({
            intent: "LAPOR_GANGGUAN",
            sender: "6281@s.whatsapp.net",
            stateSender: "6281@s.whatsapp.net",
            pushname: "Tester",
            reply,
            msg: {},
            raf: {}
        });

        expect(result).toEqual(expect.objectContaining({ handled: true }));
        expect(reply).toHaveBeenCalledWith("ok");
    });

    test("LAPOR_GANGGUAN_MATI auto-selects troubleshoot and does NOT resend the main menu", async () => {
        // startReportFlow mengembalikan menu utama; handleMenuSelection mengembalikan
        // menu troubleshoot. Untuk MATI, pelanggan hanya boleh menerima menu
        // troubleshoot (sesuai state REPORT_MATI_TROUBLESHOOT), bukan menu utama lagi.
        mockStartReportFlow.mockResolvedValue({ message: "MENU_UTAMA" });
        mockHandleMenuSelection.mockResolvedValue({ message: "MENU_TROUBLESHOOT" });
        const reply = jest.fn();

        const result = await handleReportingIntent({
            intent: "LAPOR_GANGGUAN_MATI",
            sender: "6281@s.whatsapp.net",
            stateSender: "6281@s.whatsapp.net",
            pushname: "Tester",
            reply,
            msg: {},
            raf: {}
        });

        expect(result).toEqual(expect.objectContaining({ handled: true }));
        expect(mockHandleMenuSelection).toHaveBeenCalledWith(
            expect.objectContaining({ choice: "1" })
        );
        expect(reply).toHaveBeenCalledWith("MENU_TROUBLESHOOT");
        expect(reply).not.toHaveBeenCalledWith("MENU_UTAMA");
    });
});
