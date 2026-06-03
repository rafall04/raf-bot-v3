/**
 * Header Doc
 * Purpose: Source guardrail untuk memastikan branching reporting state di-own oleh domain reporting.
 * Caller: Jest test runner.
 * Deps: `fs`, `path`, source `../handlers/state-domains/reporting.state.js`.
 * MainFuncs: Memverifikasi owner reporting berada di file domain state khusus.
 * SideEffects: Tidak ada.
 */
"use strict";

const fs = require("fs");
const path = require("path");

describe("reporting state owner", () => {
    test("reporting state branches live in reporting state domain", () => {
        const reportingSource = fs.readFileSync(path.join(__dirname, "..", "handlers", "state-domains", "reporting.state.js"), "utf8");

        expect(reportingSource).toContain("handleReportingConversationState");
        expect(reportingSource).toContain('REPORT_MENU');
        expect(reportingSource).toContain('GANGGUAN_MATI_DEVICE_OFFLINE');
        expect(reportingSource).toContain('downloadMedia');
        expect(reportingSource).toContain('addPhotoToQueue');
    });
});
