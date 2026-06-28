"use strict";

/**
 * Header Doc
 * Purpose: Guardrail — pastikan callback iPaymu cabang `tagihan` fail-closed: catat lunas
 *   (settleTagihanPayment) DULU, tandai paid HANYA bila settle sukses; user tak ketemu / settle
 *   gagal → throw !1 (HTTP 500 → iPaymu retry, pembayaran tidak hilang). Reaktivasi best-effort.
 * Caller: Jest (`npx jest routes/__tests__/payment-callback-tagihan.test.js`).
 * Deps: fs, path, source routes/public.js (scan, tidak dieksekusi).
 * MainFuncs: -
 * SideEffects: Tidak ada.
 */

const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "public.js"), "utf8");
const idx = source.indexOf("pay.tag == 'tagihan'");
const block = idx > -1 ? source.slice(idx, idx + 2600) : "";

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
        const idxMarkPaid = block.indexOf("updateStatusPayment(reference_id, true)");
        expect(idxThrowFail).toBeGreaterThan(idxCatch);
        expect(idxThrowFail).toBeLessThan(idxMarkPaid);
    });

    test("kirim struk dibungkus try/catch (best-effort, tak menggagalkan callback)", () => {
        const idxStruk = block.indexOf("tagihan_struk_lunas");
        const before = block.slice(Math.max(0, idxStruk - 400), idxStruk);
        expect(idxStruk).toBeGreaterThan(-1);
        expect(before).toMatch(/try\s*{/);
    });

    test("verifikasi server-to-server tetap berlaku (verify sebelum semua cabang)", () => {
        // checkTransaction (verifyIpaymuTransaction) ada di handler & sebelum blok tagihan.
        const idxVerify = source.indexOf("verifyIpaymuTransaction(pay.trxId");
        expect(idxVerify).toBeGreaterThan(-1);
        expect(idxVerify).toBeLessThan(idx);
    });
});
