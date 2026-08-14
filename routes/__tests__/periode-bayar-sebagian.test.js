/**
 * Header Doc
 * Purpose: Mengunci bahwa pembayaran sebagian tercatat ke periode yang DIPILIH admin, bukan
 *          selalu bulan berjalan — dan bahwa periode tak masuk akal ditolak.
 * Caller: Jest test runner.
 * Deps: `../partial-payment` (`resolvePeriodeDiminta`).
 * MainFuncs: —
 * SideEffects: Tidak ada — predikat murni.
 *
 * KENAPA ADA: `routes/partial-payment.js` men-hardcode `new Date()` untuk periode, sementara
 * halaman Status Pembayaran punya pemilih periode yang tak pernah dikirim. Admin memilih Juli,
 * memasukkan Rp75.000 tunai untuk tagihan Juli, server menulisnya ke Agustus: Juli tetap
 * menunggak di ledger & rekap tunggakan, Agustus jadi setengah terbayar, dan struk ke
 * pelanggan menyebut periode yang salah — tanpa jejak koreksi.
 */
"use strict";

const { resolvePeriodeDiminta } = require("../partial-payment");

const sekarang = new Date();
const BULAN_KINI = sekarang.getMonth() + 1;
const TAHUN_KINI = sekarang.getFullYear();

describe("periode dari klien dipakai apa adanya", () => {
    test("period_month/period_year snake_case dihormati", () => {
        expect(resolvePeriodeDiminta({ period_month: 7, period_year: 2026 })).toEqual({
            periodMonth: 7,
            periodYear: 2026,
        });
    });

    test("camelCase juga diterima", () => {
        expect(resolvePeriodeDiminta({ periodMonth: 3, periodYear: 2025 })).toEqual({
            periodMonth: 3,
            periodYear: 2025,
        });
    });

    test("string angka dari form tetap terbaca", () => {
        expect(resolvePeriodeDiminta({ period_month: "7", period_year: "2026" })).toEqual({
            periodMonth: 7,
            periodYear: 2026,
        });
    });
});

describe("tanpa periode → bulan berjalan (alur teknisi di lapangan)", () => {
    test.each([{}, { period_month: null }, { period_month: "" }, { period_month: undefined }])(
        "payload %p jatuh ke periode berjalan",
        (payload) => {
            expect(resolvePeriodeDiminta(payload)).toEqual({
                periodMonth: BULAN_KINI,
                periodYear: TAHUN_KINI,
            });
        }
    );

    test("halaman teknisi memang tak punya pemilih periode — default ini disengaja", () => {
        // Menolak 400 saat periode tak dikirim akan mematahkan penagihan lapangan.
        expect(resolvePeriodeDiminta({}).periodMonth).toBe(BULAN_KINI);
    });
});

describe("periode tak masuk akal ditolak, bukan dibulatkan diam-diam", () => {
    test.each([0, 13, -1, "abc"])("bulan %p ditolak", (bulan) => {
        const hasil = resolvePeriodeDiminta({ period_month: bulan, period_year: TAHUN_KINI });
        expect(hasil.error).toMatch(/period_month/i);
    });

    test.each([1999, 1, "xyz"])("tahun %p ditolak", (tahun) => {
        const hasil = resolvePeriodeDiminta({ period_month: 5, period_year: tahun });
        expect(hasil.error).toMatch(/period_year/i);
    });

    test("periode di MASA DEPAN ditolak", () => {
        const hasil = resolvePeriodeDiminta({
            period_month: 12,
            period_year: TAHUN_KINI + 1,
        });

        // Salah ketik tahun akan menyembunyikan pembayaran di periode yang tak pernah ditagih.
        expect(hasil.error).toMatch(/masa depan|period_year/i);
    });

    test("periode LAMPAU tetap boleh — justru itu tujuan perbaikannya", () => {
        expect(resolvePeriodeDiminta({ period_month: 1, period_year: 2024 })).toEqual({
            periodMonth: 1,
            periodYear: 2024,
        });
    });
});

describe("frontend benar-benar mengirim periodenya", () => {
    const fs = require("fs");
    const path = require("path");
    const baca = (...p) => fs.readFileSync(path.join(__dirname, "..", "..", ...p), "utf8");

    test("payment-status.js mengirim periode yang sedang dipilih", () => {
        const src = baca("static", "js", "payment-status.js");
        const blok = src.slice(src.indexOf("/api/partial-payment/request"));

        expect(blok.slice(0, 900)).toMatch(/period_month:\s*periodeDipilih\.periodMonth/);
        expect(blok.slice(0, 900)).toMatch(/period_year:\s*periodeDipilih\.periodYear/);
    });

    test("teknisi-pembayaran.js mengirim periode berjalan secara eksplisit", () => {
        const src = baca("static", "js", "teknisi-pembayaran.js");
        const blok = src.slice(src.indexOf("/api/partial-payment/request"));

        expect(blok.slice(0, 900)).toMatch(/period_month:/);
        expect(blok.slice(0, 900)).toMatch(/period_year:/);
    });
});
