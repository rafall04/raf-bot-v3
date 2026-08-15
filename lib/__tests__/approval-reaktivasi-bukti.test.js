/**
 * Header Doc
 * Purpose: Mengunci bahwa pemulihan profil pasca-bayar diputuskan oleh BUKTI (profil live
 *          MikroTik), bukan oleh tanggal hari ini.
 * Caller: Jest test runner.
 * Deps: pemindaian sumber `../approval-logic.js`.
 * MainFuncs: —
 * SideEffects: Tidak ada.
 *
 * KENAPA ADA — `handlePaidStatusChange` dulu menggerbangi seluruh blok pemulihan dengan
 * `new Date().getDate() >= config.tanggal_isolir`. Tanggal adalah PROKSI, dan salah di
 * DUA arah sekaligus:
 *
 *  (a) Terlalu KETAT sebelum tanggal isolir. Pelanggan yang melunasi tunggakan di awal
 *      bulan — pola paling umum — tidak dipulihkan, dan TAK ADA cron yang membuka isolir
 *      (isolir.js hanya mengisolir dan melewati pelanggan `paid`; paid-reconcile hanya
 *      menyamakan flag). Produksi memakai tanggal_isolir=16 → jendela buta 15 hari/bulan.
 *  (b) Terlalu LONGGAR sesudahnya. Profil ditimpa tanpa syarat lalu sesi diputus paksa dan
 *      router di-reboot, walau pelanggan tak pernah terisolir — mencabut boost
 *      Speed-on-Demand/kompensasi dan memutus orang yang sedang memakai internetnya.
 *
 * Jalur bayar ONLINE sudah benar sejak awal (lib/services/bill-payment-settlement.js
 * `maybeReactivate` membaca profil live); jalur MANUAL yang tertinggal.
 *
 * Tes ini memindai SUMBER karena handlePaidStatusChange menyentuh MikroTik, WhatsApp, DB,
 * dan ledger sekaligus — memalsukan semuanya akan menguji tiruan, bukan gerbangnya.
 * Assertion sengaja ditembakkan ke pernyataan kode, bukan ke komentar.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const SUMBER = fs.readFileSync(path.join(__dirname, "..", "approval-logic.js"), "utf8");

// Buang komentar supaya assertion tak menangkap penjelasan tentang kode lama.
const KODE = SUMBER
    .split(/\r?\n/)
    .filter((b) => !/^\s*(\/\/|\*|\/\*)/.test(b))
    .join("\n");

describe("pemulihan profil TIDAK lagi digerbangi tanggal", () => {
    test("tak ada perbandingan getDate() dengan tanggal_isolir", () => {
        expect(KODE).not.toMatch(/currentDate\s*>=\s*tanggalIsolir/);
        expect(KODE).not.toMatch(/new Date\(\)\.getDate\(\)\s*>=/);
    });

    test("variabel proksi tanggal itu tak lagi dirakit", () => {
        expect(KODE).not.toMatch(/const\s+tanggalIsolir\s*=\s*parseInt\(config\.tanggal_isolir/);
    });
});

describe("gerbangnya berbasis BUKTI profil live", () => {
    test("membaca profil live dari MikroTik", () => {
        expect(KODE).toMatch(/getPPPoEUserProfile\(/);
        expect(KODE).toMatch(/caller:\s*['"]approval-logic\.detect['"]/);
    });

    test("hanya memulihkan bila profil live SAMA DENGAN isolir_profile", () => {
        expect(KODE).toMatch(/config\.isolir_profile/);
        expect(KODE).toMatch(/perluPulihkan\s*=\s*true/);
    });

    test("seluruh blok pemulihan bergantung pada perluPulihkan, bukan tanggal", () => {
        expect(KODE).toMatch(/if\s*\(perluPulihkan\)\s*\{/);
    });
});

describe("GAGAL-AMAN saat profil tak terbaca", () => {
    test("kegagalan baca TIDAK menyalakan pemulihan", () => {
        // "Tak bisa melihat" bukan "terlihat terisolir" — menebak lalu menimpa profil
        // bisa memutus pelanggan yang sedang aktif.
        const blok = KODE.slice(KODE.indexOf("let perluPulihkan"), KODE.indexOf("if (perluPulihkan)"));
        expect(blok).toMatch(/tak terbaca|gagal membaca/i);
        // Di seluruh blok gerbang, satu-satunya penyalaan adalah cabang "profil == isolir".
        expect((blok.match(/perluPulihkan\s*=\s*true/g) || []).length).toBe(1);
    });

    test("alasan tidak-memulihkan dicatat, tidak bisu", () => {
        expect(KODE).toMatch(/alasanLewat/);
        expect(KODE).toMatch(/Tidak memulihkan profil/);
    });
});

describe("selaras dengan jalur online yang sudah benar", () => {
    test("bill-payment-settlement tetap memakai gerbang profil live", () => {
        const lain = fs.readFileSync(
            path.join(__dirname, "..", "services", "bill-payment-settlement.js"),
            "utf8"
        );
        expect(lain).toMatch(/getPPPoEUserProfile/);
        expect(lain).toMatch(/liveProfile\s*!==\s*isolirProfile/);
    });
});
