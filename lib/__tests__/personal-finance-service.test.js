/**
 * Header Doc
 * Purpose: Mengunci perilaku penerjemah nominal + parser perintah `#U` domain keuangan pribadi.
 *          Nominal adalah tempat paling gampang salah: "50.000" (titik = ribuan) dan "1,5jt"
 *          (koma = desimal) harus dibedakan, kalau tertukar catatan uang jadi ngawur 1000x.
 * Caller: Jest.
 * Deps: `lib/personal-finance-service`.
 * MainFuncs: -
 * SideEffects: Tidak ada (fungsi murni).
 */
"use strict";

const {
    parseAmount,
    inferCategory,
    parsePersonalFinanceCommand,
    formatRupiah,
    monthRange
} = require("../personal-finance-service");

describe("parseAmount — nominal gaya Indonesia", () => {
    test.each([
        ["50rb", 50000],
        ["50 rb", 50000],
        ["50k", 50000],
        ["50K", 50000],
        ["50ribu", 50000],
        ["2jt", 2000000],
        ["2juta", 2000000],
        ["50000", 50000],
        ["Rp50000", 50000],
        ["500", 500]
    ])("%s → %i", (masukan, harapan) => {
        expect(parseAmount(masukan)).toBe(harapan);
    });

    test("titik/koma TANPA satuan = pemisah ribuan", () => {
        expect(parseAmount("50.000")).toBe(50000);
        expect(parseAmount("1.500.000")).toBe(1500000);
        expect(parseAmount("50,000")).toBe(50000);
    });

    test("titik/koma DENGAN satuan = desimal", () => {
        expect(parseAmount("1,5jt")).toBe(1500000);
        expect(parseAmount("2.5jt")).toBe(2500000);
        expect(parseAmount("1,5rb")).toBe(1500);
    });

    test("masukan tak masuk akal ditolak (null), bukan 0", () => {
        for (const buruk of ["", "abc", "0", "-5rb", "rb", null, undefined, "50rb50"]) {
            expect(parseAmount(buruk)).toBeNull();
        }
    });
});

describe("inferCategory", () => {
    test("cocok per-KATA, bukan substring — 'fotokopi' bukan kategori makan", () => {
        expect(inferCategory("kopi pagi")).toBe("makan");
        expect(inferCategory("fotokopi berkas")).toBe("lain");
    });

    test("kata kunci umum terpetakan", () => {
        expect(inferCategory("bensin motor")).toBe("transport");
        expect(inferCategory("bayar listrik")).toBe("tagihan");
        expect(inferCategory("gaji bulanan")).toBe("gaji");
    });

    test("catatan kosong → lain", () => {
        expect(inferCategory("")).toBe("lain");
        expect(inferCategory(null)).toBe("lain");
    });
});

describe("parsePersonalFinanceCommand", () => {
    test("#U kosong → bantuan", () => {
        expect(parsePersonalFinanceCommand("#U").action).toBe("help");
        expect(parsePersonalFinanceCommand("  #u  ").action).toBe("help");
    });

    test("catat pengeluaran lengkap", () => {
        expect(parsePersonalFinanceCommand("#U keluar 50rb bensin")).toEqual({
            action: "add",
            kind: "out",
            amount: 50000,
            note: "bensin",
            category: "transport"
        });
    });

    test("catat pemasukan", () => {
        const r = parsePersonalFinanceCommand("#U masuk 2jt gaji");
        expect(r).toMatchObject({ action: "add", kind: "in", amount: 2000000, category: "gaji" });
    });

    test("alias jenis diterima (orang mengetik buru-buru)", () => {
        expect(parsePersonalFinanceCommand("#U k 10rb parkir").kind).toBe("out");
        expect(parsePersonalFinanceCommand("#U beli 10rb galon").kind).toBe("out");
        expect(parsePersonalFinanceCommand("#U terima 10rb").kind).toBe("in");
    });

    test("laporan harian & bulanan", () => {
        expect(parsePersonalFinanceCommand("#U lapor")).toEqual({ action: "report", scope: "day" });
        expect(parsePersonalFinanceCommand("#U hari ini")).toEqual({ action: "report", scope: "day" });
        expect(parsePersonalFinanceCommand("#U bulan")).toEqual({ action: "report", scope: "month", month: null });
        expect(parsePersonalFinanceCommand("#U bulan 2026-06")).toEqual({
            action: "report",
            scope: "month",
            month: "2026-06"
        });
    });

    test("hapus butuh id valid", () => {
        expect(parsePersonalFinanceCommand("#U hapus 12")).toEqual({ action: "delete", id: 12 });
        expect(parsePersonalFinanceCommand("#U hapus abc").action).toBe("unknown");
    });

    test("nominal tak terbaca dilaporkan sebagai alasan, bukan dicatat diam-diam", () => {
        const r = parsePersonalFinanceCommand("#U keluar banyak sekali");
        expect(r).toEqual({ action: "unknown", reason: "nominal_tidak_terbaca" });
    });

    test("jenis tak dikenal tidak pernah jadi catatan", () => {
        expect(parsePersonalFinanceCommand("#U halo 50rb").reason).toBe("jenis_tidak_dikenal");
    });
});

describe("formatRupiah & monthRange", () => {
    test("format ribuan Indonesia", () => {
        expect(formatRupiah(50000)).toBe("Rp50.000");
        expect(formatRupiah(1500000)).toBe("Rp1.500.000");
        expect(formatRupiah(0)).toBe("Rp0");
        expect(formatRupiah(-25000)).toBe("-Rp25.000");
    });

    test("rentang bulan menutup hari terakhir yang benar", () => {
        expect(monthRange("2026-02")).toEqual({ month: "2026-02", from: "2026-02-01", to: "2026-02-28" });
        expect(monthRange("2024-02")).toEqual({ month: "2024-02", from: "2024-02-01", to: "2024-02-29" });
        expect(monthRange("2026-01")).toEqual({ month: "2026-01", from: "2026-01-01", to: "2026-01-31" });
    });

    test("bulan tak valid → jatuh ke bulan berjalan", () => {
        const r = monthRange("ngawur", new Date(2026, 6, 23));
        expect(r.month).toBe("2026-07");
    });
});
