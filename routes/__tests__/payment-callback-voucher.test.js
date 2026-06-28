"use strict";

/**
 * Header Doc
 * Purpose: Guardrail — pastikan callback voucher (buynow/buynowweb) HARDENED untuk go-public:
 *   (1) kode voucher dikirim via sendCritical (retry+dead-letter), (2) saat voucher GAGAL dibuat
 *   → recordVoucherOrphan + alertAdmins (tidak silent) + tetap mark paid (stop retry; getvoucher
 *   non-idempotent → retry = risiko voucher ganda). Mencegah regresi ke "silent paid tanpa voucher".
 * Caller: Jest (`npx jest routes/__tests__/payment-callback-voucher.test.js`).
 * Deps: fs, path, source routes/public.js (scan, tidak dieksekusi).
 * MainFuncs: -
 * SideEffects: Tidak ada.
 */

const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "public.js"), "utf8");
const buynowIdx = source.indexOf("pay.tag == 'buynow'");
const webIdx = source.indexOf("pay.tag == 'buynowweb'");
const buynowBlock = buynowIdx > -1 ? source.slice(buynowIdx, webIdx) : "";
const webBlock = webIdx > -1 ? source.slice(webIdx, source.indexOf("pay.tag == 'topup'")) : "";

describe("callback voucher hardening (go-public)", () => {
    test("blok buynow & buynowweb ada", () => {
        expect(buynowIdx).toBeGreaterThan(-1);
        expect(webIdx).toBeGreaterThan(-1);
    });

    test("buynow: kode voucher via sendCritical (bukan sendMessage best-effort)", () => {
        expect(buynowBlock).toMatch(/sendCritical\(pay\.sender/);
    });

    test("buynow: voucher gagal → recordVoucherOrphan + alertAdmins (terlihat, tidak silent)", () => {
        const catchBlock = buynowBlock.slice(buynowBlock.indexOf(".catch("));
        expect(catchBlock).toMatch(/recordVoucherOrphan/);
        expect(catchBlock).toMatch(/alertAdmins/);
    });

    test("buynow: voucher gagal → tetap mark paid (stop retry; getvoucher non-idempotent)", () => {
        const catchBlock = buynowBlock.slice(buynowBlock.indexOf(".catch("));
        const idxMarkPaid = catchBlock.indexOf("updateStatusPayment(reference_id, true)");
        const idxThrowOk = catchBlock.indexOf("throw !0");
        expect(idxMarkPaid).toBeGreaterThan(-1);
        expect(idxThrowOk).toBeGreaterThan(idxMarkPaid);
    });

    test("buynowweb: voucher gagal → recordVoucherOrphan + alertAdmins juga", () => {
        const catchBlock = webBlock.slice(webBlock.indexOf(".catch("));
        expect(catchBlock).toMatch(/recordVoucherOrphan/);
        expect(catchBlock).toMatch(/alertAdmins/);
    });
});
