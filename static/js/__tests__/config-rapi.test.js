/**
 * Header Doc
 * Purpose : Mengunci perapian halaman /config (#b292) — judul tak lagi berlapis tiga, gaya
 *           pindah ke CSS, dan pane padat memakai dua kolom di layar lebar.
 * Caller  : jest
 * Deps    : pemindaian sumber (tanpa DOM).
 * MainFuncs: —
 * SideEffects: tidak ada.
 *
 * KENAPA ADA — TERUKUR sebelum perbaikan:
 *   - 10 pane punya <h4 class="dashboard-section-title"> yang MENGULANG label tab dan/atau
 *     judul kartu tepat di bawahnya. Enam di antaranya kembar PERSIS ("Konfigurasi MikroTik"
 *     muncul dua kali berturut-turut). Tiga lapis penamaan untuk satu hal.
 *   - Subjudul halaman berbunyi "Kelola dan monitor perbarui konfigurasi" — kalimat template
 *     yang rusak.
 *   - 10 gaya sebaris di .php + 1 di .js, padahal konvensi repo menaruh gaya di CSS.
 *   - Pane sangat tinggi karena semua medan satu kolom: Penagihan 3299 px, Teknis 2834 px.
 * Sesudah: Teknis 1703 (-40%), Penagihan 2317 (-30%), Pembayaran 992 (-37%), dan
 * 81 medan bernama TETAP UTUH (dihitung ulang di peramban, nol selisih).
 */
"use strict";

const fs = require("fs");
const path = require("path");

const AKAR = path.join(__dirname, "..", "..", "..");
const baca = (p) => fs.readFileSync(path.join(AKAR, p), "utf8");
const PHP = "views/sb-admin/config.php";
const JS = "static/js/config.js";
const CSS = "static/css/config.css";

/** Gabungkan isi media query dengan min-width >= batas. */
function blokLebar(src, batas) {
    const out = [];
    const re = /@media\s*\(min-width:\s*(\d+)px\)\s*\{/g;
    let m;
    while ((m = re.exec(src)) !== null) {
        if (Number(m[1]) < batas) continue;
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

describe("#b292 — /config tidak lagi berlapis tiga", () => {
    test("!! tak ada lagi judul seksi yang mengulang label tab", () => {
        // Label TAB sudah menyebutkan seksinya, dan tiap kartu masih punya judulnya sendiri.
        expect(baca(PHP)).not.toContain("dashboard-section-title");
    });

    test("tiap pane masih punya judul kartunya sendiri (bukan dihapus semua)", () => {
        // Membuang judul seksi TIDAK boleh membuat panenya jadi anonim.
        const src = baca(PHP);
        const kartu = (src.match(/card-header/g) || []).length;
        expect(kartu).toBeGreaterThanOrEqual(10);
    });

    test("subjudul halaman bukan lagi kalimat template rusak", () => {
        const src = baca(PHP);
        expect(src).not.toContain("Kelola dan monitor perbarui konfigurasi");
        expect(src).toMatch(/Tiap tab disimpan sendiri/);
    });

    test("kapitalisasi nama produk konsisten", () => {
        const src = baca(PHP);
        expect(src).not.toContain("Genieacs URL");
        expect(src).toContain("GenieACS URL");
    });
});

describe("#b292 — gaya tinggal di CSS", () => {
    test("!! tak ada gaya sebaris di config.php", () => {
        const nakal = baca(PHP).split("\n")
            .map((b, i) => ({ b: b.trim(), i: i + 1 }))
            .filter((x) => x.b.includes('style="'))
            .map((x) => x.i + ": " + x.b.slice(0, 70));
        expect(nakal).toEqual([]);
    });

    test("!! tak ada gaya sebaris di config.js", () => {
        expect(baca(JS)).not.toMatch(/style="[^"]*(?:font-|white-space|flex:|gap:)/);
    });

    test("kelas penggantinya benar-benar didefinisikan", () => {
        const css = baca(CSS);
        for (const k of ["cfg-baris-aksi", "cfg-isi-sisa", "cfg-tanpa-patah", "cfg-subjudul", "cfg-pratinjau-rekening"]) {
            expect(css).toContain("." + k);
        }
    });
});

describe("#b292 — dua kolom hanya di layar lebar", () => {
    const css = baca(CSS);
    const lebar = blokLebar(css, 992);

    test("grid didefinisikan di dalam media query >= 992px", () => {
        // Di layar sempit WAJIB tetap satu kolom — diverifikasi juga di peramban
        // (375 px: display `block`, nol geser horizontal).
        expect(lebar).toMatch(/\.cfg-grid\s*\{[^}]*display:\s*grid/);
        expect(lebar).toMatch(/grid-template-columns/);
    });

    test("!! .cfg-grid TIDAK boleh dideklarasikan di luar media query", () => {
        const tanpaMedia = css.replace(/@media[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g, "");
        expect(tanpaMedia).not.toMatch(/\.cfg-grid\s*\{[^}]*display:\s*grid/);
    });

    test("elemen yang tak boleh dipotong membentang penuh", () => {
        // Tabel, kartu bersarang, textarea, dan tombol simpan akan rusak kalau dipaksa
        // setengah lebar.
        for (const sel of ["> table", "> .card", "> hr", "> .config-save-btn"]) {
            expect(lebar).toContain(".cfg-grid " + sel);
        }
        expect(lebar).toMatch(/form-group:has\(textarea\)/);
    });

    test("dipasang pada kartu yang memang padat medan", () => {
        // Jumlahnya sengaja TIDAK dipatok angka tetap — kartu bisa bertambah/berkurang
        // saat pengelompokan berubah. Yang dijaga: kelasnya dipakai, dan hanya pada
        // card-body (bukan sembarang div).
        const src = baca(PHP);
        const pakai = (src.match(/cfg-grid/g) || []).length;
        expect(pakai).toBeGreaterThanOrEqual(5);
        for (const m of src.matchAll(/class="([^"]*cfg-grid[^"]*)"/g)) {
            expect(m[1]).toContain("card-body");
        }
    });
});

describe("#b292 — mekanisme simpan tidak boleh ikut berubah", () => {
    test("tiap tombol simpan masih menunjuk pane-nya", () => {
        // `collectPaneData(pane)` membaca input[name] DI DALAM pane; kalau data-pane hilang,
        // simpan diam-diam mengirim data kosong.
        const src = baca(PHP);
        const tombol = (src.match(/config-save-btn/g) || []).length;
        expect(tombol).toBeGreaterThanOrEqual(7);
        for (const m of src.matchAll(/class="[^"]*config-save-btn[^"]*"[^>]*/g)) {
            expect(m[0]).toMatch(/data-pane="pane-[a-z]+"/);
        }
    });

    test("navigasi tab & pemilih pane masih utuh", () => {
        const js = baca(JS);
        expect(js).toContain("configNav");
        expect(js).toMatch(/#configForm \.config-pane/);
        expect(js).toContain("collectPaneData");
    });
});
