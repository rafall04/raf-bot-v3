/**
 * Header Doc
 * Purpose: Mengunci—untuk helper KANONIK `lib/html-to-pdf.js`—bahwa `executablePath` Chromium HANYA
 *          ditetapkan bila binernya benar-benar ada (fs.existsSync), dan bahwa helper ini GAGAL-KERAS
 *          (tak punya jalur "kembalikan HTML sebagai .pdf"). Invarian yang sama dijaga untuk
 *          pdf-invoice-generator.js di pdf-chromium-resolusi.test.js.
 * Caller: Jest test runner.
 * Deps: pemindaian `../html-to-pdf.js`.
 * MainFuncs: —
 * SideEffects: Tidak ada.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const SUMBER = fs.readFileSync(path.join(__dirname, "..", "html-to-pdf.js"), "utf8");
const blokLinux = SUMBER.slice(
    SUMBER.indexOf("if (process.platform === \"linux\")"),
    SUMBER.indexOf("browser = await puppeteer.launch")
);

describe("html-to-pdf: executablePath tidak ditetapkan tanpa syarat", () => {
    test("blok resolusi Chromium ada dan tidak kosong", () => {
        expect(blokLinux.length).toBeGreaterThan(0);
    });

    test("tak ada penetapan langsung ke path karangan", () => {
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
        expect(blokLinux).not.toMatch(/['"]chromium-browser['"],/);
        expect(blokLinux).toMatch(/fs\.existsSync\(p\)/);
    });
});

describe("html-to-pdf: gagal-keras (tak ada HTML dilabeli PDF)", () => {
    test("tidak pernah membungkus HTML sebagai buffer PDF palsu", () => {
        // Jebakan generateSimplePDFFallback: `Buffer.from(htmlContent)` dikirim sebagai .pdf.
        // (Nama fungsi jebakan boleh disebut di komentar; yang dilarang adalah MEMANGGILNYA.)
        expect(SUMBER).not.toMatch(/Buffer\.from\(\s*(html|String\(html)/i);
        expect(SUMBER).not.toMatch(/generateSimplePDFFallback\(|generatePDFAlternative\(/);
    });

    test("mengembalikan hasil page.pdf apa adanya", () => {
        expect(SUMBER).toMatch(/await page\.pdf\(/);
        expect(SUMBER).toMatch(/return pdfBuffer;/);
    });
});
