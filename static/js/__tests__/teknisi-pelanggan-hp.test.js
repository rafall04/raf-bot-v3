/**
 * Header Doc
 * Purpose : Mengunci tata letak /teknisi-pelanggan di layar HP (#b290) — baris ditumpuk jadi
 *           kartu berlabel, dan TIDAK ADA kolom yang disembunyikan.
 * Caller  : jest
 * Deps    : pemindaian sumber (tanpa DOM).
 * MainFuncs: —
 * SideEffects: tidak ada.
 *
 * KENAPA ADA — TERUKUR di 375 px sebelum perbaikan: tabelnya **1378 px** dengan 13 kolom
 * terlihat, melebar 4,3x dari layar. Teknisi harus menggeser menyamping untuk membaca satu
 * pelanggan. Sesudah: 321 px, pas, nol geser, 13/13 sel berlabel.
 *
 * !! BEDA PENANGANAN dari Monitor OLT (#b286) — dan bedanya PENTING:
 * di sana kolom boleh DISEMBUNYIKAN karena barisnya bisa diketuk dan modal detail
 * menampilkan semuanya. Halaman INI tidak punya modal detail per-baris, jadi menyembunyikan
 * kolom berarti datanya BENAR-BENAR HILANG. Karena itu semua kolom dipertahankan dan hanya
 * ditumpuk vertikal.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const AKAR = path.join(__dirname, "..", "..", "..");   // static/js/__tests__ -> akar repo
const JS = "static/js/teknisi-pelanggan.js";
const CSS = "static/css/teknisi-pelanggan.css";
const baca = (p) => fs.readFileSync(path.join(AKAR, p), "utf8");

/** Gabungkan isi SEMUA media query max-width <= 640px. */
function blokHp(src) {
    const out = [];
    const re = /@media\s*\(max-width:\s*(\d+)px\)\s*\{/g;
    let m;
    while ((m = re.exec(src)) !== null) {
        if (Number(m[1]) > 640) continue;
        let i = m.index + m[0].length, depth = 1;
        while (i < src.length && depth > 0) {
            if (src[i] === "{") depth++;
            else if (src[i] === "}") depth--;
            i++;
        }
        out.push(src.slice(m.index, i));
    }
    return out.join("\n");
}

describe("#b290 — /teknisi-pelanggan di layar HP", () => {
    const js = baca(JS);
    const css = baca(CSS);
    const hp = blokHp(css);

    test("label sel diambil dari HEADER, bukan daftar nama tulis tangan", () => {
        // Kolom di halaman ini bisa disembunyikan/ditampilkan saat runtime
        // (toggleDeviceMetricColumns), jadi daftar tangan pasti ketinggalan.
        expect(js).toContain('"createdRow"');
        const i = js.indexOf('"createdRow"');
        const blok = js.slice(i, i + 700);
        expect(blok).toContain("#dataTable thead th");
        expect(blok).toContain("data-label");
    });

    test("baris ditumpuk jadi kartu di HP", () => {
        expect(hp).toMatch(/#dataTable thead\s*\{[^}]*display:\s*none/);
        expect(hp).toMatch(/#dataTable td\b/);
        expect(hp).toContain("attr(data-label)");
    });

    test("!! TIDAK ADA kolom yang disembunyikan — halaman ini tak punya modal detail", () => {
        // Inilah beda pentingnya dari #b286. Kalau seseorang menyalin pola sembunyi-kolom
        // ke sini, datanya hilang tanpa jalan lain untuk melihatnya.
        const nakal = [];
        for (const m of hp.matchAll(/#dataTable\s+(?:thead\s+th|td):nth-child\(\d+\)[^{]*\{[^}]*\}/g)) {
            if (/display:\s*none/.test(m[0])) nakal.push(m[0].slice(0, 60));
        }
        expect(nakal).toEqual([]);
    });

    test("asumsi tetap benar: halaman ini memang tak punya modal detail per-baris", () => {
        // Kalau suatu hari modal detail DITAMBAHKAN, komentar di atas jadi usang —
        // tapi menyembunyikan kolom tetap harus keputusan sadar, bukan efek samping.
        expect(js).not.toMatch(/clickable-row/);
        expect(js).not.toMatch(/function showCustomerDetail/);
    });

    test("!! nilai panjang tanpa spasi harus bisa membungkus", () => {
        // Device ID `D49E02-RAFNETNV3a-EQFLH7U22977` adalah simpul teks POLOS di dalam flex
        // (anonymous flex item) — tak bisa diberi min-width, jadi ia memaksa sel melebar.
        // TERUKUR: 1 dari 13 sel meluber, scrollWidth 421 vs 316.
        expect(hp).toMatch(/flex-wrap:\s*wrap/);
        expect(hp).toMatch(/word-break:\s*break-all|overflow-wrap:\s*anywhere/);
    });

    test("tombol aksi TIDAK dilawan — aturan lamanya dihormati", () => {
        // `.device-action-group { flex-direction: column }` + tombol lebar penuh sudah ada
        // SEBELUM #b290; target sentuh besar memang tepat untuk teknisi di lapangan.
        expect(css).toMatch(/\.device-action-group\s*\{[^}]*flex-direction:\s*column/);
        const i = hp.indexOf("device-action-group");
        if (i > -1) {
            const blok = hp.slice(i, i + 260);
            expect(blok).not.toMatch(/flex-direction:\s*row/);
            expect(blok).not.toMatch(/width:\s*auto/);
        }
    });

    test("wadah tabel tak lagi perlu menggeser di HP", () => {
        expect(hp).toMatch(/\.table-responsive\s*\{[^}]*overflow-x:\s*visible/);
    });

    test("hanya token semantik (aman di mode gelap)", () => {
        // Warna primitif tetap tidak ikut membalik — akar tiap bug "gelap di atas gelap".
        for (const m of hp.matchAll(/(?:color|background|border[a-z-]*)\s*:\s*([^;]+);/g)) {
            const nilai = m[1].trim();
            if (nilai.startsWith("var(--") || /^(0|none|inherit|transparent|\d)/.test(nilai)) continue;
            expect({ deklarasi: m[0].trim() }).toEqual({ deklarasi: "HARUS pakai var(--token)" });
        }
    });
});
