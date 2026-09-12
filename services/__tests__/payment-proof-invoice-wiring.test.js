/**
 * Header Doc
 * Purpose: Guard wiring FIX invoice-tak-terkirim [2/2] di jalur konfirmasi bukti foto WA. Pastikan
 *   notifyCustomerConfirmed memanggil hook bersama sendPaidInvoiceOrReceipt di bawah gate
 *   config.invoiceOnSettle.enabled + cek send_invoice, dan TETAP fallback ke struk teks durable
 *   (sendCritical) bila hook tak mengirim. Gate terdaftar di FEATURE_FLAGS (toggle web).
 * Caller: Jest.
 * Deps: fs (scan sumber), ../../lib/feature-flags.
 * SideEffects: -
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { flagByKey } = require("../../lib/feature-flags");

const SRC = fs.readFileSync(path.join(__dirname, "..", "payment-proof.service.js"), "utf8");

test("notifyCustomerConfirmed wiring: gate invoiceOnSettle + hook + cek send_invoice + fallback teks", () => {
    expect(SRC).toMatch(/invoiceOnSettle/);
    expect(SRC).toMatch(/sendPaidInvoiceOrReceipt/);
    expect(SRC).toMatch(/isSendInvoiceEnabled\(user\.send_invoice\)/);
    // Fallback durable ke struk teks tetap ada (konfirmasi tak boleh hilang).
    expect(SRC).toMatch(/sendCritical\(record\.userId, \{ text \}/);
});

test("gate invoiceOnSettle terdaftar di FEATURE_FLAGS (punya toggle web) + default OFF", () => {
    const f = flagByKey("invoiceOnSettle");
    expect(f).toBeTruthy();
    expect(f.defaultEnabled).not.toBe(true); // deploy-gelap
});
