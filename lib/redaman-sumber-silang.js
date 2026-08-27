/**
 * Header Doc
 * Purpose: Menyajikan redaman dari DUA sumber APA ADANYA — GenieACS (dilaporkan modem) dan
 *          OLT (dibaca dari web) — tanpa memaksa keduanya jadi satu angka.
 *
 *          KENAPA TIDAK DISINKRONKAN (keputusan pemilik, 2026-08-27): memilih salah satu
 *          MEMBUANG informasi, lalu memaksa kita mengarang aturan "siapa menang" berikut
 *          ambang kalibrasi yang harus dirawat selamanya. Versi pertama modul ini melakukan
 *          itu — dan ambang pertamanya langsung salah menandai 2 dari 97 perangkat yang
 *          pemetaannya benar. Menampilkan keduanya menghapus seluruh kelas masalah itu:
 *          teknisi melihat kenyataan dari dua titik pandang dan menilai sendiri.
 *
 *          SATU hal yang tetap harus diputuskan: alarm ya/tidak — dua angka tak bisa
 *          ditampilkan ke sebuah boolean. Aturannya sengaja yang paling aman dan paling
 *          sederhana: **alert bila SALAH SATU sumber melewati ambang**. TERUKUR tidak
 *          menambah kebisingan sama sekali (97 pelanggan: 'ACS saja' 2 · 'OLT saja' 2 ·
 *          'salah satu' 2 — keduanya sepakat pada kedua kasus).
 *
 *          Beda besar antar-sumber TIDAK lagi menahan alarm; ia hanya ditempelkan sebagai
 *          catatan. Menahan alarm berarti berpotensi menyembunyikan gangguan nyata, dan
 *          teknisi yang melihat kedua angka bisa menilainya sendiri.
 *
 *          Konteks terukur: keduanya membaca daya terima ONU yang SAMA (r = 0,991; Huawei
 *          memotong desimal, OLT memberi 2 desimal), jadi ini bukan verifikasi silang —
 *          nilainya ada di CAKUPAN (saling menambal saat satu sumber diam) dan KEJELASAN.
 * Caller: `lib/cron/jobs/redaman-check.js`.
 * Deps: tidak ada (murni).
 * MainFuncs: `ringkasDuaSumber`, `AMBANG_BEDA_DB`.
 * SideEffects: tidak ada.
 */
"use strict";

// Ambang untuk CATATAN "beda jauh" — bukan untuk menahan alarm.
// Dikalibrasi dari sebaran nyata: HG8145V5 (n=92) median 0,46 · p90 0,93 · maks 1,85 dB.
// Di atas maksimum itu, dua bacaan hampir pasti milik DUA PERANGKAT berbeda.
const AMBANG_BEDA_DB = 2.5;

const TAK_TERBACA = "(tidak terbaca)";

function angkaAtauNull(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number.parseFloat(String(v));
    return Number.isFinite(n) ? n : null;
}

// OLT memberi 2 desimal; ACS Huawei bilangan bulat. Ditampilkan APA ADANYA supaya teknisi
// bisa mencocokkan langsung dengan angka di halaman OLT.
function fmt(v) {
    if (v === null) return TAK_TERBACA;
    return `${Number.isInteger(v) ? v : v.toFixed(2)} dBm`;
}

/**
 * @param {{acs:number|string|null, olt:number|string|null, ambangAlert:number,
 *          ambangBedaDb?:number}} input
 * @returns {{acs:number|null, olt:number|null, beda:number|null, bedaBesar:boolean,
 *            layakAlert:boolean, terburuk:number|null, adaData:boolean, teks:string}}
 */
function ringkasDuaSumber(input = {}) {
    const acs = angkaAtauNull(input.acs);
    const olt = angkaAtauNull(input.olt);
    const ambangBeda = Number.isFinite(input.ambangBedaDb) && input.ambangBedaDb > 0
        ? input.ambangBedaDb
        : AMBANG_BEDA_DB;
    const ambangAlert = angkaAtauNull(input.ambangAlert);

    const beda = acs !== null && olt !== null ? Math.abs(acs - olt) : null;
    const bedaBesar = beda !== null && beda > ambangBeda;

    // Alert bila SALAH SATU melewati ambang — tak perlu keduanya sepakat, dan tak perlu
    // memilih pemenang. Fail-safe: lebih baik teknisi melihat dua angka lalu memutuskan.
    const kena = (v) => v !== null && ambangAlert !== null && v <= ambangAlert;
    const layakAlert = kena(acs) || kena(olt);

    const kandidat = [acs, olt].filter((v) => v !== null);
    const terburuk = kandidat.length ? Math.min(...kandidat) : null;

    let teks = `GenieACS ${fmt(acs)} · OLT ${fmt(olt)}`;
    if (bedaBesar) {
        // Ditempelkan, BUKAN dipakai menahan alarm. Beda sebesar ini biasanya berarti
        // pelanggan tertaut ke ONU yang keliru — dan itu perlu dilihat manusia.
        teks += ` ⚠️ beda ${beda.toFixed(2)} dB — cek pemetaan pelanggan/ONU`;
    }

    return {
        acs,
        olt,
        beda,
        bedaBesar,
        layakAlert,
        terburuk,
        adaData: kandidat.length > 0,
        teks,
    };
}

module.exports = { ringkasDuaSumber, AMBANG_BEDA_DB };
