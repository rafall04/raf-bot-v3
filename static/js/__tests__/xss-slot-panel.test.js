/**
 * Header Doc
 * Purpose: Mengunci agar data yang DIKENDALIKAN PIHAK LUAR (nama perangkat WiFi, nama SSID,
 *          nama/catatan aset ODC-ODP) selalu di-escape sebelum masuk HTML panel.
 * Caller: Jest test runner.
 * Deps: pemindaian `static/js/*.js` dan `views/sb-admin/*.php`.
 * MainFuncs: `slotMentah`.
 * SideEffects: Tidak ada.
 *
 * KENAPA ADA — sumber datanya bukan staf:
 *  - `dev.hostName` = hostname DHCP, bebas diketik SIAPA PUN yang tersambung ke WiFi
 *    pelanggan (Android/iOS/Windows), lalu dilaporkan modem lewat TR-069. Begitu admin atau
 *    teknisi membuka "Cek WiFi" — alur paling rutin saat menangani keluhan — skrip di
 *    dalamnya jalan di sesi mereka.
 *  - `s.name` (SSID) bisa diubah pelanggan dari panel web modemnya sendiri
 *    (192.168.100.1), jalur yang TIDAK melewati filter karakter bot.
 *  - `asset.name`/`asset.notes` diketik TEKNISI lewat WhatsApp (`#ODP <teks bebas>`) tanpa
 *    validasi; Leaflet mem-PARSE string bindPopup/bindTooltip sebagai HTML.
 *
 * CSP tidak menyelamatkan: lib/http-security.js mengizinkan 'unsafe-inline' untuk scriptSrc
 * DAN scriptSrcAttr.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const DIR_JS = path.join(__dirname, "..");
const baca = (f) => fs.readFileSync(path.join(DIR_JS, f), "utf8");

/** Mencari slot template `${<ekspresi>}` yang TIDAK dibungkus fungsi escaping. */
function slotMentah(isi, ekspresi) {
    const pola = new RegExp("\\$\\{\\s*" + ekspresi.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
    return (isi.match(pola) || []).filter((m) => !/escapeHtml/.test(m));
}

describe("nama perangkat WiFi (hostName TR-069) di-escape", () => {
    test.each(["users.js", "teknisi-pelanggan.js"])("%s", (berkas) => {
        const isi = baca(berkas);

        expect(slotMentah(isi, "dev.hostName")).toEqual([]);
        expect(slotMentah(isi, "dev.mac")).toEqual([]);
        expect(slotMentah(isi, "dev.ip")).toEqual([]);
    });
});

describe("nama SSID di-escape sebelum masuk atribut value", () => {
    test.each(["users.js", "teknisi-pelanggan.js"])("%s", (berkas) => {
        const isi = baca(berkas);
        const nilaiMentah = (isi.match(/value="\$\{\s*s\.name[^}]*\}"/g) || []).filter(
            (m) => !/escapeHtml/.test(m)
        );

        // Nama SSID ber-kutip keluar dari atribut: `x" onfocus="..." autofocus="` memicu
        // handler TANPA klik. Efek non-jahat pun merusak — nama terpotong lalu TERSIMPAN salah.
        expect(nilaiMentah).toEqual([]);
    });
});

describe("nama & catatan aset ODC/ODP di-escape di popup peta", () => {
    test.each(["map-viewer.js", "teknisi-map-viewer.js"])("%s", (berkas) => {
        const isi = baca(berkas);

        for (const field of ["asset.name", "asset.notes", "asset.address", "asset.type"]) {
            expect(slotMentah(isi, field)).toEqual([]);
        }
    });

    test("tooltip permanen tak menerima nama aset mentah", () => {
        for (const berkas of ["map-viewer.js", "teknisi-map-viewer.js"]) {
            const isi = baca(berkas);
            const mentah = (isi.match(/bindTooltip\(\s*(?:marker\.assetData|asset)\.name/g) || []);

            // Tooltip permanen berbahaya justru karena tak perlu diklik untuk tampil.
            expect(mentah).toEqual([]);
        }
    });
});

describe("helper escaping benar-benar terjangkau dari berkas yang memakainya", () => {
    const pemakaiGlobal = ["teknisi-pelanggan.js", "map-viewer.js", "teknisi-map-viewer.js"];

    test.each(pemakaiGlobal)("%s memakai rafEscapeHtml global, bukan nama lokal yang tak ada", (berkas) => {
        const isi = baca(berkas);

        // Berkas ini tak punya `function escapeHtml` sendiri. Memakai nama itu = ReferenceError
        // yang mematikan seluruh render halaman.
        if (!/function escapeHtml/.test(isi)) {
            expect(isi).not.toMatch(/(?<!raf)escapeHtml\(/);
        }
    });

    test.each(pemakaiGlobal)("halaman %s memuat _head.php (sumber rafEscapeHtml)", (berkas) => {
        const halaman = berkas.replace(/\.js$/, ".php");
        const isi = fs.readFileSync(
            path.join(DIR_JS, "..", "..", "views", "sb-admin", halaman),
            "utf8"
        );

        expect(isi).toContain("_head.php");
    });
});

describe("nama pelanggan aman di atribut ber-kutip TUNGGAL & argumen handler", () => {
    test("users.js: data-customer-name diisi nilai yang sudah di-escape", () => {
        const isi = baca("users.js");

        // Atribut ini memakai kutip TUNGGAL, jadi apostrof di nama (Ma'ruf, Sa'diyah)
        // memutusnya: `data-customer-name='Ma'` lalu atribut sampah `ruf'`.
        expect(isi).toMatch(/const customerName = escapeHtml\(/);
    });

    test("users.js: data-device (JSON di kutip tunggal) ikut di-escape", () => {
        const isi = baca("users.js");
        const mentah = (isi.match(/data-device='\$\{JSON\.stringify\(device\)\}'/g) || []);

        // hostName di dalam JSON berasal dari hostname DHCP — bebas diketik siapa pun yang
        // tersambung ke WiFi pelanggan. Satu apostrof merusak seluruh <option>.
        expect(mentah).toEqual([]);
    });

    test("teknisi-map-viewer.js: argumen onclick di-escape untuk DUA konteks", () => {
        const isi = baca("teknisi-map-viewer.js");
        const mentah = (isi.match(/onclick="\w+\('\$\{customer\.device_id\}'/g) || []);

        // Argumen di dalam onclick hidup di dua konteks sekaligus: atribut HTML DAN string
        // JS. Keduanya harus ditutup, kalau tidak tombolnya mati untuk nama ber-apostrof.
        expect(mentah).toEqual([]);
        expect(isi).toMatch(/rafEscapeJsString\(/);
    });

    test("teknisi-map-viewer.js: nama pelanggan di daftar popup di-escape", () => {
        const isi = baca("teknisi-map-viewer.js");
        expect(slotMentah(isi, "customer.name")).toEqual([]);
    });
});
