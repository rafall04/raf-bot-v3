/**
 * Header Doc
 * Purpose: Helper KANONIK "HTML string -> PDF Buffer" via Chromium headless (puppeteer). Dipakai fitur
 *   Cetak Voucher (lembar 36/lembar) dan boleh dipakai konsumen lain yang butuh render HTML sembarang
 *   ke PDF. GAGAL-KERAS: melempar error bila Chromium gagal — TIDAK PERNAH memulangkan buffer HTML
 *   dilabeli PDF (jebakan generateSimplePDFFallback di pdf-invoice-generator.js).
 * Caller: `services/voucher-print.service.js` (renderPdf/renderPdfAndSend).
 * Deps: `puppeteer` (paket penuh; membawa Chromium bawaan), `fs`.
 * MainFuncs: `renderHtmlToPdf(html, options)`.
 * SideEffects: Menjalankan Chromium headless (satu instance per panggilan, ditutup di finally).
 *
 * CATATAN: `pdf-invoice-generator.js` punya jalur launch Chromium sendiri (LIVE, jalur uang) yang
 * SENGAJA tidak diubah agar tak menambah risiko regresi ke invoice. Invarian kritis yang dulu
 * menjatuhkan prod (executablePath dipaksa TANPA syarat) dikunci di KEDUA tempat oleh guard test
 * masing-masing (lib/__tests__/pdf-chromium-resolusi.test.js & lib/__tests__/html-to-pdf-chromium.test.js).
 * Ke depan, konsumen HTML-sembarang pakai helper ini; invoice bisa migrasi belakangan.
 */
"use strict";

const fs = require("fs");
const puppeteer = require("puppeteer");

// Normalisasi opsi margin: string tunggal ("8mm") diterapkan ke empat sisi; object diteruskan apa adanya.
function normalizeMargin(margin) {
    if (!margin) return { top: "0", right: "0", bottom: "0", left: "0" };
    if (typeof margin === "string") return { top: margin, right: margin, bottom: margin, left: margin };
    return margin;
}

/**
 * Render string HTML ke Buffer PDF.
 * @param {string} html - dokumen HTML lengkap.
 * @param {object} [options]
 * @param {string} [options.format="A4"] - "A4" | "Letter" (dst yang didukung puppeteer).
 * @param {string|object} [options.margin="0"] - string diterapkan ke 4 sisi, atau object {top,right,bottom,left}.
 * @param {boolean} [options.printBackground=true]
 * @param {string} [options.waitUntil="load"] - "load" untuk konten statis + font sistem (JANGAN networkidle0
 *   bila HTML memuat web-font eksternal: di prod tanpa egress ia menggantung sampai timeout).
 * @param {number} [options.timeoutMs=60000] - batas waktu setContent & page.pdf; render yang macet
 *   (mis. batch besar ber-QR) MELEMPAR bersih alih-alih menggantung tanpa batas.
 * @returns {Promise<Buffer>} PDF asli. MELEMPAR bila Chromium/render gagal atau timeout.
 */
async function renderHtmlToPdf(html, options = {}) {
    const {
        format = "A4",
        margin = "0",
        printBackground = true,
        waitUntil = "load",
        timeoutMs = 60000
    } = options;

    const puppeteerConfig = {
        headless: true,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--disable-web-security",
            "--disable-features=IsolateOrigins,site-per-process",
            "--disable-accelerated-2d-canvas"
        ]
    };

    // Chromium sistem HANYA dipakai bila binernya BENAR-BENAR ADA. Menetapkan executablePath ke path
    // karangan TANPA SYARAT (bentuk lama) membuat puppeteer gagal di mesin tanpa Chromium sistem padahal
    // ia membawa Chromium bawaannya di ~/.cache/puppeteer. Biarkan KOSONG = puppeteer pakai browser bawaan.
    if (process.platform === "linux") {
        const chromiumPaths = [
            "/usr/bin/chromium-browser",
            "/usr/bin/chromium",
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable"
        ];
        const terpasang = chromiumPaths.find((p) => {
            try {
                return fs.existsSync(p);
            } catch (_e) {
                return false;
            }
        });
        if (terpasang) {
            puppeteerConfig.executablePath = terpasang;
            console.log(`[HTML_TO_PDF] Memakai Chromium sistem: ${terpasang}`);
        } else {
            // JANGAN set executablePath — biarkan puppeteer memakai browser bawaannya.
            let bawaan = "(bawaan puppeteer)";
            try {
                bawaan = puppeteer.executablePath();
            } catch (_e) { /* biarkan label generik */ }
            console.log(`[HTML_TO_PDF] Chromium sistem tak ada; memakai browser bawaan puppeteer: ${bawaan}`);
        }
    }

    let browser = null;
    try {
        browser = await puppeteer.launch(puppeteerConfig);
        const page = await browser.newPage();
        if (timeoutMs) page.setDefaultTimeout(timeoutMs);
        await page.setContent(String(html || ""), { waitUntil, timeout: timeoutMs });
        const pdfBuffer = await page.pdf({
            format,
            printBackground: Boolean(printBackground),
            margin: normalizeMargin(margin),
            timeout: timeoutMs
        });
        return pdfBuffer;
    } finally {
        if (browser) {
            try {
                await browser.close();
            } catch (_e) { /* abaikan galat penutupan */ }
        }
    }
}

module.exports = { renderHtmlToPdf };
