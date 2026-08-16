/**
 * Header Doc
 * Purpose: Mengunci bahwa rem OTP dikunci per IDENTITAS (nomor ternormalkan), bukan per
 *          string yang diketik — sehingga 08xx / 62xx / +62xx berbagi SATU jatah.
 * Caller: Jest test runner.
 * Deps: `lib/otp.js`.
 * MainFuncs: —
 * SideEffects: Tidak ada (Map in-memory di dalam modul; direset tiap tes lewat
 *          resetOTPAttempts untuk semua format yang dipakai).
 *
 * KENAPA ADA — kunci rem dulu memakai nomor MENTAH (`request_${phoneNumber}`), jadi
 * `081234567890`, `6281234567890`, dan `+62 812-3456-7890` menjadi TIGA kunci berbeda yang
 * masing-masing dapat jatah penuh. Akibatnya rem "3 OTP per jam" bisa dilewati hanya dengan
 * mengubah format penulisan: satu pelanggan bisa dibanjiri OTP dari nomor bot (risiko nomor
 * bot diblokir WhatsApp), dan lockout "salah 5 kali" pada verifikasi praktis tak berlaku.
 * Polanya menyalin `resolveAuthLimiterKey` (lib/http-security.js) yang sudah benar.
 */
"use strict";

const { checkOTPRequestLimit, checkOTPVerifyLimit, resetOTPAttempts } = require("../otp");

// Satu nomor yang SAMA, ditulis lima cara berbeda.
const NOMOR = "081234567890";
const VARIAN = ["081234567890", "6281234567890", "+6281234567890", "+62 812-3456-7890", "0812 3456 7890"];

beforeEach(() => {
    // Bersihkan semua kemungkinan kunci — termasuk bentuk mentah, kalau-kalau normalisasinya
    // rusak dan menyisakan kunci lama.
    for (const v of VARIAN) resetOTPAttempts(v);
});

describe("rem permintaan OTP dikunci per identitas", () => {
    test("3 permintaan pertama lolos, ke-4 ditolak — walau formatnya beda-beda", () => {
        // MAX_OTP_REQUESTS = 3 per jam.
        expect(checkOTPRequestLimit(VARIAN[0]).allowed).toBe(true);
        expect(checkOTPRequestLimit(VARIAN[1]).allowed).toBe(true);
        expect(checkOTPRequestLimit(VARIAN[2]).allowed).toBe(true);

        // Format KEEMPAT yang berbeda lagi — dulu ini dapat jatah baru.
        const keempat = checkOTPRequestLimit(VARIAN[3]);
        expect(keempat.allowed).toBe(false);
        expect(typeof keempat.remainingTime).toBe("number");
    });

    test("setiap varian penulisan memberi hasil yang sama persis", () => {
        // Habiskan jatah dengan satu format...
        checkOTPRequestLimit(NOMOR);
        checkOTPRequestLimit(NOMOR);
        checkOTPRequestLimit(NOMOR);
        // ...lalu SEMUA format lain harus ikut tertolak.
        for (const v of VARIAN) {
            expect(checkOTPRequestLimit(v).allowed).toBe(false);
        }
    });

    test("nomor BERBEDA tetap punya jatah sendiri (rem tak jadi terlalu ketat)", () => {
        checkOTPRequestLimit(NOMOR);
        checkOTPRequestLimit(NOMOR);
        checkOTPRequestLimit(NOMOR);
        expect(checkOTPRequestLimit(NOMOR).allowed).toBe(false);

        const lain = "081299998888";
        try {
            expect(checkOTPRequestLimit(lain).allowed).toBe(true);
        } finally {
            resetOTPAttempts(lain);
        }
    });
});

describe("lockout verifikasi OTP dikunci per identitas", () => {
    test("5 percobaan lalu terkunci — ganti format TIDAK mereset", () => {
        // MAX_VERIFY_ATTEMPTS = 5.
        for (let i = 0; i < 5; i++) checkOTPVerifyLimit(VARIAN[i % VARIAN.length]);
        for (const v of VARIAN) {
            const h = checkOTPVerifyLimit(v);
            expect(h.allowed).toBe(false);
            expect(h.attemptsLeft).toBe(0);
        }
    });

    test("attemptsLeft menurun lintas format, bukan tiap format punya hitungan sendiri", () => {
        const a = checkOTPVerifyLimit(VARIAN[0]);
        const b = checkOTPVerifyLimit(VARIAN[1]);
        const c = checkOTPVerifyLimit(VARIAN[2]);
        expect(a.attemptsLeft).toBeGreaterThan(b.attemptsLeft);
        expect(b.attemptsLeft).toBeGreaterThan(c.attemptsLeft);
    });
});

describe("reset memakai kunci yang sama dengan penulisnya", () => {
    test("reset dengan format BERBEDA tetap membuka kunci", () => {
        // Kalau reset masih memakai nomor mentah sementara pencatatnya sudah dinormalkan,
        // reset akan diam-diam tak menghapus apa pun dan pelanggan tetap terkunci.
        for (let i = 0; i < 5; i++) checkOTPVerifyLimit(NOMOR);
        expect(checkOTPVerifyLimit(NOMOR).allowed).toBe(false);

        resetOTPAttempts("+62 812-3456-7890"); // format lain sama sekali
        expect(checkOTPVerifyLimit(NOMOR).allowed).toBe(true);
    });
});
