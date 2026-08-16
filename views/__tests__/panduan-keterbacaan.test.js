/**
 * Header Doc
 * Purpose: Mengunci perbaikan keterbacaan halaman panduan — batas panjang baris prosa, dan
 *          perancah navigasi khusus panduan admin (dokumen 29 layar).
 * Caller: Jest test runner.
 * Deps: `fs`, `path`.
 * MainFuncs: —
 * SideEffects: Tidak ada (hanya membaca berkas sumber).
 *
 * ANGKA DI SINI DARI PENGUKURAN DI BROWSER (viewport 1440x900, halaman /admin-tutorial):
 *   · SEBELUM: baris prosa 127-141 karakter — hampir dua kali batas nyaman baca (45-75).
 *     Penyebabnya `.tut-wide` yang dilebarkan ke 1040px demi grid kartu; kartunya sendiri
 *     sehat (43 karakter) karena kolom grid membatasinya, yang melar hanya prosanya.
 *   · SESUDAH: 72 karakter untuk prosa, kartu tetap 43, grid tetap 3 kolom.
 *   · Halaman: 26.516px = 29 layar, 16 bagian, 85 kartu, tanpa cari & tanpa navigasi menetap.
 *     Menyaring "isolir" memangkasnya 28.809px -> 7.999px (29 cocok).
 */
"use strict";

const fs = require("fs");
const path = require("path");

const AKAR = path.join(__dirname, "..", "..");
const css = fs.readFileSync(path.join(AKAR, "static", "css", "tutorial.css"), "utf8");
const jsAdmin = fs.readFileSync(path.join(AKAR, "static", "js", "admin-tutorial.js"), "utf8");
const phpAdmin = fs.readFileSync(path.join(AKAR, "views", "sb-admin", "admin-tutorial.php"), "utf8");
const phpTeknisi = fs.readFileSync(path.join(AKAR, "views", "sb-admin", "teknisi-tutorial.php"), "utf8");

describe("panjang baris prosa dibatasi", () => {
    test("ada variabel --measure dan nilainya masuk akal untuk membaca", () => {
        const cocok = css.match(/--measure:\s*(\d+)ch/);
        expect(cocok).not.toBeNull();
        const ch = Number(cocok[1]);
        // `ch` = lebar glif "0" yang lebih lebar dari rata-rata huruf kecil: 72ch terukur
        // 86 karakter nyata, 60ch terukur 72. Di luar rentang ini, hasilnya keluar dari
        // batas nyaman baca 45-75.
        expect(ch).toBeGreaterThanOrEqual(50);
        expect(ch).toBeLessThanOrEqual(64);
    });

    test("batas itu dipasang pada elemen PROSA", () => {
        const blok = css.slice(css.indexOf("--measure:"));
        for (const sel of [".flow-sub", ".step-d", ".why", ".rule", ".note", "details.qa"]) {
            expect(blok).toContain(sel);
        }
        expect(blok).toMatch(/max-width:\s*var\(--measure\)/);
    });

    test("kartu & grid TIDAK ikut dibatasi — tata letak tiga kolomnya harus utuh", () => {
        // Kartu terukur 43 karakter (sehat) karena kolom grid sudah membatasinya. Membatasinya
        // lagi lewat --measure akan menyempitkan grid tanpa manfaat baca apa pun.
        const blokMeasure = css.slice(css.indexOf("--measure:"), css.indexOf("Navigasi untuk dokumen panjang"));
        expect(blokMeasure).not.toMatch(/\.card\s*[,{]/);
        expect(blokMeasure).not.toMatch(/\.grid\s*[,{]/);
    });
});

describe("perancah navigasi hanya untuk panduan admin", () => {
    test("panduan admin memuat admin-tutorial.js, bukan skrip panduan teknisi", () => {
        expect(phpAdmin).toContain("/js/admin-tutorial.js");
        expect(phpAdmin).not.toContain("/js/teknisi-tutorial.js");
    });

    test("panduan teknisi TIDAK ikut memuat perancah itu", () => {
        // Panduan teknisi 10x lebih pendek; bilah cari/lompat hanya jadi beban di sana.
        expect(phpTeknisi).not.toContain("/js/admin-tutorial.js");
    });

    test("gaya bilah di-scope ke .tut-wide supaya panduan lain tak kebagian", () => {
        for (const baris of css.split("\n").filter((l) => l.includes(".tut-bar"))) {
            if (baris.trim().startsWith("/*") || baris.trim().startsWith("*")) continue;
            expect(baris).toMatch(/\.tut-wide/);
        }
    });

    test("skrip menyediakan cari, lompat bagian, penanda posisi, dan kembali ke atas", () => {
        expect(jsAdmin).toMatch(/tb-cari/);
        expect(jsAdmin).toMatch(/tb-lompat/);
        expect(jsAdmin).toMatch(/aria-current/);
        expect(jsAdmin).toMatch(/tb-atas/);
    });
});

describe("jebakan tata letak sb-admin yang sudah terukur", () => {
    test("bilah TIDAK memakai position:sticky — di layout ini sticky gagal diam-diam", () => {
        // Terukur: `html` yang menggulir, tapi `body` dan `#content-wrapper` sama-sama
        // ber-`overflow-y: auto` tanpa pernah menggulir sendiri, sehingga sticky berpatokan
        // pada `#content-wrapper` yang justru ikut hanyut — bilah berakhir di top -3762.
        const blok = css.slice(css.indexOf(".tut.tut-wide .tut-bar {"), css.indexOf(".tut-bar-slot"));
        expect(blok).not.toMatch(/position:\s*sticky/);
        expect(blok).toMatch(/position:\s*fixed/);
    });

    test("slot penahan TIDAK boleh display:none", () => {
        // Elemen tersembunyi memulangkan rect nol semua, jadi ambang "sudah terlewat"
        // (top < 0) tak pernah tercapai dan bilahnya tak pernah melayang.
        const blok = css.slice(css.indexOf(".tut-bar-slot"));
        const aturan = blok.slice(0, blok.indexOf("}") + 1);
        expect(aturan).not.toMatch(/display:\s*none/);
        expect(aturan).toMatch(/height:\s*0/);
    });

    test("tombol ke atas memberi fokus dengan preventScroll", () => {
        // Tanpa `preventScroll`, memberi fokus ke kotak cari menggulirkannya ke dalam
        // pandangan dan MEMBATALKAN gulir-mulus ke atas — terukur berhenti di 1985px
        // alih-alih 0. Dengan preventScroll: 23.000 → 0.
        expect(jsAdmin).toMatch(/focus\(\s*\{\s*preventScroll:\s*true\s*\}\s*\)/);
    });

    test("alasan kedua jebakan itu tertulis di sumber, bukan cuma di riwayat git", () => {
        expect(css).toMatch(/overflow-y/);
        expect(css).toMatch(/#content-wrapper/);
        expect(jsAdmin).toMatch(/sticky/i);
    });
});
