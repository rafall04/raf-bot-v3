/**
 * Header Doc
 * Purpose: Menerjemahkan kegagalan ganti nama/sandi WiFi jadi SEBAB yang benar untuk pelanggan —
 *          dan memutuskan apakah pantas menyuruh mereka memeriksa modemnya.
 * Caller: `message/handlers/states/wifi-password-state-handler.js`,
 *         `message/handlers/states/wifi-name-state-handler.js`.
 * Deps: Tidak ada. Fungsi murni.
 * MainFuncs: `bacaSebabGagalWifi`.
 * SideEffects: Tidak ada.
 *
 * !! KENAPA ADA (#b268). Semua kegagalan dulu memakai SATU pesan yang menyuruh pelanggan
 * "pastikan modem dalam keadaan menyala". Terukur ada empat sebab berbeda, dan hanya SATU yang
 * ada di sisi pelanggan:
 *
 *     modem tak menjawab (HTTP 202)  -> memang perlu cek modem
 *     server pengatur modem MATI     -> modemnya baik-baik saja
 *     breaker terbuka                -> modemnya baik-baik saja
 *     timeout ke server              -> modemnya baik-baik saja
 *
 * Menyuruh orang mengurus perangkat yang tidak rusak membuat mereka mencoba, gagal lagi, lalu
 * menyimpulkan layanannya rusak — sementara TAK ADA yang diberi tahu sistem kita yang bermasalah.
 * Pola kesalahan yang sama dengan alur LEMOT (#b261): menuduh sisi pelanggan saat kita yang buta.
 *
 * PRIVASI: `pesanPelanggan` tidak pernah menyebut GenieACS/ACS/breaker/IP — istilah internal itu
 * tak berarti apa pun bagi pelanggan (aturan customer-facing-no-internal-ids).
 */
"use strict";

// Kode & kata kunci yang menandakan masalah ada DI SISI KITA, bukan di modem pelanggan.
const SISI_KITA = [
    "connect_error", "econnrefused", "ehostunreach", "enetunreach",
    "breaker", "circuit", "timeout_error", "etimedout", "timeout",
    "config_error", "auth_error", "task_submission_error", "500", "502", "503"
];
// Modem terjangkau ACS tapi tak menjawab panggilan — ini memang perlu dicek pelanggan.
const MODEM_DIAM = ["device_unreachable", "queued", "202", "tidak menjawab", "tidak merespons"];

function normal(x) {
    return String(x == null ? "" : x).toLowerCase();
}

/**
 * @param {object|Error} hasil Hasil operasi ACS ATAU Error yang dilempar penjaga.
 * @returns {{pihak:'modem'|'kami'|'tidak_diketahui', sarankanCekModem:boolean, kunciTemplate:string}}
 *
 * `tidak_diketahui` sengaja TIDAK menyuruh cek modem: saat kita tak bisa memastikan, menuduh
 * sisi pelanggan adalah tebakan yang merugikan mereka. Aturan rumah: "cannot observe" != "observed bad".
 */
function bacaSebabGagalWifi(hasil) {
    const teks = normal(
        (hasil && (hasil.errorCode || hasil.code)) + " " +
        (hasil && (hasil.message || hasil.error)) + " " +
        (hasil && hasil.details && hasil.details.httpStatus)
    );

    if (MODEM_DIAM.some((k) => teks.includes(k))) {
        return { pihak: "modem", sarankanCekModem: true, kunciTemplate: "wifi_gagal_modem_diam" };
    }
    if (SISI_KITA.some((k) => teks.includes(k))) {
        return { pihak: "kami", sarankanCekModem: false, kunciTemplate: "wifi_gagal_sisi_kami" };
    }
    return { pihak: "tidak_diketahui", sarankanCekModem: false, kunciTemplate: "wifi_gagal_sisi_kami" };
}

module.exports = { bacaSebabGagalWifi, _internal: { SISI_KITA, MODEM_DIAM } };
