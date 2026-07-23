/**
 * Header Doc
 * Purpose: Mengunci parser perintah `kas` dan pemetaan kategori KAS USAHA. Yang paling kritis:
 *          hasil `inferKategoriKas` WAJIB selalu salah satu dari `EXPENSE_CATEGORIES` milik
 *          `lib/expense-manager` — kategori di luar daftar itu ditolak `createExpense`, jadi
 *          tebakan yang meleset akan membuat pencatatan GAGAL, bukan sekadar salah label.
 * Caller: Jest.
 * Deps: `lib/business-expense-service`, `lib/expense-manager` (hanya daftar kategorinya).
 * MainFuncs: -
 * SideEffects: Tidak ada (fungsi murni; expense-manager tak pernah dipanggil).
 */
"use strict";

const {
    TRIGGER_KAS,
    KATEGORI_KAS,
    KATEGORI_BAWAAN,
    inferKategoriKas,
    parseBusinessExpenseCommand,
    resolveRentangKas,
    buildKasReport
} = require("../business-expense-service");
const { EXPENSE_CATEGORIES } = require("../expense-manager");

describe("inferKategoriKas — hasilnya HARUS kategori yang sah", () => {
    test("setiap kategori yang dipetakan ada di EXPENSE_CATEGORIES", () => {
        for (const kategori of Object.keys(KATEGORI_KAS)) {
            expect(EXPENSE_CATEGORIES).toContain(kategori);
        }
    });

    test("kategori bawaan juga sah", () => {
        expect(EXPENSE_CATEGORIES).toContain(KATEGORI_BAWAAN);
    });

    test("teks apa pun tetap menghasilkan kategori yang sah", () => {
        for (const t of ["kabel dropcore", "bensin survei", "token listrik", "gaji teknisi", "zzz tak dikenal", "", null]) {
            expect(EXPENSE_CATEGORIES).toContain(inferKategoriKas(t));
        }
    });

    test("pemetaan kata kunci yang penting", () => {
        expect(inferKategoriKas("kabel dropcore 100m")).toBe("maintenance");
        expect(inferKategoriKas("bensin survei")).toBe("transport");
        expect(inferKategoriKas("token listrik kantor")).toBe("internet_utilities");
        expect(inferKategoriKas("gaji teknisi juli")).toBe("gaji_payroll");
        expect(inferKategoriKas("spanduk promo")).toBe("marketing");
        expect(inferKategoriKas("hal aneh")).toBe(KATEGORI_BAWAAN);
    });
});

describe("parseBusinessExpenseCommand", () => {
    test("mencatat pengeluaran", () => {
        expect(parseBusinessExpenseCommand("kas 150rb kabel dropcore")).toEqual({
            action: "add",
            amount: 150000,
            title: "kabel dropcore",
            category: "maintenance"
        });
    });

    test("sinonim pemicu", () => {
        for (const w of TRIGGER_KAS) {
            expect(parseBusinessExpenseCommand(`${w} 50rb bensin`).action).toBe("add");
        }
    });

    test("laporan: hari ini, kemarin, minggu, bulan", () => {
        expect(parseBusinessExpenseCommand("kas")).toMatchObject({ action: "report", scope: "day", geser: 0 });
        expect(parseBusinessExpenseCommand("kas kemarin")).toMatchObject({ scope: "day", geser: -1 });
        expect(parseBusinessExpenseCommand("kas minggu")).toMatchObject({ scope: "week", geser: 0 });
        expect(parseBusinessExpenseCommand("kas minggu lalu")).toMatchObject({ scope: "week", geser: -1 });
        expect(parseBusinessExpenseCommand("kas bulan")).toMatchObject({ scope: "month" });
        expect(parseBusinessExpenseCommand("kas bulan lalu")).toMatchObject({ scope: "month", geser: -1 });
        expect(parseBusinessExpenseCommand("kas bulan 2026-06")).toMatchObject({ scope: "month", month: "2026-06" });
    });

    test("batal butuh id valid", () => {
        expect(parseBusinessExpenseCommand("kas batal 12")).toEqual({ action: "cancel", id: 12 });
        expect(parseBusinessExpenseCommand("kas batal abc").action).toBe("unknown");
    });

    // Tanpa judul, `createExpense` akan melempar "Judul pengeluaran wajib diisi" — lebih baik
    // ditolak lebih awal dengan pesan yang menuntun.
    test("nominal tanpa judul ditolak sebelum menyentuh expense-manager", () => {
        expect(parseBusinessExpenseCommand("kas 150rb")).toEqual({ action: "unknown", reason: "judul_kosong" });
    });

    test("nominal ngawur ditolak", () => {
        expect(parseBusinessExpenseCommand("kas banyak sekali").reason).toBe("nominal_tidak_terbaca");
    });

    test("bukan perintah kas → diabaikan", () => {
        expect(parseBusinessExpenseCommand("keluar 50rb bensin").reason).toBe("bukan_perintah_kas");
        expect(parseBusinessExpenseCommand("uang").reason).toBe("bukan_perintah_kas");
    });

    test("bantuan", () => {
        expect(parseBusinessExpenseCommand("kas bantuan").action).toBe("help");
    });
});

describe("buildKasReport", () => {
    const rentang = { from: "2026-07-01", to: "2026-07-31", judul: "BULAN 2026-07" };
    const rows = [
        { id: 1, amount: 150000, title: "kabel", category: "maintenance", status: "active" },
        { id: 2, amount: 50000, title: "bensin", category: "transport", status: "active" },
        { id: 3, amount: 999999, title: "salah catat", category: "operasional", status: "cancelled" }
    ];

    test("baris DIBATALKAN tidak ikut dihitung", () => {
        const r = buildKasReport(rows, rentang);
        expect(r.totalRp).toBe("Rp200.000");
        expect(r.jumlah).toBe(2);
        expect(r.daftar).not.toMatch(/salah catat/);
    });

    test("kategori diurut dari terbesar", () => {
        const r = buildKasReport(rows, rentang);
        expect(r.rincianKategori.split("\n")[0]).toMatch(/maintenance/);
    });

    test("daftar kosong tetap aman", () => {
        const r = buildKasReport([], rentang);
        expect(r.totalRp).toBe("Rp0");
        expect(r.rincianKategori).toMatch(/belum ada/);
    });
});

describe("resolveRentangKas", () => {
    test("minggu = 7 hari inklusif", () => {
        const r = resolveRentangKas({ scope: "week", geser: 0 });
        expect(Math.round((Date.parse(r.to) - Date.parse(r.from)) / 86400000)).toBe(6);
    });

    test("hari ini = rentang satu hari", () => {
        const r = resolveRentangKas({ scope: "day", geser: 0 });
        expect(r.from).toBe(r.to);
    });
});
