/**
 * Header Doc
 * Purpose : GUARD pesan konfirmasi aksi MERUSAK (#b298) — berbahasa Indonesia, berkalimat
 *           utuh, dan menyebut objek yang akan dihapus.
 * Caller  : jest
 * Deps    : pemindaian sumber static/js (tanpa DOM).
 * MainFuncs: —
 * SideEffects: tidak ada.
 *
 * KENAPA ADA — lima berkas memakai scaffold `window.deleteData` yang disalin-tempel dengan
 * pesan TERPOTONG, tanpa objek dan tanpa titik:
 *     confirm('Are you sure you want to delete this')
 * Yang membedakan kelimanya cuma endpoint DELETE-nya, jadi objeknya bisa diambil dari sana
 * dan bukan ditebak. Yang paling berkonsekuensi: transaction-2.js menghapus /api/payment/ —
 * itu CATATAN PEMBAYARAN, hilang dari rekap pemasukan.
 *
 * !! ANGKA DI LAPORAN AUDIT SAYA SALAH. Saya menulis "17 confirm()", padahal itu hasil
 * `grep -c` per BERKAS. Jumlah titik panggilan sebenarnya 60 di 33 berkas (44 sinkron,
 * 16 async). Yang diperbaiki di sini hanya 10 pesan berbahasa Inggris — lihat catatan
 * di boundary kenapa 60 titik itu TIDAK dikonversi ke dialog async sekalian.
 *
 * Diverifikasi di peramban: dialognya ditangkap, pesannya terbaca berbahasa Indonesia, dan
 * setelah DITOLAK tidak ada satu pun permintaan DELETE terkirim — alur kendalinya utuh.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const AKAR = path.join(__dirname, "..", "..", "..");
const DIR_JS = path.join(AKAR, "static/js");
const berkasJs = fs.readdirSync(DIR_JS).filter((f) => f.endsWith(".js"));
const baca = (f) => fs.readFileSync(path.join(DIR_JS, f), "utf8");

/** Semua string yang diteruskan ke confirm(), dari seluruh static/js. */
function pesanConfirm() {
    const out = [];
    for (const f of berkasJs) {
        const s = baca(f);
        for (const m of s.matchAll(/(?<![.\w])(?:window\.)?confirm\s*\(\s*([`'"])([\s\S]{0,240}?)\1/g)) {
            out.push({ berkas: f, pesan: m[2] });
        }
    }
    return out;
}

describe("#b298 — konfirmasi aksi merusak berbahasa Indonesia", () => {
    const semua = pesanConfirm();

    test("ada pesan yang terbaca (penjaganya tidak memindai nol berkas)", () => {
        // Tanpa ini, regex yang rusak membuat semua tes di bawah lolos secara palsu.
        expect(semua.length).toBeGreaterThan(20);
    });

    test("!! tak ada pesan berbahasa Inggris tersisa", () => {
        const ING = /\b(are you sure|do you want|this will|restore from backup|start the database|delete this|news item)\b/i;
        const nakal = semua.filter((x) => ING.test(x.pesan)).map((x) => x.berkas + " :: " + x.pesan.slice(0, 50));
        expect(nakal).toEqual([]);
    });

    test("!! scaffold deleteData yang terpotong sudah tak ada di berkas mana pun", () => {
        const nakal = berkasJs.filter((f) => baca(f).includes("Are you sure you want to delete this"));
        expect(nakal).toEqual([]);
    });

    test("tiap pesan hapus menyebut OBJEK-nya, bukan 'ini' telanjang", () => {
        // "Hapus ini?" tak memberi tahu apa yang hilang. Minimal satu kata benda.
        const nakal = semua
            .filter((x) => /^\s*hapus\s+ini\b/i.test(x.pesan))
            .map((x) => x.berkas + " :: " + x.pesan.slice(0, 40));
        expect(nakal).toEqual([]);
    });
});

describe("#b298 — aksi berkonsekuensi menyebut akibatnya", () => {
    const KONSEKUENSI = [
        // /api/payment/ = catatan pembayaran; hilang dari rekap pemasukan.
        ["transaction-2.js", /rekap pemasukan/i],
        // menghapus paket tidak menghapus pelanggannya — itu perlu dikatakan.
        ["packages-2.js", /pelanggan/i],
        // memulihkan cadangan MENGGANTI database yang sekarang.
        ["migrate.js", /DIGANTI/],
    ];
    for (const [f, pola] of KONSEKUENSI) {
        test(f + " menjelaskan akibatnya", () => {
            expect(baca(f)).toMatch(pola);
        });
    }
});

describe("#b298 — alur kendali TIDAK ikut diubah", () => {
    test("!! tetap confirm() sinkron, bukan diam-diam jadi async", () => {
        /*
         * Perbaikan ini SENGAJA hanya mengganti string. Mengubah `confirm()` sinkron jadi
         * dialog async adalah operasi alur kendali di 44 titik — dan salah satu saja yang
         * keliru berarti aksi HAPUS berjalan tanpa konfirmasi, jelas lebih buruk daripada
         * dialog yang tak bergaya. Kalau nanti dikonversi, konversinya harus per-titik
         * dengan verifikasi masing-masing, bukan cari-ganti massal.
         */
        for (const f of ["packages-2.js", "transaction-2.js", "statik-2.js", "payment-method-2.js", "atm-2.js"]) {
            const s = baca(f);
            expect({ berkas: f, adaConfirm: /if \(confirm\(/.test(s) }).toEqual({ berkas: f, adaConfirm: true });
        }
    });

    test("interpolasi ${filename} di migrate.js tidak rusak saat diterjemahkan", () => {
        // Pesannya template literal; terjemahan yang mengubah backtick jadi kutip biasa
        // akan mencetak "${filename}" mentah ke layar.
        const s = baca("migrate.js");
        expect(s).toMatch(/confirm\(`Pulihkan database dari cadangan: \$\{filename\}\?/);
    });
});
