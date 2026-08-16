/**
 * Header Doc
 * Purpose: Mengunci pengenalan niat MEMBATALKAN — cukup longgar untuk bahasa pelanggan nyata,
 *          tapi cukup ketat supaya nama/sandi WiFi yang sah tidak ikut dibatalkan.
 * Caller: Jest test runner.
 * Deps: `lib/affirmative-parser.js`, `message/handlers/raf-interceptors.js`.
 * MainFuncs: —
 * SideEffects: Tidak ada.
 *
 * KENAPA ADA — daftar lama cocok-PERSIS `['batal','cancel','ga jadi','gak jadi']`. Karena state
 * input WiFi TERPROTEKSI dari perintah global, apa pun yang tak cocok persis langsung dipakai
 * sebagai NAMA/SANDI WiFi rumah pelanggan. Tanpa langkah konfirmasi (setelan
 * `custom_wifi_modification` mati), nilainya ditulis ke modem dan bot membalas
 * "Berhasil! Kata sandi WiFi telah diubah menjadi: batal aja" — seluruh perangkat di rumah
 * terputus. Prompt bot sendiri yang mengajari kata itu ("Ketik *batal* untuk membatalkan").
 *
 * DUA ARAH diuji di sini, karena melonggarkan terlalu jauh sama merusaknya: pelanggan yang
 * benar-benar ingin memberi nama WiFi "Stop Kontak" tak boleh gagal.
 */
"use strict";

const { isCancelIntent } = require("../affirmative-parser");
const { isCancellationKeyword } = require("../../message/handlers/raf-interceptors");

describe("frasa pembatalan yang DULU lolos jadi nama/sandi WiFi", () => {
    const NYATA = [
        "batal", "Batal", "BATAL",
        "batal aja", "batal saja", "batal wae", "batal dulu",
        "batalkan", "dibatalkan",
        "batal ya", "batal ya kak", "batal kak", "batal mas",
        "cancel", "cancel aja", "Cancel",
        "stop", "STOP", "hentikan", "berhenti",
        "ga jadi", "gak jadi", "gk jadi", "nggak jadi", "tidak jadi", "tdk jadi",
        "ora sido", "ga usah", "gak usah",
    ];
    test.each(NYATA)("%p dikenali sebagai pembatalan", (teks) => {
        expect(isCancelIntent(teks)).toBe(true);
        expect(isCancellationKeyword(teks)).toBe(true);
    });
});

describe("nama/sandi WiFi yang SAH tidak boleh dianggap batal", () => {
    // Kalau salah satu dari ini dianggap pembatalan, pelanggan tak bisa memakai nama yang dia mau —
    // kerusakan yang setara, hanya arahnya terbalik.
    const SAH = [
        "RumahBatal", "batalkan123", "Stop Kontak", "StopKontak",
        "WiFi Keluarga", "RafnetGriya", "Kontrakan Bu Sri",
        "P4ssw0rdKu", "rahasia123", "12345678", "internetlancar",
        "jangan lupa bayar",       // kalimat, bukan pembatalan
        "ya kak",                  // cuma partikel — bukan pembatalan
        "ok", "iya", "siap",       // afirmasi, bukan pembatalan
        "ganti nama wifi",         // permintaan, bukan pembatalan
        "batal ya kak tapi nanti saya ganti lagi", // >4 kata: perlakukan sebagai kalimat
    ];
    test.each(SAH)("%p TIDAK dianggap pembatalan", (teks) => {
        expect(isCancelIntent(teks)).toBe(false);
    });
});

describe("masukan aneh tak melempar", () => {
    test.each([null, undefined, "", "   ", 123, {}])("%p aman", (nilai) => {
        expect(() => isCancelIntent(nilai)).not.toThrow();
        expect(isCancelIntent(nilai)).toBe(false);
    });
});

describe("kompatibilitas mundur", () => {
    test("empat kata lama tetap dikenali persis seperti sebelumnya", () => {
        for (const k of ["batal", "cancel", "ga jadi", "gak jadi"]) {
            expect(isCancellationKeyword(k)).toBe(true);
        }
    });

    test("interceptor tidak lagi memakai pencocokan PERSIS sebagai satu-satunya jalan", () => {
        const fs = require("fs");
        const path = require("path");
        const src = fs.readFileSync(path.join(__dirname, "..", "..", "message", "handlers", "raf-interceptors.js"), "utf8");
        expect(src).toMatch(/isCancelIntent/);
        // Daftar lama SENGAJA dipertahankan sebagai jaring bila parser gagal dimuat.
        expect(src).toMatch(/CANCEL_KEYWORDS\.includes/);
    });
});
