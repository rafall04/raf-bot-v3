/**
 * Header Doc
 * Purpose : Bahasa Indonesia BERSAMA untuk semua tabel DataTables di panel (#b294).
 *           Dipasang sebagai default global sekali, bukan per halaman.
 * Caller  : views/sb-admin/_head.php (semua halaman panel, tanpa defer).
 * Deps    : jQuery + DataTables (dimuat belakangan di kaki halaman) — dipasang saat
 *           DOMContentLoaded, sebelum callback $(document).ready milik skrip halaman.
 * MainFuncs: (IIFE) pasang()
 * SideEffects: menulis $.fn.dataTable.defaults.language.
 *
 * KENAPA ADA — TERUKUR di 19 halaman daftar sebelum perbaikan:
 *   11 halaman berbahasa INGGRIS ("Showing 1 to 12 of 12 entries")
 *    5 halaman CAMPUR dalam satu kalimat ("Menampilkan 1 sampai 25 dari 56 entries")
 *    3 halaman Indonesia, masing-masing dengan gaya BERBEDA
 *        "Menampilkan 1 sampai 3 dari 3 entri" / "1-2 dari 2" / "Menampilkan 1–5 dari 5 paket"
 *   Empat konvensi untuk satu kalimat yang sama.
 *
 * !! AKAR SEBAGIAN BESARNYA BUKAN LUPA MENERJEMAHKAN. Enam berkas JS memuat terjemahan dari
 * `//cdn.datatables.net/.../id.json`, padahal `cdn.datatables.net` TIDAK ADA sama sekali di
 * kebijakan CSP (lib/http-security.js: connectSrc hanya 'self' + unpkg.com). Permintaannya
 * diblokir, DataTables diam-diam jatuh ke teks bawaan Inggris, dan tak ada yang tahu karena
 * kegagalannya senyap. Ini kelas kesalahan yang sama dengan #b287 — aset terdaftar di satu
 * direktif CSP tapi tidak di direktif yang benar-benar dipakai.
 *
 * Karena itu terjemahannya DI-HOST SENDIRI sebagai objek JS, bukan di-fetch: tak ada
 * permintaan jaringan, jadi tak ada lagi yang bisa diblokir CSP maupun mati saat CDN down.
 */
"use strict";

(function () {
    var BAHASA = {
        decimal: ",",
        thousands: ".",
        emptyTable: "Tidak ada data",
        info: "Menampilkan _START_ sampai _END_ dari _TOTAL_ baris",
        infoEmpty: "Menampilkan 0 baris",
        infoFiltered: "(disaring dari _MAX_ baris)",
        infoPostFix: "",
        lengthMenu: "Tampilkan _MENU_ baris",
        loadingRecords: "Memuat…",
        processing: "Memproses…",
        search: "Cari:",
        searchPlaceholder: "ketik untuk menyaring",
        zeroRecords: "Tidak ada baris yang cocok",
        paginate: {
            first: "Awal",
            last: "Akhir",
            next: "Berikutnya",
            previous: "Sebelumnya",
        },
        aria: {
            sortAscending: ": urutkan menaik",
            sortDescending: ": urutkan menurun",
        },
        select: {
            rows: { _: "%d baris dipilih", 0: "", 1: "1 baris dipilih" },
        },
    };

    // Diekspor supaya halaman yang butuh menimpa satu kata saja bisa menyalin dari sini
    // ketimbang menulis ulang seluruh objeknya.
    window.RAF_DATATABLES_BAHASA = BAHASA;

    function pasang() {
        var $ = window.jQuery;
        if (!$ || !$.fn || !$.fn.dataTable || !$.fn.dataTable.defaults) return false;
        $.extend(true, $.fn.dataTable.defaults, { language: BAHASA });
        return true;
    }

    // Berkas ini dimuat di <head>, jadi jQuery/DataTables belum ada saat ini. Percobaan
    // pertama tetap dilakukan supaya urutan muat yang berbeda di masa depan tetap tertangani.
    if (!pasang()) {
        // Listener ini terdaftar SEBELUM jQuery dimuat, sehingga berjalan lebih dulu daripada
        // callback $(document).ready() milik skrip halaman yang menginisialisasi tabelnya.
        document.addEventListener("DOMContentLoaded", pasang);
    }
})();
