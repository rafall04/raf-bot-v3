/**
 * Header Doc
 * Purpose : GUARD penamaan halaman panel (#b299) — judul <h1> berbahasa Indonesia, judul tab
 *           satu format dan selalu sama dengan <h1>-nya, serta scaffolding `fee` yang mati
 *           di /payment-method tidak kembali.
 * Caller  : jest
 * Deps    : pemindaian sumber views/sb-admin (tanpa DOM).
 * MainFuncs: judulHalaman()
 * SideEffects: tidak ada.
 *
 * !! TEMUAN "7 HALAMAN TANPA JUDUL, 11 PAKAI h5/h6" DI LAPORAN AUDIT SAYA ADALAH ARTEFAK.
 * Ekstraktor pertama menuntut teks LANGSUNG setelah tag (`<h1>\s*([^<]{2,70})`), padahal
 * banyak judul berbentuk `<h1><i class="fas fa-print"></i>Cetak Voucher</h1>` — ikonnya
 * lebih dulu, jadi pola itu melompatinya lalu salah menangkap <h6> di bawahnya. Setelah
 * ekstraktornya benar: 70 dari 72 halaman sudah ber-<h1>, dan dua sisanya pun punya
 * (/olt-log di partial, /map-viewer tepat di luar container). Nol cacat di sana.
 * Yang benar-benar cacat: 15 judul Inggris + 4 format judul tab yang berbeda-beda.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const AKAR = path.join(__dirname, "..", "..");
const V = path.join(AKAR, "views/sb-admin");
const baca = (f) => fs.readFileSync(path.join(V, f), "utf8");

/*
 * Hanya halaman peran ADMIN. Panel teknisi & agen sengaja memakai penanda peran di judul
 * tab ("Request Ubah Paket - Panel Teknisi", "Agen - Panduan") — itu BERGUNA, bukan cacat:
 * teknisi yang membuka beberapa tab sekaligus bisa membedakannya. Memaksa format
 * "RAF BOT - X" di sana justru menghapus informasi.
 */
const HALAMAN = fs.readdirSync(V)
    .filter((f) => f.endsWith(".php") && !f.startsWith("_") && !/^(404|login|blank|footer|topbar)/.test(f))
    .filter((f) => !/^(teknisi|agen)-/.test(f));

/**
 * Judul halaman = <h1> pertama, tag di dalamnya dibuang.
 *
 * !! CARI <h1> DI SELURUH DOKUMEN, bukan cuma di dalam container-fluid. /map-viewer
 * menaruh <h1>-nya tepat DI LUAR container (petanya layar penuh), sehingga pencarian yang
 * dibatasi container menangkap <h6>"Quick Tools" dan salah melaporkannya sebagai judul
 * halaman — variasi dari artefak yang sama seperti di catatan atas berkas ini.
 */
function judulHalaman(src) {
    const bersih = (t) => t.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
    const h1 = src.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
    if (h1 && bersih(h1[1])) return bersih(h1[1]);
    const i = src.indexOf("container-fluid");
    const sisa = i >= 0 ? src.slice(i) : src;
    const m = sisa.match(/<h([2-6])[^>]*>([\s\S]*?)<\/h\1>/);
    return m && bersih(m[2]) ? bersih(m[2]) : null;
}

describe("#b299 — judul halaman berbahasa Indonesia", () => {
    const ING = /\b(Management|Manage|Overview|Configuration|Method Payment|Activity Logs|Logout Logs|Network Assets|Package|Account)\b/;

    test("!! tak ada judul <h1> berbahasa Inggris", () => {
        const nakal = [];
        for (const f of HALAMAN) {
            const j = judulHalaman(baca(f));
            if (j && ING.test(j)) nakal.push(f + " :: " + j);
        }
        expect(nakal).toEqual([]);
    });

    test("pemindainya tidak memindai nol halaman", () => {
        // Tanpa ini, ekstraktor yang rusak membuat tes di atas lolos secara palsu —
        // persis cara temuan di laporan audit saya jadi salah.
        const berjudul = HALAMAN.filter((f) => judulHalaman(baca(f)));
        expect(berjudul.length).toBeGreaterThan(50);
    });
});

