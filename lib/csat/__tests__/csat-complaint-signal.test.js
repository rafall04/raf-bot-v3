/**
 * Header Doc
 * Purpose: Mengunci pendeteksi keluhan pada KOMENTAR SURVEI (#b263) — dikalibrasi ke komentar
 *          CSAT NYATA dari produksi, bukan contoh karangan.
 * Caller: Jest test runner.
 * Deps: `lib/csat/csat-complaint-signal`.
 * MainFuncs: —
 * SideEffects: Tidak ada.
 *
 * !! Semua string di bawah disalin APA ADANYA dari `csat.sqlite` produksi (termasuk salah ketik,
 * dialek, dan emoji). Mengganti mereka dengan contoh yang "rapi" akan membuat tes ini lulus
 * sementara jalur nyatanya gagal.
 */
"use strict";

const { adaKeluhanDiKomentar } = require("../csat-complaint-signal");

const KELUHAN_NYATA = [
    "soalnya kalau di pakai main game kadang lemot",
    "Tp NK mlam kok radak lemot ya",
    "Sering lag",
    "kadang lemot padal cuma hp 3",
    "jaringan nya agak lemot kak mohon segera diperbaiki trima kasih 🙏🙏😊",
    "kadang di buat game sama YouTube masih ngelag sinyal e",
    "Jaringanya masih sering hilang 🙏",
    "Di buat buka shopee lama loadingnya",
    "Kadang² susah sinyal nya",
    "Perbaiki",
    "Kadang lemot",
    "Wi-Fi nya agak lemot",
    "Jaringan sering muter kak",
    "jangkauannya makin sempit",
    "Sinyalnya diperkuat",
    "Tidak ada,sdh oke cuma kadang lemot internet nya tetapi juga langsung di respon"
];

const BUKAN_KELUHAN_NYATA = [
    "Gk ada kak. Makasih kembali",
    "Ok",
    "Pokok lancar aja Wifi-nya sudah senang",
    "Ndak ada sangat puas dengan pelayanan nya",
    "baik terimakasih",
    "Iy kak",
    "Dari awal pemasangan tak pernah ganti sandi.... Tapi tetap👍",
    "Oke",
    "Sudah baik semua. Kl ada keluhan juga fast respon 🙏",
    "iya kak ga papa",
    "Iya mas 🙏",
    "Gk ada kak"
];

describe("#b263 — keluhan dikenali dari ISI komentar", () => {
    test.each(KELUHAN_NYATA)("KELUHAN: %s", (teks) => {
        expect(adaKeluhanDiKomentar(teks).keluhan).toBe(true);
    });

    test.each(BUKAN_KELUHAN_NYATA)("BUKAN keluhan: %s", (teks) => {
        expect(adaKeluhanDiKomentar(teks).keluhan).toBe(false);
    });
});

describe("#b263 — jebakan konteks survei", () => {
    test('!! "tidak ada" di survei berarti TIDAK ADA KELUHAN, bukan keluhan', () => {
        // Matcher keluhan spontan (`hasConnectivityComplaintSignal`) salah di sini: terukur ia
        // menandai "Gk ada kak. Makasih kembali" sebagai keluhan. Mengirimi owner alarm tentang
        // pelanggan yang senang adalah cara tercepat membuat alarm diabaikan.
        ["Gk ada kak", "tidak ada", "ndak ada mas", "belum ada keluhan"].forEach((t) => {
            expect(adaKeluhanDiKomentar(t).keluhan).toBe(false);
        });
    });

    test('tapi "gak ada internet" TETAP keluhan — kata layanan mengubah artinya', () => {
        ["gak ada internet dari kemarin", "tidak ada jaringan", "gk ada sinyal"].forEach((t) => {
            expect(adaKeluhanDiKomentar(t).keluhan).toBe(true);
        });
    });

    test('kata "keluhan"/"komplain" TIDAK dihitung — keduanya meta', () => {
        // Satu-satunya komentar produksi yang memuatnya justru pujian.
        expect(adaKeluhanDiKomentar("Sudah baik semua. Kl ada keluhan juga fast respon").keluhan).toBe(false);
    });

    test("skor tinggi + keluhan nyata = tetap keluhan (kasus paling sering terlewat)", () => {
        // "mohon segera diperbaiki" ditulis pelanggan yang memberi skor 5.
        expect(adaKeluhanDiKomentar("jaringan nya agak lemot kak mohon segera diperbaiki").keluhan).toBe(true);
    });

    test("sebab SELALU terisi supaya keputusannya terbaca di log", () => {
        ["", "x", "lemot", "Gk ada kak"].forEach((t) => {
            const r = adaKeluhanDiKomentar(t);
            expect(typeof r.sebab).toBe("string");
            expect(r.sebab.length).toBeGreaterThan(3);
        });
    });

    test("masukan tak wajar tidak melempar", () => {
        [null, undefined, 123, {}, []].forEach((t) => {
            expect(() => adaKeluhanDiKomentar(t)).not.toThrow();
        });
    });
});

describe("#b263 — komentar berkeluhan diteruskan APA PUN skornya", () => {
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(path.join(__dirname, "..", "csat-survey-service.js"), "utf8");

    test("penerusan tidak lagi bergantung SEMATA pada skor", () => {
        // Terukur: 67-75% keluhan "lemot" datang dari pemberi skor 3-5. Menyaring dengan skor
        // berarti membuang justru bagian yang berisi.
        expect(src).toMatch(/adaKeluhanDiKomentar\(raw\)/);
        expect(src).toMatch(/const alasanTeruskan = isDetractorAlert\(cfg, active\.score\)/);
        expect(src).toMatch(/isiKeluhan\.keluhan \? `isi komentar/);
    });

    test("pesan ke owner menandai bila skornya tinggi — konteks itu penting", () => {
        // Owner perlu tahu ini BUKAN detractor biasa: pelanggannya sungkan memberi skor rendah.
        expect(src).toMatch(/skor tinggi, tapi komentarnya memuat keluhan/);
    });

    test("keputusan dicetak — 'tidak diteruskan' tak boleh terlihat sama dgn 'tak diperiksa'", () => {
        expect(src).toMatch(/CSAT_KOMENTAR/);
    });

    test("alert skor-rendah pada RATING tetap ada (dua hal berbeda)", () => {
        // Alert saat rating masuk = "ada yang tidak puas". Alert komentar = "ini sebabnya".
        // Yang kedua diperluas, yang pertama TIDAK diubah.
        expect(src).toMatch(/csat-detractor-rating/);
        expect(src).toMatch(/csat-detractor-comment/);
    });
});
