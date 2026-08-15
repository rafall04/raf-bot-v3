/**
 * Header Doc
 * Purpose: Menjamin `uploads/` (foto KTP pelanggan, bukti transfer, foto tiket) hanya bisa
 *          diambil oleh sesi STAF — bukan siapa pun yang menebak URL-nya.
 * Caller: Jest test runner.
 * Deps: `express`, `../http-security` (`registerProtectedStatic`), `./helpers` via http.
 * MainFuncs: `panggil`.
 * SideEffects: Server HTTP ephemeral + berkas uji di direktori sementara.
 *
 * KENAPA ADA: `/uploads` dulu di-mount di `registerHttpSecurity`, yang dipanggil index.js
 * SEBELUM `registerHttpAuth`. Urutan pendaftaran = urutan eksekusi, jadi berkasnya disajikan
 * TANPA autentikasi sama sekali. Terukur di produksi: `uploads/psb/` berisi berkas
 * `ktp_photo.jpg` sungguhan — kartu identitas pelanggan.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const express = require("express");
const { registerProtectedStatic } = require("../http-security");

let akar;

beforeAll(() => {
    akar = fs.mkdtempSync(path.join(os.tmpdir(), "raf-uploads-"));
    fs.mkdirSync(path.join(akar, "uploads", "psb", "2026", "08", "PSB1"), { recursive: true });
    fs.writeFileSync(path.join(akar, "uploads", "psb", "2026", "08", "PSB1", "ktp_photo.jpg"), "KTP-RAHASIA");
    fs.mkdirSync(path.join(akar, "temp"), { recursive: true });
    fs.writeFileSync(path.join(akar, "temp", "bocor.txt"), "ISI-TEMP");
});

afterAll(() => {
    try {
        fs.rmSync(akar, { recursive: true, force: true });
    } catch (_e) { /* abaikan */ }
});

function buatApp(peran) {
    const app = express();
    app.use((req, _res, next) => {
        if (peran === "pelanggan") req.customer = { id: 9 };
        else if (peran) req.user = { id: 1, username: "x", role: peran };
        next();
    });
    registerProtectedStatic(app, { express, projectRoot: akar });
    return app;
}

async function panggil(app, jalur) {
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    try {
        const res = await new Promise((resolve, reject) => {
            const req = http.request(
                { host: "127.0.0.1", port: server.address().port, path: jalur, method: "GET", agent: false, headers: { Connection: "close" } },
                (r) => {
                    let teks = "";
                    r.setEncoding("utf8");
                    r.on("data", (c) => (teks += c));
                    r.on("end", () => resolve({ status: r.statusCode, teks }));
                }
            );
            req.on("error", reject);
            req.end();
        });
        return res;
    } finally {
        await new Promise((r) => server.close(r));
    }
}

const JALUR_SENSITIF = ["/uploads/psb/2026/08/PSB1/ktp_photo.jpg", "/temp/bocor.txt"];

describe("uploads & temp tertutup untuk yang bukan staf", () => {
    describe.each(["anonim", "pelanggan"])("peran %s", (peran) => {
        test.each(JALUR_SENSITIF)("%s ditolak dan isinya tak bocor", async (jalur) => {
            const app = buatApp(peran === "anonim" ? null : peran);
            const res = await panggil(app, jalur);

            expect(res.status).toBe(404);
            expect(res.teks).not.toContain("KTP-RAHASIA");
            expect(res.teks).not.toContain("ISI-TEMP");
        });
    });

    test("ditolak 404, BUKAN 403 — 403 membocorkan berkas mana yang ada", async () => {
        const res = await panggil(buatApp(null), "/uploads/psb/2026/08/PSB1/ktp_photo.jpg");
        expect(res.status).toBe(404);
    });

    test("berkas yang TIDAK ADA pun dijawab sama — tak bisa dipakai menebak", async () => {
        const ada = await panggil(buatApp(null), "/uploads/psb/2026/08/PSB1/ktp_photo.jpg");
        const tiada = await panggil(buatApp(null), "/uploads/psb/2026/08/TIDAKADA/ktp_photo.jpg");

        expect(ada.status).toBe(tiada.status);
    });
});

