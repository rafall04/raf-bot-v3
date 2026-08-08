"use strict";

/**
 * Header Doc
 * Purpose: Kunci gerbang "sudah lunas" di routes/bill-payment.js agar tahan tipe. Status lunas di
 *   snapshot runtime bisa BOOLEAN (loader boot lib/database.js) atau INTEGER (jalur pelunasan
 *   lib/payment-finance-service.js menulis `paid = isPaid ? 1 : 0`). Sebelum perbaikan ini gerbangnya
 *   memakai `paid === true`, sehingga JUSTRU gagal tepat setelah pelanggan membayar — pelanggan bisa
 *   membayar tagihan yang sama dua kali lewat link lama.
 * Caller: Jest (`npx jest routes/__tests__/bill-payment-paid-gate.test.js`).
 * Deps: fs, path, routes/bill-payment.js (helper internal `_isUserPaid`).
 * MainFuncs: -
 * SideEffects: Tidak ada.
 */

const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "bill-payment.js"), "utf8");

describe("bill-payment: gerbang lunas tahan tipe (boolean ATAU integer)", () => {
    const { _isUserPaid: isUserPaid } = require("../bill-payment");

    test("integer 1 dari jalur pelunasan dibaca LUNAS", () => {
        // lib/payment-finance-service.js: paidValue = isPaid ? 1 : 0 → masuk snapshot runtime.
        expect(isUserPaid({ paid: 1 })).toBe(true);
    });

    test("boolean true dari loader boot dibaca LUNAS", () => {
        expect(isUserPaid({ paid: true })).toBe(true);
    });

    test("string '1' (bentuk yang pernah datang dari form admin) dibaca LUNAS", () => {
        expect(isUserPaid({ paid: "1" })).toBe(true);
    });

    test("belum bayar tetap BELUM LUNAS dalam semua bentuknya", () => {
        expect(isUserPaid({ paid: 0 })).toBe(false);
        expect(isUserPaid({ paid: false })).toBe(false);
        expect(isUserPaid({ paid: "0" })).toBe(false);
        expect(isUserPaid({})).toBe(false);
        expect(isUserPaid(null)).toBe(false);
    });

    test("TIDAK ADA lagi perbandingan `paid === true` yang tersisa di file ini", () => {
        // Regresi: satu saja yang tertinggal cukup untuk membuka kembali jalur bayar-dua-kali.
        expect(source).not.toMatch(/\.paid\s*===\s*true/);
    });

    test("ketiga gerbang (halaman, info, charge) memakai helper yang sama", () => {
        const pakai = source.match(/isUserPaid\(/g) || [];
        // 1 definisi + 3 pemakaian + 1 ekspor internal.
        expect(pakai.length).toBeGreaterThanOrEqual(4);
        // Guard server-side anti bayar-dua-kali WAJIB ikut memakainya.
        expect(source).toMatch(/if\s*\(\s*isUserPaid\(ctx\.user\)\s*\)\s*return\s+res\.status\(409\)[\s\S]{0,60}already_paid/);
    });
});
