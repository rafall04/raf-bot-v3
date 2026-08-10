"use strict";

/**
 * Header Doc
 * Purpose: Mengunci penutupan komisi historis — jalur yang menyatakan "uang ini SUDAH saya
 *   serahkan sendiri di luar sistem". Karena tak ada rupiah berpindah di sini, satu-satunya
 *   yang menjaga uang teknisi adalah invariannya, dan tiap test di bawah mengunci satu di
 *   antaranya.
 *
 *   Latar produksi (terukur 2026-08-10, raf-tanjungharjo): 271 dari 315 baris komisi DAVIN
 *   dibuat oleh `backfill-20260710` dan NOL di antaranya bertaut ke `payment_history` —
 *   artinya Rp1.355.000 itu artefak pembukuan saat fitur dinyalakan, bukan utang berjalan.
 *   44 baris sisanya (7/2026) dibuat teknisi sendiri dan SEMUANYA bertaut ke pembayaran nyata.
 * Caller: Jest (`npx jest lib/__tests__/collection-writeoff.test.js`).
 * Deps: `lib/technician-collection-settlement`, `lib/technician-finance-service`, `sqlite3`.
 * MainFuncs: -
 * SideEffects: Membuat `global.db` di memori; tak menyentuh data nyata.
 */

const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const REPO = path.join(__dirname, "..", "..");
const baca = (...p) => fs.readFileSync(path.join(REPO, ...p), "utf8");

const settlement = require("../technician-collection-settlement");
const finance = require("../technician-finance-service");

const TEKNISI = 3;
const KETERANGAN = "sudah diserahkan tunai Juli 2026, ini hasil backfill";

function jalankan(sql, params = []) {
    return new Promise((res, rej) => global.db.run(sql, params, (e) => (e ? rej(e) : res())));
}
function ambil(sql, params = []) {
    return new Promise((res, rej) => global.db.all(sql, params, (e, r) => (e ? rej(e) : res(r || []))));
}

let urutan = 0;
async function tambahKredit({ bulan, tahun, userId = "p1", nominal = 5000 }) {
    urutan += 1;
    await jalankan(
        `INSERT INTO technician_collection_ledger
           (teknisi_id, teknisi_name, user_id, user_name, period_month, period_year,
            commission_amount, direction, reason, event_key, created_by, created_at)
         VALUES (?, 'Teknisi Uji', ?, 'Pelanggan Uji', ?, ?, ?, 'credit', 'customer_paid_final', ?, 'backfill-uji', datetime('now'))`,
        [String(TEKNISI), String(userId), bulan, tahun, nominal, `k-${urutan}`]
    );
}

