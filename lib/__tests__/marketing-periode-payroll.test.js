"use strict";

/**
 * Header Doc
 * Purpose: Mengunci batas PERIODE pada komisi marketing PSB yang masuk payroll.
 *   Sebelum ini `getUnsettledMarketingForTeknisi`/`settleMarketingToPayroll` menyaring hanya
 *   `marketing_type='teknisi' AND marketing_status='pending' AND marketing_ref_id=?` — TANPA
 *   periode. Akibatnya satu payroll menyapu seluruh komisi pending lintas bulan: payroll Juli
 *   yang difinalisasi setelah lead Agustus terpasang menelan komisi Agustus dan membukukannya
 *   di Juli, dan payroll Agustus lalu menemukan nol.
 * Caller: Jest (`npx jest lib/__tests__/marketing-periode-payroll.test.js`).
 * Deps: `lib/psb-schedule-service` (DB uji lewat setDbPathForTest), fs/path.
 * MainFuncs: -
 * SideEffects: Membuat berkas sqlite sementara lalu menghapusnya.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const sqlite3 = require("sqlite3");

const psb = require("../psb-schedule-service");

const berkasUji = path.join(os.tmpdir(), "raf-marketing-periode-uji.sqlite");

/** Menyetel tanggal aktivitas langsung supaya periodenya pasti, tak bergantung jam mesin. */
function setelTanggal(id, tanggal) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(berkasUji);
        db.run(
            "UPDATE psb_schedule SET installed_at = ?, updated_at = ?, created_at = ? WHERE id = ?",
            [tanggal, tanggal, tanggal, id],
            (err) => {
                db.close();
                if (err) reject(err);
                else resolve();
            }
        );
    });
}

function bersihkanBerkas() {
    for (const suffix of ["", "-wal", "-shm"]) {
        try {
            fs.unlinkSync(berkasUji + suffix);
        } catch (_e) {
            /* memang belum ada */
        }
    }
}

let urutan = 0;
async function tambahLead({ teknisiId, fee, tanggal }) {
    urutan += 1;
    const rec = await psb.createRequest({
        nama: `Pelanggan ${urutan}`,
        hp: `62800000${urutan}`,
        dusun: "Dusun Uji",
        paket: "PAKET-UJI"
    });
    const id = rec.id;
    const hasil = await psb.setMarketing(id, { type: "teknisi", refId: String(teknisiId), refName: "Teknisi Uji", fee });
    if (hasil && hasil.ok === false) throw new Error(`setMarketing gagal: ${hasil.reason}`);
    await setelTanggal(id, tanggal);
    return id;
}

describe("komisi marketing PSB dibatasi periode payroll-nya", () => {
    beforeAll(() => {
        bersihkanBerkas();
        psb.setDbPathForTest(berkasUji);
    });

    afterAll(() => {
        bersihkanBerkas();
    });

    test("payroll Juli TIDAK menelan komisi Agustus", async () => {
        await tambahLead({ teknisiId: 3, fee: 50000, tanggal: "2026-07-10T03:00:00.000Z" });
        await tambahLead({ teknisiId: 3, fee: 75000, tanggal: "2026-08-05T03:00:00.000Z" });

        const juli = await psb.getUnsettledMarketingForTeknisi(3, { periodMonth: 7, periodYear: 2026 });
        expect(juli.net_total).toBe(50000);

        const semua = await psb.getUnsettledMarketingForTeknisi(3);
        expect(semua.net_total).toBe(125000); // tanpa batas = perilaku lama
    });

    test("komisi bulan LAMPAU yang tercecer tetap ikut terbayar", async () => {
        // Batasnya "sampai dengan", bukan "sama dengan" — kalau tidak, komisi yang terlewat
        // satu bulan akan menggantung selamanya.
        const agustus = await psb.getUnsettledMarketingForTeknisi(3, { periodMonth: 8, periodYear: 2026 });
        expect(agustus.net_total).toBe(125000);
    });

    test("settle hanya mengunci yang ada di dalam batas periode", async () => {
        const hasil = await psb.settleMarketingToPayroll({ teknisiId: 3, payrollId: 11, periodMonth: 7, periodYear: 2026 });
        expect(hasil.netTotal).toBe(50000);

        // Yang Agustus HARUS masih pending dan siap masuk payroll Agustus.
        const sisa = await psb.getUnsettledMarketingForTeknisi(3, { periodMonth: 8, periodYear: 2026 });
        expect(sisa.net_total).toBe(75000);
    });

    test("yang sudah settled tak bisa terkunci dua kali", async () => {
        const ulang = await psb.settleMarketingToPayroll({ teknisiId: 3, payrollId: 12, periodMonth: 7, periodYear: 2026 });
        expect(ulang.netTotal).toBe(0);
    });

    test("teknisi lain tak ikut tersapu", async () => {
        await tambahLead({ teknisiId: 4, fee: 30000, tanggal: "2026-08-06T03:00:00.000Z" });
        const lain = await psb.getUnsettledMarketingForTeknisi(4, { periodMonth: 8, periodYear: 2026 });
        expect(lain.net_total).toBe(30000);

        const davin = await psb.getUnsettledMarketingForTeknisi(3, { periodMonth: 8, periodYear: 2026 });
        expect(davin.net_total).toBe(75000);
    });
});
