/**
 * Header Doc
 * Purpose: Mengunci bahwa periode yang DIBOLOS di tengah riwayat pembayaran ikut terhitung
 *          menunggak — dan bahwa enumerasinya dibatasi bukti, tak mengarang periode.
 * Caller: Jest test runner.
 * Deps: `../arrears.service` dengan repository tiruan.
 * MainFuncs: `rekap`.
 * SideEffects: Tidak ada.
 *
 * KENAPA ADA: `buildCustomerPeriods` membangun daftar periode HANYA dari kunci `paymentMap`
 * (plus periode acuan), dan tak ada kode non-test yang membuat baris payment_history kosong
 * per periode. Jadi periode tanpa baris pembayaran tak pernah muncul — padahal justru itulah
 * yang menunggak. `unpaid_period_count` kurang dan aging bucket terlalu ringan, sehingga
 * prioritas penagihan terbalik.
 *
 * BATASNYA BUKTI: terukur di produksi 2026-08-14, `registration_date` kosong pada 59 dari 60
 * pelanggan dan `created_at` pada 56 — "sejak kapan ditagih" tak terjawab untuk hampir semua
 * orang. Enumerasi karena itu mulai dari bukti ledger paling awal, bukan dari tanggal karangan.
 */
"use strict";

const { createArrearsService } = require("../arrears.service");

function buatService({ pembayaran = [], pembalikan = [], pembebasan = [] } = {}) {
    return createArrearsService({
        repository: {
            listBillableCustomers: async () => [
                {
                    id: 101,
                    name: "Customer A",
                    phone_number: "628111",
                    subscription: "Paket 150K",
                    subscription_price: 150000,
                    status: "active",
                },
            ],
            getLedgerEntriesUpToPeriod: async () => ({
                payments: pembayaran,
                reversals: pembalikan,
                waivers: pembebasan,
            }),
        },
    });
}

const bayar = (bulan, tahun, jumlah = 150000) => ({
    user_id: 101,
    amount_paid: jumlah,
    amount_due: 150000,
    period_month: bulan,
    period_year: tahun,
});

async function rekap(opsi, acuan = { periodMonth: 8, periodYear: 2026 }) {
    const svc = buatService(opsi);
    const hasil = await svc.getArrearsReadModel(acuan);
    return hasil.rows[0] || null;
}

describe("periode yang dibolos di tengah riwayat ikut terhitung", () => {
    test("bayar Juni & Agustus, bolos Juli → Juli menunggak", async () => {
        const baris = await rekap({ pembayaran: [bayar(6, 2026), bayar(8, 2026)] });

        // Sebelum perbaikan Juli TIDAK PERNAH muncul — bukan "lunas", tapi tak terhitung.
        expect(baris.unpaid_period_count).toBe(1);
        expect(baris.total_outstanding).toBe(150000);
    });

    test("bolos dua bulan berturut-turut terhitung dua periode", async () => {
        const baris = await rekap({ pembayaran: [bayar(5, 2026), bayar(8, 2026)] });

        expect(baris.unpaid_period_count).toBe(2); // Juni + Juli
        expect(baris.total_outstanding).toBe(300000);
    });

    test("riwayat berurutan tanpa lubang tidak muncul di rekap sama sekali", async () => {
        const baris = await rekap({
            pembayaran: [bayar(6, 2026), bayar(7, 2026), bayar(8, 2026)],
        });

        // Rekap tunggakan hanya memuat yang MENUNGGAK — pelanggan lunas absen dari daftar.
        // Penting diuji: enumerasi kalender tak boleh memunculkan tunggakan palsu.
        expect(baris).toBeNull();
    });

    test("lubang yang melewati pergantian tahun tetap terhitung", async () => {
        const baris = await rekap(
            { pembayaran: [bayar(11, 2025), bayar(2, 2026)] },
            { periodMonth: 2, periodYear: 2026 }
        );

        expect(baris.unpaid_period_count).toBe(2); // Des 2025 + Jan 2026
    });
});

describe("enumerasi dibatasi bukti — tidak mengarang periode", () => {
    test("pelanggan TANPA riwayat apa pun hanya dinilai pada periode acuan", async () => {
        const baris = await rekap({ pembayaran: [] });

        // Tanpa bukti sejak kapan ditagih, memundurkan periode = menagih yang tak pernah
        // ditagihkan. registration_date/created_at kosong di hampir semua baris produksi.
        expect(baris.unpaid_period_count).toBe(1);
        expect(baris.total_outstanding).toBe(150000);
    });

    test("tidak memundurkan periode melewati bukti paling awal", async () => {
        const baris = await rekap({ pembayaran: [bayar(7, 2026)] });

        // Bukti paling awal Juli; Agustus acuan. Juni ke belakang TIDAK dienumerasi.
        expect(baris.unpaid_period_count).toBe(1); // hanya Agustus
    });
});

describe("periode acuan tetap dinilai", () => {
    test("sudah bayar sampai bulan lalu tapi belum bulan ini → menunggak 1 periode", async () => {
        const baris = await rekap({ pembayaran: [bayar(6, 2026), bayar(7, 2026)] });

        expect(baris.unpaid_period_count).toBe(1); // Agustus
    });
});

describe("jendela 24 periode berakhir di periode ACUAN, bukan di yang tertua", () => {
    test("bukti ledger 30 bulan lalu → periode BERJALAN tetap ikut terhitung", async () => {
        // Regresi nyata: loop dulu berhenti setelah 24 item dari yang TERTUA, sehingga periode
        // acuan (yang justru ditagih) tak pernah masuk daftar sama sekali.
        const baris = await rekap(
            { pembayaran: [bayar(2, 2024)] },
            { periodMonth: 8, periodYear: 2026 }
        );

        expect(baris).not.toBeNull();
        expect(baris.unpaid_period_count).toBeGreaterThan(0);
        expect(baris.unpaid_period_count).toBeLessThanOrEqual(24);
    });

    test("periode acuan SELALU ada di daftar, seberapa pun tuanya bukti awal", async () => {
        const svc = buatService({ pembayaran: [bayar(1, 2023)] });
        const hasil = await svc.getCustomerArrearsDetail({
            userId: 101,
            periodMonth: 8,
            periodYear: 2026,
        });

        const daftar = (hasil.unpaid_periods || []).map((p) => p.period);
        expect(daftar).toContain("2026-08");
    });
});
