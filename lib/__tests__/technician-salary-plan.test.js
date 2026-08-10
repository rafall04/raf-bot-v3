"use strict";

/**
 * Header Doc
 * Purpose: Mengunci gaji pokok TETAP per teknisi + pembuatan draft payroll otomatis.
 *   Yang dijaga bukan sekadar "draftnya muncul", melainkan batas-batas yang membuat otomatisasi
 *   ini aman: berhenti di DRAFT (tak pernah memfinalisasi/membayar/mengirim struk), idempoten
 *   terhadap restart (prod restart 7-13x/hari), tak menghidupkan lagi draft yang sengaja
 *   dihapus operator, dan tak membuat payroll bulan lalu jadi tak terlihat.
 * Caller: Jest (`npx jest lib/__tests__/technician-salary-plan.test.js`).
 * Deps: `lib/technician-salary-plan`, `lib/technician-finance-service`, `sqlite3`.
 * MainFuncs: -
 * SideEffects: `global.db` di memori + `global.accounts`/`global.config` palsu; tak menyentuh
 *   data nyata dan tak pernah menulis config.json (jalur setAutoDraft tak diuji di sini).
 */

const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const REPO = path.join(__dirname, "..", "..");
const baca = (...p) => fs.readFileSync(path.join(REPO, ...p), "utf8");

const salaryPlan = require("../technician-salary-plan");
const finance = require("../technician-finance-service");

function ambil(sql, params = []) {
    return new Promise((res, rej) => global.db.all(sql, params, (e, r) => (e ? rej(e) : res(r || []))));
}
function jalankan(sql, params = []) {
    return new Promise((res, rej) => global.db.run(sql, params, (e) => (e ? rej(e) : res())));
}

// Tanggal SELALU disuntik. Jest tak memaksa TZ, jadi tes berbasis jam mesin hijau di Jakarta
// dan merah di mesin lain.
const tgl = (y, m, d) => new Date(y, m - 1, d, 10, 0, 0);

