/**
 * Header Doc
 * Purpose: Guardrail boundary untuk memastikan route PSB API tetap menjadi adapter tipis setelah normalisasi domain PSB.
 * Caller: Jest test runner.
 * Deps: `fs`, `path`, dan source `routes/api-psb-routes.js`.
 * MainFuncs: Memverifikasi delegation route PSB ke service owner dan melarang kembalinya orchestration list/update-status/phase1/phase2/phase3/delete-all langsung di route.
 * SideEffects: Membaca source file lokal tanpa memodifikasi runtime.
 */
"use strict";

const fs = require("fs");
const path = require("path");

function readPsbRouteSource() {
    return fs.readFileSync(path.join(__dirname, "..", "api-psb-routes.js"), "utf8");
}

describe("api-psb route boundary", () => {
    test("route delegates extracted psb flows to service owner", () => {
        const source = readPsbRouteSource();

        expect(source).toContain("const { createApiPsbRepository } = require('../repositories/api-psb.repository')");
        expect(source).toContain("const { createApiPsbService } = require('../services/api-psb.service')");
        expect(source).toContain("apiPsbService.submitPhase1");
        expect(source).toContain("apiPsbService.listPsbRecordsByStatus");
        expect(source).toContain("apiPsbService.updatePsbStatus");
        expect(source).toContain("apiPsbService.submitPhase2");
        expect(source).toContain("apiPsbService.submitPhase3");
        expect(source).toContain("apiPsbService.deleteAllPsbRecords");
    });

    test("route no longer owns extracted psb read-model and phase1/phase2/phase3/delete-all orchestration", () => {
        const source = readPsbRouteSource();

        expect(source).not.toContain("let customers = getPsbRecords()");
        expect(source).not.toContain("const phase2Records = getPsbRecords()");
        expect(source).not.toContain("const validationResult = await validatePhoneNumbers");
        expect(source).not.toContain("await getNextAvailablePSBId()");
        expect(source).not.toContain("fs.renameSync");
        expect(source).not.toContain("await sendPSBInstallationCompleteNotification(psbRecord)");
        expect(source).not.toContain("await sendPSBTeknisiMeluncurNotification(psbRecord");
        expect(source).not.toContain("const transaction = {");
        expect(source).not.toContain("await movePSBToUsers(psbRecord)");
        expect(source).not.toContain("await comparePassword(password, currentUser.password)");
    });
});
