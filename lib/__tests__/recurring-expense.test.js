/**
 * Header Doc
 * Purpose: Mengunci biaya rutin usaha. Dua sifat yang paling mahal kalau salah:
 *          (1) IDEMPOTEN per periode — prod restart 7-13x/hari, dan pengingat/posting ganda
 *              berarti pembukuan menghitung tagihan yang sama dua kali;
 *          (2) konfirmasi membuat pengeluaran lewat `expense-manager`, BUKAN penyimpanan
 *              sendiri, sehingga angkanya satu sumber dengan /pengeluaran & /rekap-keuangan.
 * Caller: Jest.
 * Deps: `lib/recurring-expense`, `lib/expense-manager`, `sqlite3` (DB sementara di memori).
 * SideEffects: Membuat `global.db` sementara; tidak menyentuh data nyata.
 */
"use strict";

const sqlite3 = require("sqlite3").verbose();
const recurring = require("../recurring-expense");
const { listExpenses } = require("../expense-manager");

const HARI_INI = new Date();
const TGL = HARI_INI.getDate();
const PERIODE = recurring.periodeSekarang(HARI_INI);

async function buatItem(lebih = {}) {
    return recurring.simpan({
        nama: "Listrik Dander",
        perkiraan: 500000,
        kategori: "internet_utilities",
        tanggal: TGL,
        metode: "TRANSFER",
        ...lebih
    });
}

describe("biaya rutin", () => {
    // SATU DB untuk seluruh berkas, isinya dikosongkan tiap test. Mengganti `global.db`
    // per-test TIDAK bisa: `recurring` dan `expense-manager` memoize "tabel sudah dibuat"
    // di module scope, jadi DB baru dianggap sudah bertabel padahal kosong melompong —
    // dan tesnya gagal hanya saat dijalankan berbarengan.
    beforeAll(async () => {
        global.db = new sqlite3.Database(":memory:");
        await recurring.ensureTable();
        await require("../expense-manager").ensureExpenseTables();
    });

    afterAll(() => {
        if (global.db) global.db.close();
        global.db = null;
    });

    beforeEach(async () => {
        const kosongkan = (tabel) =>
            new Promise((res, rej) => global.db.run(`DELETE FROM ${tabel}`, (e) => (e ? rej(e) : res())));
        await kosongkan("recurring_expenses");
        await kosongkan("expense_entries");
    });

    test("simpan lalu baca", async () => {
        const it = await buatItem();
        expect(it.nama).toBe("Listrik Dander");
        expect((await recurring.listAll())).toHaveLength(1);
    });

    test("tolak masukan tak masuk akal", async () => {
        await expect(buatItem({ nama: "" })).rejects.toThrow(/nama/i);
        await expect(buatItem({ perkiraan: 0 })).rejects.toThrow(/nominal/i);
        await expect(buatItem({ tanggal: 32 })).rejects.toThrow(/1-31/);
        // Kategori di luar daftar resmi akan DITOLAK createExpense saat dikonfirmasi —
        // lebih baik ditolak sejak disimpan.
        await expect(buatItem({ kategori: "ngawur" })).rejects.toThrow(/kategori/i);
    });

    test("jatuh tempo hari ini muncul, dan HILANG setelah diingatkan", async () => {
        const it = await buatItem();
        expect(await recurring.jatuhTempoHariIni()).toHaveLength(1);

        await recurring.tandaiDiingatkan(it.id);
        // Idempotensi: siklus cron berikutnya (atau setelah restart) tak mengingatkan lagi.
        expect(await recurring.jatuhTempoHariIni()).toHaveLength(0);
        expect(await recurring.tertunda()).toHaveLength(1);
    });

    test("item nonaktif tak pernah jatuh tempo", async () => {
        await buatItem({ aktif: false });
        expect(await recurring.jatuhTempoHariIni()).toHaveLength(0);
    });

    test("konfirmasi membuat pengeluaran SUNGGUHAN di expense_entries", async () => {
        const it = await buatItem();
        await recurring.tandaiDiingatkan(it.id);

        const hasil = await recurring.konfirmasi(it.id, { actor: "Uji" });
        expect(hasil.jumlah).toBe(500000);

        const rows = await listExpenses({ status: "active" });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ title: "Listrik Dander", category: "internet_utilities", amount: 500000 });
    });

    test("nominal boleh beda dari perkiraan — justru itu alasan konfirmasi ada", async () => {
        const it = await buatItem();
        await recurring.tandaiDiingatkan(it.id);

        const hasil = await recurring.konfirmasi(it.id, { nominal: 620000 });
        expect(hasil.jumlah).toBe(620000);
        expect((await listExpenses({ status: "active" }))[0].amount).toBe(620000);
    });

    test("konfirmasi dua kali dalam periode yang sama DITOLAK", async () => {
        const it = await buatItem();
        await recurring.tandaiDiingatkan(it.id);
        await recurring.konfirmasi(it.id);

        await expect(recurring.konfirmasi(it.id)).rejects.toThrow(/sudah dituntaskan/i);
        // Yang terpenting: tak ada entri kedua di pembukuan.
        expect(await listExpenses({ status: "active" })).toHaveLength(1);
    });

    test("lewati menuntaskan periode TANPA membuat pengeluaran", async () => {
        const it = await buatItem();
        await recurring.tandaiDiingatkan(it.id);
        await recurring.lewati(it.id);

        expect(await listExpenses({ status: "active" })).toHaveLength(0);
        expect(await recurring.tertunda()).toHaveLength(0);
        expect((await recurring.cari(it.id)).last_action).toBe("dilewati");
    });

    test("tanggal 31 pada bulan pendek jatuh ke hari terakhir", async () => {
        await buatItem({ tanggal: 31 });
        // 28 Feb 2026 = hari terakhir Februari → tagihan tgl 31 harus muncul di sana,
        // kalau tidak ia tak pernah tertagih pada bulan-bulan pendek.
        const feb = new Date(2026, 1, 28);
        expect(await recurring.jatuhTempoHariIni(feb)).toHaveLength(1);
        // 27 Feb belum.
        expect(await recurring.jatuhTempoHariIni(new Date(2026, 1, 27))).toHaveLength(0);
    });

    test("periode dihitung sebagai YYYY-MM", () => {
        expect(recurring.periodeSekarang(new Date(2026, 6, 23))).toBe("2026-07");
        expect(recurring.periodeSekarang(new Date(2026, 0, 1))).toBe("2026-01");
    });

    test("hapus definisi", async () => {
        const it = await buatItem();
        expect(await recurring.hapus(it.id)).toEqual({ dihapus: true });
        expect(await recurring.listAll()).toHaveLength(0);
    });

    test("PERIODE, bukan timestamp, yang menjaga idempotensi", async () => {
        const it = await buatItem();
        await recurring.tandaiDiingatkan(it.id);
        expect((await recurring.cari(it.id)).last_reminded_period).toBe(PERIODE);
    });
});
