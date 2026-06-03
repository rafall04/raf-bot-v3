/**
 * Header Doc
 * Purpose: Source guardrail untuk memastikan teknisi photo/completion state di-own oleh domain teknisi.
 * Caller: Jest test runner.
 * Deps: `fs`, `path`, source `../handlers/state-domains/teknisi.state.js`.
 * MainFuncs: Memverifikasi upload completion photo dan transisi teknisi terpusat di owner teknisi.
 * SideEffects: Tidak ada.
 */
"use strict";

const fs = require("fs");
const path = require("path");

describe("teknisi state owner", () => {
    test("teknisi completion states live in teknisi state domain", () => {
        const teknisiSource = fs.readFileSync(path.join(__dirname, "..", "handlers", "state-domains", "teknisi.state.js"), "utf8");

        expect(teknisiSource).toContain("photoStateSteps");
        expect(teknisiSource).toContain("handleLegacyTeknisiStateTransitions");
        expect(teknisiSource).toContain("handleTeknisiPhotoUpload");
        expect(teknisiSource).toContain('AWAITING_LOCATION_FOR_JOURNEY');
        expect(teknisiSource).toContain("handleTeknisiShareLocation");
    });
});