describe("staf tetap bisa membuka berkasnya", () => {
    test.each(["admin", "owner", "superadmin", "teknisi"])("peran %s", async (peran) => {
        const res = await panggil(buatApp(peran), "/uploads/psb/2026/08/PSB1/ktp_photo.jpg");

        expect(res.status).toBe(200);
        expect(res.teks).toBe("KTP-RAHASIA");
    });
});

describe("urutan pendaftaran di index.js", () => {
    test("registerProtectedStatic dipanggil SESUDAH registerHttpAuth", () => {
        const idx = fs.readFileSync(path.join(__dirname, "..", "..", "index.js"), "utf8");
        const posisiAuth = idx.indexOf("registerHttpAuth(app,");
        const posisiStatic = idx.indexOf("registerProtectedStatic(app,");

        // Urutan pendaftaran = urutan eksekusi. Kalau terbalik, `req.user` belum terisi saat
        // static dijalankan dan gerbangnya menolak SEMUA orang — atau, seperti sebelumnya,
        // tak ada gerbang sama sekali.
        expect(posisiAuth).toBeGreaterThan(-1);
        expect(posisiStatic).toBeGreaterThan(posisiAuth);
    });

    test("http-security tidak lagi mem-mount /uploads penuh sebelum auth", () => {
        const src = fs.readFileSync(path.join(__dirname, "..", "http-security.js"), "utf8");
        const fungsi = src.slice(
            src.indexOf("function registerHttpSecurity"),
            src.indexOf("function registerProtectedStatic")
        );

        // /uploads/logos (branding publik) boleh; /uploads penuh tidak.
        expect(fungsi).toMatch(/"\/uploads\/logos"/);
        expect(fungsi).not.toMatch(/app\.use\("\/uploads",/);
        expect(fungsi).not.toMatch(/app\.use\("\/temp",/);
    });
});

describe("auth global TIDAK melewati /uploads & /temp meski berekstensi gambar", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "http-auth-bootstrap.js"), "utf8");

    test("ada pengecualian eksplisit untuk jalur terlindungi", () => {
        // Tanpa ini, `req.user` tak pernah terisi untuk berkas .jpg di /uploads, sehingga
        // gerbang staf menolak SEMUA orang — lubang tertutup TAPI fitur foto tiket ikut mati.
        expect(src).toMatch(/jalurTerlindungi/);
        expect(src).toContain("(uploads|temp)");
    });

    test("pelewatan aset hanya berlaku bila BUKAN jalur terlindungi", () => {
        // Potong dari deklarasinya, 300 karakter ke depan. Versi pertama tes ini memotong
        // sampai `indexOf("verifyInternalServiceToken")` — yang menemukan barisnya di blok
        // IMPOR di puncak berkas, jauh SEBELUM titik awal, sehingga potongannya kosong dan
        // tesnya merah karena alasan yang salah.
        const mulai = src.indexOf("const jalurTerlindungi");
        const blok = src.slice(mulai, mulai + 300);

        expect(blok).toMatch(/if \(!jalurTerlindungi &&/);
    });

    test("polanya benar-benar cocok untuk jalur nyata", () => {
        const pola = /^\/+(uploads|temp)(\/|$)/i;

        expect(pola.test("/uploads/psb/2026/08/X/ktp_photo.jpg")).toBe(true);
        expect(pola.test("/temp/bocor.txt")).toBe(true);
        // Aset publik biasa TIDAK boleh ikut kena (itu akan memperlambat semua halaman).
        expect(pola.test("/js/html-escape.js")).toBe(false);
        expect(pola.test("/css/tokens.css")).toBe(false);
        expect(pola.test("/img/logo.png")).toBe(false);
        // Jangan tertipu awalan mirip.
        expect(pola.test("/uploads-lain/x.jpg")).toBe(false);
    });
});
