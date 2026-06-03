/**
 * Header Doc
 * Purpose: Guardrail boundary untuk memastikan handler WiFi mendelegasikan orchestration aktif ke service owner.
 * Caller: Jest test runner.
 * Deps: `fs`, `path`, dan source `message/handlers/wifi-management-handler.js`.
 * MainFuncs: Memverifikasi handler menginisialisasi `wifi-management.service` dan mengekspor delegasi public API.
 * SideEffects: Membaca source file lokal tanpa memodifikasi runtime.
 */
"use strict";

const fs = require("fs");
const path = require("path");

describe("wifi management handler boundary", () => {
    test("wifi handler delegates active orchestration to wifi-management service", () => {
        const source = fs.readFileSync(
            path.join(__dirname, "..", "handlers", "wifi-management-handler.js"),
            "utf8"
        );

        expect(source).toContain("createWifiManagementService");
        expect(source).toContain("wifiManagementService.handleGantiNamaWifi");
        expect(source).toContain("wifiManagementService.handleGantiSandiWifi");
        expect(source).toContain("wifiManagementService.handleSingleSSIDNameChange");
        expect(source).toContain("wifiManagementService.handleSingleSSIDPasswordChange");
        expect(source).not.toContain("require('../../lib/wifi')");
        expect(source).not.toContain("require('../../lib/jid-utils')");
        expect(source).not.toContain("require('../../lib/wifi-logger')");
    });
});
