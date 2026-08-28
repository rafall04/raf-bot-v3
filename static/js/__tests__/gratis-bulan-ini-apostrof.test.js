/**
 * Header Doc
 * Purpose : GUARD tombol Gratiskan tak boleh dibangun lewat interpolasi string ke atribut
 *           onclick (#b294). Nama pelanggan ber-apostrof memecah JS-nya dan tombol jadi mati.
 * Caller  : jest
 * Deps    : pemindaian sumber (tanpa DOM).
 * MainFuncs: tanpaKomentar()
 * SideEffects: tidak ada.
 *
 * KENAPA ADA — bug yang TERBUKTI di peramban sebelum diperbaiki:
 *   `var namaArg = esc(nama).replace(/'/g, "\\'")` tampak seperti penambal apostrof, padahal
 *   TIDAK PERNAH cocok: esc() sudah lebih dulu mengubah ' menjadi &#39;, jadi tak ada apostrof
 *   tersisa untuk di-replace. Saat peramban mengurai atribut onclick, &#39; dikembalikan jadi
 *   apostrof dan memecah string JS-nya:
 *       gratiskan('2','Ma'ruf',110000)   -> SyntaxError: missing ) after argument list
 *   Tombolnya tampak normal tapi diam total, tanpa pesan galat ke admin. Diukur: "Budi Santoso"
 *   jalan, "Ma'ruf" dan "Sa'diyah" tidak. Nama seperti itu lazim di basis pelanggan ini.
 *
 * !! Pemeriksaan WAJIB membuang komentar dulu. Komentar perbaikan di berkas itu MENGUTIP pola
 * lamanya sebagai penjelasan, dan penjaga naif akan menyangka bug-nya masih ada.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const AKAR = path.join(__dirname, "..", "..", "..");
const BERKAS = "static/js/gratis-bulan-ini.js";
const mentah = fs.readFileSync(path.join(AKAR, BERKAS), "utf8");

/** Sumber tanpa komentar blok maupun baris. */
function tanpaKomentar(s) {
    return s
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .filter((b) => !/^\s*\/\//.test(b))
        .join("\n");
}
const kode = tanpaKomentar(mentah);

describe("#b294 — tombol Gratiskan tak lagi lewat onclick sebaris", () => {
    test("!! tak ada onclick=\"gratiskan(...)\" di kode", () => {
        expect(kode).not.toMatch(/onclick="gratiskan\(/);
    });

    test("!! penambal apostrof yang tak pernah cocok sudah dicabut", () => {
        expect(kode).not.toMatch(/replace\(\/'\/g/);
    });

    test("tak ada atribut onclick sebaris tersisa sama sekali", () => {
        expect((kode.match(/onclick=/g) || []).length).toBe(0);
    });
});

describe("#b294 — data dibawa lewat atribut, bukan masuk ke dalam kode", () => {
    test("tombol memakai data-id / data-nama / data-amount", () => {
        for (const attr of ["data-id=", "data-nama=", "data-amount="]) {
            expect({ attr, ada: kode.includes(attr) }).toEqual({ attr, ada: true });
        }
    });

    test("ada kelas penanda + delegasi klik yang membacanya", () => {
        expect(kode).toContain("btn-gratiskan");
        // Delegasi dipasang di tbody, bukan per tombol — barisnya dirender ulang terus.
        expect(kode).toMatch(/addEventListener\("click"/);
        expect(kode).toMatch(/closest\((?:'|")\.btn-gratiskan(?:'|")\)/);
    });

    test("nama tetap di-escape untuk konteks HTML", () => {
        // Pindah ke data-* menghilangkan bahaya JS, TAPI atributnya tetap HTML —
        // tanda kutip ganda pada nama masih harus di-escape.
        expect(kode).toMatch(/data-nama="'\s*\+\s*esc\(/);
    });
});

describe("#b294 — komentar peringatannya ikut terjaga", () => {
    test("berkas menjelaskan kenapa onclick tak boleh kembali", () => {
        // Tanpa catatan ini, orang berikutnya melihat data-* sebagai gaya belaka
        // dan bisa menganggap onclick lebih ringkas.
        expect(mentah).toMatch(/JANGAN kembali ke onclick/i);
    });
});
