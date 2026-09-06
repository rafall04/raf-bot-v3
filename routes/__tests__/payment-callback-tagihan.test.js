"use strict";

/**
 * Header Doc
 * Purpose: Guardrail — pastikan callback iPaymu cabang `tagihan` fail-closed: catat lunas
 *   (settleTagihanPayment) DULU, tandai paid HANYA bila settle sukses; user tak ketemu / settle
 *   gagal → throw !1 (HTTP 500 → iPaymu retry, pembayaran tidak hilang). Reaktivasi + kirim struk
 *   best-effort (gagal kirim WA tidak boleh menggagalkan callback).
 * Caller: Jest (`npx jest routes/__tests__/payment-callback-tagihan.test.js`).
 * Deps: fs, path, source routes/public.js (scan, tidak dieksekusi). Struk dirender lewat
 *   `buildPaidReceiptText` (lib/services/paid-receipt.js) — satu-satunya perender template struk.
 * MainFuncs: -
 * SideEffects: Tidak ada.
 */

const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "public.js"), "utf8");
const idx = source.indexOf("pay.tag == 'tagihan'");
// Jendela blok dilebarkan 2600 → 3600 (#b238): blok tagihan kini juga menangani kasus
// kelebihan bayar (catat ledger + alarm admin) sebelum penutup try/catch-nya, sehingga
// bloknya bertambah panjang. Yang diuji suite ini tidak berubah.
const block = idx > -1 ? source.slice(idx, idx + 3600) : "";

describe("callback tagihan — fail-closed catat lunas + auto-reaktivasi", () => {
    test("blok tagihan ada di routes/public.js", () => {
        expect(idx).toBeGreaterThan(-1);
    });

    test("user tidak ditemukan → throw !1 (sebelum settle/markpaid)", () => {
        const idxUser = block.indexOf("global.users");
        const idxThrow = block.indexOf("throw !1", idxUser);
        const idxSettle = block.indexOf("settleTagihanPayment");
        expect(idxUser).toBeGreaterThan(-1);
        expect(idxThrow).toBeGreaterThan(idxUser);
        expect(idxThrow).toBeLessThan(idxSettle);
    });

    test("settle dipanggil SEBELUM updateStatusPayment(paid)", () => {
        const idxSettle = block.indexOf("settleTagihanPayment");
        const idxMarkPaid = block.indexOf("updateStatusPayment(reference_id, true)");
        expect(idxSettle).toBeGreaterThan(-1);
        expect(idxMarkPaid).toBeGreaterThan(idxSettle);
    });

    test("settle gagal → throw !1 di jalur catch, sebelum tandai-paid", () => {
        const idxCatch = block.indexOf("catch (settleErr)");
        const idxThrowFail = idxCatch > -1 ? block.indexOf("throw !1", idxCatch) : -1;
        // #b344: markPaid (di dalam args settle) hanya jalan SETELAH ledger sukses DI DALAM settle —
        // tak relevan utk fail-path. Yang relevan = updateStatusPayment POST-settle: cari occurrence
        // SESUDAH throw fail. Bila settle THROW, keduanya tak tercapai (aman).
        const idxMarkPaidPost = block.indexOf("updateStatusPayment(reference_id, true)", idxThrowFail);
        expect(idxThrowFail).toBeGreaterThan(idxCatch);
        expect(idxMarkPaidPost).toBeGreaterThan(idxThrowFail);
    });

    test("kirim struk dibungkus try/catch (best-effort, tak menggagalkan callback)", () => {
        // Struk dirender SATU sumber: lib/services/paid-receipt.js. Key template
        // `tagihan_struk_lunas` sengaja TIDAK lagi disebut di routes/public.js — itu justru dilarang oleh
        // lib/services/__tests__/paid-receipt-single-source.test.js. Jadi anchor-nya fungsi, bukan key.
        //
        // JANGKAR DIPERBARUI (#b238): callback kini memanggil `putuskanTindakanPascaLunas`
        // (lib/services/bill-payment-aftercare), yang memilih struk-lunas vs pesan
        // kelebihan-bayar berdasarkan verdict ledger lalu tetap mendelegasikan teksnya ke
        // sumber tunggal. Yang diuji tes ini TIDAK berubah: pengirimannya wajib dibungkus
        // try/catch supaya gagal render/kirim WA tak menggagalkan callback gateway.
        const idxStruk = block.indexOf("putuskanTindakanPascaLunas");
        const before = block.slice(Math.max(0, idxStruk - 400), idxStruk);
        // Jendela dilebarkan 600 → 1100: blok ini kini juga mencatat/mewartakan kasus
        // kelebihan bayar sebelum `catch`, jadi jarak ke penutupnya bertambah. Yang diuji
        // tetap sama — keberadaan pembungkus try/catch, bukan panjang bloknya.
        const after = block.slice(idxStruk, idxStruk + 1100);
        expect(idxStruk).toBeGreaterThan(-1);
        // Dibungkus try { ... } catch: gagal render/kirim WA ditelan, callback tetap 200.
        expect(before).toMatch(/try\s*{/);
        expect(after).toMatch(/catch\s*\(/);
    });

    test("verifikasi server-to-server tetap berlaku (verify sebelum semua cabang)", () => {
        // checkTransaction (verifyIpaymuTransaction) ada di handler & sebelum blok tagihan.
        const idxVerify = source.indexOf("verifyIpaymuTransaction(effectiveTrxId");
        expect(idxVerify).toBeGreaterThan(-1);
        expect(idxVerify).toBeLessThan(idx);
    });

    test("mode hosted: trxId fallback ke payload (pay.trxId || req.body.trx_id) + cross-check tetap", () => {
        // Record hosted tak punya trxId saat dibuat → verify pakai trx_id dari payload callback.
        expect(source).toMatch(/effectiveTrxId\s*=\s*pay\.trxId\s*\|\|\s*req\.body\.trx_id/);
        // Cross-check keamanan referenceId & amount WAJIB tetap ada (anti substitusi trx).
        expect(source).toContain("referenceId iPaymu tidak cocok");
        expect(source).toContain("amount iPaymu kurang dari tagihan");
    });
});