describe("menutup komisi yang sudah dibayar di luar sistem", () => {
    // SATU database untuk seluruh berkas: `ensureSettlementTable`/`ensureFinanceTables`
    // menyimpan promise inisialisasinya di level modul, jadi DB baru per-test tak akan
    // pernah dibuatkan tabelnya lagi. Tiap test memakai BULAN sendiri supaya tetap terisolasi.
    beforeAll(async () => {
        global.db = new sqlite3.Database(":memory:");
        await settlement.ensureSettlementTable();
        await finance.ensureFinanceTables();
    });

    afterAll(() => {
        if (global.db) global.db.close();
    });

    test("periode tertutup jadi nol bersih dan hilang dari daftar menggantung", async () => {
        await tambahKredit({ bulan: 1, tahun: 2026 });
        await tambahKredit({ bulan: 1, tahun: 2026 });

        const hasil = await settlement.writeOffCollectionPeriods({
            teknisiId: TEKNISI,
            periods: [{ month: 1, year: 2026 }],
            keterangan: KETERANGAN,
            actor: "raf"
        });

        expect(hasil.ok).toBe(true);
        expect(hasil.total).toBe(10000);
        const sisa = await finance.getUnsettledCollectionByPeriod({ teknisiId: TEKNISI });
        expect(sisa).toEqual([]);
    });

    test("baris tertutup TIDAK bisa lagi jadi kandidat payroll — pengecualian struktural", async () => {
        // Ini beda antara jaminan aritmetis ("kebetulan netnya nol") dan struktural
        // ("barisnya tak pernah terlihat"). Yang kedua tahan terhadap penambah fitur berikutnya.
        await tambahKredit({ bulan: 2, tahun: 2026 });
        await settlement.writeOffCollectionPeriods({
            teknisiId: TEKNISI,
            periods: [{ month: 2, year: 2026 }],
            keterangan: KETERANGAN,
            actor: "raf"
        });

        const kandidat = await finance.getCollectionPayableEntries({ teknisiId: TEKNISI, periodMonth: 2, periodYear: 2026 });
        expect(kandidat).toEqual([]);

        const ringkas = await finance.getCollectionPayableSummary({ teknisiId: TEKNISI, periodMonth: 2, periodYear: 2026 });
        expect(ringkas.net_total).toBe(0);
    });

    test("klik ganda tidak menghasilkan debit kedua", async () => {
        await tambahKredit({ bulan: 3, tahun: 2026 });

        const pertama = await settlement.writeOffCollectionPeriods({
            teknisiId: TEKNISI, periods: [{ month: 3, year: 2026 }], keterangan: KETERANGAN, actor: "raf"
        });
        const kedua = await settlement.writeOffCollectionPeriods({
            teknisiId: TEKNISI, periods: [{ month: 3, year: 2026 }], keterangan: KETERANGAN, actor: "raf"
        });

        expect(pertama.total).toBe(5000);
        expect(kedua.total).toBe(0);
        expect(kedua.dilewati.map((d) => d.alasan)).toContain("tidak_ada_baris_terbuka");

        const debit = await ambil("SELECT COUNT(*) n FROM technician_collection_ledger WHERE direction = 'debit' AND period_month = 3");
        expect(debit[0].n).toBe(1);
    });

    test("komisi yang SUDAH terkunci payroll tak ikut ditutup", async () => {
        // Uang yang sedang dibayarkan lewat payroll bukan urusan tombol ini.
        await tambahKredit({ bulan: 4, tahun: 2026 });
        await jalankan("UPDATE technician_collection_ledger SET payroll_id = 99 WHERE period_month = 4");

        const hasil = await settlement.writeOffCollectionPeriods({
            teknisiId: TEKNISI, periods: [{ month: 4, year: 2026 }], keterangan: KETERANGAN, actor: "raf"
        });
        expect(hasil.total).toBe(0);
        const debit = await ambil("SELECT COUNT(*) n FROM technician_collection_ledger WHERE direction = 'debit' AND period_month = 4");
        expect(debit[0].n).toBe(0);
    });

    test("debit penyeimbang mendarat di PERIODE ASLI, bukan bulan berjalan", async () => {
        // Kalau mendarat di bulan berjalan, laporan bulan ini mendadak kelihatan seperti
        // pengeluaran padahal tak ada rupiah keluar hari ini.
        await tambahKredit({ bulan: 5, tahun: 2026 });
        await settlement.writeOffCollectionPeriods({
            teknisiId: TEKNISI, periods: [{ month: 5, year: 2026 }], keterangan: KETERANGAN, actor: "raf"
        });
        const debit = await ambil("SELECT period_month, period_year FROM technician_collection_ledger WHERE direction = 'debit' AND period_month = 5");
        expect(debit).toHaveLength(1);
        expect(debit[0].period_month).toBe(5);
        expect(debit[0].period_year).toBe(2026);
    });

    test("nominal yang berubah sejak layar dimuat DITOLAK, bukan ditutup diam-diam", async () => {
        await tambahKredit({ bulan: 6, tahun: 2026 });
        await tambahKredit({ bulan: 6, tahun: 2026 }); // total 10.000, layar operator bilang 5.000

        const hasil = await settlement.writeOffCollectionPeriods({
            teknisiId: TEKNISI, periods: [{ month: 6, year: 2026 }], keterangan: KETERANGAN, actor: "raf", expectedTotal: 5000
        });
        expect(hasil.ok).toBe(false);
        expect(hasil.reason).toBe("nominal_berubah");
        expect(hasil.totalSekarang).toBe(10000);

        const debit = await ambil("SELECT COUNT(*) n FROM technician_collection_ledger WHERE direction = 'debit' AND period_month = 6");
        expect(debit[0].n).toBe(0);
    });

    test("keterangan kosong / terlalu pendek ditolak — jejaknya wajib", async () => {
        await tambahKredit({ bulan: 7, tahun: 2026 });
        for (const buruk of ["", "   ", "sudah"]) {
            const hasil = await settlement.writeOffCollectionPeriods({
                teknisiId: TEKNISI, periods: [{ month: 7, year: 2026 }], keterangan: buruk, actor: "raf"
            });
            expect(hasil.ok).toBe(false);
            expect(hasil.reason).toBe("keterangan_wajib");
        }
    });

    test("penutupan menyimpan siapa, kapan, dan alasannya di barisnya sendiri", async () => {
        await tambahKredit({ bulan: 8, tahun: 2026 });
        await settlement.writeOffCollectionPeriods({
            teknisiId: TEKNISI, periods: [{ month: 8, year: 2026 }], keterangan: KETERANGAN, actor: "raf"
        });
        const rows = await ambil("SELECT closed_out_at, closed_out_by, closed_out_note FROM technician_collection_ledger WHERE period_month = 8");
        expect(rows.every((r) => r.closed_out_at && r.closed_out_by === "raf" && r.closed_out_note === KETERANGAN)).toBe(true);

        const riwayat = (await settlement.getCloseoutHistory({ teknisiId: TEKNISI })).filter((r) => r.period_month === 8);
        expect(riwayat).toHaveLength(1);
        expect(Number(riwayat[0].total)).toBe(5000);
        expect(riwayat[0].closed_out_note).toBe(KETERANGAN);
    });

    test("pembayaran ULANG periode yang sudah ditutup tidak mengkredit lagi", async () => {
        // Lubang paling halus: debit penutupan membuat net jadi nol, dan `evaluateCollectionSettlement`
        // memakai net > 0 sebagai jawaban "sudah pernah dikredit". Kalau debit penutupan ikut
        // dihitung, satu pembayaran ulang menghidupkan kembali komisi yang sudah diserahkan.
        await tambahKredit({ bulan: 9, tahun: 2026, userId: "p9" });
        await settlement.writeOffCollectionPeriods({
            teknisiId: TEKNISI, periods: [{ month: 9, year: 2026 }], keterangan: KETERANGAN, actor: "raf"
        });

        global.config = { teknisiCollectionCommissionEnabled: true, teknisiCollectionCommissionAmount: 5000 };
        global.accounts = [{ id: TEKNISI, name: "Teknisi Uji" }];

        const hasil = await settlement.evaluateCollectionSettlement({
            user: { id: "p9", name: "Pelanggan Uji" },
            paid: true,
            periodMonth: 9,
            periodYear: 2026,
            teknisiId: TEKNISI
        });

        expect(hasil.applied).toBe(false);
        expect(hasil.reason).toBe("already_credited");
        const kredit = await ambil("SELECT COUNT(*) n FROM technician_collection_ledger WHERE direction = 'credit' AND period_month = 9");
        expect(kredit[0].n).toBe(1);
    });

    test("periode bernet nol/negatif dilewati, bukan dikarang debitnya", async () => {
        await tambahKredit({ bulan: 10, tahun: 2026, userId: "p10" });
        await jalankan(
            `INSERT INTO technician_collection_ledger
               (teknisi_id, teknisi_name, user_id, user_name, period_month, period_year,
                commission_amount, direction, reason, event_key, created_by, created_at)
             VALUES (?, 'Teknisi Uji', 'p10', 'Pelanggan Uji', 10, 2026, 5000, 'debit', 'customer_reverted_unpaid', 'batal-1', 'uji', datetime('now'))`,
            [String(TEKNISI)]
        );

        const hasil = await settlement.writeOffCollectionPeriods({
            teknisiId: TEKNISI, periods: [{ month: 10, year: 2026 }], keterangan: KETERANGAN, actor: "raf"
        });
        expect(hasil.total).toBe(0);
        expect(hasil.dilewati.map((d) => d.alasan)).toContain("net_nol_atau_negatif");
    });

    test("teknisi LAIN tak ikut tertutup", async () => {
        await tambahKredit({ bulan: 11, tahun: 2026 });
        await jalankan(
            `INSERT INTO technician_collection_ledger
               (teknisi_id, teknisi_name, user_id, user_name, period_month, period_year,
                commission_amount, direction, reason, event_key, created_by, created_at)
             VALUES ('999', 'Teknisi Lain', 'p2', 'Pelanggan', 11, 2026, 5000, 'credit', 'customer_paid_final', 'lain-1', 'uji', datetime('now'))`
        );

        await settlement.writeOffCollectionPeriods({
            teknisiId: TEKNISI, periods: [{ month: 11, year: 2026 }], keterangan: KETERANGAN, actor: "raf"
        });

        const lain = await finance.getUnsettledCollectionByPeriod({ teknisiId: 999 });
        expect(lain).toHaveLength(1);
        expect(Number(lain[0].net_total)).toBe(5000);
    });
});

