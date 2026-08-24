/**
 * Header Doc
 * Purpose: Menuliskan rentang waktu dalam bahasa yang wajar dibaca PELANGGAN — satu-satunya
 *          pemilik format durasi untuk teks yang dikirim ke luar.
 * Caller: `lib/olt-los-broadcaster.js` (durasi gangguan di pesan pulih), `lib/cctv-monitor.js`.
 * Deps: Tidak ada. Fungsi murni.
 * MainFuncs: `formatDurasi`.
 * SideEffects: Tidak ada.
 *
 * KENAPA ADA (#b260): dulu ada DUA salinan `fmtDuration` dengan perilaku berbeda, dan keduanya
 * sama-sama sampai ke pelanggan. Salinan LOS menuliskan "2 jam 0 menit" untuk jam bulat, dan
 * tak satu pun mengenal satuan HARI — insiden nyata 2258 menit terbaca "37 jam 38 menit",
 * angka yang harus dihitung sendiri oleh pembacanya.
 *
 * Aturan penulisan, dipilih agar tetap mudah dibaca di layar HP:
 *   < 1 jam   -> "45 menit"
 *   < 1 hari  -> "3 jam" · "3 jam 20 menit"        (satuan nol tak pernah ditulis)
 *   >= 1 hari -> "1 hari" · "1 hari 13 jam"        (menit dibuang; pada rentang sehari lebih,
 *                                                   presisi menit tak menambah apa pun)
 */
"use strict";

/**
 * @param {number} ms rentang dalam milidetik
 * @returns {string|null} null bila bukan angka wajar (pemanggil yang memutuskan teks penggantinya)
 */
function formatDurasi(ms) {
    if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
    const totalMenit = Math.max(1, Math.round(ms / 60000));
    if (totalMenit < 60) return `${totalMenit} menit`;

    const totalJam = Math.floor(totalMenit / 60);
    const menit = totalMenit % 60;
    if (totalJam < 24) return menit ? `${totalJam} jam ${menit} menit` : `${totalJam} jam`;

    const hari = Math.floor(totalJam / 24);
    const jam = totalJam % 24;
    return jam ? `${hari} hari ${jam} jam` : `${hari} hari`;
}

module.exports = { formatDurasi };
