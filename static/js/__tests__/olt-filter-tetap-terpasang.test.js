/**
 * Header Doc
 * Purpose : Menjaga agar penyaring Monitor OLT TIDAK hilang saat modal detail dibuka (#b289).
 *           `renderCurrentView()` harus jadi SATU-SATUNYA tempat yang mengisi tabel, karena
 *           di situlah penyaring identitas diterapkan.
 * Caller  : jest
 * Deps    : pemindaian sumber halaman (tanpa DOM).
 * MainFuncs: —
 * SideEffects: tidak ada.
 *
 * KENAPA ADA — TERUKUR di peramban sebelum perbaikan:
 *   saring "Belum didaftarkan" → 2 baris  ·  klik satu baris → modal terbuka dan memicu
 *   refresh SENYAP → kembali 5 baris, sementara dropdown MASIH tertulis "mikrotik".
 * Rusaknya saat modal DIBUKA (refresh senyap otomatis), bukan saat ditutup — jadi mudah
 * salah diduga sebagai masalah pada tombol tutup.
 *
 * Penyebabnya: refresh itu memanggil `clear().rows.add(matchedData)` sendiri — data PENUH —
 * melewati `renderCurrentView()`. Penyaring identitas bekerja di tingkat DATA, jadi ia ikut
 * terbuang. Penyaring status/redaman selamat karena memakai `$.fn.dataTable.ext.search`
 * yang global; itulah kenapa gejalanya terasa "kadang hilang kadang tidak".
 */
"use strict";

const fs = require("fs");
const path = require("path");

const AKAR = path.join(__dirname, "..", "..", "..");   // static/js/__tests__ -> akar repo
const HALAMAN = ["static/js/admin-olt.js", "static/js/teknisi-olt.js"];
const baca = (p) => fs.readFileSync(path.join(AKAR, p), "utf8");

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

describe.each(HALAMAN)("#b289 — %s", (berkas) => {
    const src = baca(berkas);

    test("!! HANYA renderCurrentView yang boleh mengisi tabel", () => {
        // Setiap `rows.add(` di luar renderCurrentView adalah jalur yang MELEWATI penyaring.
        const render = badanFungsi(src, "function renderCurrentView()");
        expect(render).not.toBeNull();
        expect(render).toContain("rows.add(");

        const diLuar = [];
        const baris = src.split("\n");
        for (let i = 0; i < baris.length; i++) {
            const t = baris[i].trim();
            // Komentar bukan pemakaian — docblock `perbaruiSatuBaris` sengaja MENYEBUT
            // pola lamanya supaya pembaca berikutnya tahu apa yang tak boleh diulang.
            if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue;
            if (!t.includes("rows.add(")) continue;
            if (render.includes(t)) continue;   // yang di dalam renderCurrentView
            diLuar.push((i + 1) + ": " + t);
        }
        expect({ berkas, rowsAddDiLuarRenderCurrentView: diLuar })
            .toEqual({ berkas, rowsAddDiLuarRenderCurrentView: [] });
    });

    test("!! renderCurrentView mengisi `view` yang tersaring, BUKAN matchedData mentah", () => {
        const render = badanFungsi(src, "function renderCurrentView()");
        expect(render).toContain("saringIdentitas(matchedData");
        expect(render).toContain("rows.add(view)");
        expect(render).not.toContain("rows.add(matchedData)");
    });

    test("refresh di modal memakai pembaruan SATU baris", () => {
        expect(src).toContain("perbaruiSatuBaris(");
        const fn = badanFungsi(src, "function perbaruiSatuBaris(key)");
        expect(fn).not.toBeNull();
        // Mencari baris lewat _key, bukan indeks matchedData: tabel hanya memuat subset
        // yang lolos penyaring, jadi indeksnya tidak sejajar.
        expect(fn).toContain("data._key === key");
        expect(fn).toContain("row.data(baru)");
    });

    test("!! baris yang sedang TERSARING KELUAR tidak dipaksa muncul", () => {
        const fn = badanFungsi(src, "function perbaruiSatuBaris(key)");
        // `row.length === 0` = baris tak ada di tabel karena penyaring; harus DILEWATI.
        expect(fn).toMatch(/row\.length\s*===\s*0/);
        expect(fn).toMatch(/return/);
    });

    test("!! draw(false) — halaman & urutan dipertahankan", () => {
        // `draw()` polos melempar teknisi kembali ke halaman 1 tiap membuka detail.
        const fn = badanFungsi(src, "function perbaruiSatuBaris(key)");
        expect(fn).toContain("draw(false)");
    });

    test("modal detail memang memicu refresh SENYAP saat dibuka (asumsi bug ini)", () => {
        // Kalau baris ini hilang, gejalanya berubah dan komentar di atas jadi menyesatkan.
        expect(src).toContain("refreshCustomerOlt({ silent: true })");
    });
});

describe("#b289 — kedua halaman harus sama", () => {
    test("perbaruiSatuBaris identik di admin & teknisi", () => {
        const a = badanFungsi(baca(HALAMAN[0]), "function perbaruiSatuBaris(key)").replace(/\s+/g, " ").trim();
        const b = badanFungsi(baca(HALAMAN[1]), "function perbaruiSatuBaris(key)").replace(/\s+/g, " ").trim();
        expect(a).toBe(b);
    });
});
