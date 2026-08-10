"use strict";

/**
 * Header Doc
 * Purpose: Mengunci DUA cacat yang membuat angka gaji salah — keduanya ditemukan lewat audit
 *   adversarial siklus gaji 2026-08-10 dan keduanya terbukti dengan reproduksi, bukan pembacaan.
 *
 *   (1) STRUK MENGGANDAKAN BONUS. `bonus` dan `bonus_manual` SELALU berisi nilai yang sama —
 *       formatter menyetel keduanya dari `bonus_manual || bonus`, dan tiap jalur tulis mengisi
 *       keduanya sekaligus. Struk menjumlahkannya, jadi teknisi membaca bonus dua kali lipat
 *       dan rinciannya tak menjumlah ke gaji bersih di bawahnya. Uang yang ditransfer benar;
 *       yang salah justru satu-satunya dokumen yang dibaca teknisi.
 *
 *   (2) HUTANG KASBON BISA TERPOTONG DUA KALI. Cicilan baru ditulis saat payroll DIBAYAR, jadi
 *       dua payroll yang menggantung bersamaan sama-sama melihat sisa hutang PENUH dan
 *       sama-sama lolos. Teknisi kehilangan uangnya dua kali sementara hutangnya berkurang
 *       sekali — tanpa satu pun peringatan.
 * Caller: Jest (`npx jest lib/__tests__/payroll-uang-benar.test.js`).
 * Deps: `lib/technician-finance-service`, `lib/services/payroll-receipt`, `sqlite3`.
 * MainFuncs: -
 * SideEffects: `global.db` di memori; tak menyentuh data nyata.
 */

const sqlite3 = require("sqlite3").verbose();

const finance = require("../technician-finance-service");
const { buildPayrollReceiptText } = require("../services/payroll-receipt");

const TEKNISI = 7;

function jalankan(sql, params = []) {
    return new Promise((res, rej) => global.db.run(sql, params, (e) => (e ? rej(e) : res())));
}
function ambil(sql, params = []) {
    return new Promise((res, rej) => global.db.all(sql, params, (e, r) => (e ? rej(e) : res(r || []))));
}

describe("struk yang dibaca teknisi harus menjumlah ke gaji bersihnya", () => {
    beforeAll(async () => {
        global.db = new sqlite3.Database(":memory:");
        global.accounts = [{ id: TEKNISI, name: "Teknisi Uji", role: "teknisi" }];
        await finance.ensureFinanceTables();
        finance.__setMarketingSourceForTest?.({
            getUnsettledMarketingForTeknisi: async () => ({ entries: [], net_total: 0 }),
            settleMarketingToPayroll: async () => ({ entries: [], netTotal: 0 })
        });
    });

    test("bonus dicetak SEKALI, bukan dua kali", () => {
        // Bentuk baris yang BENAR-BENAR dihasilkan produksi: kedua kolom berisi nilai sama.
        const teks = buildPayrollReceiptText({
            id: 1,
            teknisi_name: "Teknisi Uji",
            period_month: 8,
            period_year: 2026,
            gaji_pokok: 600000,
            bonus: 100000,
            bonus_manual: 100000,
            komisi_collection: 0,
            komisi_marketing: 0,
            potongan_kasbon: 0,
            potongan_lain: 0,
            total_potongan: 0,
            net_amount: 700000
        });
        expect(teks).toContain("100.000");
        expect(teks).not.toContain("200.000");
    });

    test("rincian pendapatan dikurangi potongan HARUS sama dengan gaji bersih", () => {
        // Invarian yang sebenarnya. Tanpa ini, tiap komponen bisa salah sendiri-sendiri dan
        // saling menutupi sampai aritmetikanya tampak masuk akal.
        const row = {
            id: 2,
            teknisi_name: "Teknisi Uji",
            period_month: 8,
            period_year: 2026,
            gaji_pokok: 600000,
            bonus: 100000,
            bonus_manual: 100000,
            komisi_collection: 225000,
            komisi_marketing: 50000,
            potongan_kasbon: 75000,
            potongan_lain: 0,
            total_potongan: 75000,
            net_amount: 900000
        };
        const teks = buildPayrollReceiptText(row);

        const pendapatan = row.gaji_pokok + row.bonus_manual + row.komisi_collection + row.komisi_marketing;
        expect(pendapatan - row.total_potongan).toBe(row.net_amount);
        // Tiap komponen pendapatan harus benar-benar TERCETAK, kalau tidak teknisi melihat
        // rincian yang lebih kecil daripada gaji bersihnya tanpa penjelasan.
        for (const n of ["600.000", "100.000", "225.000", "50.000"]) {
            expect(teks).toContain(n);
        }
        // Dan bonus tak boleh muncul berlipat.
        expect(teks).not.toContain("200.000");
    });

    test("komisi marketing ikut tercetak", () => {
        const teks = buildPayrollReceiptText({
            id: 3, teknisi_name: "T", period_month: 8, period_year: 2026,
            gaji_pokok: 0, bonus: 0, bonus_manual: 0, komisi_collection: 0,
            komisi_marketing: 50000, potongan_kasbon: 0, potongan_lain: 0,
            total_potongan: 0, net_amount: 50000
        });
        expect(teks).toMatch(/marketing/i);
    });
});

