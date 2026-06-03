/**
 * Header Doc
 * Purpose: Guardrail source test untuk memastikan consumer voucher aktif membaca katalog via voucher repository owner.
 * Caller: Jest test runner.
 * Deps: `fs`, `path`, dan source `../raf.js`.
 * MainFuncs: Memverifikasi `message/raf.js` mengambil katalog voucher dari `voucherRepository`.
 * SideEffects: Tidak ada.
 */
"use strict";

const fs = require("fs");
const path = require("path");

describe("voucher repository owner", () => {
    test("active bot consumer reads voucher catalog via voucher repository", () => {
        const source = fs.readFileSync(path.join(__dirname, "..", "raf.js"), "utf8");

        expect(source).toContain("const voucherRepository = domainRepositories.voucher;");
        expect(source).toContain("const voucherCatalog = voucherRepository.getVoucherCatalog();");
        expect(source).not.toContain("const voucherCatalog = requestRuntime?.repositories?.voucher?.getAll() || runtimeGlobalScope.voucher || [];");
    });
});
