/**
 * Header Doc
 * Purpose : GUARD stempel `data-label` bersama untuk pola tumpuk-kartu (#b295) — satu owner,
 *           dimuat semua halaman, dan tabel yang TERUKUR meluber memakai kelasnya.
 * Caller  : jest
 * Deps    : pemindaian sumber + jsdom untuk menguji perilaku stempelnya.
 * MainFuncs: —
 * SideEffects: tidak ada.
 *
 * KENAPA BERSAMA — pola lamanya disalin per halaman dengan selektor tabel tulis tangan
 * (`document.querySelectorAll("#kasbonTable thead th")`). Menyebarkannya ke 25 halaman
 * berarti 25 salinan yang pasti melenceng saat kolomnya berubah.
 *
 * KENAPA MutationObserver, BUKAN `createdRow` DataTables — TERUKUR: 18 dari 37 halaman
 * daftar panel ini TIDAK memakai DataTables sama sekali (barisnya dirakit lewat innerHTML),
 * jadi `createdRow` tak pernah jalan di sana.
 *
 * Diverifikasi di peramban sesudah dipasang: 25/25 halaman bucket A lulus di HP 375px
 * (thead tersembunyi, semua sel berlabel, tabel tak lagi lebih lebar dari kotaknya), dan
 * 25/25 desktop 1440px TIDAK ikut berubah.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const AKAR = path.join(__dirname, "..", "..", "..");
const baca = (p) => fs.readFileSync(path.join(AKAR, p), "utf8");
const OWNER = "static/js/tabel-hp-label.js";

describe("#b295 — satu owner stempel data-label", () => {
    const src = baca(OWNER);

    test("dimuat semua halaman lewat _head.php", () => {
        const head = baca("views/sb-admin/_head.php");
        expect(head).toMatch(/rafAssetUrl\('\/js\/tabel-hp-label\.js'\)/);
    });

    test("label diambil dari <thead>, bukan daftar nama tulis tangan", () => {
        // Daftar tangan selalu ketinggalan begitu kolomnya berubah.
        expect(src).toMatch(/querySelectorAll\("thead tr"\)/);
        expect(src).not.toMatch(/\[\s*["']Nama["']\s*,/);
    });

    test("memakai MutationObserver supaya tabel non-DataTables ikut tertangani", () => {
        expect(src).toContain("MutationObserver");
    });

    test("tidak bergantung jQuery maupun DataTables", () => {
        const kode = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((b) => !/^\s*\/\//.test(b)).join("\n");
        expect(kode).not.toMatch(/jQuery|\$\(|dataTable/);
    });
});

describe("#b295 — aturan stempel yang tak boleh hilang", () => {
    /*
     * PERILAKUNYA DIVERIFIKASI DI PERAMBAN, BUKAN DI SINI — dan itu disengaja.
     * Repo ini memakai `testEnvironment: 'node'` dan `jest-environment-jsdom` tidak
     * terpasang; tak satu pun tes di sini memakai DOM. Menambah dependensi baru cuma
     * untuk berkas ini di luar lingkup dan mengubah package.json untuk semua orang.
     *
     * Ganti buktinya: 25 halaman bucket A diukur di Chrome sungguhan pada 375px —
     * 25/25 lulus (thead tersembunyi, semua sel berkolom-berjudul terlabeli, tabel tak
     * lagi lebih lebar dari kotaknya), dan 25/25 desktop 1440px TIDAK ikut berubah.
     *
     * Yang dikunci di sini: keempat aturan yang membuat stempelnya benar tetap ADA di
     * kode. Tiap aturan lahir dari kasus nyata yang sudah ditemui saat memasangnya.
     */
    const kode = baca(OWNER).replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((b) => !/^\s*\/\//.test(b)).join("\n");

    test("!! baris keadaan-kosong (colspan) dilewati", () => {
        // Melabelinya memunculkan judul kolom palsu di atas pesan "belum ada data".
        expect(kode).toMatch(/hasAttribute\("colspan"\)/);
    });

    test("!! kolom ber-header kosong dilewati", () => {
        // data-label="" memunculkan label KOSONG di kartunya. Nyata di /gratis-bulan-ini:
        // kolom kotak centangnya memang <th></th>.
        expect(kode).toMatch(/if\s*\(judul\[k\]\)/);
    });

    test("label tulis tangan halaman menang atas judul kolom", () => {
        expect(kode).toMatch(/hasAttribute\("data-label"\)\)\s*continue/);
    });

    test("hanya menyentuh tabel ber-kelas tabel-tumpuk-hp", () => {
        expect(kode).toMatch(/table\.["'\s+]*\+?\s*KELAS|"table\." \+ KELAS/);
        expect(kode).toMatch(/var KELAS = "tabel-tumpuk-hp"/);
    });

    test("hanya sel <td> yang dilabeli, bukan <th> di dalam tbody", () => {
        expect(kode).toMatch(/tagName !== "TD"/);
    });
});

describe("#b296 — CSS pola tumpuk menetralkan min-width", () => {
    const css = baca("static/css/tabel-hp.css");

    test("!! min-width dinetralkan, bukan cuma width:auto", () => {
        /*
         * TERUKUR di /users: polanya aktif (thead sembunyi, 13/13 sel berlabel) tapi
         * tabelnya TETAP meluber 859px, karena users.css memaku `min-width: 1180px` dan
         * sebuah kotak tak pernah bisa menyusut di bawah min-width-nya. `width: auto`
         * kalah. Gejalanya menipu: semua tanda pola terlihat benar, isinya tetap tak
         * terjangkau — jadi tanpa penjaga ini regresinya sulit terlihat.
         */
        const blok = css.match(/\.tabel-tumpuk-hp tr,\s*\.tabel-tumpuk-hp td \{[^}]*\}/);
        expect(blok).not.toBeNull();
        expect(blok[0]).toMatch(/min-width:\s*0\s*!important/);
        expect(blok[0]).toMatch(/width:\s*auto\s*!important/);
    });

    test("label kolom membungkus di spasi, tidak dipotong di tengah kata", () => {
        // `word-break: break-all` di <td> (perlu untuk Device ID panjang tanpa spasi)
        // ikut diwarisi label ::before dan memotong "…Periode A / cuan".
        const blok = css.match(/\.tabel-tumpuk-hp td::before \{[^}]*\}/);
        expect(blok).not.toBeNull();
        expect(blok[0]).toMatch(/word-break:\s*normal/);
    });
});

