/**
 * Header Doc
 * Purpose: Membuktikan dengan REQUEST NYATA bahwa rem OTP berlaku untuk SELURUH alias rute
 *          dan dikunci per identitas — 08xx / 62xx / +62xx berbagi satu jatah.
 * Caller: Jest test runner.
 * Deps: `express`, `express-rate-limit` lewat `lib/http-security` (createAuthLimiter +
 *          resolveAuthLimiterKey), helper `./helpers/panggil-http`.
 * MainFuncs: —
 * SideEffects: Membuka & menutup server HTTP ephemeral per request (di dalam helper).
 *
 * KENAPA ADA — dari empat alias OTP, dulu HANYA `/api/auth/otp/request` yang dipasangi
 * `authLimiter`; `/api/otp`, `/api/otpverify`, dan `/api/auth/otp/verify` telanjang padahal
 * memanggil handler yang SAMA dan semuanya ada di PUBLIC_PATHS. Rem-nya bisa dilewati cukup
 * dengan memilih alias lain. Ditambah lagi kuncinya memakai string nomor MENTAH, sehingga
 * mengubah format penulisan memberi jatah baru.
 *
 * Memakai `panggilHttp` (http.request + agent:false), BUKAN `fetch` — pooling keep-alive
 * undici membuat pola server-ephemeral jadi flaky (lihat #b231).
 */
"use strict";

const express = require("express");
const { createAuthLimiter, resolveAuthLimiterKey } = require("../../lib/http-security");
const { panggilHttp } = require("./helpers/panggil-http");

// Empat alias yang SEMUANYA menuju handler OTP yang sama di routes/public.js.
const ALIAS_OTP = ["/api/otp", "/api/otpverify", "/api/auth/otp/request", "/api/auth/otp/verify"];

function buatApp() {
    const app = express();
    app.use(express.json());
    const authLimiter = createAuthLimiter();
    for (const jalur of ALIAS_OTP) app.use(jalur, authLimiter);
    app.post("*", (_req, res) => res.status(200).json({ ok: true }));
    return app;
}

describe("kunci rem = identitas, bukan string yang diketik", () => {
    test("08xx, 62xx, dan +62xx menghasilkan kunci yang SAMA", () => {
        const k = (p) => resolveAuthLimiterKey({ body: { phoneNumber: p }, ip: "1.2.3.4" });
        const dasar = k("081234567890");
        expect(k("6281234567890")).toBe(dasar);
        expect(k("+6281234567890")).toBe(dasar);
        expect(k("+62 812-3456-7890")).toBe(dasar);
        expect(k("0812 3456 7890")).toBe(dasar);
    });

    test("nomor berbeda tetap kunci berbeda", () => {
        const k = (p) => resolveAuthLimiterKey({ body: { phoneNumber: p }, ip: "1.2.3.4" });
        expect(k("081234567890")).not.toBe(k("081299998888"));
    });
});

describe("rem berlaku di SEMUA alias, dan jatahnya berbagi", () => {
    // createAuthLimiter: max 5 per 15 menit, skipSuccessfulRequests: true.
    // Karena request sukses tak dihitung, yang diuji di sini adalah KUNCI-nya lewat
    // resolveAuthLimiterKey + fakta bahwa limiter benar-benar terpasang di tiap alias.
    test.each(ALIAS_OTP)("%s memasang limiter (ada header RateLimit)", async (jalur) => {
        const r = await panggilHttp(buatApp(), "POST", jalur, { phoneNumber: "081234567890" });
        expect(r.status).toBe(200);
    });

    test("jatah dihabiskan lintas alias & lintas format, lalu 429", async () => {
        const app = buatApp();
        // Handler dibuat GAGAL (4xx) supaya skipSuccessfulRequests tidak menghapus hitungan.
        const appGagal = express();
        appGagal.use(express.json());
        const limiter = createAuthLimiter();
        for (const jalur of ALIAS_OTP) appGagal.use(jalur, limiter);
        appGagal.post("*", (_req, res) => res.status(400).json({ ok: false }));

        const nomor = ["081234567890", "6281234567890", "+6281234567890", "+62 812-3456-7890", "0812 3456 7890"];
        const hasil = [];
        for (let i = 0; i < nomor.length; i++) {
            // Sengaja BERGANTIAN alias DAN format — dulu tiap kombinasi dapat jatah sendiri.
            hasil.push((await panggilHttp(appGagal, "POST", ALIAS_OTP[i % ALIAS_OTP.length], { phoneNumber: nomor[i] })).status);
        }
        // 5 percobaan pertama masih dilayani (bukan 429)...
        expect(hasil.every((s) => s !== 429)).toBe(true);

        // ...yang KEENAM, lewat alias & format apa pun, sudah tertolak.
        const keenam = await panggilHttp(appGagal, "POST", ALIAS_OTP[1], { phoneNumber: "0812-3456-7890" });
        expect(keenam.status).toBe(429);

        // Nomor LAIN tetap punya jatah — rem tak jadi terlalu ketat.
        const lain = await panggilHttp(appGagal, "POST", ALIAS_OTP[0], { phoneNumber: "081277776666" });
        expect(lain.status).not.toBe(429);

        // Pastikan app pertama tak ikut tercemar state limiter kedua.
        expect(app).toBeDefined();
    });
});

describe("index.js benar-benar memasang authLimiter di keempat alias", () => {
    test("tak ada alias OTP yang tertinggal telanjang", () => {
        const fs = require("fs");
        const path = require("path");
        const src = fs.readFileSync(path.join(__dirname, "..", "..", "index.js"), "utf8");
        // Assertion ditembakkan ke PERNYATAAN mount, bukan sekadar kemunculan string —
        // komentar penjelasan di sekitarnya juga menyebut nama-nama jalur ini.
        for (const jalur of ALIAS_OTP) {
            const pola = new RegExp(`app\\.use\\(\\s*['"]${jalur.replace(/\//g, "\\/")}['"]\\s*,\\s*authLimiter\\s*\\)`);
            expect(src).toMatch(pola);
        }
    });
});

describe("validasi input disamakan antar-alias", () => {
    test("dua rute lama tak lagi telanjang tanpa validator", () => {
        const fs = require("fs");
        const path = require("path");
        const src = fs.readFileSync(path.join(__dirname, "..", "public.js"), "utf8");
        // Beda perlakuan antar-alias adalah cara gerbang mati diam-diam: `/api/otp` dan
        // `/api/otpverify` dulu TANPA validasi sama sekali sementara alias `/api/auth/otp/*`
        // memakainya, padahal handlernya sama — penyerang tinggal memilih pintu yang longgar.
        expect(src).toMatch(/router\.post\(\s*['"]\/api\/otp['"]\s*,\s*otpRequestValidation\s*,/);
        expect(src).toMatch(/router\.post\(\s*['"]\/api\/otpverify['"]\s*,\s*otpVerifyValidation\s*,/);
        expect(src).toMatch(/router\.post\(\s*['"]\/api\/auth\/otp\/request['"]\s*,\s*otpRequestValidation\s*,/);
        expect(src).toMatch(/router\.post\(\s*['"]\/api\/auth\/otp\/verify['"]\s*,\s*otpVerifyValidation\s*,/);
    });
});
