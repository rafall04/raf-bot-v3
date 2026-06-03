/**
 * Header Doc
 * Purpose: Guardrail source untuk memastikan registrar admin wifi/network ops tetap menjadi adapter HTTP tipis tanpa helper WiFi/history langsung.
 * Caller: Jest test runner.
 * Deps: `fs`, `path`, dan source `routes/admin-wifi-ops-routes.js`.
 * MainFuncs: Memverifikasi registrar network ops hanya memakai `services/network-ops.service.js` untuk observability dan mutasi WiFi perangkat.
 * SideEffects: Membaca source file lokal tanpa memodifikasi runtime.
 */
"use strict";

const fs = require("fs");
const path = require("path");

describe("admin wifi ops registrar boundary", () => {
    test("admin wifi ops registrar stays service-first for network and wifi mutation paths", () => {
        const source = fs.readFileSync(
            path.join(__dirname, "..", "admin-wifi-ops-routes.js"),
            "utf8"
        );

        expect(source).toContain("createNetworkOpsService");
        expect(source).toContain("networkOpsService.getCustomerWifiInfo");
        expect(source).toContain("networkOpsService.updateCustomerWifi");
        expect(source).not.toContain("require(\"../lib/wifi\")");
        expect(source).not.toContain("require(\"../lib/wifi-logger\")");
        expect(source).not.toContain("buildWebWifiLogPayload");
        expect(source).not.toContain("logWifiChange(");
        expect(source).not.toContain("loadJSON(");
    });
});
