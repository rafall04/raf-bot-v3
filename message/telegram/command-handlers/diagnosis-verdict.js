/**
 * Header Doc
 * Purpose: Mesin vonis diagnosa pelanggan untuk perintah /cek (one-shot) bot teknisi.
 *          Murni: menggabungkan sinyal (status PPPoE, gangguan area, status OLT LOS/Dying-Gasp,
 *          redaman modem & OLT vs toleransi) menjadi satu vonis berperingkat + penyebab + saran
 *          tindakan (READ-ONLY: saran saja, bot tidak mengeksekusi apa pun). Mudah di-unit-test.
 * Caller: `message/telegram/command-handlers/cek-command.js`.
 * Deps: `lib/telegram/telegram-format` (rxVerdict).
 * MainFuncs: `buildVerdict(input)` → { level, emoji, headline, penyebab, saran, rx }.
 * SideEffects: tidak ada.
 */
"use strict";

const { rxVerdict } = require("../../../lib/telegram/telegram-format");

function mk(level, emoji, headline, penyebab, saran, rx) {
    return { level, emoji, headline, penyebab, saran: saran || null, rx: rx || null };
}
const red = (h, p, s, rx) => mk("red", "🔴", h, p, s, rx);
const yellow = (h, p, s, rx) => mk("yellow", "🟡", h, p, s, rx);
const green = (h, p, s, rx) => mk("green", "🟢", h, p, s, rx);
const gray = (h, p, s) => mk("gray", "⚪", h, p, s, null);

// Pilih verdict RX terburuk (BURUK > WASPADA > BAIK) dari sisi modem & OLT.
function worseRx(a, b) {
    const rank = { BURUK: 3, WASPADA: 2, BAIK: 1 };
    const va = a && a.value != null ? a : null;
    const vb = b && b.value != null ? b : null;
    if (!va) return vb;
    if (!vb) return va;
    return (rank[va.label] || 0) >= (rank[vb.label] || 0) ? va : vb;
}

/**
 * @param {object} input
 * @param {'online'|'offline'|'unknown'} input.lineStatus - status PPPoE
 * @param {boolean} input.areaOutage
 * @param {number} input.offlineCount
 * @param {string|null} input.oltStatus - 'Online'|'LOS'|'Dying Gasp'|'Offline'|null
 * @param {boolean} input.isLos
 * @param {boolean} input.isDyingGasp
 * @param {*} input.modemRxRaw - nilai redaman modem (GenieACS) atau null
 * @param {*} input.oltRxRaw - nilai redaman OLT (SNMP) atau null
 * @param {*} input.tolerance - rx_tolerance
 * @returns {{level:string, emoji:string, headline:string, penyebab:string, saran:(string|null), rx:object|null}}
 */
function buildVerdict(input = {}) {
    const tol = input.tolerance;
    const modemV = input.modemRxRaw != null ? rxVerdict(input.modemRxRaw, tol) : null;
    const oltV = input.oltRxRaw != null ? rxVerdict(input.oltRxRaw, tol) : null;
    const rx = worseRx(modemV, oltV);

    const los = input.isLos === true || input.oltStatus === "LOS";
    const dg = input.isDyingGasp === true || input.oltStatus === "Dying Gasp";

    // Prioritas paling parah dulu.
    if (los) {
        return red(
            "Fiber bermasalah (LOS)",
            "Sinyal optik hilang — kemungkinan fiber putus, konektor kotor, atau redaman sangat buruk.",
            "Cek & bersihkan konektor, telusuri jalur fiber ke pelanggan.",
            rx
        );
    }
    if (dg) {
        return red(
            "ONU mati — Dying Gasp",
            "ONU kehilangan daya (listrik atau adaptor mati).",
            "Pastikan listrik & adaptor ONU menyala; cek di lokasi bila perlu.",
            rx
        );
    }
    if (input.lineStatus === "offline" && input.areaOutage) {
        return red(
            "Gangguan area",
            `Terputus, dan sekitar ${input.offlineCount} pelanggan lain ikut terdampak.`,
            "Tangani di sisi distribusi/uplink; pelanggan tidak perlu membuat laporan.",
            rx
        );
    }
    if (input.lineStatus === "offline") {
        return red(
            "Koneksi terputus (hanya pelanggan ini)",
            "Hanya jalur pelanggan ini yang putus — ONU/modem mati atau jalur ke pelanggan bermasalah.",
            "Minta pelanggan restart modem; bila tetap mati → cek fisik/ONU.",
            rx
        );
    }

    if (input.lineStatus === "online") {
        if (rx && rx.label === "BURUK") {
            return yellow(
                "Online, tetapi redaman BURUK",
                "Sinyal optik lemah — rawan putus saat hujan atau jam sibuk.",
                "Jadwalkan perbaikan konektor/splicing atau penataan kabel.",
                rx
            );
        }
        if (rx && rx.label === "WASPADA") {
            return yellow(
                "Online, redaman mendekati ambang",
                "Sinyal mulai menurun.",
                "Pantau; rapikan konektor bila terus memburuk.",
                rx
            );
        }
        if (rx && rx.label === "BAIK") {
            return green("Sehat", "Jalur internet aktif & redaman dalam batas wajar.", null, rx);
        }
        return green("Online", "Jalur internet aktif.", null, rx);
    }

    return gray(
        "Status belum lengkap",
        "Sebagian data (MikroTik / OLT / GenieACS) tidak terjangkau saat ini.",
        "Coba lagi sebentar, atau cek per bagian: /redaman, /olt, /koneksi."
    );
}

module.exports = { buildVerdict, worseRx };
