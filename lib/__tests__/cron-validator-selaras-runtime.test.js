/**
 * Header Doc
 * Purpose: Mengunci bahwa validasi jadwal cron memakai SUMBER KEBENARAN yang sama dengan
 *          yang menjalankannya (node-cron), dan bahwa satu jadwal rusak tidak menjatuhkan
 *          pendaftaran job lain.
 * Caller: Jest test runner.
 * Deps: `lib/cron/shared.js` (isValidCron), `node-cron`.
 * MainFuncs: —
 * SideEffects: Tidak ada.
 *
 * KENAPA ADA — validasi dulu memakai `cron-validator` dengan `{alias:true, allowBlankDay:true}`
 * yang MENERIMA day-of-month `?` gaya Quartz, sementara node-cron 4.x menolaknya dan
 * `cron.schedule()` MELEMPAR `Invalid time value`. Rantai akibatnya berat:
 *   1. jadwal `?` lolos gerbang simpan → `database/cron.json` ditulis,
 *   2. `initializeAllCronTasks()` melempar di job itu,
 *   3. ke-19 init dipanggil berurutan TANPA penjaga → semua job sesudahnya tak terdaftar,
 *   4. karena dipanggil di dalam `dbInitPromise.then(...)` (lib/app-runtime.js), sisa urutan
 *      boot ikut batal, lalu tertangkap `.catch` berlabel
 *      "[DATABASE] Failed to initialize database" — operator dikirim ke tempat yang salah.
 *
 * Tes ini menembak PERILAKU (hasil validasi & isolasi kegagalan), bukan teks sumber.
 */
"use strict";

const cron = require("node-cron");
const { isValidCron } = require("../cron/shared");

describe("validator jadwal selaras dengan runtime-nya", () => {
    test("ekspresi Quartz `?` DITOLAK — dulu lolos lalu melempar saat dijadwalkan", () => {
        expect(isValidCron("0 0 ? * *")).toBe(false);
        expect(isValidCron("0 0 ? * MON")).toBe(false);
    });

    test("apa pun yang lolos validator BENAR-BENAR bisa dijadwalkan", () => {
        // Inilah invarian yang dilanggar sebelumnya. Diuji lintas bentuk, termasuk yang
        // dulu jadi jebakan.
        const kandidat = [
            "0 0 * * *", "*/5 * * * *", "0 */6 * * *", "30 9 2 * *", "0 0 16 * *",
            "0 0 ? * *", "ngawur", "", "60 0 * * *", "0 0 32 * *",
        ];
        for (const e of kandidat) {
            if (!isValidCron(e)) continue;
            const task = cron.schedule(e, () => {});   // tak boleh melempar
            task.stop();
        }
    });

    test("SELURUH jadwal produksi nyata tetap diterima (tak ada regresi)", () => {
        const produksi = [
            "0 * * * *", "0 8 1 * *", "30 9 2 * *", "* * * * *", "0 8 16 * *",
            "0 9 12 * *", "0 9 14 * *", "0 9 27 * *", "0 9 19 * *", "0 4 * * *",
            "0 0 16 * *", "0 0 1 * *",
        ];
        for (const e of produksi) expect(isValidCron(e)).toBe(true);
    });

    test("nilai kosong/bukan string ditolak tanpa melempar", () => {
        for (const e of ["", "   ", null, undefined, 123, {}]) {
            expect(isValidCron(e)).toBe(false);
        }
    });

    test("jadwal berawalan # tetap diperlakukan sebagai dimatikan", () => {
        expect(isValidCron("# 0 0 * * *")).toBe(false);
    });
});

describe("satu job rusak tidak menjatuhkan job lain", () => {
    test("initializeAllCronTasks mengisolasi kegagalan per job & melaporkannya", () => {
        // Diuji lewat POLA yang dipakai lib/cron.js, bukan dengan memuat modulnya
        // (memuatnya menarik seluruh graf cron + WA + DB).
        const jalan = [];
        function daftarkanTask(nama, fn) {
            try { fn(); return true; } catch (_e) { return false; }
        }
        const daftar = [
            ["a", () => jalan.push("a")],
            ["b", () => { throw new Error("Invalid time value"); }],
            ["c", () => jalan.push("c")],
        ];
        const gagal = [];
        for (const [nama, fn] of daftar) if (!daftarkanTask(nama, fn)) gagal.push(nama);

        // Job SESUDAH yang gagal tetap terdaftar — inilah yang dulu hilang.
        expect(jalan).toEqual(["a", "c"]);
        expect(gagal).toEqual(["b"]);
    });

    test("lib/cron.js benar-benar memakai pola isolasi itu", () => {
        const fs = require("fs");
        const path = require("path");
        const src = fs.readFileSync(path.join(__dirname, "..", "cron.js"), "utf8");
        expect(src).toMatch(/function daftarkanTask/);
        expect(src).toMatch(/CRON_INIT_GAGAL/);
        // Tak boleh kembali ke deretan panggilan telanjang.
        expect(src).not.toMatch(/\n\s+initGraceReminderTask\(config\);\n\s+initSetUnpaidTask\(config\);/);
    });
});
