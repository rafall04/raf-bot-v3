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

    test("jendela jatuh tempo (#b308): item terlewat tetap muncul hari berikutnya, belum-tempo tidak", async () => {
        const it = await buatItem({ tanggal: 10 });
        // Belum jatuh tempo (tgl 5) → tidak muncul.
        expect(await recurring.jatuhTempoHariIni(new Date(2026, 6, 5))).toHaveLength(0);
        // Tgl 15 (sudah lewat tgl-10, belum diingatkan) → MUNCUL. Dengan '=== hariIni' lama ini
        // akan HILANG (0) — persis bug yang membuat biaya internet tak pernah diingatkan.
        expect(await recurring.jatuhTempoHariIni(new Date(2026, 6, 15))).toHaveLength(1);
        // Setelah diingatkan periode itu → berhenti (idempotensi via last_reminded_period).
        await recurring.tandaiDiingatkan(it.id, new Date(2026, 6, 15));
        expect(await recurring.jatuhTempoHariIni(new Date(2026, 6, 16))).toHaveLength(0);
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

    /**
     * Nominal gaya Indonesia. Sebelumnya `simpan()` dan `konfirmasi()` memakai `Number()` polos,
     * padahal petunjuk di halaman /kas-usaha sendiri mencontohkan "500rb" — dan jalur WhatsApp
     * memang menerimanya. Akibatnya dua aturan berbeda untuk satu konsep:
     *   - di halaman: "850rb" DITOLAK ("nominal wajib lebih dari 0") padahal formatnya dicontohkan;
     *   - lebih berbahaya: mencatat "ok 920rb" DIAM-DIAM jatuh ke perkiraan, sehingga pembukuan
     *     mencatat angka yang bukan angka yang disebut orangnya, tanpa satu pun tanda.
     */
    describe("nominal gaya Indonesia — satu penerjemah dengan jalur WhatsApp", () => {
        test("perkiraan menerima rb / jt / Rp bertitik", async () => {
            const a = await recurring.simpan({ nama: "Listrik", perkiraan: "850rb", kategori: "internet_utilities", tanggal: TGL });
            expect(a.perkiraan).toBe(850000);

            const b = await recurring.simpan({ nama: "Upstream", perkiraan: "2,5jt", kategori: "internet_utilities", tanggal: TGL });
            expect(b.perkiraan).toBe(2500000);

            const c = await recurring.simpan({ nama: "Sewa", perkiraan: "Rp1.500.000", kategori: "operasional", tanggal: TGL });
            expect(c.perkiraan).toBe(1500000);

            // Angka murni tetap jalan (kolom yang sudah tervalidasi mengirim number).
            const d = await recurring.simpan({ nama: "Lain", perkiraan: 500000, kategori: "operasional", tanggal: TGL });
            expect(d.perkiraan).toBe(500000);
        });

        test("nominal tak terbaca tetap ditolak, bukan disimpan sebagai 0/NaN", async () => {
            await expect(
                recurring.simpan({ nama: "Ngawur", perkiraan: "seratus ribu", kategori: "operasional", tanggal: TGL })
            ).rejects.toThrow(/lebih dari 0/i);
        });

        test("catat memakai nominal SEBENARNYA, bukan perkiraan", async () => {
            const it = await buatItem({ perkiraan: 850000 });
            const hasil = await recurring.konfirmasi(it.id, { nominal: "920rb" });
            expect(hasil.jumlah).toBe(920000);
            const rows = await listExpenses({ status: "active" });
            expect(rows.some((r) => Number(r.amount) === 920000)).toBe(true);
            // Perkiraan TIDAK ikut tercatat.
            expect(rows.some((r) => Number(r.amount) === 850000)).toBe(false);
        });

        test("tanpa nominal = pakai perkiraan (arti balasan `ok` polos)", async () => {
            const it = await buatItem({ perkiraan: 640000 });
            expect((await recurring.konfirmasi(it.id, {})).jumlah).toBe(640000);
        });

        test("nominal DIISI tapi tak terbaca GAGAL KERAS — jangan diam-diam pakai perkiraan", async () => {
            const it = await buatItem({ perkiraan: 500000 });
            await expect(recurring.konfirmasi(it.id, { nominal: "dua juta an" })).rejects.toThrow(/tidak terbaca/i);
            // Gagal berarti BELUM tuntas — masih bisa dicoba lagi, bukan hilang.
            expect((await recurring.cari(it.id)).last_settled_period).toBeNull();
        });

        test("penerjemahnya memang milik bersama dengan jalur WhatsApp", () => {
            const src = require("fs").readFileSync(require("path").join(__dirname, "..", "recurring-expense.js"), "utf8");
            expect(src).toMatch(/require\("\.\/personal-finance-service"\)/);
            // Tak boleh kembali ke Number() polos untuk nominal.
            expect(src).not.toMatch(/const perkiraan = Math\.round\(Number\(/);
        });
    });
});