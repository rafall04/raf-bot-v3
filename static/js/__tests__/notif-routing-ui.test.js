/**
 * Header Doc
 * Purpose: Guard UI halaman /notif-routing — harus RAPI & mudah dipahami admin non-teknis:
 *   dikelompokkan per DOMAIN, pemilih grup = CHECKBOX (bukan multi-select ctrl-click), badge
 *   severity bahasa awam (Penting/Biasa), baris status "Sekarang: ..." yang tegas. Pemindai sumber.
 * Caller: Jest.
 * Deps: fs (baca static/js/notif-routing.js).
 * SideEffects: -
 */
"use strict";

const fs = require("fs");
const path = require("path");
const SRC = fs.readFileSync(path.join(__dirname, "..", "notif-routing.js"), "utf8");

test("dikelompokkan per DOMAIN (Pembayaran/Jaringan/Voucher)", () => {
    expect(SRC).toMatch(/DOMAINS\s*=/);
    expect(SRC).toMatch(/Pembayaran/);
    expect(SRC).toMatch(/Jaringan/);
    expect(SRC).toMatch(/Voucher & Billing/);
});

test("pemilih grup = CHECKBOX, BUKAN select multiple", () => {
    expect(SRC).toMatch(/type="checkbox"[^>]*nr-grp/);
    expect(SRC).not.toMatch(/<select[^>]*multiple/);
});

test("severity bahasa awam (Penting/Biasa), bukan critical/info mentah di UI", () => {
    expect(SRC).toMatch(/Penting/);
    expect(SRC).toMatch(/Biasa/);
});

test("baris status 'Sekarang:' tegas + fallback chat admin bila belum dipilih", () => {
    expect(SRC).toMatch(/Sekarang:/);
    expect(SRC).toMatch(/chat pribadi admin/);
});