describe("#b299 — judul tab satu format dan sama dengan judul halaman", () => {
    test("!! semua memakai format 'RAF BOT - X'", () => {
        // Sebelumnya EMPAT format: 60x "RAF BOT - X", 5x "X - RAF NET",
        // 3x "X - Admin Panel", 4x nama telanjang.
        const nakal = [];
        for (const f of HALAMAN) {
            const m = baca(f).match(/pageTitle\s*=\s*'([^']*)'/);
            if (!m) continue;
            if (!m[1].startsWith("RAF BOT - ")) nakal.push(f + " :: " + m[1]);
        }
        expect(nakal).toEqual([]);
    });

    test("!! judul tab TIDAK menyimpan &amp; (akan ter-escape dua kali)", () => {
        // _head.php merender lewat htmlspecialchars(); menyimpan &amp; di sini membuat
        // tab menampilkan teks "&amp;" mentah. Ini sempat saya buat sendiri lalu diperbaiki.
        const nakal = [];
        for (const f of HALAMAN) {
            const m = baca(f).match(/pageTitle\s*=\s*'([^']*)'/);
            if (m && /&(amp|lt|gt|quot);/.test(m[1])) nakal.push(f + " :: " + m[1]);
        }
        expect(nakal).toEqual([]);
    });

    test("judul tab sama dengan judul halaman", () => {
        const beda = [];
        for (const f of HALAMAN) {
            const s = baca(f);
            const m = s.match(/pageTitle\s*=\s*'([^']*)'/);
            const j = judulHalaman(s);
            if (!m || !j) continue;
            // sebagian judul halaman memakai emoji hiasan; tab sengaja tanpa emoji
            const bersih = j.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "").trim();
            if (!bersih || bersih.length > 48) continue;
            if (m[1] !== "RAF BOT - " + bersih) beda.push(f + " :: tab=" + m[1] + " | h1=" + bersih);
        }
        expect(beda).toEqual([]);
    });
});

describe("#b299 — scaffolding 'fee' mati di /payment-method tidak kembali", () => {
    /*
     * TERUKUR: halaman itu melempar DUA alert peramban yang MEMBLOKIR setiap kali dibuka —
     *   "DataTables warning: table id=dataTable - Requested unknown parameter 'fee'
     *    for row 0, column 3"
     * karena kolom 3 dikonfigurasi `data: 'fee'` sementara datanya tak punya medan itu.
     * database/payment-method.json hanya menyimpan {id, name, category}, dan GET
     * /api/payment-method mengembalikan medan yang sama. Kolomnya scaffolding yang tak
     * pernah punya data, bukan fitur yang menunggu backend.
     *
     * Alert ini juga yang membuat halaman tsb TIMEOUT di sapuan audit pertama, sehingga
     * ia terlewat dari pekerjaan pola tabel HP — satu bug menyembunyikan bug lain.
     */
    const berkas = ["views/sb-admin/payment-method.php", "static/js/payment-method-1.js", "static/js/payment-method-2.js"];

    for (const rel of berkas) {
        test(rel.split("/").pop() + " bersih dari 'fee'", () => {
            const s = fs.readFileSync(path.join(AKAR, rel), "utf8");
            expect({ berkas: rel, adaFee: /\bfee\b/i.test(s) }).toEqual({ berkas: rel, adaFee: false });
        });
    }

    test("jumlah <th> dan entri columns tetap seimbang", () => {
        // Mencabut salah satu saja membuat DataTables melempar galat jumlah kolom —
        // menukar satu bug dengan bug lain.
        const php = baca("payment-method.php");
        const js = fs.readFileSync(path.join(AKAR, "static/js/payment-method-2.js"), "utf8");
        const thead = (php.match(/<thead>[\s\S]*?<\/thead>/) || [""])[0];
        const th = (thead.match(/<th>/g) || []).length;
        const kolom = ((js.match(/columns:\s*\[[\s\S]*?\n\s*\]/) || [""])[0].match(/data:/g) || []).length;
        expect({ th, kolom }).toEqual({ th: 4, kolom: 4 });
    });

    test("tabelnya ikut pola tumpuk HP", () => {
        // Terlewat dari #b295/#b296 karena halamannya timeout saat disapu.
        expect(baca("payment-method.php")).toMatch(/<table[^>]*tabel-tumpuk-hp[^>]*id="dataTable"|<table[^>]*id="dataTable"[^>]*tabel-tumpuk-hp/);
    });
});