describe("gaji pokok tetap: diisi sekali, dipakai tiap bulan", () => {
    beforeAll(async () => {
        global.db = new sqlite3.Database(":memory:");
        global.accounts = [
            { id: 3, name: "DAVIN", role: "teknisi" },
            { id: 4, name: "IVAN", role: "teknisi" },
            { id: 2, name: "raf", role: "admin" }
        ];
        global.config = { technicianSalary: { autoDraft: true, draftDay: 28 } };
        await finance.ensureFinanceTables();
        await salaryPlan.ensureTable();
    });

    afterAll(() => {
        if (global.db) global.db.close();
    });

    beforeEach(async () => {
        await jalankan("DELETE FROM technician_salary_defaults");
        await jalankan("DELETE FROM technician_gaji");
    });

    test("menyimpan gaji tetap untuk dua teknisi sekaligus", async () => {
        const hasil = await salaryPlan.savePlans([
            { teknisi_id: 3, gaji_pokok: 250000 },
            { teknisi_id: 4, gaji_pokok: 250000 }
        ]);
        expect(hasil.ok).toBe(true);
        expect(hasil.tersimpan).toBe(2);
        const rows = await salaryPlan.listPlans();
        expect(rows.map((r) => r.gaji_pokok)).toEqual([250000, 250000]);
    });

    test("mengubah gaji tetap IKUT memperbarui draft bulan ini", async () => {
        // Jebakan senyap yang terukur di produksi 2026-08-10: layar bilang "Rp600.000
        // tersimpan", draft bulan ini tetap Rp250.000, dan yang benar-benar dibayarkan
        // adalah angka lama.
        await salaryPlan.savePlans([{ teknisi_id: 3, gaji_pokok: 250000 }], { date: tgl(2026, 8, 28) });
        await salaryPlan.createDraftsForPeriod({ date: tgl(2026, 8, 28) });

        const hasil = await salaryPlan.savePlans([{ teknisi_id: 3, gaji_pokok: 600000 }], { date: tgl(2026, 8, 28) });
        expect(hasil.draftDiselaraskan).toEqual([{ nama: "DAVIN", periode: "8/2026", sebelum: 250000, sesudah: 600000 }]);

        const rows = await ambil("SELECT gaji_pokok, net_amount FROM technician_gaji WHERE period_month = 8");
        expect(rows[0].gaji_pokok).toBe(600000);
        expect(rows[0].net_amount).toBe(600000);
    });

    test("payroll yang SUDAH difinalisasi tidak ikut ditulis ulang", async () => {
        await salaryPlan.savePlans([{ teknisi_id: 3, gaji_pokok: 250000 }], { date: tgl(2026, 8, 28) });
        await salaryPlan.createDraftsForPeriod({ date: tgl(2026, 8, 28) });
        await jalankan("UPDATE technician_gaji SET status = 'finalized' WHERE period_month = 8");

        const hasil = await salaryPlan.savePlans([{ teknisi_id: 3, gaji_pokok: 900000 }], { date: tgl(2026, 8, 28) });
        expect(hasil.draftDiselaraskan).toEqual([]);
        const rows = await ambil("SELECT gaji_pokok FROM technician_gaji WHERE period_month = 8");
        expect(rows[0].gaji_pokok).toBe(250000);
    });

    test("draft bulan LAMPAU tidak ditulis ulang surut", async () => {
        // Bulan lampau memakai gaji yang berlaku saat itu.
        await salaryPlan.savePlans([{ teknisi_id: 3, gaji_pokok: 250000 }], { date: tgl(2026, 7, 28) });
        await salaryPlan.createDraftsForPeriod({ date: tgl(2026, 7, 28) });

        const hasil = await salaryPlan.savePlans([{ teknisi_id: 3, gaji_pokok: 600000 }], { date: tgl(2026, 8, 28) });
        expect(hasil.draftDiselaraskan).toEqual([]);
        const rows = await ambil("SELECT gaji_pokok FROM technician_gaji WHERE period_month = 7");
        expect(rows[0].gaji_pokok).toBe(250000);
    });

    test("nominal nol/negatif ditolak SELURUHNYA — separuh tersimpan lebih buruk", async () => {
        // Operator melihat "berhasil" lalu pergi; yang gagal tak pernah ketahuan.
        const hasil = await salaryPlan.savePlans([
            { teknisi_id: 3, gaji_pokok: 250000 },
            { teknisi_id: 4, gaji_pokok: 0 }
        ]);
        expect(hasil.ok).toBe(false);
        expect(await salaryPlan.listPlans()).toEqual([]);
    });

    test("id yang bukan akun teknisi ditolak", async () => {
        const hasil = await salaryPlan.savePlans([{ teknisi_id: 2, gaji_pokok: 250000 }]);
        expect(hasil.ok).toBe(false);
        expect(hasil.reason).toMatch(/bukan akun teknisi/);
    });

    test("tanggal 27 belum membuat apa pun; tanggal 28 membuat draft untuk dua teknisi", async () => {
        await salaryPlan.savePlans([
            { teknisi_id: 3, gaji_pokok: 250000 },
            { teknisi_id: 4, gaji_pokok: 300000 }
        ]);

        const belum = await salaryPlan.createDraftsForPeriod({ date: tgl(2026, 8, 27) });
        expect(belum.dijalankan).toBe(false);
        expect(belum.alasan).toBe("belum_tanggalnya");
        expect(await ambil("SELECT * FROM technician_gaji")).toHaveLength(0);

        const jadi = await salaryPlan.createDraftsForPeriod({ date: tgl(2026, 8, 28) });
        expect(jadi.dibuat).toBe(2);
        const rows = await ambil("SELECT teknisi_name, period_month, period_year, gaji_pokok, status FROM technician_gaji ORDER BY teknisi_id");
        expect(rows).toEqual([
            { teknisi_name: "DAVIN", period_month: 8, period_year: 2026, gaji_pokok: 250000, status: "draft" },
            { teknisi_name: "IVAN", period_month: 8, period_year: 2026, gaji_pokok: 300000, status: "draft" }
        ]);
    });

    test("tanggal LEWAT tetap menyusul — cron tak mengejar tick yang terlewat", async () => {
        // Pakai ">=" bukan "===": satu restart tepat di menitnya akan menghilangkan satu bulan
        // penuh kalau syaratnya kesamaan tanggal.
        await salaryPlan.savePlans([{ teknisi_id: 3, gaji_pokok: 250000 }]);
        const hasil = await salaryPlan.createDraftsForPeriod({ date: tgl(2026, 8, 31) });
        expect(hasil.dibuat).toBe(1);
    });

    test("draftDay 31 tetap menyala di Februari (di-clamp ke hari terakhir)", async () => {
        global.config.technicianSalary.draftDay = 31;
        await salaryPlan.savePlans([{ teknisi_id: 3, gaji_pokok: 250000 }]);
        const hasil = await salaryPlan.createDraftsForPeriod({ date: tgl(2026, 2, 28) });
        expect(hasil.dibuat).toBe(1);
        global.config.technicianSalary.draftDay = 28;
    });

    test("dijalankan dua kali untuk periode sama hanya menghasilkan SATU payroll", async () => {
        await salaryPlan.savePlans([{ teknisi_id: 3, gaji_pokok: 250000 }]);
        await salaryPlan.createDraftsForPeriod({ date: tgl(2026, 8, 28) });
        const kedua = await salaryPlan.createDraftsForPeriod({ date: tgl(2026, 8, 29) });

        expect(kedua.dibuat).toBe(0);
        expect(await ambil("SELECT * FROM technician_gaji")).toHaveLength(1);
    });

    test("draft yang SENGAJA dihapus operator tidak hidup lagi besok paginya", async () => {
        // Tanpa penanda periode, DELETE /api/gaji/:id dibatalkan diam-diam oleh cron.
        await salaryPlan.savePlans([{ teknisi_id: 3, gaji_pokok: 250000 }]);
        await salaryPlan.createDraftsForPeriod({ date: tgl(2026, 8, 28) });
        await jalankan("DELETE FROM technician_gaji");

        const besok = await salaryPlan.createDraftsForPeriod({ date: tgl(2026, 8, 29) });
        expect(besok.dibuat).toBe(0);
        expect(await ambil("SELECT * FROM technician_gaji")).toHaveLength(0);
    });

    test("bulan berikutnya membuat draft lagi", async () => {
        await salaryPlan.savePlans([{ teknisi_id: 3, gaji_pokok: 250000 }]);
        await salaryPlan.createDraftsForPeriod({ date: tgl(2026, 8, 28) });
        const sept = await salaryPlan.createDraftsForPeriod({ date: tgl(2026, 9, 28) });
        expect(sept.dibuat).toBe(1);
        const rows = await ambil("SELECT period_month FROM technician_gaji ORDER BY period_month");
        expect(rows.map((r) => r.period_month)).toEqual([8, 9]);
    });

    test("sakelar mati = tidak membuat apa pun", async () => {
        global.config.technicianSalary.autoDraft = false;
        await salaryPlan.savePlans([{ teknisi_id: 3, gaji_pokok: 250000 }]);
        const hasil = await salaryPlan.createDraftsForPeriod({ date: tgl(2026, 8, 28) });
        expect(hasil.dijalankan).toBe(false);
        expect(hasil.alasan).toBe("auto_draft_mati");
        global.config.technicianSalary.autoDraft = true;
    });

    test("tombol manual mengabaikan sakelar DAN tanggal", async () => {
        global.config.technicianSalary.autoDraft = false;
        await salaryPlan.savePlans([{ teknisi_id: 3, gaji_pokok: 250000 }]);
        const hasil = await salaryPlan.createDraftsForPeriod({ date: tgl(2026, 8, 5), ignoreDayGate: true });
        expect(hasil.dibuat).toBe(1);
        global.config.technicianSalary.autoDraft = true;
    });

    test("akun teknisi yang hilang DILEWATI, bukan dibuatkan draft tanpa nama jelas", async () => {
        await salaryPlan.savePlans([{ teknisi_id: 3, gaji_pokok: 250000 }]);
        const simpan = global.accounts;
        global.accounts = simpan.filter((a) => a.id !== 3);
        const hasil = await salaryPlan.createDraftsForPeriod({ date: tgl(2026, 8, 28) });
        expect(hasil.dibuat).toBe(0);
        expect(hasil.hasil[0].alasan).toBe("akun_teknisi_tidak_ditemukan");
        // Barisnya TIDAK dihapus — akunnya bisa aktif lagi.
        expect(await salaryPlan.listPlans()).toHaveLength(1);
        global.accounts = simpan;
    });

    test("draft otomatis tak menyentuh potongan kasbon — memotong hutang keputusan manusia", async () => {
        await salaryPlan.savePlans([{ teknisi_id: 3, gaji_pokok: 250000 }]);
        await salaryPlan.createDraftsForPeriod({ date: tgl(2026, 8, 28) });
        const rows = await ambil("SELECT potongan_kasbon, created_by_name FROM technician_gaji");
        expect(rows[0].potongan_kasbon).toBe(0);
        expect(rows[0].created_by_name).toBe("otomatis");
    });

    test("payroll belum dibayar terbaca LINTAS BULAN", async () => {
        // Tanpa ini, draft bulan lalu tak muncul di satu pixel pun setelah bulannya berganti.
        await salaryPlan.savePlans([{ teknisi_id: 3, gaji_pokok: 250000 }]);
        await salaryPlan.createDraftsForPeriod({ date: tgl(2026, 8, 28) });
        await salaryPlan.createDraftsForPeriod({ date: tgl(2026, 9, 28) });

        const belum = await salaryPlan.getUnpaidPayrolls();
        expect(belum.map((r) => r.period_month)).toEqual([8, 9]);
    });
});

