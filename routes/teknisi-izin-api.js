/**
 * Header Doc
 * Purpose: DAFTAR IZIN eksplisit — jalur di dalam `adminApiRouter` yang boleh disentuh peran
 *          TEKNISI. Apa pun di luar daftar ini ditolak 403 oleh `lib/authz.buatGerbangTeknisi`.
 *          Berkas ini adalah SATU-SATUNYA jawaban atas pertanyaan "teknisi boleh apa di API admin".
 * Caller: `routes/admin-router.js`.
 * Deps: Tidak ada.
 * MainFuncs: — (ekspor data)
 * SideEffects: Tidak ada.
 *
 * CARA MENAMBAH: tambahkan baris + sebutkan HALAMAN yang membutuhkannya. Kalau sebuah endpoint
 * tak bisa ditunjuk halaman teknisinya, ia TIDAK boleh ada di sini.
 *
 * ASAL-USUL DAFTAR (#b253): diturunkan DARI KODE, bukan ditebak — halaman di
 * `views/sb-admin/_navbar_teknisi.php` → berkas `.php`-nya → `<script src>` → panggilan `fetch()`
 * di JS-nya. Dari 42 endpoint yang dipanggil halaman teknisi, hanya yang di bawah ini yang
 * benar-benar berada DI DALAM `adminApiRouter`; sisanya dipasang dengan prefix sendiri
 * (kasbon, tiket, psb-schedule, partial-payment, packages, olt, users) dan tak tersentuh gerbang.
 *
 * SENGAJA TIDAK DIMASUKKAN: `/api/config` — halaman teknisi memang memanggilnya, tapi hari ini
 * SUDAH ditolak oleh cek admin inline dan halamannya tetap berfungsi. Memasukkannya ke daftar
 * ini justru MEMBUKA lubang baru (config memuat rahasia). Daftar ini mempertahankan perilaku
 * yang berlaku sekarang, bukan melonggarkannya.
 */
"use strict";

const IZIN_TEKNISI_API = [
    // /teknisi-pelanggan — daftar pelanggan + metrik perangkat
    { method: "GET", jalur: "/api/list/users" },
    { method: "GET", jalur: "/api/list/packages" },
    { method: "POST", jalur: "/api/customer-metrics-batch" },

    // /teknisi-pelanggan — setel WiFi pelanggan saat pemasangan/perbaikan
    { method: "POST", jalur: "/api/ssid/:deviceId" },

    // /teknisi-pelanggan & /teknisi-map-viewer — lihat sesi PPPoE aktif
    { method: "GET", jalur: "/api/mikrotik/ppp-active-users" },

    // /teknisi-map-viewer — aset jaringan (ODC/ODP) + hitung rute
    { method: "GET", jalur: "/api/map/network-assets" },
    { method: "POST", jalur: "/api/map/network-assets" },
    { method: "POST", jalur: "/api/map/route" },

    // /admin/teknisi-request-paket — ajukan ganti paket pelanggan
    { method: "POST", jalur: "/api/request-package-change" }
];

module.exports = { IZIN_TEKNISI_API };
