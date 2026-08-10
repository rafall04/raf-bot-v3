"use strict";

/**
 * Header Doc
 * Purpose: Mengunci cacat MERUSAK pada finalisasi payroll. Komisi dihitung dari entri yang BELUM
 *   terkunci; finalisasi pertama mengunci semuanya, sehingga jalan KEDUA menemukan nol lalu
 *   MENIMPA `komisi_collection` & `komisi_marketing` jadi 0. Uangnya tidak sekadar salah hitung —
 *   ia hilang dari payroll dan tak bisa dikembalikan dengan memfinalisasi lagi.
 *   Bisa dipicu tanpa niat: tombol Finalisasi dulu tanpa konfirmasi dan tanpa kunci, jadi klik
 *   ganda mengirim dua PUT sebelum tabel sempat menyembunyikan tombolnya.
 * Caller: Jest (`npx jest lib/__tests__/payroll-double-finalize.test.js`).
 * Deps: `lib/technician-finance-service`, `sqlite3` (DB di memori), fs/path (pindai UI + route).
 * MainFuncs: -
 * SideEffects: Membuat `global.db` sementara; tak menyentuh data nyata.
 */

const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const REPO = path.join(__dirname, "..", "..");
const baca = (...p) => fs.readFileSync(path.join(REPO, ...p), "utf8");

const financeService = require("../technician-finance-service");

// ID teknisi NUMERIK — sama dengan akun nyata di accounts.json (payroll menyimpannya sbg INTEGER).
const TEKNISI = 77;
const BULAN = 8;
const TAHUN = 2026;

function jalankan(sql, params = []) {
    return new Promise((res, rej) => global.db.run(sql, params, (e) => (e ? rej(e) : res())));
}

let urutan = 0;
/** Satu baris komisi penarikan. `event_key` UNIK — itulah kunci idempotensi tabelnya. */
function tambahKomisi(nominal) {
    urutan += 1;
    return jalankan(
        `INSERT INTO technician_collection_ledger
           (teknisi_id, teknisi_name, user_id, user_name, period_month, period_year,
            commission_amount, direction, reason, event_key, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'credit', 'customer_paid_final', ?, 'uji', datetime('now'))`,
        [TEKNISI, "Teknisi Uji", `pelanggan-${urutan}`, `Pelanggan ${urutan}`, BULAN, TAHUN, nominal, `uji-${Date.now()}-${urutan}`]
    );
}

describe("finalisasi payroll dua kali tidak boleh mengosongkan komisi", () => {
    beforeAll(async () => {
        global.db = new sqlite3.Database(":memory:");
        await financeService.ensureFinanceTables();
        // Komisi marketing di-stub: yang diuji di sini jalur collection + gerbang finalisasi.
        financeService.__setMarketingSourceForTest({
            getUnsettledMarketingForTeknisi: async () => ({ entries: [], net_total: 0 }),
            settleMarketingToPayroll: async () => ({ entries: [], netTotal: 0 })
        });
    });

    afterAll(() => {
        if (global.db) global.db.close();
        global.db = null;
    });

    beforeEach(async () => {
        await jalankan("DELETE FROM technician_collection_ledger");
        await jalankan("DELETE FROM technician_gaji");
    });

    async function siapkanPayrollBerkomisi() {
        await tambahKomisi(5000);
        await tambahKomisi(5000);
        return financeService.createPayrollDraft({
            teknisiId: TEKNISI,
            teknisiName: "Teknisi Uji",
            periodMonth: BULAN,
            periodYear: TAHUN,
            gajiPokok: 1500000
        });
    }

    test("finalisasi pertama mengunci komisi ke payroll", async () => {
        const draft = await siapkanPayrollBerkomisi();
        const hasil = await financeService.finalizePayroll(draft.id, { id: 1, name: "Admin" });
        expect(hasil.finalized).toBe(true);
        expect(hasil.komisiCollection).toBe(10000);

        const row = await financeService.getPayrollRecord(draft.id);
        expect(row.komisi_collection).toBe(10000);
        expect(row.net_amount).toBe(1510000);
    });

    test("finalisasi KEDUA ditolak — komisi di baris payroll tetap utuh", async () => {
        const draft = await siapkanPayrollBerkomisi();
        await financeService.finalizePayroll(draft.id, { id: 1, name: "Admin" });

        const kedua = await financeService.finalizePayroll(draft.id, { id: 1, name: "Admin" });
        expect(kedua.finalized).toBe(false);
        expect(kedua.reason).toBe("already_finalized");

        const row = await financeService.getPayrollRecord(draft.id);
        expect(row.komisi_collection).toBe(10000); // BUKAN 0
        expect(row.net_amount).toBe(1510000);
    });

    test("hitung ulang menyembuhkan diri: entri yang sudah terkunci ke payroll ini ikut dihitung", async () => {
        // Pertahanan lapis kedua. Kalaupun sebuah jalur memanggil ulang perhitungan, hasilnya
        // harus tetap 10000 — bukan 0 seperti dulu ketika filter hanya `payroll_id IS NULL`.
        const draft = await siapkanPayrollBerkomisi();
        await financeService.finalizePayroll(draft.id, { id: 1, name: "Admin" });

        const terkunci = await financeService.getCollectionPayableEntries({
            teknisiId: TEKNISI,
            periodMonth: BULAN,
            periodYear: TAHUN,
            includePayrollId: draft.id
        });
        expect(terkunci).toHaveLength(2);

        // Tanpa includePayrollId perilakunya TETAP seperti semula (dipakai draft/ringkasan).
        const belumTerkunci = await financeService.getCollectionPayableEntries({
            teknisiId: TEKNISI,
            periodMonth: BULAN,
            periodYear: TAHUN
        });
        expect(belumTerkunci).toHaveLength(0);
    });
});

describe("pemicunya ikut ditutup di HTTP dan di tombol", () => {
    test("route memulangkan 409, bukan diam-diam sukses", () => {
        const src = baca("routes", "gaji.js");
        expect(src).toContain("already_finalized");
        expect(src).toMatch(/status\(409\)/);
    });

    test("tombol Finalisasi minta konfirmasi dan terkunci selama permintaan berjalan", () => {
        const js = baca("static", "js", "gaji-teknisi.js");
        expect(js).toMatch(/finalisasiBerjalan/);
        expect(js).toMatch(/window\.confirm\(/);
        expect(js).toMatch(/prop\('disabled', true\)/);
    });
});
