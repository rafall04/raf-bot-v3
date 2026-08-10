"use strict";

/**
 * Header Doc
 * Purpose: Mengunci cacat DIAM di halaman Gaji Teknisi: komisi penarikan yang periodenya
 *   tak pernah dibuatkan payroll menjadi TIDAK TERLIHAT di mana pun. Ringkasan kasbon hanya
 *   melaporkan komisi periode yang sedang dibuka, jadi operator yang setiap bulan membuka
 *   bulan berjalan tak punya cara tahu ada utang komisi bulan-bulan sebelumnya.
 *
 *   Terukur di produksi 2026-08-10 (raf-tanjungharjo, read-only): komisi belum terkunci
 *   tersebar Jan–Jul 2026 senilai Rp1.575.000, sedangkan payroll yang pernah dibuat hanya
 *   7/2026 → Rp1.355.000 tak pernah muncul di layar mana pun. Uangnya tidak hilang dari
 *   ledger — ia hilang dari pandangan, dan itu cukup untuk tak pernah dibayarkan.
 * Caller: Jest (`npx jest lib/__tests__/payroll-stranded-commission.test.js`).
 * Deps: `lib/technician-finance-service`, `sqlite3` (DB di memori), fs/path (pindai route + UI).
 * MainFuncs: -
 * SideEffects: Membuat `global.db` sementara; tak menyentuh data nyata.
 */

const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const REPO = path.join(__dirname, "..", "..");
const baca = (...p) => fs.readFileSync(path.join(REPO, ...p), "utf8");

const financeService = require("../technician-finance-service");

const TEKNISI = 3;

function jalankan(sql, params = []) {
    return new Promise((res, rej) => global.db.run(sql, params, (e) => (e ? rej(e) : res())));
}

let urutan = 0;
function tambahKomisi({ bulan, tahun, nominal, arah = "credit" }) {
    urutan += 1;
    return jalankan(
        `INSERT INTO technician_collection_ledger
           (teknisi_id, teknisi_name, user_id, user_name, period_month, period_year,
            commission_amount, direction, reason, event_key, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'customer_paid_final', ?, 'uji', datetime('now'))`,
        [TEKNISI, "Teknisi Uji", `pel-${urutan}`, `Pelanggan ${urutan}`, bulan, tahun, nominal, arah, `nyangkut-${urutan}`]
    );
}

describe("komisi periode lain yang belum pernah masuk payroll harus terbaca", () => {
    beforeAll(async () => {
        global.db = new sqlite3.Database(":memory:");
        await financeService.ensureFinanceTables();
    });

    afterAll(() => {
        if (global.db) global.db.close();
    });

    test("mengelompokkan komisi belum-terkunci per periode, terurut waktu", async () => {
        // Bentuk produksi: komisi tiap bulan, payroll cuma pernah dibuat untuk bulan terakhir.
        await tambahKomisi({ bulan: 5, tahun: 2026, nominal: 215000 });
        await tambahKomisi({ bulan: 6, tahun: 2026, nominal: 205000 });
        await tambahKomisi({ bulan: 7, tahun: 2026, nominal: 220000 });

        const per = await financeService.getUnsettledCollectionByPeriod({ teknisiId: TEKNISI });

        expect(per.map((r) => `${r.period_month}/${r.period_year}`)).toEqual(["5/2026", "6/2026", "7/2026"]);
        expect(per.map((r) => Number(r.net_total))).toEqual([215000, 205000, 220000]);
        expect(per.every((r) => Number(r.entries) === 1)).toBe(true);
    });

    test("pembatalan (debit) mengurangi, bukan menambah", async () => {
        await tambahKomisi({ bulan: 4, tahun: 2026, nominal: 100000 });
        await tambahKomisi({ bulan: 4, tahun: 2026, nominal: 30000, arah: "debit" });

        const per = await financeService.getUnsettledCollectionByPeriod({ teknisiId: TEKNISI });
        const april = per.find((r) => Number(r.period_month) === 4);
        expect(Number(april.net_total)).toBe(70000);
    });

    test("komisi milik teknisi LAIN tak ikut terhitung", async () => {
        const per = await financeService.getUnsettledCollectionByPeriod({ teknisiId: 999 });
        expect(per).toEqual([]);
    });

    test("yang sudah terkunci ke payroll TIDAK lagi dilaporkan", async () => {
        await jalankan("UPDATE technician_collection_ledger SET payroll_id = 1 WHERE period_month = 5");
        const per = await financeService.getUnsettledCollectionByPeriod({ teknisiId: TEKNISI });
        expect(per.map((r) => Number(r.period_month))).not.toContain(5);
    });
});

describe("jalur tampil: route dan halaman benar-benar membawa peringatannya", () => {
    const route = baca("routes", "gaji.js");
    const js = baca("static", "js", "gaji-teknisi.js");
    const php = baca("views", "sb-admin", "gaji-teknisi.php");

    test("ringkasan kasbon memanggil pengelompokan periode dan mengirim `komisi_tertunda`", () => {
        expect(route).toMatch(/getUnsettledCollectionByPeriod/);
        expect(route).toMatch(/komisi_tertunda/);
    });

    test("periode yang SEDANG dibuat draft dikecualikan — itu bukan tunggakan", () => {
        // Tanpa filter ini, peringatan menyala untuk komisi yang justru sedang dibayarkan.
        expect(route).toMatch(/period_month\)\s*===\s*month\s*&&\s*Number\(r\.period_year\)\s*===\s*year/);
    });

    test("periode bernilai nol bersih tidak ikut diperingatkan", () => {
        expect(route).toMatch(/r\.total\s*!==\s*0/);
    });

    test("halaman punya elemen peringatannya (JS tanpa elemen = peringatan tak pernah tampil)", () => {
        expect(js).toMatch(/#komisiTertundaInfo/);
        expect(php).toMatch(/id="komisiTertundaInfo"/);
    });

    test("peringatan disembunyikan lagi saat tidak ada yang nyangkut", () => {
        expect(js).toMatch(/jejakTertunda[\s\S]{0,200}\.hide\(\)/);
    });
});
