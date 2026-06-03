/**
 * Header Doc
 * Purpose: Source guardrail untuk memastikan owner lokasi teknisi aktif berada di helper lokasi, bukan router utama.
 * Caller: Jest test runner.
 * Deps: `fs`, `path`, dan source `../handlers/simple-location-handler.js`.
 * MainFuncs: Memverifikasi helper live-location aktif diekspor dan memegang lookup active ticket.
 * SideEffects: Tidak ada.
 */
"use strict";

const fs = require("fs");
const path = require("path");

describe("simple location owner", () => {
    test("active ticket live-location lookup lives in simple-location handler", () => {
        const source = fs.readFileSync(path.join(__dirname, "..", "handlers", "simple-location-handler.js"), "utf8");

        expect(source).toContain("handleActiveTicketLocationUpdate");
        expect(source).toContain("const activeTicket = reports.find(");
        expect(source).toContain("return updateTeknisiLocation(sender, activeTicket.ticketId, location, activeTicket);");
    });
});
