/**
 * Header Doc
 * Purpose: Mengunci tata letak Monitor OLT di LAYAR HP (#b286) — kolom mana yang disisakan,
 *          urutan aturan CSS yang menentukan, dan kesamaan antara halaman admin & teknisi.
 * Caller: Jest
 * Deps: pemindaian berkas CSS/PHP (tanpa DOM).
 * MainFuncs: —
 * SideEffects: tidak ada.
 *
 * KENAPA ADA: TERUKUR di 375 px sebelum perbaikan — tabelnya 970 px, hanya 2 dari 10 kolom
 * muat, dan REDAMAN (angka yang justru dicari teknisi di atas tiang) ada di luar layar di
 * balik geser horizontal. Sesudah: 321 px, pas, kolomnya Pelanggan/Redaman/Status.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const AKAR = path.join(__dirname, "..", "..", "..");
const CSS = ["static/css/admin-olt.css", "static/css/teknisi-olt.css"];
const PHP = ["views/sb-admin/admin-olt.php", "views/sb-admin/teknisi-olt.php"];
const baca = (p) => fs.readFileSync(path.join(AKAR, p), "utf8");

// Urutan kolom tabel (1-indeks, sesuai :nth-child):
//   1 Pelanggan/ONU · 2 PPPoE · 3 Redaman · 4 ONU Tx · 5 Atenuasi
//   6 Status · 7 Penyebab · 8 OLT · 9 Slot/ONU · 10 Aksi
const DISEMBUNYIKAN = [2, 4, 5, 7, 8, 9, 10];
const DISISAKAN = [1, 3, 6];

function blokHp(src) {
    // Gabungkan isi SEMUA media query max-width <= 640px.
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

describe.each(CSS)("#b286 — %s", (berkas) => {
    const src = baca(berkas);
    const hp = blokHp(src);

    test("punya aturan khusus layar HP", () => {
        expect(hp.length).toBeGreaterThan(200);
    });

    test.each(DISEMBUNYIKAN)("kolom %i disembunyikan di HP", (n) => {
        expect(hp).toContain("#oltDataTable td:nth-child(" + n + ")");
    });

    test("!! REDAMAN (kolom 3) TIDAK ikut disembunyikan — itu alasan halaman ini dibuka", () => {
        // Kalau kolom 3 masuk daftar sembunyi, teknisi kehilangan satu-satunya angka yang dicari.
        const daftarSembunyi = hp.slice(hp.indexOf("display: none") - 900, hp.indexOf("display: none"));
        for (const n of DISISAKAN) {
            expect(daftarSembunyi).not.toContain("th:nth-child(" + n + "),");
        }
        expect(hp).toContain("td:nth-child(3)");   // tetap diatur (lebar/tebal), bukan disembunyikan
    });

    test("!! aturan dasar .olt-toolbar berada DI ATAS media query", () => {
        // Spesifisitasnya sama, jadi yang menang ditentukan URUTAN SUMBER. Ditulis di bawah,
        // `display: grid` di HP mati diam-diam — sudah terbukti sekali saat pengerjaan.
        const iDasar = src.indexOf(".olt-toolbar {");
        const iHp = src.search(/@media\s*\(max-width:\s*640px\)/);
        expect(iDasar).toBeGreaterThan(-1);
        expect(iHp).toBeGreaterThan(-1);
        expect(iDasar).toBeLessThan(iHp);
    });

    test("toolbar jadi grid di HP dan penyaringnya selebar penuh", () => {
        expect(hp).toMatch(/display:\s*grid/);
        expect(hp).toMatch(/\.olt-toolbar \.olt-filter\s*\{[^}]*width:\s*100%/);
    });

    test("tabel dipaksa muat, tidak menggeser horizontal", () => {
        expect(hp).toMatch(/#oltDataTable\s*\{[^}]*width:\s*100%\s*!important/);
    });
});

describe("#b286 — kedua halaman harus sama", () => {
    test("aturan HP di admin & teknisi identik (jangan sampai menyimpang)", () => {
        const a = blokHp(baca(CSS[0])).replace(/\s+/g, " ").trim();
        const b = blokHp(baca(CSS[1])).replace(/\s+/g, " ").trim();
        expect(a).toBe(b);
    });

    test.each(PHP)("%s: penyaing memakai kelas, BUKAN lebar sebaris", (berkas) => {
        const src = baca(berkas);
        for (const id of ["oltSelector", "identitasFilter", "statusFilter", "redamanFilter", "sortFilter"]) {
            const baris = src.split("\n").find((l) => l.includes('id="' + id + '"'));
            expect(baris).toBeDefined();
            expect(baris).toContain("olt-filter");
            // Gaya sebaris tak bisa ditimpa media query tanpa !important — itulah kenapa dicabut.
            expect(baris).not.toMatch(/style="width:\s*auto/);
        }
    });

    test.each(PHP)("%s: wadah toolbar TIDAK memakai utilitas d-flex Bootstrap", (berkas) => {
        const baris = baca(berkas).split("\n").find((l) => l.includes("olt-toolbar"));
        expect(baris).toBeDefined();
        // `d-flex` memakai !important sehingga display:grid di media query kalah diam-diam.
        expect(baris).not.toMatch(/\bd-flex\b/);
    });
});
