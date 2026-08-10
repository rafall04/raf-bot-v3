"use strict";

/**
 * Header Doc
 * Purpose: Mengunci dua penutup celah pada siklus gaji.
 *
 *   (1) STATUS STRUK JUJUR. `sendCritical` tak pernah melempar — ia memulangkan
 *       `{ delivered:false, errorCode }`. Kode lama mengabaikan nilai balik itu dan melaporkan
 *       "struk sudah dikirim" ke grup kas walau tak satu pesan pun sampai. Statusnya kini
 *       disimpan di baris payroll supaya terlihat dan bisa dikirim ulang.
 *
 *   (2) PEMBATALAN FINALISASI. Finalisasi menempelkan `payroll_id` ke baris komisi; kalau
 *       status dikembalikan ke draft tanpa melepas kunci itu, komisinya menggantung pada
 *       payroll yang tak jadi dibayar — hilang dari perhitungan dan tak bisa masuk payroll
 *       mana pun lagi. Payroll yang SUDAH DIBAYAR tak boleh bisa dibatalkan dari sini.
 * Caller: Jest (`npx jest lib/__tests__/payroll-struk-dan-batal.test.js`).
 * Deps: `lib/technician-finance-service`, `sqlite3`, fs/path (pindai route + UI).
 * MainFuncs: -
 * SideEffects: `global.db` di memori; tak menyentuh data nyata.
 */

const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const REPO = path.join(__dirname, "..", "..");
const baca = (...p) => fs.readFileSync(path.join(REPO, ...p), "utf8");

const finance = require("../technician-finance-service");

const TEKNISI = 21;

function jalankan(sql, params = []) {
    return new Promise((res, rej) => global.db.run(sql, params, (e) => (e ? rej(e) : res())));
}
function ambil(sql, params = []) {
    return new Promise((res, rej) => global.db.all(sql, params, (e, r) => (e ? rej(e) : res(r || []))));
}

let urutan = 0;
function tambahKomisi({ bulan, tahun, nominal = 5000 }) {
    urutan += 1;
    return jalankan(
        `INSERT INTO technician_collection_ledger
           (teknisi_id, teknisi_name, user_id, user_name, period_month, period_year,
            commission_amount, direction, reason, event_key, created_by, created_at)
         VALUES (?, 'Teknisi Uji', ?, 'Pelanggan', ?, ?, ?, 'credit', 'customer_paid_final', ?, 'uji', datetime('now'))`,
        [String(TEKNISI), `p-${urutan}`, bulan, tahun, nominal, `sb-${urutan}`]
    );
}