describe("jalur HTTP dan halaman", () => {
    const route = baca("routes", "gaji.js");
    const js = baca("static", "js", "gaji-teknisi.js");
    const php = baca("views", "sb-admin", "gaji-teknisi.php");

    test("endpoint tutup TERPISAH dari pembuatan payroll", () => {
        // Dua arah uang yang berlawanan tak boleh dibedakan oleh sebuah boolean di body.
        expect(route).toMatch(/komisi-tertunda\/tutup/);
        expect(route).toMatch(/writeOffCollectionPeriods/);
    });

    test("route menolak keterangan pendek dan meneruskan expected_total", () => {
        expect(route).toMatch(/keterangan\.length < 10/);
        expect(route).toMatch(/expected_total/);
        expect(route).toMatch(/409/);
    });

    test("activity log menyimpan entry_ids — tanpa itu pembatalan berarti menebak", () => {
        expect(route).toMatch(/entry_ids/);
    });

    test("tombol berada DI LUAR form buat-draft dan bertipe button", () => {
        // Tombol submit di dalam form bisa terpicu tombol Enter di kolom teks.
        const posisiTombol = php.indexOf('id="btnTutupKomisi"');
        const posisiForm = php.indexOf('<form id="createGajiForm">');
        expect(posisiTombol).toBeGreaterThan(-1);
        expect(posisiTombol).toBeLessThan(posisiForm);
        expect(php).toMatch(/<button type="button"[^>]*id="btnTutupKomisi"/);
    });

    test("konfirmasi menyatakan bahwa bot TIDAK membayar", () => {
        expect(js).toMatch(/TIDAK akan mentransfer/);
        expect(js).toMatch(/TIDAK mengirim struk/);
    });

    test("peringatan komisi ikut dibersihkan saat form direset", () => {
        const reset = js.slice(js.indexOf("function resetCreateForm"), js.indexOf("function resetCreateForm") + 900);
        expect(reset).toMatch(/#komisiTertundaInfo/);
    });

    test("riwayat penutupan punya endpoint dan tabelnya", () => {
        expect(route).toMatch(/komisi-tertunda\/riwayat/);
        expect(php).toMatch(/id="tabelRiwayatTutup"/);
    });
});
