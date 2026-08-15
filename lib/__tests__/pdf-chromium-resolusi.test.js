/**
 * Header Doc
 * Purpose: Mengunci bahwa `executablePath` Chromium HANYA ditetapkan bila binernya benar-benar
 *          ada — supaya puppeteer memakai browser bawaannya di mesin tanpa Chromium sistem.
 * Caller: Jest test runner.
 * Deps: pemindaian `../pdf-invoice-generator.js`.
 * MainFuncs: —
 * SideEffects: Tidak ada.
 *
 * KENAPA ADA: kode lama menetapkan `puppeteerConfig.executablePath = '/usr/bin/chromium-browser'`
 * TANPA SYARAT, lalu loop di bawahnya hanya MENIMPA bila menemukan kandidat nyata. Di mesin
 * yang tak punya satu pun kandidat, nilai karangan itu BERTAHAN dan puppeteer gagal dengan
 * "Browser was not found at the configured executablePath (/usr/bin/chromium-browser)" —
 * padahal ia MEMBAWA Chromium-nya sendiri. Terukur di produksi Tanjungharjo 2026-08-15:
 * puppeteer 24.29.1 + chrome linux-142 terpasang rapi tapi tak pernah dipakai; cetak PDF
 * invoice gagal total dan pesannya ("PDF file was not created") tak menyebut Chromium.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const SUMBER = fs.readFileSync(path.join(__dirname, "..", "pdf-invoice-generator.js"), "utf8");
const blokLinux = SUMBER.slice(
    SUMBER.indexOf("if (process.platform === 'linux')"),
    SUMBER.indexOf("browser = await puppeteer.launch")
);

describe("executablePath tidak ditetapkan tanpa syarat", () => {
    test("tak ada penetapan langsung ke path karangan", () => {
        // Inilah barisnya: `puppeteerConfig.executablePath = '/usr/bin/chromium-browser';`
        // ditulis SEBELUM ada pemeriksaan apa pun.
        expect(blokLinux).not.toMatch(
            /puppeteerConfig\.executablePath\s*=\s*['"]\/usr\/bin\/chromium-browser['"]\s*;/
        );
    });

    test("penetapan hanya terjadi di dalam cabang 'biner ditemukan'", () => {
        expect(blokLinux).toMatch(/if \(terpasang\)/);
        expect(blokLinux).toMatch(/puppeteerConfig\.executablePath = terpasang;/);
    });

    test("ada cabang eksplisit yang MEMBIARKAN puppeteer memakai browser bawaannya", () => {
        expect(blokLinux).toMatch(/browser bawaan puppeteer/i);
    });

    test("kandidat diperiksa dengan fs.existsSync, bukan nama relatif tanpa path", () => {
        // Kandidat seperti 'chromium-browser' (tanpa `/usr/bin`) tak pernah bisa diverifikasi
        // dengan existsSync dan hanya mengandalkan `which` di dalam try/catch — sumber
        // false-positive. Daftar kini hanya path absolut.
        expect(blokLinux).not.toMatch(/['"]chromium-browser['"],/);
        expect(blokLinux).toMatch(/fs\.existsSync\(p\)/);
    });
});

describe("kegagalan PDF menyebut SEBABNYA, bukan hanya gejala", () => {
    test("sebab asli disimpan saat puppeteer gagal", () => {
        expect(SUMBER).toMatch(/galatPdfTerakhir = error;/);
    });

    test("pesan galat akhir menyertakan sebab itu", () => {
        // Diperiksa pada pernyataan `throw`-nya, BUKAN pada potongan sumber mentah: komentar
        // penjelasan di sekitarnya sengaja MENGUTIP pesan lama, dan versi pertama tes ini
        // merah karena menangkap komentarnya sendiri.
        const barisThrow = SUMBER.split(/\r?\n/).filter(
            (b) => /throw new Error\(/.test(b) && !/^\s*(\/\/|\*)/.test(b)
        );
        const pesanGagalBuat = barisThrow.filter((b) => /outputPath/.test(b));

        expect(pesanGagalBuat).toHaveLength(1);
        expect(pesanGagalBuat[0]).toMatch(/sebab/i);
        // Pesan lama hanya melaporkan gejala dan membuat operator mencari di folder temp.
        expect(pesanGagalBuat[0]).not.toMatch(/PDF file was not created at/);
    });

    test("sebab lama tak terbawa ke kegagalan berikutnya", () => {
        expect(SUMBER).toMatch(/galatPdfTerakhir = null;/);
    });
});
