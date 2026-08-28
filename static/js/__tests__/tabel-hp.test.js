/**
 * Header Doc
 * Purpose : Mengunci pola "tabel terpakai di layar HP" untuk SEMUA halaman staf yang
 *           tabelnya lebih lebar dari layar (#b290, #b291) — termasuk aturan KAPAN boleh
 *           menyembunyikan kolom dan kapan wajib menumpuk jadi kartu.
 * Caller  : jest
 * Deps    : pemindaian sumber (tanpa DOM).
 * MainFuncs: —
 * SideEffects: tidak ada.
 *
 * KENAPA ADA — TERUKUR di 375 px (wadah efektif 321 px), 2026-08-28:
 *   /teknisi-pelanggan 1378px(13 kolom) · /pembayaran/teknisi 924px(8) ·
 *   /teknisi-pembayaran 640px(6) · /teknisi-kasbon 550px(7) · /papan-psb 500px(8)
 * Teknisi memakai halaman ini di lapangan, di HP — bukan di meja.
 *
 * !! DUA POLA, dan memilih yang salah MENGHILANGKAN DATA:
 *   - Halaman punya MODAL DETAIL per-baris → boleh SEMBUNYIKAN kolom (datanya tetap
 *     terjangkau lewat detail, dan kolom tersembunyi tetap ikut tercari).
 *   - Halaman TIDAK punya modal detail    → WAJIB tumpuk jadi kartu.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const AKAR = path.join(__dirname, "..", "..", "..");   // static/js/__tests__ -> akar repo
const baca = (p) => fs.readFileSync(path.join(AKAR, p), "utf8");
const ada = (p) => fs.existsSync(path.join(AKAR, p));

const BERSAMA = "static/css/tabel-hp.css";

/** Halaman yang memakai pola TUMPUK (tak punya modal detail per-baris). */
const TUMPUK = [
    { nama: "/teknisi-pelanggan", php: "views/sb-admin/teknisi-pelanggan.php", js: "static/js/teknisi-pelanggan.js", stempel: "createdRow" },
    { nama: "/teknisi-kasbon", php: "views/sb-admin/teknisi-kasbon.php", js: "static/js/teknisi-kasbon.js", stempel: "createdRow" },
    { nama: "/pembayaran/teknisi", php: "views/sb-admin/pembayaran/teknisi.php", js: "static/js/pembayaran-teknisi.js", stempel: "createdRow" },
    { nama: "/papan-psb", php: "views/sb-admin/papan-psb.php", js: "static/js/papan-psb.js", stempel: "templat" },
];

/** Halaman yang memakai pola SEMBUNYI-KOLOM (punya modal detail per-baris). */
const SEMBUNYI = [
    { nama: "/teknisi-pembayaran", php: "views/sb-admin/teknisi-pembayaran.php", js: "static/js/teknisi-pembayaran.js",
      css: "static/css/teknisi-pembayaran.css", buktiDetail: "function showDetail" },
];

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

/** Potong badan sebuah fungsi (dari deklarasinya sampai kurung penutupnya). */
function badanFungsi(src, deklarasi) {
    const mulai = src.indexOf(deklarasi);
    if (mulai < 0) return null;
    let i = mulai, depth = 0, sudahBuka = false;
    while (i < src.length) {
        const ch = src[i];
        if (ch === "{") { depth++; sudahBuka = true; }
        else if (ch === "}") { depth--; if (sudahBuka && depth === 0) return src.slice(mulai, i + 1); }
        i++;
    }
    return null;
}

