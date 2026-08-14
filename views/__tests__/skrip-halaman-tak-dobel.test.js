/**
 * Header Doc
 * Purpose: Mencegah satu berkas JS dimuat DUA KALI dalam satu halaman `.php`, dan mencegah
 *          tag <script> terselip di dalam markup teks (mis. di dalam <span> copyright).
 * Caller: Jest test runner.
 * Deps: `fs`, `path`.
 * MainFuncs: —
 * SideEffects: Tidak ada — hanya membaca berkas view.
 *
 * KENAPA ADA: `network-assets.php` memuat `network-assets.js` dua kali — sekali terselip di
 * dalam <span> copyright SEBELUM jQuery, sekali lagi di akhir body. Muatan pertama melempar
 * `$ is not defined` setelah sempat mendeklarasikan binding `let` global; muatan kedua lalu
 * gagal PARSE ("Identifier ... has already been declared") sehingga tak pernah dieksekusi.
 * Halaman tampak normal di server, tapi mati total di browser: DataTable tak di-init, daftar
 * ODC/ODP kosong, tombol Tambah/Edit/Hapus dan peta tidak berfungsi.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const DIR_VIEW = path.join(__dirname, "..", "sb-admin");
const halaman = fs
    .readdirSync(DIR_VIEW)
    .filter((f) => f.endsWith(".php") && !f.startsWith("_"))
    .sort();

// Ambil src dari setiap <script src="...">, termasuk bentuk PHP `<?= rafAssetUrl('/js/x.js') ?>`.
//
// Tag di-ambil UTUH dulu, baru src-nya diurai. Mengurai langsung dengan `src="([^"']+)"`
// salah: pola itu berhenti di kutip tunggal DI DALAM rafAssetUrl('...'), sehingga banyak tag
// menghasilkan potongan yang sama dan tampak seperti duplikat.
// Komentar HTML dibuang lebih dulu: penjelasan yang MENYEBUT sebuah tag <script> bukan
// pemuatan, dan tanpa ini komentar dokumentasi sendiri bisa membuat tes merah.
function tanpaKomentarHtml(isi) {
    return isi.replace(/<!--[\s\S]*?-->/g, "");
}

function ambilSrcSkrip(sumber) {
    const isi = tanpaKomentarHtml(sumber);
    const hasil = [];
    for (const tag of isi.matchAll(/<script\b[^>]*?>/gi)) {
        const teksTag = tag[0];
        const lewatHelper = teksTag.match(/rafAssetUrl\(\s*['"]([^'"]+)['"]/);
        if (lewatHelper) {
            hasil.push(lewatHelper[1]);
            continue;
        }
        const polos = teksTag.match(/\bsrc\s*=\s*"([^"]*)"|\bsrc\s*=\s*'([^']*)'/);
        if (polos) hasil.push(polos[1] || polos[2]);
    }
    return hasil;
}

describe("tidak ada berkas JS yang dimuat dua kali dalam satu halaman", () => {
    test.each(halaman)("%s", (berkas) => {
        const isi = fs.readFileSync(path.join(DIR_VIEW, berkas), "utf8");

        const hitung = new Map();
        for (const src of ambilSrcSkrip(isi)) {
            // Bandingkan berdasarkan nama berkas tanpa query cache-bust.
            const kunci = src.split("?")[0].split("/").pop();
            hitung.set(kunci, (hitung.get(kunci) || 0) + 1);
        }

        const dobel = [...hitung.entries()].filter(([, n]) => n > 1).map(([k, n]) => `${k} x${n}`);
        expect(dobel).toEqual([]);
    });
});

describe("tag <script> tidak terselip di dalam elemen teks", () => {
    // Pola yang benar-benar terjadi: <span>…<script …></script></span>. Selain merusak urutan
    // muat, ia juga tak terlihat saat membaca bagian <head>/akhir body.
    const POLA_TERSELIP = /<(span|p|small|td|h[1-6]|label|strong|em)\b[^>]*>[^<]*<script\b/i;

    test.each(halaman)("%s", (berkas) => {
        const isi = tanpaKomentarHtml(fs.readFileSync(path.join(DIR_VIEW, berkas), "utf8"));
        const cocok = isi.match(POLA_TERSELIP);

        expect(cocok ? `${berkas}: ${cocok[0].slice(0, 80)}` : null).toBeNull();
    });
});
