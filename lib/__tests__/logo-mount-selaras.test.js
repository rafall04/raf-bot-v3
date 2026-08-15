/**
 * Header Doc
 * Purpose: Mengunci bahwa URL logo perusahaan yang DICATAT ke config benar-benar bisa diambil
 *          lewat HTTP — yakni mount `/uploads/logos` menunjuk folder yang sama dengan tempat
 *          `routes/invoice.js` menyimpan berkasnya.
 * Caller: Jest test runner.
 * Deps: `express`, `lib/http-security.js`, helper `routes/__tests__/helpers/panggil-http.js`.
 * MainFuncs: —
 * SideEffects: Menulis lalu menghapus satu berkas uji di `static/uploads/logos/`.
 *
 * KENAPA ADA: unggah logo menyimpan berkas ke `static/uploads/logos/` tapi mencatat URL
 * `/uploads/logos/<file>` ke `config.company.logoPath` — sementara mount `/uploads/logos`
 * menunjuk `<root>/uploads/logos` yang SELALU KOSONG. Logo karenanya selalu tampil rusak di
 * /invoice-settings, portal pelanggan, halaman legal, dan situs publik. Terukur di produksi
 * Tanjungharjo 2026-08-15: `/uploads/logos/<file>` → 302, `/static/uploads/logos/<file>` → 200.
 *
 * Tes ini sengaja RUNTIME, bukan pemindaian sumber: yang harus benar adalah "berkas yang
 * disimpan bisa diambil", bukan "baris kodenya terlihat benar".
 */
"use strict";

const fs = require("fs");
const path = require("path");
const express = require("express");

const { registerHttpSecurity } = require("../http-security");
const { panggilHttp } = require("../../routes/__tests__/helpers/panggil-http");

const PROJECT_ROOT = path.join(__dirname, "..", "..");
const FOLDER_LOGO = path.join(PROJECT_ROOT, "static", "uploads", "logos");
const NAMA_UJI = "__uji-mount-logo__.png";
const BERKAS_UJI = path.join(FOLDER_LOGO, NAMA_UJI);

// PNG 1x1 sah — cukup untuk membuktikan berkasnya tersaji utuh beserta Content-Type-nya.
const PNG_1PX = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64"
);

function buatApp() {
    const app = express();
    registerHttpSecurity(app, { express, projectRoot: PROJECT_ROOT });
    return app;
}

beforeAll(() => {
    fs.mkdirSync(FOLDER_LOGO, { recursive: true });
    fs.writeFileSync(BERKAS_UJI, PNG_1PX);
});

afterAll(() => {
    try {
        fs.unlinkSync(BERKAS_UJI);
    } catch (_e) {
        /* sudah hilang: tidak apa-apa */
    }
});

describe("URL logo yang dicatat ke config bisa diambil lewat HTTP", () => {
    test("berkas di static/uploads/logos tersaji di /uploads/logos", async () => {
        // Persis bentuk URL yang ditulis routes/invoice.js ke config.company.logoPath.
        const hasil = await panggilHttp(buatApp(), "GET", `/uploads/logos/${NAMA_UJI}`);
        expect(hasil.status).toBe(200);
    });

    test("mount TIDAK menunjuk folder uploads/logos di root (yang tak pernah diisi)", async () => {
        // Bukti negatifnya: berkas yang hanya ada di root/uploads/logos TIDAK tersaji.
        // Kalau tes ini merah, mount-nya berpindah kembali ke akar yang salah.
        const folderSalah = path.join(PROJECT_ROOT, "uploads", "logos");
        const berkasSalah = path.join(folderSalah, "__uji-akar-salah__.png");
        fs.mkdirSync(folderSalah, { recursive: true });
        fs.writeFileSync(berkasSalah, PNG_1PX);

        try {
            const hasil = await panggilHttp(buatApp(), "GET", "/uploads/logos/__uji-akar-salah__.png");
            expect(hasil.status).not.toBe(200);
        } finally {
            try {
                fs.unlinkSync(berkasSalah);
            } catch (_e) {
                /* abaikan */
            }
        }
    });
});

describe("konvensi logoPath tetap: relatif terhadap static/", () => {
    test("routes/invoice.js menyimpan ke static/uploads/logos dan mencatat prefiks /uploads/logos/", () => {
        const sumber = fs.readFileSync(path.join(PROJECT_ROOT, "routes", "invoice.js"), "utf8");

        // Kedua sisi harus tetap sepasang; kalau salah satunya diubah sendirian, logo rusak lagi.
        expect(sumber).toMatch(/['"]static['"],\s*['"]uploads['"],\s*['"]logos['"]/);
        expect(sumber).toMatch(/['"]\/uploads\/logos\/['"]\s*\+\s*req\.file\.filename/);
    });

    test("pembacaan filesystem (PDF & hapus logo lama) menggabungkan static + logoPath", () => {
        const generator = fs.readFileSync(path.join(PROJECT_ROOT, "lib", "pdf-invoice-generator.js"), "utf8");
        const invoice = fs.readFileSync(path.join(PROJECT_ROOT, "routes", "invoice.js"), "utf8");

        // Inilah alasan `logoPath` TIDAK boleh diubah jadi `/static/uploads/...`:
        // kedua pembacaan ini akan menunjuk `static/static/...` dan logo mati di PDF.
        expect(generator).toMatch(/path\.join\(__dirname,\s*['"]\.\.['"],\s*['"]static['"],\s*relativeLogoPath\)/);
        expect(invoice).toMatch(/path\.join\(__dirname,\s*['"]\.\.['"],\s*['"]static['"],\s*config\.company\.logoPath\)/);
    });
});
