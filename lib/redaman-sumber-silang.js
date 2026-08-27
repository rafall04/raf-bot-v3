/**
 * Header Doc
 * Purpose: Memilih SATU angka redaman dari dua sumber — GenieACS (dilaporkan modem) dan OLT
 *          (dibaca dari web) — plus menandai ketidakcocokan yang menunjukkan masalah
 *          PEMETAAN, bukan masalah optik.
 *
 *          TERUKUR (Tanjungharjo, 97 pasangan, 2026-08-27): korelasi r = 0,991, selisih
 *          median 0,55 dB, p90 1,02 dB. Polanya truncation — OLT -24,81 → ACS -24;
 *          -18,93 → -18. Keduanya mengukur DAYA TERIMA ONU YANG SAMA, jadi ini bukan
 *          "pendapat kedua yang independen": kalau satu salah, yang lain salah dengan cara
 *          yang sama. Nilai menggabungkannya ada di dua hal lain:
 *
 *            1. CAKUPAN — saat modem tak inform, ACS diam; OLT tetap punya angka (dan
 *               sebaliknya saat OLT tak terjangkau). Alarm tak lagi buta sebelah.
 *            2. PRESISI — OLT memberi 2 desimal; Huawei memotong desimal. Karena itu OLT
 *               didahulukan saat keduanya ada.
 *
 *          AMBANG BEDA 1,5 dB dipilih DI ATAS p90 terukur (1,02 dB), bukan ditebak. Beda
 *          sebesar itu hampir pasti berarti kita membandingkan DUA PERANGKAT BERBEDA —
 *          pemetaan pelanggan↔ONU salah. Dalam keadaan itu redaman pelanggan tsb TIDAK
 *          diketahui, jadi alarm ditahan dan masalahnya dilaporkan sebagai integritas data.
 *          Menahan alarm di sini konsisten dengan aturan "buta bukan berarti buruk".
 * Caller: `lib/cron/jobs/redaman-check.js`.
 * Deps: tidak ada (murni).
 * MainFuncs: `pilihNilaiRedaman`, `AMBANG_BEDA_DB`, `SUMBER`.
 * SideEffects: tidak ada.
 */
"use strict";

const AMBANG_BEDA_DB = 1.5;

const SUMBER = Object.freeze({
    OLT: "olt",
    ACS: "acs",
    TIDAK_ADA: null,
});

function angkaAtauNull(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number.parseFloat(String(v));
    return Number.isFinite(n) ? n : null;
}

/**
 * @param {{acs:number|string|null, olt:number|string|null, ambangBedaDb?:number}} input
 * @returns {{angka:number|null, sumber:string|null, beda:number|null,
 *            integritasMencurigakan:boolean, acs:number|null, olt:number|null}}
 */
function pilihNilaiRedaman(input = {}) {
    const acs = angkaAtauNull(input.acs);
    const olt = angkaAtauNull(input.olt);
    const ambang = Number.isFinite(input.ambangBedaDb) && input.ambangBedaDb > 0
        ? input.ambangBedaDb
        : AMBANG_BEDA_DB;

    const dasar = { acs, olt, beda: null, integritasMencurigakan: false };

    if (acs === null && olt === null) {
        return { ...dasar, angka: null, sumber: SUMBER.TIDAK_ADA };
    }
    if (olt === null) return { ...dasar, angka: acs, sumber: SUMBER.ACS };
    if (acs === null) return { ...dasar, angka: olt, sumber: SUMBER.OLT };

    const beda = Math.abs(acs - olt);
    if (beda > ambang) {
        // Bukan optik yang bermasalah — kemungkinan besar pelanggan ini tertaut ke ONU yang
        // KELIRU. Redamannya jadi tidak diketahui; jangan mengalert dari angka mana pun.
        return { ...dasar, beda, angka: null, sumber: SUMBER.TIDAK_ADA, integritasMencurigakan: true };
    }

    // Keduanya sepakat → pakai OLT: 2 desimal, dan tidak bergantung pada modem mau inform.
    return { ...dasar, beda, angka: olt, sumber: SUMBER.OLT };
}

module.exports = { pilihNilaiRedaman, AMBANG_BEDA_DB, SUMBER };
