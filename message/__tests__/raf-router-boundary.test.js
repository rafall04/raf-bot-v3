/**
 * Header Doc
 * Purpose: Guardrail test untuk memastikan `message/raf.js` tidak kembali mengimpor helper domain legacy secara langsung.
 * Caller: Jest test runner.
 * Deps: `fs`, `path`, dan source `../raf.js`.
 * MainFuncs: Memverifikasi router bot memakai facade `domain-handlers` dan `domain-services`.
 * SideEffects: Tidak ada.
 */
"use strict";

const fs = require("fs");
const path = require("path");

describe("message/raf router boundary", () => {
    test("router bot memakai facade domain dan tidak mengimpor helper legacy langsung", () => {
        const source = fs.readFileSync(path.join(__dirname, "..", "raf.js"), "utf8");

        expect(source).toContain("require('./handlers/domain-handlers')");
        expect(source).toContain("require('./handlers/domain-services')");
        expect(source).not.toContain('const { addvoucher');
        expect(source).not.toContain('const { addStatik');
        expect(source).not.toContain('const { addATM');
        expect(source).not.toContain("createScopedStateProxy('legacy-temp')");
        expect(source).not.toContain("global.teknisiStates = createScopedStateProxy('teknisi')");
        expect(source).not.toContain("const { handleTopupSaldoPayment, handleBeliVoucher } = require('./handlers/payment-processor-handler');");
        expect(source).not.toContain("const { handleGantiNamaWifi, handleGantiSandiWifi } = require('./handlers/wifi-management-handler');");
        expect(source).toContain("handleActiveTicketLocationUpdate,");
        expect(source).toContain("const activeTicketLocationResult = await handleActiveTicketLocationUpdate({");
        expect(source).not.toContain("const activeTicket = reports.find(");
        expect(source).not.toContain("handleAgentPurchaseVoucher,");
        expect(source).toContain("...domainHandlers,");
        expect(source).toContain("...domainServices,");
    });
});