describe("#b291 — pola tumpuk tinggal di SATU berkas bersama", () => {
    test("berkas bersamanya ada dan berisi aturan kartunya", () => {
        expect(ada(BERSAMA)).toBe(true);
        const hp = blokHp(baca(BERSAMA));
        expect(hp).toMatch(/\.tabel-tumpuk-hp thead\s*\{[^}]*display:\s*none/);
        expect(hp).toContain("attr(data-label)");
    });

    test("dimuat di head BERSAMA, bukan per-halaman (inert tanpa kelasnya)", () => {
        expect(baca("views/sb-admin/_head.php")).toContain("/css/tabel-hp.css");
    });

    test("!! aturannya TIDAK disalin ke CSS halaman mana pun", () => {
        // Salinan = dua halaman bisa menyimpang diam-diam. Ini yang dihindari #b291.
        const nakal = [];
        for (const h of TUMPUK) {
            const cssHal = "static/css/" + path.basename(h.php, ".php") + ".css";
            if (!ada(cssHal)) continue;
            const hp = blokHp(baca(cssHal));
            if (/thead\s*\{[^}]*display:\s*none/.test(hp) && hp.includes("attr(data-label)")) nakal.push(cssHal);
        }
        expect(nakal).toEqual([]);
    });

    test("!! nilai panjang tanpa spasi bisa membungkus (anonymous flex item)", () => {
        // Nilai sel adalah simpul teks POLOS -> anonymous flex item yang TAK BISA diberi
        // `min-width: 0`. TERUKUR: Device ID 30 karakter membuat 1 dari 13 sel meluber,
        // scrollWidth 421 vs 316. Obatnya membungkus, bukan min-width.
        const hp = blokHp(baca(BERSAMA));
        expect(hp).toMatch(/flex-wrap:\s*wrap/);
        expect(hp).toMatch(/word-break:\s*break-all|overflow-wrap:\s*anywhere/);
    });

    test("paginasi DataTables ikut dirapikan (ia yang meluber setelah tabel ditumpuk)", () => {
        // TERUKUR: tabel sudah pas 321 px, tapi ul.pagination 339 px.
        const hp = blokHp(baca(BERSAMA));
        expect(hp).toMatch(/\.pagination[^{]*\{[^}]*flex-wrap:\s*wrap/);
    });
});

describe.each(TUMPUK)("#b291 — halaman TUMPUK: $nama", ({ php, js, stempel }) => {
    test("tabelnya memakai kelas bersama + wadahnya ditandai", () => {
        const src = baca(php);
        expect(src).toMatch(/<table[^>]*tabel-tumpuk-hp/);
        expect(src).toMatch(/table-responsive[^"]*tabel-tumpuk-hp-wrap|tabel-tumpuk-hp-wrap[^"]*table-responsive/);
    });

    test("setiap sel diberi data-label", () => {
        const src = baca(js);
        if (stempel === "createdRow") {
            // Diambil dari HEADER, bukan daftar tulis tangan — kolom bisa berubah saat runtime.
            expect(src).toContain('"createdRow"');
            const i = src.indexOf('"createdRow"');
            expect(src.slice(i, i + 700)).toContain("thead th");
            expect(src.slice(i, i + 700)).toContain("data-label");
        } else {
            // Tabel dirakit sendiri: label ditulis di templat.
            expect(src).toMatch(/<td data-label="/);
        }
    });

    test("!! TIDAK menyembunyikan kolom — halaman ini tak punya modal detail", () => {
        const cssHal = "static/css/" + path.basename(php, ".php") + ".css";
        if (!ada(cssHal)) return;
        const hp = blokHp(baca(cssHal));
        const nakal = [];
        for (const m of hp.matchAll(/(?:thead\s+th|td):nth-child\(\d+\)[^{]*\{[^}]*\}/g)) {
            if (/display:\s*none/.test(m[0])) nakal.push(m[0].slice(0, 50));
        }
        expect(nakal).toEqual([]);
    });
});

describe.each(SEMBUNYI)("#b291 — halaman SEMBUNYI-KOLOM: $nama", ({ js, css, buktiDetail }) => {
    test("!! boleh sembunyi kolom HANYA karena punya modal detail per-baris", () => {
        // Kalau modal ini dicabut, polanya WAJIB diganti jadi tumpuk-kartu — kalau tidak,
        // ID/Paket/Tgl Tagihan hilang tanpa jalan lain melihatnya.
        expect(baca(js)).toContain(buktiDetail);
    });

    test("kolom yang disembunyikan memang ada di modal detailnya", () => {
        // Badan fungsinya dipotong dengan pencocokan kurung, BUKAN jendela karakter tetap:
        // medan Paket/Tagihan ada di offset 4371/4528 sementara fungsinya 5366 karakter,
        // jadi jendela tebakan gampang meleset dan memberi merah palsu.
        const modal = badanFungsi(baca(js), buktiDetail);
        expect(modal).not.toBeNull();
        for (const medan of ["Paket", "Tagihan", "Tgl"]) expect(modal).toContain(medan);
    });

    test("kolom Aksi TIDAK ikut disembunyikan (di situ tombol menuju detail)", () => {
        const hp = blokHp(baca(css));
        // Kolom: 1 ID · 2 Pelanggan · 3 Paket · 4 Tgl Tagihan · 5 Status · 6 Aksi
        expect(hp).not.toMatch(/th:nth-child\(6\)[^{]*\{[^}]*display:\s*none/);
        expect(hp).not.toMatch(/th:nth-child\(2\)[^{]*\{[^}]*display:\s*none/);
        expect(hp).not.toMatch(/th:nth-child\(5\)[^{]*\{[^}]*display:\s*none/);
    });

    test("!! min-width lama dinetralkan — `width` tak bisa menyusut di bawahnya", () => {
        // AKAR terukur: `.table-payment { min-width: 640px }` memaksa tabel 640 px, jadi
        // menambah override lebar saja TIDAK PERNAH berhasil.
        const src = baca(css);
        expect(src).toMatch(/min-width:\s*640px/);          // aturan desktop tetap ada
        expect(blokHp(src)).toMatch(/min-width:\s*0\s*!important/);
    });
});