describe("pembatalan finalisasi melepas kunci komisinya", () => {
    beforeAll(async () => {
        global.db = new sqlite3.Database(":memory:");
        global.accounts = [{ id: TEKNISI, name: "Teknisi Uji", role: "teknisi" }];
        await finance.ensureFinanceTables();
        finance.__setMarketingSourceForTest?.({
            getUnsettledMarketingForTeknisi: async () => ({ entries: [], net_total: 0 }),
            settleMarketingToPayroll: async () => ({ entries: [], netTotal: 0 }),
            unsettleMarketingFromPayroll: async () => ({ dilepas: 0 })
        });
    });

    afterAll(() => {
        if (global.db) global.db.close();
    });

    beforeEach(async () => {
        await jalankan("DELETE FROM technician_gaji");
        await jalankan("DELETE FROM technician_collection_ledger");
    });

    test("status kembali draft DAN komisi terlepas untuk dihitung ulang", async () => {
        await tambahKomisi({ bulan: 8, tahun: 2026, nominal: 25000 });
        const p = await finance.createPayrollDraft({
            teknisiId: TEKNISI, periodMonth: 8, periodYear: 2026, gajiPokok: 600000
        }, { name: "uji" });
        await finance.finalizePayroll(p.id, { name: "uji" });

        const terkunci = await ambil("SELECT COUNT(*) n FROM technician_collection_ledger WHERE payroll_id IS NOT NULL");
        expect(terkunci[0].n).toBe(1);

        const batal = await finance.unfinalizePayroll(p.id, { name: "raf" });
        expect(batal.ok).toBe(true);
        expect(batal.komisiDilepas).toBe(1);

        const rows = await ambil("SELECT status, finalized_at FROM technician_gaji WHERE id = ?", [p.id]);
        expect(rows[0].status).toBe("draft");
        expect(rows[0].finalized_at).toBeNull();

        const lepas = await ambil("SELECT COUNT(*) n FROM technician_collection_ledger WHERE payroll_id IS NULL");
        expect(lepas[0].n).toBe(1);
    });

    test("difinalisasi ULANG setelah dibatalkan menghasilkan komisi yang sama, bukan nol", async () => {
        // Ini inti kenapa kuncinya harus dilepas: tanpa itu finalisasi kedua menemukan nol
        // dan menimpa komisi teknisi jadi kosong.
        await tambahKomisi({ bulan: 8, tahun: 2026, nominal: 25000 });
        const p = await finance.createPayrollDraft({
            teknisiId: TEKNISI, periodMonth: 8, periodYear: 2026, gajiPokok: 600000
        }, { name: "uji" });
        await finance.finalizePayroll(p.id, { name: "uji" });
        await finance.unfinalizePayroll(p.id, { name: "raf" });
        await finance.finalizePayroll(p.id, { name: "uji" });

        const rows = await ambil("SELECT komisi_collection, net_amount FROM technician_gaji WHERE id = ?", [p.id]);
        expect(rows[0].komisi_collection).toBe(25000);
        expect(rows[0].net_amount).toBe(625000);
    });

    test("payroll yang SUDAH DIBAYAR tak bisa dibatalkan dari sini", async () => {
        const p = await finance.createPayrollDraft({
            teknisiId: TEKNISI, periodMonth: 8, periodYear: 2026, gajiPokok: 600000
        }, { name: "uji" });
        await finance.finalizePayroll(p.id, { name: "uji" });
        await jalankan("UPDATE technician_gaji SET status = 'paid' WHERE id = ?", [p.id]);

        const batal = await finance.unfinalizePayroll(p.id, { name: "raf" });
        expect(batal.ok).toBe(false);
        expect(batal.reason).toBe("sudah_dibayar");
    });

    test("draft biasa bukan sasaran pembatalan", async () => {
        const p = await finance.createPayrollDraft({
            teknisiId: TEKNISI, periodMonth: 8, periodYear: 2026, gajiPokok: 600000
        }, { name: "uji" });
        const batal = await finance.unfinalizePayroll(p.id, { name: "raf" });
        expect(batal.ok).toBe(false);
        expect(batal.reason).toBe("bukan_finalized");
    });

    test("status struk tersimpan di baris payroll-nya", async () => {
        const p = await finance.createPayrollDraft({
            teknisiId: TEKNISI, periodMonth: 8, periodYear: 2026, gajiPokok: 600000
        }, { name: "uji" });
        await finance.setPayrollReceiptStatus(p.id, { status: "gagal", error: "nomor WA teknisi belum diisi" });

        const rows = await ambil("SELECT struk_status, struk_error, struk_at FROM technician_gaji WHERE id = ?", [p.id]);
        expect(rows[0].struk_status).toBe("gagal");
        expect(rows[0].struk_error).toMatch(/nomor WA/);
        expect(rows[0].struk_at).toBeTruthy();
    });
});

describe("jalur route & halaman", () => {
    const route = baca("routes", "gaji.js");
    const js = baca("static", "js", "gaji-teknisi.js");

    test("hasil sendCritical BENAR-BENAR diperiksa, bukan diasumsikan", () => {
        expect(route).toMatch(/r\.delivered !== true/);
        expect(route).not.toMatch(/strukTerkirim = true;\s*\n\s*\}\s*\n\s*\} catch/);
    });

    test("status struk disimpan lewat setPayrollReceiptStatus", () => {
        expect(route).toMatch(/setPayrollReceiptStatus\(/);
    });

    test("ada endpoint kirim ulang struk, hanya untuk payroll yang sudah dibayar", () => {
        expect(route).toMatch(/kirim-ulang-struk/);
        const blok = route.slice(route.indexOf("kirim-ulang-struk"));
        expect(blok).toMatch(/status !== 'paid'/);
    });

    test("ada endpoint batal finalisasi yang menolak payroll terbayar", () => {
        expect(route).toMatch(/batal-finalisasi/);
        expect(route).toMatch(/sudah_dibayar/);
    });

    test("tombolnya muncul di halaman", () => {
        expect(js).toMatch(/kirimUlangStruk/);
        expect(js).toMatch(/batalFinalisasi/);
        // Tombol kirim ulang HANYA saat struknya belum terkirim — kalau selalu muncul,
        // ia berubah jadi tombol kirim-spam ke teknisi.
        expect(js).toMatch(/struk_status !== 'terkirim'/);
    });
});
