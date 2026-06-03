/**
 * Header Doc
 * Purpose: Guardrail boundary untuk memastikan route network API tetap menjadi adapter tipis setelah normalisasi domain network.
 * Caller: Jest test runner.
 * Deps: `fs`, `path`, dan source `routes/api-network-routes.js`.
 * MainFuncs: Memverifikasi delegation route network ke service owner dan melarang kembalinya orchestration action/import langsung di route.
 * SideEffects: Membaca source file lokal tanpa memodifikasi runtime.
 */
"use strict";

const fs = require("fs");
const path = require("path");

function readNetworkRouteSource() {
    return fs.readFileSync(path.join(__dirname, "..", "api-network-routes.js"), "utf8");
}

describe("api-network route boundary", () => {
    test("route delegates active network flows to service owner", () => {
        const source = readNetworkRouteSource();

        expect(source).toContain("const { createApiNetworkRepository } = require('../repositories/api-network.repository')");
        expect(source).toContain("const { createApiNetworkService } = require('../services/api-network.service')");
        expect(source).toContain("apiNetworkService.handleNetworkAction(req.body)");
        expect(source).toContain("apiNetworkService.sendManualMessage");
        expect(source).toContain("apiNetworkService.listUnregisteredPppoeSecrets()");
        expect(source).toContain("apiNetworkService.listDevicesForImport()");
    });

    test("route no longer owns direct mikrotik action or import enrichment logic", () => {
        const source = readNetworkRouteSource();

        expect(source).not.toContain("updatePPPoEProfile(username, newProfile");
        expect(source).not.toContain("sendMessage(req.params.id");
        expect(source).not.toContain("profileToPackage");
        expect(source).not.toContain("registeredUsernames");
        expect(source).not.toContain("getUsers()");
        expect(source).not.toContain("getPackages()");
    });
});
