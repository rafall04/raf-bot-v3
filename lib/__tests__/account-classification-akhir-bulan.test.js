/**
 * Header Doc
 * Purpose : GUARD siklus tagihan AKHIR BULAN — klasifikasi pelanggan `billing_cycle='akhir_bulan'`
 *           dan gerbang gabungan `isEndOfMonthBillingActive` (fitur ON + pelanggan bertanda).
 * Caller  : jest
 * Deps    : lib/account-classification.
 * MainFuncs: —
 * SideEffects: mengatur/mereset global.config di tiap test.
 *
 * KENAPA ADA — gerbang ini dipakai DUA arah (job standar mengecualikan kohort; cron akhir-bulan
 * mengklaimnya). Kalau gerbang bocor (mis. mengabaikan flag enabled), pelanggan bisa jatuh di celah:
 * dikecualikan siklus standar TAPI tak ditangani job akhir-bulan → tak pernah ditagih/diisolir.
 */
"use strict";

const {
    isEndOfMonthCustomer,
    isEndOfMonthBillingActive,
} = require("../account-classification");

describe("siklus tagihan akhir bulan — klasifikasi & gerbang", () => {
    const cfgAsli = global.config;
    const cronAsli = global.cronConfig;
    // #b304 fail-closed: eksklusi butuh cron TERJADWAL. Set cron ON di sebagian besar test.
    beforeEach(() => { global.cronConfig = { status_billing_akhir_bulan: true }; });
    afterEach(() => { global.config = cfgAsli; global.cronConfig = cronAsli; });

    test("isEndOfMonthCustomer: hanya 'akhir_bulan' (case-insensitive) yang true", () => {
        expect(isEndOfMonthCustomer({ billing_cycle: "akhir_bulan" })).toBe(true);
        expect(isEndOfMonthCustomer({ billing_cycle: "AKHIR_BULAN" })).toBe(true);
        expect(isEndOfMonthCustomer({ billing_cycle: "awal_bulan" })).toBe(false);
        expect(isEndOfMonthCustomer({ billing_cycle: "" })).toBe(false);
        expect(isEndOfMonthCustomer({})).toBe(false);
        expect(isEndOfMonthCustomer(null)).toBe(false);
        expect(isEndOfMonthCustomer(undefined)).toBe(false);
    });

    test("isEndOfMonthBillingActive: butuh fitur ON DAN pelanggan bertanda", () => {
        const leny = { billing_cycle: "akhir_bulan" };
        const biasa = { billing_cycle: "awal_bulan" };

        // fitur OFF (tak ada config) → semua false, walau bertanda
        global.config = {};
        expect(isEndOfMonthBillingActive(leny)).toBe(false);

        // fitur OFF eksplisit
        global.config = { billingAkhirBulan: { enabled: false } };
        expect(isEndOfMonthBillingActive(leny)).toBe(false);

        // fitur ON + cron ON (default beforeEach) → hanya pelanggan bertanda yang aktif
        global.config = { billingAkhirBulan: { enabled: true } };
        expect(isEndOfMonthBillingActive(leny)).toBe(true);
        expect(isEndOfMonthBillingActive(biasa)).toBe(false);
    });

    test("#b304 FAIL-CLOSED: fitur ON tapi cron job TAK terjadwal → eksklusi MATI (kohort jatuh-aman ke siklus standar)", () => {
        const leny = { billing_cycle: "akhir_bulan" };
        global.config = { billingAkhirBulan: { enabled: true } };

        // cron status false → tak aktif (kalau true, kohort dikecualikan TAPI tak ditagih siapa pun)
        global.cronConfig = { status_billing_akhir_bulan: false };
        expect(isEndOfMonthBillingActive(leny)).toBe(false);

        // cron config hilang total → tetap tak aktif
        global.cronConfig = undefined;
        expect(isEndOfMonthBillingActive(leny)).toBe(false);

        // keduanya ON → baru aktif
        global.cronConfig = { status_billing_akhir_bulan: true };
        expect(isEndOfMonthBillingActive(leny)).toBe(true);
    });

    test("enabled harus === true (truthy lain tak mengaktifkan — hindari aktivasi tak sengaja)", () => {
        const leny = { billing_cycle: "akhir_bulan" };
        global.config = { billingAkhirBulan: { enabled: "true" } }; // string, bukan boolean
        expect(isEndOfMonthBillingActive(leny)).toBe(false);
        global.config = { billingAkhirBulan: { enabled: 1 } };
        expect(isEndOfMonthBillingActive(leny)).toBe(false);
    });
});