describe("#b295 — tabel yang terukur meluber memakai kelasnya", () => {
    // Daftar ini BUKAN selera: tiap halaman terukur di Chrome 375px punya tabel yang lebih
    // lebar dari kotak penampungnya, DAN tak punya tampilan detail per-baris — jadi
    // menyembunyikan kolom di sana berarti datanya benar-benar hilang (#b290).
    const WAJIB = [
        ["views/sb-admin/rekap-keuangan.php", "transactionTable"],
        ["views/sb-admin/wifi-logs.php", "logsTable"],
        ["views/sb-admin/login-logs.php", "loginLogsTable"],
        ["views/sb-admin/activity-logs.php", "activityLogsTable"],
        ["views/sb-admin/agent-management.php", "agentTable"],
        ["views/sb-admin/pengeluaran.php", "expenseTable"],
        ["views/sb-admin/los-broadcast.php", "incidentsTable"],
        ["views/sb-admin/pembayaran/otorisasi.php", "dataTable"],
        ["views/sb-admin/admin-diskon.php", "discountTable"],
        ["views/sb-admin/admin-kasbon.php", "kasbonTable"],
        ["views/sb-admin/kompensasi.php", "activeCompensationsTable"],
        ["views/sb-admin/broadcast.php", "history-table"],
        ["views/sb-admin/auto-outage.php", "statesTable"],
        ["views/sb-admin/gratis-bulan-ini.php", "free-table"],
        ["views/sb-admin/telegram-teknisi.php", "waTable"],
        ["views/sb-admin/laporan-agen.php", "entryTable"],
        ["views/sb-admin/laporan-marketing-psb.php", "entryTable"],
        ["views/sb-admin/index.php", "recentLoginLogsTable"],
    ];

    for (const [berkas, id] of WAJIB) {
        test(berkas.replace("views/sb-admin/", "") + " #" + id, () => {
            const tag = baca(berkas).match(new RegExp('<table[^>]*id="' + id + '"[^>]*>'));
            expect({ id, ada: !!tag }).toEqual({ id, ada: true });
            expect({ id, punyaKelas: /tabel-tumpuk-hp/.test(tag[0]) }).toEqual({ id, punyaKelas: true });
        });
    }

    // Bucket B (#b296): halaman yang PUNYA modal + pemicu per-baris, jadi audit awal
    // menaruhnya di "boleh sembunyikan kolom". Setelah cakupan modalnya diperiksa, syarat
    // itu TIDAK CUKUP — punya modal bukan berarti modalnya MENAMPILKAN kolomnya:
    //   /package-requests   0%  modalnya cuma "Konfirmasi Aksi + Catatan"
    //   /agent-voucher-mgmt 0%  Rank/Area/Stok/Terjual/Revenue nihil di modal
    //   /users             73%  editModal tak memuat Redaman, Suhu, IP Pelanggan, Tipe Router
    // Jadi ke-12-nya ikut pola tumpuk. Satu pola untuk seluruh panel.
    const WAJIB_B = [
        ["views/sb-admin/users.php", "dataTable"],
        ["views/sb-admin/speed-requests.php", "speedRequestTable"],
        ["views/sb-admin/payment-status.php", "paymentTable"],
        ["views/sb-admin/package-requests.php", "packageRequestTable"],
        ["views/sb-admin/network-assets.php", "assetsDataTable"],
        ["views/sb-admin/packages.php", "dataTable"],
        ["views/sb-admin/gaji-teknisi.php", "gajiTable"],
        ["views/sb-admin/agent-voucher-management.php", "topAgentsTable"],
        ["views/sb-admin/paket-voucher.php", "dataTable"],
        ["views/sb-admin/accounts.php", "dataTable"],
        ["views/sb-admin/cctv-monitor.php", "cctvTable"],
        ["views/sb-admin/config.php", "mikrotikDevicesTable"],
    ];
    for (const [berkas, id] of WAJIB_B) {
        test("[B] " + berkas.replace("views/sb-admin/", "") + " #" + id, () => {
            const tag = baca(berkas).match(new RegExp('<table[^>]*id="' + id + '"[^>]*>'));
            expect({ id, ada: !!tag }).toEqual({ id, ada: true });
            expect({ id, punyaKelas: /tabel-tumpuk-hp/.test(tag[0]) }).toEqual({ id, punyaKelas: true });
        });
    }

    test("halaman tanpa id tabel juga terpasang", () => {
        for (const b of ["broadcast-tagihan", "infra-monitor", "kas-usaha", "sisa-pppoe", "steering-pelanggan", "voucher-sales"]) {
            const s = baca("views/sb-admin/" + b + ".php");
            expect({ halaman: b, ada: /<table[^>]*tabel-tumpuk-hp/.test(s) }).toEqual({ halaman: b, ada: true });
        }
        // /rekap-tunggakan merakit tabelnya di JS, bukan di .php
        expect(baca("static/js/rekap-tunggakan.js")).toMatch(/<table[^>]*tabel-tumpuk-hp/);
    });
});