describe("hutang kasbon tak boleh terpotong dua kali", () => {
    // Memakai DB yang SAMA dengan describe di atas: `ensureFinanceTables` menyimpan promise
    // inisialisasinya di level modul, jadi database baru tak akan pernah dibuatkan tabel lagi.
    beforeEach(async () => {
        await jalankan("DELETE FROM technician_gaji");
        await jalankan("DELETE FROM technician_kasbon");
        await jalankan("DELETE FROM technician_kasbon_ledger");
        await jalankan(
            `INSERT INTO technician_kasbon (id, teknisi_id, teknisi_name, amount, description, status, created_at)
             VALUES (1, ?, 'Teknisi Uji', 250000, 'kasbon uji', 'approved', datetime('now'))`,
            [TEKNISI]
        );
    });

    test("payroll KEDUA tak bisa memotong hutang yang sudah dipesan payroll pertama", async () => {
        const juli = await finance.createPayrollDraft({
            teknisiId: TEKNISI, periodMonth: 7, periodYear: 2026,
            gajiPokok: 600000, bonusManual: 0, potonganKasbon: 250000, potonganLain: 0
        }, { name: "uji" });
        expect(juli.created).toBe(true);

        const agustus = await finance.createPayrollDraft({
            teknisiId: TEKNISI, periodMonth: 8, periodYear: 2026,
            gajiPokok: 600000, bonusManual: 0, potonganKasbon: 250000, potonganLain: 0
        }, { name: "uji" });

        const rows = await ambil("SELECT period_month, potongan_kasbon, net_amount FROM technician_gaji ORDER BY period_month");
        expect(rows[0].potongan_kasbon).toBe(250000); // Juli memesan lebih dulu
        expect(rows[1].potongan_kasbon).toBe(0);      // Agustus tak menemukan sisa
        expect(rows[1].net_amount).toBe(600000);      // dan gaji Agustus TIDAK terpotong
        expect(agustus.created).toBe(true);
    });

    test("mengedit draft-nya sendiri tidak menghitung dirinya sebagai pesanan", async () => {
        const juli = await finance.createPayrollDraft({
            teknisiId: TEKNISI, periodMonth: 7, periodYear: 2026,
            gajiPokok: 600000, bonusManual: 0, potonganKasbon: 250000, potonganLain: 0
        }, { name: "uji" });

        const r = await finance.updatePayrollDraft(juli.id, {
            gaji_pokok: 600000, bonus_manual: 0, potongan_kasbon: 250000, potongan_lain: 0, notes: ""
        });
        expect(r.updated).toBe(true);
        const rows = await ambil("SELECT potongan_kasbon FROM technician_gaji WHERE id = ?", [juli.id]);
        expect(rows[0].potongan_kasbon).toBe(250000);
    });

    test("finalisasi tidak mengosongkan potongan miliknya sendiri", async () => {
        const juli = await finance.createPayrollDraft({
            teknisiId: TEKNISI, periodMonth: 7, periodYear: 2026,
            gajiPokok: 600000, bonusManual: 0, potonganKasbon: 250000, potonganLain: 0
        }, { name: "uji" });

        const hasil = await finance.finalizePayroll(juli.id, { name: "uji" });
        expect(hasil.finalized).toBe(true);
        const rows = await ambil("SELECT potongan_kasbon, net_amount FROM technician_gaji WHERE id = ?", [juli.id]);
        expect(rows[0].potongan_kasbon).toBe(250000);
        expect(rows[0].net_amount).toBe(350000);
    });

    test("payroll yang sudah DIBAYAR tak lagi memesan hutang", async () => {
        // Setelah dibayar, cicilannya sudah tercatat — sisa hutang di DB sudah benar sendiri.
        const juli = await finance.createPayrollDraft({
            teknisiId: TEKNISI, periodMonth: 7, periodYear: 2026,
            gajiPokok: 600000, bonusManual: 0, potonganKasbon: 100000, potonganLain: 0
        }, { name: "uji" });
        await finance.finalizePayroll(juli.id, { name: "uji" });
        await jalankan("UPDATE technician_gaji SET status = 'paid' WHERE id = ?", [juli.id]);

        const agustus = await finance.createPayrollDraft({
            teknisiId: TEKNISI, periodMonth: 8, periodYear: 2026,
            gajiPokok: 600000, bonusManual: 0, potonganKasbon: 250000, potonganLain: 0
        }, { name: "uji" });
        const rows = await ambil("SELECT potongan_kasbon FROM technician_gaji WHERE id = ?", [agustus.id]);
        expect(rows[0].potongan_kasbon).toBe(250000);
    });
});
