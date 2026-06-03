/**
 * Header Doc
 * Purpose: Guardrail statis untuk mencegah entrypoint bisnis aktif membaca katalog runtime tertentu langsung dari `global.*`.
 * Caller: Jest test runner.
 * Deps: `fs`, `path`, dan source `message/raf.js`.
 * MainFuncs: Memverifikasi `message/raf.js` memakai runtime-backed repository untuk `statik` dan `voucher`.
 * SideEffects: Tidak ada; membaca source file secara statis.
 */
"use strict";

const fs = require("fs");
const path = require("path");

describe("runtime global leaks", () => {
    test("message/raf.js does not read statik and voucher catalogs directly from global", () => {
        const source = fs.readFileSync(path.join(__dirname, "..", "..", "message", "raf.js"), "utf8");

        expect(source).not.toContain("global.statik");
        expect(source).not.toContain("global.voucher");
        expect(source).toContain("getRuntimeCollection(requestRuntime, 'statik'");
        expect(source).toContain("const voucherRepository = domainRepositories.voucher;");
        expect(source).toContain("voucherRepository.getVoucherCatalog()");
    });
});
