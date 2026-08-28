/**
 * Header Doc
 * Purpose : GUARD bahasa tabel panel (#b294) — satu sumber bahasa Indonesia bersama,
 *           tanpa fetch ke CDN, dan tak ada halaman yang menduplikasi teks generiknya.
 * Caller  : jest
 * Deps    : pemindaian sumber (tanpa DOM).
 * MainFuncs: tanpaKomentar()
 * SideEffects: tidak ada.
 *
 * KENAPA ADA — TERUKUR di peramban pada 19 halaman daftar SEBELUM perbaikan:
 *     11 halaman INGGRIS  "Showing 1 to 12 of 12 entries"
 *      5 halaman CAMPUR   "Menampilkan 1 sampai 25 dari 56 entries"
 *      3 halaman Indonesia dengan 3 gaya berbeda ("entri" / "baris" / "paket")
 *   SESUDAH: 19/19 Indonesia, 0 Inggris, 0 campur.
 *
 * !! AKAR SEBAGIAN BESARNYA BUKAN LUPA MENERJEMAHKAN. Enam berkas mem-fetch
 * `//cdn.datatables.net/.../id.json`, padahal host itu TIDAK ADA di CSP
 * (lib/http-security.js: connectSrc cuma 'self' + unpkg.com). Permintaannya diblokir dan
 * DataTables jatuh ke Inggris TANPA pesan apa pun. Sama seperti #b287: aset terdaftar di
 * satu direktif CSP tapi tidak di direktif yang dipakai. Karena itu tesnya menjaga DUA hal:
 * bahasanya ada, DAN tak ada yang mem-fetch-nya lagi dari jaringan.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const AKAR = path.join(__dirname, "..", "..", "..");
const baca = (p) => fs.readFileSync(path.join(AKAR, p), "utf8");
const BERSAMA = "static/js/datatables-bahasa.js";

function tanpaKomentar(s) {
    return s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((b) => !/^\s*(\/\/|\*|<!--)/.test(b)).join("\n");
}

describe("#b294 — satu sumber bahasa tabel", () => {
    // !! WAJIB tanpa komentar: Header Doc berkas itu MENGUTIP contoh "Showing 1 to 12 of 12
    // entries" sebagai penjelasan keadaan sebelum perbaikan. Penjaga naif menyangka bug-nya
    // masih ada — persis jebakan yang sama sudah kena sekali di tes gratis-bulan-ini.
    const src = tanpaKomentar(baca(BERSAMA));

    test("berkas bahasa bersama ada dan memasang default global", () => {
        expect(src).toMatch(/\$\.fn\.dataTable\.defaults/);
        expect(src).toMatch(/language:\s*BAHASA/);
    });

    test("memuat kunci yang benar-benar dilihat pemakai", () => {
        for (const k of ["emptyTable", "info", "infoEmpty", "infoFiltered", "lengthMenu", "search", "zeroRecords", "paginate"]) {
            expect({ kunci: k, ada: new RegExp("\\b" + k + ":").test(src) }).toEqual({ kunci: k, ada: true });
        }
    });

    test("!! tak ada kata Inggris yang bocor ke teks pemakai", () => {
        // Bug lamanya justru campur: "Menampilkan … dari 56 entries".
        const teks = [...src.matchAll(/"([^"]{2,60})"/g)].map((m) => m[1]);
        const bocor = teks.filter((t) => /\b(entries|Showing|Search|No data|Loading|Processing|First|Last|Next|Previous)\b/.test(t));
        expect(bocor).toEqual([]);
    });

    test("dipasang lewat DOMContentLoaded, bukan menunggu jQuery.ready", () => {
        // Harus terdaftar SEBELUM jQuery dimuat supaya jalan lebih dulu daripada
        // $(document).ready() milik skrip halaman yang menginisialisasi tabelnya.
        expect(src).toMatch(/addEventListener\("DOMContentLoaded"/);
    });
});

describe("#b294 — dimuat semua halaman, tanpa jaringan", () => {
    const head = baca("views/sb-admin/_head.php");

    test("_head.php memuatnya lewat rafAssetUrl", () => {
        expect(head).toMatch(/rafAssetUrl\('\/js\/datatables-bahasa\.js'\)/);
    });

    test("dimuat TANPA defer (urutan pendaftaran listener menentukan)", () => {
        const tag = head.match(/<script[^>]*datatables-bahasa\.js[^>]*>/);
        expect(tag).not.toBeNull();
        expect(/\bdefer\b|\basync\b/.test(tag[0])).toBe(false);
    });

    test("!! tak ada lagi yang mem-fetch bahasa dari cdn.datatables.net", () => {
        const nakal = [];
        for (const f of fs.readdirSync(path.join(AKAR, "static/js")).filter((x) => x.endsWith(".js"))) {
            const kode = tanpaKomentar(baca("static/js/" + f));
            if (/cdn\.datatables\.net/.test(kode)) nakal.push(f);
        }
        expect(nakal).toEqual([]);
    });
});

describe("#b294 — tak ada bahasa Inggris di blok language halaman mana pun", () => {
    /*
     * ATURAN INI SEMPAT SAYA TULIS TERLALU KETAT, lalu dikoreksi setelah melihat datanya.
     * Versi pertama melarang SEMUA blok `language` per halaman. Ternyata sebagian memang
     * disengaja dan benar:
     *     admin-diskon / admin-kasbon / admin-olt / teknisi-olt
     *         -> "_START_-_END_ dari _TOTAL_"  (format ringkas untuk tabel padat)
     *     paket-voucher-2 / teknisi-kasbon / teknisi-pembayaran
     *         -> memakai kata domain: "… dari _TOTAL_ paket"
     * Itu variasi KONTEKSTUAL, bukan cacat. Cacat yang sebenarnya ada dua, dan hanya dua:
     * teks Inggris yang bocor, dan kalimat generik yang sama ditulis ulang dengan gaya
     * berbeda-beda. Yang dijaga sekarang persis itu.
     */
    const INGGRIS = /\b(entries|Showing|No data available|Loading\.\.\.|Processing\.\.\.|Search:|First|Last|Next|Previous)\b/;

    test("!! tak ada halaman yang menyisakan kata Inggris di blok language-nya", () => {
        const nakal = [];
        for (const f of fs.readdirSync(path.join(AKAR, "static/js")).filter((x) => x.endsWith(".js"))) {
            if (f === "datatables-bahasa.js") continue;
            const kode = tanpaKomentar(baca("static/js/" + f));
            for (const m of kode.matchAll(/(?:"language"|language)\s*:\s*\{([\s\S]{0,700}?)\n\s*\}/g)) {
                if (INGGRIS.test(m[1])) nakal.push(f + " :: " + (m[1].match(INGGRIS) || [])[0]);
            }
        }
        expect(nakal).toEqual([]);
    });
});

describe("#b294 — aset CDN memakai skema eksplisit", () => {
    test("!! tak ada src/href protokol-relatif di views/", () => {
        // Di halaman http (akses LAN) `//cdn…` jatuh ke http:// dan diblokir CSP —
        // SweetAlert2 jadi undefined dan seluruh dialog halaman itu mati diam-diam.
        const nakal = [];
        const jelajah = (dir) => {
            for (const e of fs.readdirSync(path.join(AKAR, dir), { withFileTypes: true })) {
                const rel = dir + "/" + e.name;
                if (e.isDirectory()) jelajah(rel);
                else if (e.name.endsWith(".php")) {
                    const s = baca(rel);
                    for (const m of s.matchAll(/(?:src|href)="\/\/[^"]+"/g)) nakal.push(rel + " :: " + m[0]);
                }
            }
        };
        jelajah("views");
        expect(nakal).toEqual([]);
    });
});
