"use strict";

/**
 * Header Doc
 * Purpose: Mengunci tiga perbaikan UX keuangan yang lahir dari pemakaian nyata:
 *   (1) GAJI POKOK diisikan dari payroll terakhir teknisi — angka itu nyaris tak pernah berubah,
 *       jadi mengetiknya ulang 12x setahun hanya membuka peluang salah ketik pada angka yang
 *       seharusnya tetap;
 *   (2) METODE bayar biaya rutin jadi PILIHAN, bukan ketikan bebas — kolomnya TEXT sehingga
 *       "TF"/"Bank"/salah ketik lolos begitu saja dan memecah rekap;
 *   (3) daftar pemilik kas TIDAK menampilkan `@lid` mentah. Aturan proyek melarangnya
 *       (CLAUDE.md), dan secara praktis memilih pemilik dari deretan angka acak = salah pilih.
 * Caller: Jest (`npx jest routes/__tests__/keuangan-ux.test.js`).
 * Deps: fs/path (pindai route, view, js, adapter).
 * MainFuncs: -
 * SideEffects: Tidak ada.
 */

const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..", "..");
const baca = (...p) => fs.readFileSync(path.join(REPO, ...p), "utf8");

describe("gaji teknisi: tak perlu mengetik ulang gaji pokok tiap bulan", () => {
    const route = baca("routes", "gaji.js");
    const js = baca("static", "js", "gaji-teknisi.js");
    const view = baca("views", "sb-admin", "gaji-teknisi.php");

    test("endpoint yang sudah dipanggil saat memilih teknisi ikut membawa gaji pokok terakhir", () => {
        // Menumpang permintaan yang SUDAH ada — bukan round-trip kedua.
        const idx = route.indexOf("kasbon-summary/:teknisiId");
        const blok = route.slice(idx, idx + 2600);
        expect(blok).toMatch(/gaji_pokok_terakhir/);
        expect(blok).toMatch(/periode_terakhir/);
        expect(blok).toMatch(/getPayrollList\(\{ teknisiId \}\)/);
    });

    test("periode yang SEDANG dibuat dikecualikan — kalau tidak, ia memprefill dirinya sendiri", () => {
        const idx = route.indexOf("kasbon-summary/:teknisiId");
        const blok = route.slice(idx, idx + 2600);
        expect(blok).toMatch(/filter\(\(r\) =>/);
        expect(blok).toMatch(/period_month\) === month/);
    });

    test("gagal baca riwayat TIDAK menjatuhkan endpoint", () => {
        const idx = route.indexOf("kasbon-summary/:teknisiId");
        const blok = route.slice(idx, idx + 2600);
        expect(blok).toMatch(/\.catch\(\(\) => \[\]\)/);
    });

    test("prefill hanya mengisi kolom kosong — jangan menimpa yang sedang diketik", () => {
        expect(js).toMatch(/gaji_pokok_terakhir/);
        expect(js).toMatch(/!sekarang \|\| Number\(sekarang\) === 0/);
    });

    test("asal angkanya disebut — angka yang muncul sendiri tanpa penjelasan bikin ragu", () => {
        expect(js).toMatch(/Diisi dari payroll/);
        expect(view).toMatch(/id="gajiPokokInfo"/);
    });
});

describe("kas usaha: metode bayar dipilih, bukan diketik", () => {
    const view = baca("views", "sb-admin", "kas-usaha.php");
    const js = baca("static", "js", "kas-usaha.js");

    test("ku-metode kini <select> dengan dua nilai sah", () => {
        const idx = view.indexOf('id="ku-metode"');
        const blok = view.slice(Math.max(0, idx - 200), idx + 260);
        expect(blok).toMatch(/<select/);
        expect(blok).toMatch(/value="TUNAI"/);
        expect(blok).toMatch(/value="TRANSFER"/);
    });

    test("baris lama bernilai asing tetap tampil apa adanya saat diedit", () => {
        // Data lama ditulis saat kolom masih bebas ketik. Diam-diam mengubahnya jadi TUNAI
        // ketika baris itu sekadar dibuka untuk diedit = mengganti fakta pembukuan.
        expect(js).toMatch(/nilai lama/);
        expect(js).toMatch(/adaOpsi/);
    });
});

describe("pemilik kas: @lid tak pernah ditampilkan mentah", () => {
    const adapter = baca("lib", "whatsapp.adapter.js");
    const js = baca("static", "js", "kas-usaha.js");

    test("adapter memulangkan label yang layak dibaca manusia", () => {
        const idx = adapter.indexOf("async getGroupParticipants");
        const blok = adapter.slice(idx, idx + 1800);
        expect(blok).toMatch(/label/);
        expect(blok).toMatch(/getStoredMappingByLid/);
    });

    test("nomor TIDAK dikarang dari angka @lid saat pemetaan belum ada", () => {
        // Angka di `<id>@lid` bukan nomor telepon; menjadikannya `62<lid>` = nomor palsu.
        const idx = adapter.indexOf("async getGroupParticipants");
        const blok = adapter.slice(idx, idx + 1800);
        expect(blok).toMatch(/belum dikenali/);
    });

    test("halaman menampilkan label itu, bukan p.id", () => {
        const idx = js.indexOf("function gambarPemilik");
        const blok = js.slice(idx, idx + 1800);
        expect(blok).toMatch(/p\.label/);
        // Tak boleh kembali menampilkan id mentah untuk @lid.
        expect(blok).not.toMatch(/p\.id\.indexOf\("@lid"\) !== -1 \? p\.id/);
    });
});
