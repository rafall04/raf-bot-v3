/**
 * Header Doc
 * Purpose: Guardrail source test untuk memastikan consumer saldo aktif memakai saldo repository owner.
 * Caller: Jest test runner.
 * Deps: `fs`, `path`, dan source `../raf.js`.
 * MainFuncs: Memverifikasi lookup dan inisialisasi saldo pelanggan tidak lagi lewat helper persistence langsung.
 * SideEffects: Tidak ada.
 */
"use strict";

const fs = require("fs");
const path = require("path");

describe("saldo repository owner", () => {
    test("active bot consumer uses saldo repository for lookup and initialization", () => {
        const source = fs.readFileSync(path.join(__dirname, "..", "raf.js"), "utf8");

        expect(source).toContain("const saldoRepository = domainRepositories.saldo;");
        expect(source).toContain("const isSaldo = await saldoRepository.getSaldoUser(normalizedSenderForSaldo);");
        expect(source).toContain("await saldoRepository.createSaldoUser(primarySenderId, pushname);");
        expect(source).toContain("const rupiah = await saldoRepository.getSaldoUser(primarySenderId);");
        expect(source).not.toContain("await saldoManager.createUserSaldo(primarySenderId);");
    });
});
