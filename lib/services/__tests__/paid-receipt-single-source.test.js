/**
 * Header Doc
 * Purpose: Guardrail statis agar struk "tagihan lunas" tetap punya SATU sumber. Pernah terjadi:
 *   empat jalur pelunasan merangkai pesannya sendiri (tiga template, dua store, dua format rupiah),
 *   sehingga pelanggan yang sama menerima struk berbeda tergantung tombol yang ditekan admin.
 * Caller: Jest test runner.
 * Deps: `fs`, `path`, source jalur pelunasan + kedua store template.
 * MainFuncs: Memverifikasi hanya paid-receipt.js yang merender `tagihan_struk_lunas`, tak ada lagi
 *   template lunas kembar, dan jalur pelunasan tak memakai rupiah-format.
 * SideEffects: Tidak ada.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

// Jalur yang mengirim struk lunas ke pelanggan.
const PAYMENT_PATHS = [
    ["services", "payment-proof.service.js"],
    ["lib", "approval-logic.js"],
    ["routes", "bill-payment.js"],
    ["routes", "public.js"]
];

describe("struk lunas — sumber tunggal", () => {
    test("hanya paid-receipt.js yang merender template tagihan_struk_lunas", () => {
        PAYMENT_PATHS.forEach((p) => {
            const src = read(...p);
            expect(src).not.toContain('renderTemplate("tagihan_struk_lunas"');
            expect(src).not.toContain("renderTemplate('tagihan_struk_lunas'");
        });
        expect(read("lib", "services", "paid-receipt.js")).toContain("tagihan_struk_lunas");
    });

    test("setiap jalur pelunasan memanggil buildPaidReceiptText", () => {
        PAYMENT_PATHS.forEach((p) => {
            expect(read(...p)).toContain("buildPaidReceiptText");
        });
    });

    test("template lunas kembar sudah dihapus dari kedua store", () => {
        const response = JSON.parse(read("database", "response_templates.json"));
        const message = JSON.parse(read("database", "message_templates.json"));

        expect(response).not.toHaveProperty("payment_proof_confirmed");
        expect(message).not.toHaveProperty("sudah_bayar_notification");
        expect(message).toHaveProperty("tagihan_struk_lunas");
    });

    test("tak ada kode tersisa yang merujuk template lunas yang dihapus", () => {
        PAYMENT_PATHS.forEach((p) => {
            const src = read(...p);
            expect(src).not.toMatch(/renderResponseTemplate\(\s*["']payment_proof_confirmed["']/);
            expect(src).not.toMatch(/renderTemplate\(\s*["']sudah_bayar_notification["']/);
        });
    });

    test("nominal struk tak lagi dirakit dengan rupiah-format ('Rp. 125.000,00')", () => {
        // convertRupiah boleh tetap dipakai untuk halaman/pesan lain, tapi TIDAK untuk slot struk.
        // Yang dilarang adalah IMPORT-nya di modul struk — penyebutannya di komentar tentu boleh.
        const receipt = read("lib", "services", "paid-receipt.js");
        expect(receipt).not.toMatch(/require\(\s*["']rupiah-format["']\s*\)/);
        expect(receipt).toContain('toLocaleString("id-ID")');
    });
});
