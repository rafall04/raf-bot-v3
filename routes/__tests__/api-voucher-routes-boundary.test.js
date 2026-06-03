/**
 * Header Doc
 * Purpose: Guardrail boundary untuk memastikan route voucher API tetap menjadi adapter tipis setelah normalisasi domain voucher.
 * Caller: Jest test runner.
 * Deps: `fs`, `path`, dan source `routes/api-voucher-routes.js`.
 * MainFuncs: Memverifikasi delegation route voucher ke service owner dan melarang kembalinya orchestration generate/send langsung di route.
 * SideEffects: Membaca source file lokal tanpa memodifikasi runtime.
 */
"use strict";

const fs = require("fs");
const path = require("path");

function readVoucherRouteSource() {
    return fs.readFileSync(path.join(__dirname, "..", "api-voucher-routes.js"), "utf8");
}

describe("api-voucher route boundary", () => {
    test("route delegates active voucher flows to service owner", () => {
        const source = readVoucherRouteSource();

        expect(source).toContain("const { createApiVoucherRepository } = require('../repositories/api-voucher.repository')");
        expect(source).toContain("const { createApiVoucherService } = require('../services/api-voucher.service')");
        expect(source).toContain("apiVoucherService.listVoucherProfiles()");
        expect(source).toContain("apiVoucherService.generateAndSendVouchers");
        expect(source).toContain("apiVoucherService.listSentHistory");
        expect(source).toContain("apiVoucherService.getSentStats()");
        expect(source).toContain("apiVoucherService.sendMemberCredentials");
    });

    test("route no longer owns direct php generation or direct history mutation", () => {
        const source = readVoucherRouteSource();

        expect(source).not.toContain("axios.get(");
        expect(source).not.toContain("appendVoucherSentHistory(");
        expect(source).not.toContain("sendMessageToMany(");
        expect(source).not.toContain("findVoucherHistoryByReference(");
    });
});
