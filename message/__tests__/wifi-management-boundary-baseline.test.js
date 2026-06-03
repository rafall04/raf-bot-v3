/**
 * Header Doc
 * Purpose: Guardrail boundary untuk memastikan `wifi-management-handler` tetap tipis setelah orchestrator dan log owner dipindahkan.
 * Caller: Jest test runner.
 * Deps: `fs`, `path`, dan source `message/handlers/wifi-management-handler.js`.
 * MainFuncs: Memverifikasi handler WiFi hanya mendelegasikan ke service owner dan tidak lagi menyimpan logic device/helper legacy.
 * SideEffects: Membaca source file lokal tanpa memodifikasi runtime.
 */
"use strict";

const fs = require("fs");
const path = require("path");

describe("wifi management boundary baseline", () => {
    test("wifi handler stays as thin service adapter", () => {
        const source = fs.readFileSync(
            path.join(__dirname, "..", "handlers", "wifi-management-handler.js"),
            "utf8"
        );

        expect(source).toContain("createWifiManagementService");
        expect(source).toContain("const { setUserState, deleteUserState, format }");
        expect(source).toContain("withWifiStateHelpers");
        expect(source).toContain("wifiManagementService.handleGantiNamaWifi");
        expect(source).toContain("wifiManagementService.handleGantiSandiWifi");

        expect(source).not.toContain("require('../../lib/wifi')");
        expect(source).not.toContain("require('../../lib/jid-utils')");
        expect(source).not.toContain("require('../../lib/wifi-logger')");
        expect(source).not.toContain("setSSIDName(");
        expect(source).not.toContain("setPassword(");
        expect(source).not.toContain("updateWifiSettings(");
    });
});
