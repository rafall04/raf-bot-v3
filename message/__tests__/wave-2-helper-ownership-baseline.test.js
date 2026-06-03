/**
 * Header Doc
 * Purpose: Guardrail baseline untuk Wave 2 agar helper `lib/*` business-heavy tidak menyebar di luar owner sementara yang sudah terpetakan.
 * Caller: Jest test runner.
 * Deps: `fs`, `path`, dan source file handler/service domain WiFi, payment/topup, serta ops.
 * MainFuncs: Memverifikasi import helper persistence/integration langsung hanya muncul pada owner baseline yang disetujui.
 * SideEffects: Membaca source file lokal tanpa memodifikasi runtime.
 */
"use strict";

const fs = require("fs");
const path = require("path");

function readSource(relativePath) {
    return fs.readFileSync(path.join(__dirname, "..", "..", relativePath), "utf8");
}

describe("wave 2 helper ownership baseline", () => {
    test("wifi, payment/topup, and ops direct lib ownership stays inside current baseline", () => {
        const wifiManagementSource = readSource("message/handlers/wifi-management-handler.js");
        const paymentProcessorSource = readSource("message/handlers/payment-processor-handler.js");
        const topupHandlerSource = readSource("message/handlers/topup-handler.js");
        const adminOpsSource = readSource("services/admin-ops.service.js");
        const networkOpsSource = readSource("services/network-ops.service.js");
        const paymentApprovalSource = readSource("services/payment-approval.service.js");

        expect(wifiManagementSource).toContain("require(\"../../services/wifi-management.service\")");
        expect(wifiManagementSource).not.toContain("require('../../lib/wifi')");
        expect(wifiManagementSource).not.toContain("require('../../lib/database')");
        expect(wifiManagementSource).not.toContain("require('../../lib/saldo-manager')");

        expect(paymentProcessorSource).not.toContain("require('../../lib/database')");
        expect(paymentProcessorSource).not.toContain("require('../../lib/saldo-manager')");

        expect(topupHandlerSource).toContain("require(\"../../lib/saldo-manager\")");
        expect(topupHandlerSource).not.toContain("require('../../lib/database')");

        expect(adminOpsSource).toContain("require(\"../repositories/runtime-cache.repository\")");
        expect(adminOpsSource).not.toContain("global.users");
        expect(adminOpsSource).not.toContain("global.accounts");

        expect(networkOpsSource).toContain("require(\"../repositories/runtime-cache.repository\")");
        expect(networkOpsSource).not.toContain("global.users");

        expect(paymentApprovalSource).toContain("require(\"../repositories/runtime-cache.repository\")");
        expect(paymentApprovalSource).not.toContain("global.users");
        expect(paymentApprovalSource).not.toContain("global.accounts");
    });
});
