/**
 * Header Doc
 * Purpose: Guardrail statis untuk membekukan inventaris leak `global.*` pada service legacy aktif.
 * Caller: Jest test runner.
 * Deps: `fs`, `path`, dan source service aktif prioritas.
 * MainFuncs: Memverifikasi service target tidak lagi membaca cache/runtime legacy langsung dari `global.*`.
 * SideEffects: Tidak ada; hanya membaca source file secara statis.
 */
"use strict";

const fs = require("fs");
const path = require("path");

function readServiceSource(fileName) {
    return fs.readFileSync(path.join(__dirname, "..", fileName), "utf8");
}

describe("active services global leaks", () => {
    test("admin-ops service does not read legacy global caches directly", () => {
        const source = readServiceSource("admin-ops.service.js");

        expect(source).not.toContain("global.users");
        expect(source).not.toContain("global.accounts");
        expect(source).not.toContain("global.voucher");
        expect(source).not.toContain("global.statik");
        expect(source).not.toContain("global.paymentMethod");
        expect(source).not.toContain("global.db");
    });

    test("admin-database-ops service does not read legacy global caches directly", () => {
        const source = readServiceSource("admin-database-ops.service.js");

        expect(source).not.toContain("global.users");
        expect(source).not.toContain("global.db");
    });

    test("network-ops service does not read legacy global caches directly", () => {
        const source = readServiceSource("network-ops.service.js");

        expect(source).not.toContain("global.users");
    });

    test("payment-approval service does not read legacy global caches directly", () => {
        const source = readServiceSource("payment-approval.service.js");

        expect(source).not.toContain("global.users");
        expect(source).not.toContain("global.accounts");
        expect(source).not.toContain("global.db");
    });
});
