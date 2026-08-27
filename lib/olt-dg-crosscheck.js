/**
 * Header Doc
 * Purpose: Silang DUA SUMBER untuk memutuskan LOS vs DYING-GASP. Kejadian mati ONU masuk
 *          lewat dua jalan — `syslog` (didorong OLT, cepat) dan `scrape` (halaman log OLT,
 *          dibaca berkala) — dan keduanya bisa keliru ke arah yang SAMA.
 *
 *          KENAPA SELALU KELIRU KE "LOS": vonis LOS adalah **ketiadaan** bukti dying-gasp
 *          (lihat `olt-event-classifier`). Jadi begitu baris dying-gasp-nya tak terlihat,
 *          hasilnya otomatis LOS — padahal ONU-nya cuma kehilangan listrik:
 *            · syslog — paket UDP pembawa dying-gasp HILANG di jalan;
 *            · scrape — baris dying-gasp sudah tergulung dari halaman yang dibaca
 *              (`maxLogPages` cuma 3).
 *          Dying-gasp adalah bukti POSITIF (ONU sempat melapor kehabisan daya); LOS hanya
 *          ketiadaannya. Ketiadaan bukti di satu sumber tidak mengalahkan adanya bukti di
 *          sumber lain — maka lintas-sumber **DG MENANG**.
 *
 *          Kenapa ini penting: LOS memanggil teknisi ke lapangan mencari fiber putus,
 *          dying-gasp tidak (itu mati listrik). Setiap LOS palsu = satu perjalanan sia-sia.
 *
 *          TERUKUR (Tanjungharjo, 2026-08-27): dari 54 kejadian mati bersumber `scrape`,
 *          49 tak punya pasangan syslog sama sekali walau jendela dilebarkan sampai 3 jam —
 *          jadi kedua sumber memang menangkap kejadian yang sebagian besar BERBEDA, bukan
 *          saling mengulang. Dari yang berpasangan, SEMUA ketidaksepakatannya berpola sama:
 *          `syslog=dying-gasp` lebih dulu, `scrape=los` menyusul. Karena itu koreksi di sini
 *          sengaja hanya MAJU (DG lebih dulu → LOS berikutnya dikoreksi). Kasus sebaliknya
 *          (DG datang setelah LOS tercatat) TIDAK dikoreksi surut — belum pernah terukur, dan
 *          menulis ulang baris lama menuntut kehati-hatian yang tak sepadan tanpa bukti.
 *
 *          Jam OLT tidak dipakai sama sekali (NTP-nya meleset — terpantau 40 menit di depan).
 *          Semua perbandingan memakai jam server.
 * Caller: `lib/olt-event-logger.js` (recordOltEventSafe).
 * Deps: tidak ada (murni, in-memory).
 * MainFuncs: `catatDyingGasp`, `adaDyingGaspTerkini`, `putuskanJenis`, `_reset`.
 * SideEffects: menyimpan jejak DG terkini di memori proses (dibatasi jumlah + umur).
 */
"use strict";

// Jendela korelasi. Scrape membaca berkala (bawaan 2 menit) dan halamannya memuat kejadian
// s/d `timeWindow` menit ke belakang, jadi LOS versi scrape bisa menyusul beberapa menit
// setelah DG versi syslog. 15 menit memberi ruang cukup tanpa mengaitkan dua kejadian
// yang benar-benar terpisah.
const JENDELA_MS = 15 * 60 * 1000;

// Batas ingatan supaya tak tumbuh tanpa henti pada armada besar.
const MAKS_MAC = 2000;

const jejakDg = new Map(); // macNorm -> tsMs terakhir

function normMac(mac) {
    return String(mac || "").replace(/[^0-9a-fA-F]/g, "").toLowerCase();
}

function prune(sekarangMs, jendelaMs) {
    for (const [k, ts] of jejakDg) {
        if (sekarangMs - ts > jendelaMs) jejakDg.delete(k);
    }
    if (jejakDg.size > MAKS_MAC) {
        // Buang yang paling tua dulu.
        const urut = [...jejakDg.entries()].sort((a, b) => a[1] - b[1]);
        for (let i = 0; i < urut.length - MAKS_MAC; i++) jejakDg.delete(urut[i][0]);
    }
}

/** Catat bahwa MAC ini terlihat dying-gasp pada `tsMs` (sumber apa pun). */
function catatDyingGasp(mac, tsMs) {
    const k = normMac(mac);
    if (!k) return;
    const t = Number.isFinite(tsMs) ? tsMs : Date.now();
    const lama = jejakDg.get(k);
    if (!Number.isFinite(lama) || t > lama) jejakDg.set(k, t);
    prune(t, JENDELA_MS);
}

/** Apakah ada dying-gasp untuk MAC ini dalam jendela sebelum `tsMs`? */
function adaDyingGaspTerkini(mac, tsMs, jendelaMs = JENDELA_MS) {
    const k = normMac(mac);
    if (!k) return false;
    const t = Number.isFinite(tsMs) ? tsMs : Date.now();
    const dg = jejakDg.get(k);
    if (!Number.isFinite(dg)) return false;
    // Hanya DG yang terjadi SEBELUM (atau bersamaan) — koreksi ini sengaja maju saja.
    return dg <= t && t - dg <= jendelaMs;
}

/**
 * Putuskan jenis akhir sebuah kejadian, dengan mempertimbangkan sumber lain.
 *
 * @param {{event_type:string, mac:string, tsMs:number, source:string, jendelaMs?:number}} ev
 * @returns {{event_type:string, dikoreksi:boolean, alasan:string|null}}
 */
function putuskanJenis(ev = {}) {
    const jenis = String(ev.event_type || "").toLowerCase();
    const tsMs = Number.isFinite(ev.tsMs) ? ev.tsMs : Date.now();

    if (jenis === "dying-gasp") {
        catatDyingGasp(ev.mac, tsMs);
        return { event_type: "dying-gasp", dikoreksi: false, alasan: null };
    }

    if (jenis === "los" && adaDyingGaspTerkini(ev.mac, tsMs, ev.jendelaMs)) {
        // Bukti positif dari sumber lain mengalahkan ketiadaan bukti di sumber ini.
        return {
            event_type: "dying-gasp",
            dikoreksi: true,
            alasan: "dying-gasp terlihat lebih dulu dari sumber lain",
        };
    }

    return { event_type: jenis || ev.event_type, dikoreksi: false, alasan: null };
}

module.exports = {
    catatDyingGasp,
    adaDyingGaspTerkini,
    putuskanJenis,
    JENDELA_MS,
    _reset: () => jejakDg.clear(),
    _ukuran: () => jejakDg.size,
};
