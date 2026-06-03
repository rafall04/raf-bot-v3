/**
 * Header Doc
 * Purpose: Guardrail source untuk memastikan registrar admin ops tetap menjadi adapter HTTP tipis tanpa helper persistence langsung.
 * Caller: Jest test runner.
 * Deps: `fs`, `path`, dan source `routes/admin-ops-routes.js`.
 * MainFuncs: Memverifikasi registrar hanya memakai `services/admin-ops.service.js` sebagai owner utility destruktif.
 * SideEffects: Membaca source file lokal tanpa memodifikasi runtime.
 */
"use strict";

const fs = require("fs");
const path = require("path");

describe("admin ops registrar boundary", () => {
    test("admin ops registrar stays service-first and does not import persistence helpers directly", () => {
        const source = fs.readFileSync(
            path.join(__dirname, "..", "admin-ops-routes.js"),
            "utf8"
        );

        expect(source).toContain("createAdminOpsService");
        expect(source).toContain("adminOpsService.deleteEntityByCategory");
        expect(source).toContain("adminOpsService.deleteAllUsers");
        expect(source).toContain("adminOpsService.cleanupOrphanedPhotos");
        expect(source).not.toContain("require(\"../lib/database\")");
        expect(source).not.toContain("require(\"../lib/payment\")");
        expect(source).not.toContain("loadJSON(");
        expect(source).not.toContain("saveJSON(");
        expect(source).not.toContain("runDb(");
    });
});