describe("batas keras: otomatisasi berhenti di draft", () => {
    const plan = baca("lib", "technician-salary-plan.js");
    const job = baca("lib", "cron", "jobs", "technician-salary-draft.js");
    // Komentar SENGAJA menyebut nama-nama terlarang untuk menjelaskan batasnya — periksa KODE.
    const kode = (src) => src.split(/\r?\n/).filter((b) => !/^\s*(\*|\/\*|\/\/)/.test(b)).join("\n");

    test("modul inti tak pernah memfinalisasi, membayar, atau mengirim struk", () => {
        for (const terlarang of ["finalizePayroll", "payPayroll", "sendCritical", "payroll-receipt"]) {
            expect(kode(plan)).not.toContain(terlarang);
            expect(kode(job)).not.toContain(terlarang);
        }
    });

    test("cron menghentikan task lama sebelum menjadwalkan ulang", () => {
        expect(job).toMatch(/task\.stop\(\)/);
    });

    test("jadwal divalidasi sebelum dipakai", () => {
        expect(job).toMatch(/isValidCron/);
    });
});

describe("jalur halaman & route", () => {
    const route = baca("routes", "gaji.js");
    const js = baca("static", "js", "gaji-teknisi.js");
    const php = baca("views", "sb-admin", "gaji-teknisi.php");

    test("empat endpoint gaji tetap ada", () => {
        expect(route).toMatch(/get\('\/gaji-tetap'/);
        expect(route).toMatch(/put\('\/gaji-tetap'/);
        expect(route).toMatch(/put\('\/gaji-tetap\/otomatis'/);
        expect(route).toMatch(/post\('\/gaji-tetap\/buat-draft'/);
    });

    test("mengubah sakelar MENJADWALKAN ULANG cron — kalau tidak, sukses semu", () => {
        const blok = route.slice(route.indexOf("/gaji-tetap/otomatis"), route.indexOf("/gaji-tetap/buat-draft"));
        expect(blok).toMatch(/initTechnicianSalaryDraftTask\(\)/);
    });

    test("spanduk payroll belum dibayar ada di halaman dan bisa diklik", () => {
        expect(php).toMatch(/id="spandukBelumDibayar"/);
        expect(js).toMatch(/spanduk-periode/);
        expect(js).toMatch(/renderSpandukBelumDibayar/);
    });

    test("peringatan 'tersimpan tapi otomatis mati' ada", () => {
        expect(php).toMatch(/id="gajiTetapPeringatanMati"/);
        expect(js).toMatch(/perbaruiPeringatanOtomatisMati/);
    });


    test("notifikasi sesaat tidak boleh menghapus spanduk permanen", () => {
        // Penutup otomatis dulu menyapu SEMUA `.alert`; Bootstrap MENGHAPUS elemennya dari DOM,
        // jadi satu notifikasi membuat spanduk payroll belum dibayar lenyap selamanya.
        expect(js).toContain("alert-sesaat");
        expect(js).toContain("$('.alert-sesaat').alert('close')");
        // Dan penyapu lama yang tak bertarget tak boleh kembali.
        expect(js).not.toContain("$('.alert').alert('close')");
    });

    test("tombol simpan & draft selalu menjawab DI TEMPAT, tak ada jalur diam", () => {
        expect(php).toMatch(/id="gajiTetapHasil"/);
        expect(js).toMatch(/kabarGajiTetap/);
        // Status HTTP mentah ikut disebut: 0 / 'tak ada respons' membedakan "ditolak server"
        // dari "permintaan tak pernah sampai".
        expect(js).toMatch(/tak ada respons/);
    });

    test("JS halaman dimuat lewat rafAssetUrl — tanpa itu browser menyajikan versi lama", () => {
        expect(php).toMatch(/rafAssetUrl\('\/js\/gaji-teknisi\.js'\)/);
    });

    test("template kabar draft terdaftar di store, bukan cuma fallback di kode", () => {
        // Template tersimpan MENIMPA fallback; slot yang hanya ada di fallback tak pernah terkirim.
        const store = JSON.parse(baca("database", "response_templates.json"));
        // Entri WAJIB berbentuk objek {name, template, category}; string mentah ditolak guard
        // integritas dan tak pernah dirender.
        const entri = store.kas_notif_draft_gaji;
        expect(entri && typeof entri.template).toBe("string");
        for (const slot of ["${periode}", "${daftar}", "${jumlah}", "${total}"]) {
            expect(entri.template).toContain(slot);
        }
        expect(entri.template).toMatch(/BARU DRAFT/);
    });

    test("gate config terdokumentasi dan default MATI", () => {
        const contoh = JSON.parse(baca("config.example.json"));
        expect(contoh.technicianSalary.autoDraft).toBe(false);
    });
});
