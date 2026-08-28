/**
 * Header Doc
 * Purpose : GUARD kerapatan ponsel (#b297) — kartu statistik dua per baris dan toolbar
 *           dua tombol per baris, supaya isi halaman tidak terdorong jauh di bawah lipatan.
 * Caller  : jest
 * Deps    : pemindaian sumber CSS/JS (tanpa DOM).
 * MainFuncs: —
 * SideEffects: tidak ada.
 *
 * KENAPA ADA — TERUKUR, dan hasilnya MENGOREKSI dugaan awal audit.
 * Laporan menyebut penyebabnya "tumpukan tombol". Setelah tinggi tiap blok di atas tabel
 * benar-benar diukur, penyebab utamanya ternyata KARTU STATISTIK yang jatuh satu-per-baris:
 *     /rekap-keuangan  ~2.800px kartu statistik   /rekap-tunggakan 858px (7 kartu)
 *     /payment-status    588px                    /wifi-logs       523px
 *     /pengeluaran       491px                    /kas-usaha       370px
 * Tombol hanya dominan di SATU halaman (/users, 519px, 9 tombol) — bukan 8 halaman.
 *
 * Sesudah (tabel mulai di y, HP 375px):
 *     /users 1274 -> 1030   /rekap-tunggakan 1012 -> 819   /pengeluaran 1206 -> 983
 *     /wifi-logs 1621 -> 1385   /rekap-keuangan 3881 -> 3611   /kas-usaha 1595 -> 1439
 * Desktop 1440px diperiksa terpisah: tak ada yang berubah, dan 37/37 tabel tetap lulus.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const AKAR = path.join(__dirname, "..", "..", "..");
const baca = (p) => fs.readFileSync(path.join(AKAR, p), "utf8");

/** Isi sebuah @media block yang batasnya <= `batas` px. */
function blokPonsel(css, batas) {
    const out = [];
    const re = /@media\s*\(max-width:\s*([\d.]+)px\)\s*\{/g;
    let m;
    while ((m = re.exec(css)) !== null) {
        if (Number(m[1]) > batas) continue;
        let i = m.index + m[0].length, depth = 1;
        while (i < css.length && depth > 0) {
            if (css[i] === "{") depth++;
            else if (css[i] === "}") depth--;
            i++;
        }
        out.push(css.slice(m.index, i));
    }
    return out.join("\n");
}

describe("#b297 — kartu statistik dua per baris di ponsel", () => {
    const css = baca("static/css/components-modern.css");
    const ponsel = blokPonsel(css, 768);

    test("aturannya ADA, dan hanya di dalam media query ponsel", () => {
        expect(ponsel).toMatch(/:has\(>\s*\.stats-card\)/);
        expect(ponsel).toMatch(/max-width:\s*50%/);
        // Di luar media query tidak boleh ada — kalau bocor, desktop ikut jadi 2 kolom.
        const tanpaMedia = css.replace(/@media[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g, "");
        expect(tanpaMedia).not.toMatch(/:has\(>\s*\.stats-card\)/);
    });

    test("mendaftar SEMUA kelas kartu statistik yang dipakai panel", () => {
        // Kelasnya tidak seragam antar halaman; daftarnya sengaja dikumpulkan di SATU tempat.
        for (const k of ["stats-card", "summary-card", "olt-stats-card", "tk-stat", "kartu-statistik"]) {
            expect({ kelas: k, ada: ponsel.includes("." + k) }).toEqual({ kelas: k, ada: true });
        }
    });

    test("!! memakai :has(> …), bukan menyasar kelas kolom secara buta", () => {
        // `col-md-6`/`col-lg-3` dipakai juga oleh medan FORMULIR di halaman yang sama.
        // Menyasarnya langsung akan merusak tata letak formulirnya.
        expect(ponsel).not.toMatch(/\.col-md-6\s*\{[^}]*max-width:\s*50%/);
    });

    test("/rekap-tunggakan menandai kartunya dengan kelas eksplisit", () => {
        // Kartunya dirakit di JS dengan kelas Bootstrap generik (`card shadow-sm border-0`),
        // terlalu umum untuk dijadikan pengait :has() tanpa ikut menyasar kartu lain.
        expect(baca("static/js/rekap-tunggakan.js")).toMatch(/kartu-statistik/);
    });

    test("/kas-usaha diperbaiki di grid-nya sendiri, bukan lewat :has()", () => {
        // Halaman itu memakai CSS Grid sendiri, bukan kolom Bootstrap — aturan :has()
        // tak berlaku di sana. minmax(11rem) memaksa satu kolom di lebar ~340px.
        const ku = blokPonsel(baca("static/css/kas-usaha.css"), 768);
        expect(ku).toMatch(/\.ku-stats/);
        expect(ku).toMatch(/minmax\(9\.5rem/);
    });
});

describe("#b297 — toolbar /users dua tombol per baris", () => {
    test("!! aturannya ada di users.css, BUKAN cuma di lapisan bersama", () => {
        /*
         * users.css dimuat SETELAH dashboard-modern.css, jadi `flex-direction: column`
         * di sana mengalahkan aturan bersama. Perbaikan yang hanya ditaruh di lapisan
         * bersama TAMPAK benar tapi tak pernah kena — terbukti: perubahan pertama saya
         * di dashboard-modern.css menghasilkan nol perubahan terukur.
         */
        const ponsel = blokPonsel(baca("static/css/users.css"), 768);
        expect(ponsel).toMatch(/\.header-buttons\s*\{[^}]*display:\s*grid/);
        expect(ponsel).toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    });

    test("label panjang membungkus, tidak meluber keluar kolomnya", () => {
        // "Sync Profil ke MikroTik" di kolom ~165px. minmax(0,1fr) + white-space:normal.
        const ponsel = blokPonsel(baca("static/css/users.css"), 768);
        expect(ponsel).toMatch(/\.header-buttons \.btn\s*\{[^}]*white-space:\s*normal/);
    });

    test("lapisan bersama juga diperbaiki, untuk halaman yang tak punya CSS sendiri", () => {
        const ponsel = blokPonsel(baca("static/css/dashboard-modern.css"), 768);
        expect(ponsel).toMatch(/\.action-buttons\s*\{[^}]*display:\s*grid/);
    });

    test("tombol filter /users berdampingan di ponsel", () => {
        // Dropdown ODC/ODP sengaja DIBIARKAN selebar layar: isinya nama ODP panjang.
        const php = baca("views/sb-admin/users.php");
        expect((php.match(/col-6 col-md-3 d-flex align-items-end/g) || []).length).toBe(2);
    });
});
