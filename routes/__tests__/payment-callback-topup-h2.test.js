"use strict";

/**
 * Header Doc
 * Purpose: Guardrail H2 — pastikan callback iPaymu cabang `topup` mengkredit saldo DULU dan
 *   HANYA menandai payment paid bila kredit sukses; bila gagal → throw !1 (HTTP 500 → iPaymu
 *   retry, payment tidak hilang). Mencegah regresi ke pola lama (mark paid tanpa cek hasil kredit).
 * Caller: Jest test runner (`npx jest routes/__tests__/payment-callback-topup-h2.test.js`).
 * Deps: `fs`, `path`, source `routes/public.js` (scan, tidak dieksekusi).
 * MainFuncs: -
 * SideEffects: Tidak ada (hanya baca source).
 */

const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "public.js"), "utf8");

// Isolasi blok cabang topup di handler POST /callback/payment.
const topupIdx = source.indexOf("pay.tag == 'topup'");
// Slice cukup panjang untuk menampung seluruh branch topup, tapi tidak mencapai catch block.
const topupBlock = topupIdx > -1 ? source.slice(topupIdx, topupIdx + 1100) : "";

describe("H2: iPaymu topup callback — kredit dulu, tandai paid hanya bila sukses", () => {
    test("blok topup ada di routes/public.js", () => {
        expect(topupIdx).toBeGreaterThan(-1);
    });

    test("kredit saldo (addKoinUser) dicek hasilnya SEBELUM updateStatusPayment(paid)", () => {
        const idxCredited = topupBlock.indexOf("const credited = await addKoinUser");
        const idxGuard = topupBlock.indexOf("if (!credited)");
        const idxMarkPaid = topupBlock.indexOf("updateStatusPayment(reference_id, true)");

        expect(idxCredited).toBeGreaterThan(-1);
        // Guard kegagalan harus SETELAH pemanggilan kredit...
        expect(idxGuard).toBeGreaterThan(idxCredited);
        // ...dan tandai-paid harus SETELAH guard (bukan unconditional sebelum cek).
        expect(idxMarkPaid).toBeGreaterThan(idxGuard);
    });

    test("kredit gagal → throw !1 (HTTP 500 → retry), bukan menandai paid", () => {
        const idxGuard = topupBlock.indexOf("if (!credited)");
        const idxThrowFail = idxGuard > -1 ? topupBlock.indexOf("throw !1", idxGuard) : -1;
        const idxMarkPaid = topupBlock.indexOf("updateStatusPayment(reference_id, true)");

        expect(idxThrowFail).toBeGreaterThan(idxGuard);
        // Jalur gagal (throw !1) harus muncul sebelum tandai-paid (mark paid hanya di jalur sukses).
        expect(idxThrowFail).toBeLessThan(idxMarkPaid);
    });

    test("tidak ada anti-pattern: addKoinUser langsung diikuti updateStatusPayment(paid) tanpa guard", () => {
        expect(topupBlock).not.toMatch(/await addKoinUser\([^)]*\);\s*updateStatusPayment\(reference_id,\s*true\)/);
    });
});
