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


// Jeda antar-laporan per sebab. Saat sistem kita bermasalah, pelanggan mencoba berbondong-bondong;
// tanpa jeda, satu gangguan menghasilkan puluhan pesan yang isinya sama.
const JEDA_LAPOR_MS = 30 * 60 * 1000;
const terakhirLapor = new Map();

/**
 * Beri tahu admin saat kegagalan ada DI SISI KITA.
 *
 * !! KENAPA WAJIB (#b268): teks ke pelanggan berjanji "Tim kami sudah mendapat pemberitahuannya".
 * Tanpa fungsi ini janji itu BOHONG — pelanggan menunggu penanganan yang tak pernah dimulai, dan
 * sistem yang rusak tak diketahui siapa pun. Janji yang tak ditepati lebih merusak kepercayaan
 * daripada tidak berjanji sama sekali.
 *
 * Never-throw: gagal melapor tak boleh menjatuhkan balasan ke pelanggan.
 */
async function laporkanKegagalanWifiKeAdmin(sebab, aksi, ctx = {}, err = null) {
    try {
        if (!sebab || sebab.pihak !== "kami") return { dilaporkan: false, alasan: "bukan sisi kami" };
        const kunci = String((err && (err.code || err.message)) || "generik").slice(0, 60);
        const now = Date.now();
        const lalu = terakhirLapor.get(kunci) || 0;
        if (now - lalu < JEDA_LAPOR_MS) return { dilaporkan: false, alasan: "masih dalam jeda" };

        const { getAdminJids } = require("./admin-recipients");
        const { sendNotification } = require("./whatsapp-notification-wrapper");
        const jids = (await getAdminJids()) || [];
        if (!jids.length) return { dilaporkan: false, alasan: "tak ada admin terdaftar" };

        const teks = [
            "🛠️ *Perubahan WiFi pelanggan GAGAL — sisi kita*",
            "",
            `Aksi     : ${aksi}`,
            `Pelanggan: ${(ctx && ctx.targetUser && ctx.targetUser.name) || "-"}`,
            `Sebab    : ${(err && err.message) || "-"}`,
            "",
            "Pelanggan sudah diberi tahu bahwa ini BUKAN dari modemnya, dan diminta mencoba lagi.",
            "Selama ini berlangsung, ganti nama/sandi WiFi kemungkinan gagal untuk semua pelanggan."
        ].join("\n");

        let terkirim = 0;
        for (const jid of jids) {
            try {
                const r = await sendNotification(jid, teks);
                if (r !== false) terkirim += 1;
            } catch (_e) { /* satu gagal tak menghentikan sisanya */ }
        }
        // Jeda hanya dipasang bila ADA yang benar-benar terkirim — kalau WhatsApp ikut bermasalah,
        // membungkam laporan 30 menit berikutnya justru menyembunyikan gangguan yang sedang jalan.
        if (terkirim > 0) terakhirLapor.set(kunci, now);
        return { dilaporkan: terkirim > 0, terkirim };
    } catch (_e) {
        return { dilaporkan: false, alasan: "error" };
    }
}

module.exports = { bacaSebabGagalWifi, laporkanKegagalanWifiKeAdmin, _resetJedaUntukTest: () => terakhirLapor.clear(), _internal: { SISI_KITA, MODEM_DIAM } };
