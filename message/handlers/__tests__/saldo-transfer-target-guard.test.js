"use strict";

/**
 * Header Doc
 * Purpose: Kunci gerbang "nomor tujuan terdaftar" pada transfer saldo. `saldoManager.getUserSaldoData`
 *   adalah fungsi ASYNC (lib/saldo/balance-operations.js). Sebelum perbaikan ini pemanggilnya tidak
 *   meng-`await`, sehingga yang dinilai adalah Promise — selalu truthy — dan gerbangnya SELALU lolos:
 *   transfer ke nomor yang tak pernah terdaftar pun diteruskan.
 * Caller: Jest (`npx jest message/handlers/__tests__/saldo-transfer-target-guard.test.js`).
 * Deps: fs, path, source message/handlers/saldo-handler.js (scan statis) + lib/saldo/balance-operations.js.
 * MainFuncs: -
 * SideEffects: Tidak ada.
 */

const fs = require("fs");
const path = require("path");

const handlerSrc = fs.readFileSync(path.join(__dirname, "..", "saldo-handler.js"), "utf8");
const balanceOpsSrc = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "lib", "saldo", "balance-operations.js"),
    "utf8"
);

describe("transfer saldo: gerbang tujuan terdaftar", () => {
    test("premis tetap benar — getUserSaldoData memang async", () => {
        // Kalau suatu hari fungsi ini jadi sinkron, test ini yang harus ditinjau lebih dulu,
        // bukan gerbangnya yang diam-diam dikembalikan ke bentuk lama.
        expect(balanceOpsSrc).toMatch(/async\s+function\s+getUserSaldoData\s*\(/);
    });

    test("isTargetRegistered dideklarasikan async", () => {
        expect(handlerSrc).toMatch(/async\s+function\s+isTargetRegistered\s*\(/);
    });

    test("hasil getUserSaldoData di-await, bukan dipakai sebagai Promise truthy", () => {
        expect(handlerSrc).toMatch(/await\s+saldoManager\.getUserSaldoData\?\.\(/);
        // Regresi: bentuk tanpa await tidak boleh muncul lagi.
        expect(handlerSrc).not.toMatch(/=\s*saldoManager\.getUserSaldoData\?\.\([^)]*\)\s*;/);
    });

    test("pemanggil gerbang meng-await hasilnya sebelum menegasikan", () => {
        expect(handlerSrc).toMatch(/if\s*\(\s*!\(\s*await\s+isTargetRegistered\(/);
        // `!isTargetRegistered(...)` tanpa await = negasi atas Promise → selalu false → gerbang mati.
        expect(handlerSrc).not.toMatch(/if\s*\(\s*!isTargetRegistered\(/);
    });

    test("gerbang tetap berada SEBELUM state konfirmasi transfer dipasang", () => {
        const idxGuard = handlerSrc.indexOf("isTargetRegistered(targetId, targetNumber)");
        const idxState = handlerSrc.indexOf("setUserState(sender,", idxGuard);
        expect(idxGuard).toBeGreaterThan(-1);
        expect(idxState).toBeGreaterThan(idxGuard);
    });
});
