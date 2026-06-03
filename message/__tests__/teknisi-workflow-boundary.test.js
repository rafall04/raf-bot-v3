/**
 * Header Doc
 * Purpose: Source guardrail untuk memastikan workflow teknisi tidak lagi membuat proxy state legacy sendiri.
 * Caller: Jest test runner.
 * Deps: `fs`, `path`, dan source `../handlers/teknisi-workflow-handler.js`.
 * MainFuncs: Memverifikasi consumer workflow memakai API state langsung tanpa `createScopedStateProxy`, tetap boleh memakai formatter template, dan bebas debug log noisy.
 * SideEffects: Tidak ada.
 */
"use strict";

const fs = require("fs");
const path = require("path");

describe("teknisi workflow boundary", () => {
    test("workflow teknisi does not instantiate scoped state proxy directly", () => {
        const source = fs.readFileSync(path.join(__dirname, "..", "handlers", "teknisi-workflow-handler.js"), "utf8");

        expect(source).not.toContain("createScopedStateProxy");
        expect(source).not.toContain("global.teknisiStates =");
        expect(source).toContain("getUserState");
        expect(source).toContain("setUserState");
        expect(source).toContain("deleteUserState");
        expect(source).toContain("format");
    });

    test("workflow teknisi tidak meninggalkan debug console log noisy", () => {
        const source = fs.readFileSync(path.join(__dirname, "..", "handlers", "teknisi-workflow-handler.js"), "utf8");

        expect(source).not.toContain("TEKNISI_FOUND");
        expect(source).not.toContain("SAMPAI_DEBUG");
        expect(source).not.toContain("PHOTO_UPLOAD");
    });
});
