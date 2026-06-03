/**
 * Header Doc
 * Purpose: Guardrail baseline untuk inventaris ownership concern aktif di service admin/network ops sebelum extraction wave 3.
 * Caller: Jest test runner.
 * Deps: `fs`, `path`, dan source `services/admin-ops.service.js` + `services/network-ops.service.js`.
 * MainFuncs: Memverifikasi service ops masih menjadi owner orchestration, sekaligus menandai concern persistence/cache/history yang sudah mulai turun ke repository owner wave 3.
 * SideEffects: Membaca source file lokal tanpa memodifikasi runtime.
 */
"use strict";

const fs = require("fs");
const path = require("path");

function readServiceSource(fileName) {
    return fs.readFileSync(path.join(__dirname, "..", fileName), "utf8");
}

describe("wave 3 ops ownership baseline", () => {
    test("admin ops service inventory captures orchestration while mikrotik device JSON persistence uses repository owner", () => {
        const source = readServiceSource("admin-ops.service.js");

        expect(source).toContain("createRuntimeCacheRepository");
        expect(source).toContain("deleteEntityByCategory");
        expect(source).toContain("deleteAllUsers");
        expect(source).toContain("cleanupOrphanedPhotos");

        expect(source).toContain("deps.userRepository");
        expect(source).toContain("deps.accountRepository");
        expect(source).toContain("deps.networkAssetsRepository");
        expect(source).toContain("deps.runDb(");
        expect(source).toContain("deps.getDbRow(");
        expect(source).toContain("createAdminOpsRepository");
        expect(source).toContain("deps.adminOpsRepository.deleteMikrotikDeviceById");
        expect(source).toContain("deps.saveNetworkAssets(");
        expect(source).toContain("deps.delPayment(");
        expect(source).toContain("deps.deleteActivePPPoEUser(");
        expect(source).toContain("fs.unlinkSync");
        expect(source).toContain("VACUUM");
    });

    test("network ops service inventory captures observability orchestration while wifi logging uses repository owner", () => {
        const source = readServiceSource("network-ops.service.js");

        expect(source).toContain("createRuntimeCacheRepository");
        expect(source).toContain("getCustomerWifiInfo");
        expect(source).toContain("updateCustomerWifi");

        expect(source).toContain("deps.userRepository");
        expect(source).toContain("deps.getWifiInfo(");
        expect(source).toContain("deps.updateWifiSettings(");
        expect(source).toContain("deps.getMultipleDeviceMetrics(");
        expect(source).toContain("deps.loadJSON(");
        expect(source).toContain("createWifiRepository");
        expect(source).toContain("deps.wifiRepository.saveWebWifiChangeByDevice(");
        expect(source).not.toContain("findCustomerByDeviceId");
    });
});
