/**
 * Header Doc
 * Purpose: Guard wiring FIX invoice-tak-terkirim di jalur CALLBACK online (iPaymu/Tripay/Mayar).
 *   Pastikan tiap callback memanggil trySendSettleInvoice (gate invoiceOnSettle + send_invoice +
 *   isCleanPaid) sebelum fallback struk teks — supaya bayar QRIS/VA kirim invoice PDF bila diaktifkan,
 *   TAPI kasus 'kelebihan' tetap teks (isCleanPaid=false).
 * Caller: Jest.
 * Deps: fs (scan sumber).
 * SideEffects: -
 */
"use strict";

const fs = require("fs");
const path = require("path");
const pub = fs.readFileSync(path.join(__dirname, "..", "public.js"), "utf8");
const bill = fs.readFileSync(path.join(__dirname, "..", "bill-payment.js"), "utf8");

test("iPaymu callback (public.js) wire trySendSettleInvoice + isCleanPaid (bukan kelebihan)", () => {
    expect(pub).toMatch(/trySendSettleInvoice\(user,/);
    expect(pub).toMatch(/isCleanPaid:\s*tindakan\.jenis\s*!==\s*'kelebihan'/);
});

test("Tripay + Mayar callback (bill-payment.js) wire trySendSettleInvoice (2 titik) + fallback teks", () => {
    expect((bill.match(/trySendSettleInvoice\(user,/g) || []).length).toBe(2);
    expect(bill).toMatch(/isCleanPaid:\s*tindakan\.jenis\s*!==\s*"kelebihan"/);
    expect(bill).toMatch(/if \(!sentInvoice\) await sendMessage\(pay\.sender/);
});
