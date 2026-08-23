/**
 * Header Doc
 * Purpose: Vonis KESTABILAN jalur untuk keluhan yang menyangkut game/lag — pertanyaan "apakah
 *          stabil?", yang berbeda dari pertanyaan "apakah tersambung?" yang sudah dijawab
 *          `connection-check-handler`. Murni fungsi: menerima baris probe, memulangkan tingkat
 *          kestabilan + ringkasan angka. TIDAK menyusun kalimat dan TIDAK menyentuh I/O.
 * Caller: `message/handlers/connection-check-handler.js` (jalur pelanggan),
 *         `lib/upstream-quality-alerter.js` (alarm admin).
 * Deps: Tidak ada.
 * MainFuncs: `ringkasKualitas`, `vonisKualitas`, `AMBANG_BAWAAN`.
 * SideEffects: Tidak ada.
 *
 * !! ANGKA AMBANG DIUKUR, BUKAN DITEBAK (aturan CLAUDE.md: "Calibrate thresholds against measured
 * telemetry, never intuition"). Dasar: 539.994 baris probe Tanjungharjo selama 30 hari,
 * jalur utama, rata-rata per jam WIB (target `meta` & `gateway` dipisah — lihat catatan MEDIAN):
 *
 *     03:00  loss 0,00%  jitter 0,64      17:00  loss 1,02%  jitter 4,28
 *     08:00  loss 0,05%  jitter 1,40      18:00  loss 2,24%  jitter 4,90
 *     14:00  loss 0,40%  jitter 2,93      19:00  loss 2,98%  jitter 5,36
 *     23:00  loss 0,06%  jitter 1,75      20:00  loss 3,69%  jitter 6,35  <-- puncak
 *
 * Lutut kurva ada di jam 18:00 (loss ~2%, jitter ~5) — dan di situlah keluhan pelanggan mulai
 * menumpuk (68% keluhan game jatuh jam 16-21 WIB). Karena itu ambang PERINGATAN = loss 2% /
 * jitter 5ms, dan ambang BURUK = kira-kira dua kali lipatnya (loss 5% / jitter 10ms), yang juga
 * selaras dengan `lossWarnPct: 5` milik poller.
 *
 * KENAPA POLLER TAK PERNAH MENANGKAP INI: ambangnya `lossWarnPct: 5` — jam terburuk pun hanya
 * 3,69%, jadi jalur selalu divonis NORMAL dan pelanggan yang mengeluh dibantah "terpantau normal".
 * Ambang itu menjawab "apakah jalurnya RUSAK", bukan "apakah cukup stabil untuk GAME".
 */
"use strict";

const AMBANG_BAWAAN = {
    lossPeringatanPct: 2,   // lutut kurva harian (18:00)
    lossBurukPct: 5,        // ~2x lutut; sejajar `lossWarnPct` poller
    jitterPeringatanMs: 5,  // lutut kurva harian (18:00–19:00)
    jitterBurukMs: 10,      // ~2x lutut
    minSampel: 6            // di bawah ini: TIDAK TERPANTAU, bukan "baik"
};

function angka(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function median(daftar) {
    const a = daftar.filter((x) => x !== null && x !== undefined).map(Number).filter(Number.isFinite).sort((x, y) => x - y);
    if (!a.length) return null;
    const t = Math.floor(a.length / 2);
    return a.length % 2 ? a[t] : (a[t - 1] + a[t]) / 2;
}

/**
 * Ringkas baris probe jadi satu potret kualitas.
 *
 * !! MEDIAN, BUKAN RATA-RATA — dan itu keputusan yang menentukan. Satu target yang memang buruk
 * secara sistematis menggelembungkan rata-rata: `meta` (157.240.x) terukur loss 7,34% & RTT 264ms
 * di SEMUA jalur sepanjang 30 hari, sehingga rata-rata jam 20:00 tampak 7,12% padahal kenyataannya
 * 3,69%. Median mengabaikan pencilan semacam itu dengan sendirinya, tanpa perlu daftar-hitam target
 * yang harus dirawat manual (dan yang pasti basi begitu target diganti).
 *
 * Baris `gateway` (hop PERTAMA, milik kita sendiri) SENGAJA dipisah: artinya berbeda. Loss di
 * target jauh bisa jadi milik upstream/internet; loss di hop pertama itu jaringan kita sendiri,
 * dan itu yang harus membangunkan admin.
 */
function ringkasKualitas(rows) {
    const semua = Array.isArray(rows) ? rows : [];
    const jauh = semua.filter((r) => r && String(r.target_key || "") !== "gateway");
    const hop1 = semua.filter((r) => r && String(r.target_key || "") === "gateway");

    return {
        sampel: jauh.length,
        lossPct: median(jauh.map((r) => angka(r.loss_pct))),
        jitterMs: median(jauh.map((r) => angka(r.jitter_ms))),
        rttMs: median(jauh.map((r) => angka(r.rtt_avg_ms))),
        hopPertamaLossPct: median(hop1.map((r) => angka(r.loss_pct))),
        hopPertamaSampel: hop1.length
    };
}

/**
 * @returns {'STABIL'|'KURANG_STABIL'|'TIDAK_STABIL'|'TIDAK_TERPANTAU'}
 *
 * `TIDAK_TERPANTAU` adalah keadaan KETIGA yang wajib ada: sampel kurang berarti bot sedang BUTA
 * (poller mati, bot baru restart — produksi restart 7–13x/hari), bukan berarti jaringannya baik.
 * Aturan rumah: "cannot observe" != "observed good".
 */
function vonisKualitas(ringkas, ambangOverride = {}) {
    const a = { ...AMBANG_BAWAAN, ...(ambangOverride || {}) };
    if (!ringkas || ringkas.sampel < a.minSampel) return "TIDAK_TERPANTAU";
    if (ringkas.lossPct === null && ringkas.jitterMs === null) return "TIDAK_TERPANTAU";

    const loss = ringkas.lossPct === null ? 0 : ringkas.lossPct;
    const jitter = ringkas.jitterMs === null ? 0 : ringkas.jitterMs;

    if (loss >= a.lossBurukPct || jitter >= a.jitterBurukMs) return "TIDAK_STABIL";
    if (loss >= a.lossPeringatanPct || jitter >= a.jitterPeringatanMs) return "KURANG_STABIL";
    return "STABIL";
}

module.exports = { AMBANG_BAWAAN, median, ringkasKualitas, vonisKualitas };
