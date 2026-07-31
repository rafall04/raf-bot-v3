/**
 * Header Doc
 * Purpose: SATU pemilik verdict "gangguan area" (banyak pelanggan turun berbarengan) + gerbang
 *          gangguan-massal untuk auto outage. Sebelumnya rumus ambangnya disalin di tiga tempat
 *          (cek koneksi pelanggan, bot teknisi Telegram, dan tak ada sama sekali di cron auto
 *          outage) sehingga satu sistem bisa bilang "gangguan area" sementara sistem lain tetap
 *          menyapa pelanggan satu per satu. Modul ini murni hitung-hitungan: TIDAK mengirim pesan,
 *          TIDAK menyentuh DB, tak pernah throw dari input aneh.
 *
 *          BEDA DUA PERTANYAAN (jangan dicampur — mencampurnya membuat gerbang mati saat dibutuhkan
 *          atau menyala permanen tanpa gejala):
 *          - `evaluateAreaOutage` — "apakah SEKARANG banyak yang offline?" Dipakai untuk MENJAWAB
 *            pelanggan/teknisi yang bertanya. Memakai potret offline apa adanya (jumlah + rasio).
 *          - `evaluateMassOutage` — "apakah kita hendak menyapa terlalu banyak orang sekaligus?"
 *            Dipakai untuk MENAHAN kiriman keluar, dan diukur dari UKURAN BATCH yang akan dikirim.
 * Caller: `message/handlers/connection-check-handler.js` (resolveLineStatus),
 *         `message/telegram/command-handlers/cek-command.js` (collect),
 *         `services/auto-outage-detection.service.js` (buildDetectionSnapshot).
 * Deps: tidak ada (murni). Konfigurasi dibaca dari objek yang dioper pemanggil / `global.config`.
 * MainFuncs: `evaluateAreaOutage`, `evaluateMassOutage`, `getAreaOutageThresholds`.
 * SideEffects: Tidak ada.
 */
"use strict";

// Ambang lama yang tersebar di handler — dipertahankan persis supaya perilaku menjawab pelanggan
// tidak berubah saat rumusnya dipusatkan di sini.
const DEFAULT_MIN_OFFLINE = 5;
const DEFAULT_RATIO = 0.3;

function toPositiveNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveConfig(config) {
    if (config && typeof config === "object") return config;
    return (typeof global !== "undefined" && global.config) || {};
}

/**
 * Ambang verdict gangguan area. `outage_area_threshold` sudah dipakai config lama — dipertahankan
 * sebagai nama kunci supaya setelan prod yang ada tetap berlaku.
 * @returns {{minOffline:number, ratio:number}}
 */
function getAreaOutageThresholds(config) {
    const cfg = resolveConfig(config);
    return {
        minOffline: toPositiveNumber(cfg.outage_area_threshold, DEFAULT_MIN_OFFLINE),
        ratio: toPositiveNumber(cfg.outage_area_ratio, DEFAULT_RATIO),
    };
}

/**
 * Verdict "gangguan area" dari potret offline saat ini.
 * @param {{offlineCount:number, totalWithPppoe:number, config?:object}} input
 * @returns {{areaOutage:boolean, offlineCount:number, totalWithPppoe:number, ratio:number,
 *            minOffline:number, ratioThreshold:number}}
 */
function evaluateAreaOutage({ offlineCount = 0, totalWithPppoe = 0, config = null } = {}) {
    const { minOffline, ratio: ratioThreshold } = getAreaOutageThresholds(config);
    const offline = Number.isFinite(Number(offlineCount)) ? Math.max(0, Number(offlineCount)) : 0;
    const total = Number.isFinite(Number(totalWithPppoe)) ? Math.max(0, Number(totalWithPppoe)) : 0;
    const ratio = total > 0 ? offline / total : 0;

    return {
        areaOutage: offline >= minOffline || ratio >= ratioThreshold,
        offlineCount: offline,
        totalWithPppoe: total,
        ratio,
        minOffline,
        ratioThreshold,
    };
}

/**
 * Gerbang gangguan-massal untuk kiriman keluar otomatis. Menyala saat SATU putaran auto outage
 * hendak menyapa banyak pelanggan sekaligus — pada saat itu penyebabnya hampir pasti ada di sisi
 * kita, sehingga bertanya "apakah ada kendala pada WiFi-nya?" satu per satu salah alamat sekaligus
 * jadi kiriman massal di luar antrean ber-jitter.
 *
 * DIUKUR DARI UKURAN BATCH YANG AKAN DIKIRIM (`eligibleCount`), bukan dari jumlah pelanggan offline
 * apa adanya. Dua alasan, keduanya pernah jadi jebakan saat merancang ini:
 *   1. Pelanggan isolir/churn offline berminggu-minggu. Kalau gerbang memakai jumlah offline mentah,
 *      ia menyala TERUS dan mematikan auto outage tanpa gejala apa pun — cuma pesan yang tak pernah
 *      terkirim. `eligibleCount` kebal: begitu satu pelanggan sudah dikirimi, `broadcast_count`
 *      menahannya (repository sengaja mempertahankan hitungan itu selama status tetap offline).
 *   2. Gerbang berbasis "baru saja turun" TIDAK PERNAH bertemu jendela kelayakan rule. Rule default
 *      baru menganggap layak setelah offline 180 menit, sedangkan "baru saja turun" berumur menit —
 *      gerbangnya akan selalu padam persis saat dibutuhkan.
 * Ukuran batch juga yang sebanding dengan kerugiannya: berapa DM yang akan meluncur.
 *
 * Rasio sengaja TIDAK dipakai di sini (beda dengan `evaluateAreaOutage`): pada instansi kecil ia
 * menyala karena angka kecil (2 dari 5 = 40%) padahal 2 DM bukan kiriman massal, sementara pada
 * instansi besar ambang absolut selalu tercapai lebih dulu.
 *
 * @param {{eligibleCount:number, totalWithPppoe?:number, config?:object}} input
 * @returns {{active:boolean, enabled:boolean, eligibleCount:number, totalWithPppoe:number,
 *            minOffline:number, reason:(string|null)}}
 */
function evaluateMassOutage({ eligibleCount = 0, totalWithPppoe = 0, config = null } = {}) {
    const cfg = resolveConfig(config);
    const gate = (cfg && cfg.autoOutageMassGate) || {};
    // CATATAN SENGAJA: default ON, menyimpang dari kebiasaan "fitur baru default OFF". Ini GERBANG
    // PENGAMAN, bukan fitur — kalau default OFF, perilaku yang dikirim tetap perilaku yang rusak
    // (satu kabel putus = puluhan pelanggan di-DM satu per satu). Matikan hanya dengan sadar.
    const enabled = gate.enabled !== false;
    const minOffline = toPositiveNumber(gate.maxBatchSize, getAreaOutageThresholds(cfg).minOffline);

    const batch = Number.isFinite(Number(eligibleCount)) ? Math.max(0, Number(eligibleCount)) : 0;
    const total = Number.isFinite(Number(totalWithPppoe)) ? Math.max(0, Number(totalWithPppoe)) : 0;
    const reason = enabled && batch >= minOffline ? "batch_too_large" : null;

    return {
        active: reason !== null,
        enabled,
        eligibleCount: batch,
        totalWithPppoe: total,
        minOffline,
        reason,
    };
}

module.exports = {
    evaluateAreaOutage,
    evaluateMassOutage,
    getAreaOutageThresholds,
    DEFAULT_MIN_OFFLINE,
    DEFAULT_RATIO,
};
