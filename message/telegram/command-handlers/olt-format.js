/**
 * Header Doc
 * Purpose: Formatter baris "sisi OLT" dari hasil resolveByCustomer (lib/olt-optical-resolver),
 *          dipakai bersama handler /olt dan /redaman. Murni.
 * Caller: `olt-command.js`, `redaman-command.js`.
 * Deps: `lib/telegram/telegram-format`.
 * MainFuncs: `fmtOltLines(resolveResult)` → string[].
 * SideEffects: tidak ada.
 */
"use strict";

const { code, escapeHtml, statusBadge } = require("../../../lib/telegram/telegram-format");

function hasValue(v) {
    return v != null && v !== "" && v !== "N/A";
}

/**
 * @param {object} r - hasil resolveByCustomer
 * @returns {string[]} baris-baris siap di-join
 */
function fmtOltLines(r) {
    if (!r || !r.identifiable) {
        return ["❔ Tidak dapat dipetakan ke ONU di OLT (PPPoE / serial / MAC tak cocok)."];
    }

    const lines = [];

    // "Tak bisa mengamati" ≠ "mengamati yang mati". Kalau OLT-nya sendiri tak terbaca, teknisi
    // harus tahu bahwa ini kebutaan alat baca — bukan vonis tentang modem pelanggan, yang dulu
    // dicetak sebagai "🔴 Offline" dengan penuh percaya diri.
    if (r.statusKnown === false) {
        lines.push("❔ Status <b>TIDAK TERBACA</b> — OLT tidak menjawab, jadi ini bukan vonis soal modem pelanggan.");
    } else {
        lines.push(`Status: ${statusBadge(r.status)} <b>${escapeHtml(r.status)}</b>`);
    }
    if (hasValue(r.rxPower)) lines.push(`RX (sisi OLT): <b>${escapeHtml(String(r.rxPower))}</b> dBm`);

    const oltLabel = [r.oltName, r.oltHost].filter(Boolean).map(escapeHtml).join(" · ");
    if (oltLabel) lines.push(`OLT: ${oltLabel}`);

    const loc = [];
    if (hasValue(r.ponName)) loc.push(`PON ${escapeHtml(String(r.ponName))}`);
    if (r.slotId != null) loc.push(`Slot ${escapeHtml(String(r.slotId))}`);
    if (r.onuId != null) loc.push(`ONU ${escapeHtml(String(r.onuId))}`);
    if (loc.length) lines.push(loc.join(" · "));

    if (hasValue(r.serial)) lines.push(`Serial: ${code(r.serial)}`);

    // Alasan putus (LOS vs Dying Gasp) bila tidak online. Dilewati saat status tak terbaca:
    // `lastDownCause` di situ adalah sisa pembacaan lama, bukan sebab kejadian sekarang.
    if (r.statusKnown !== false && r.status && String(r.status).toLowerCase() !== "online") {
        if (r.isDyingGasp) {
            lines.push("⚠️ Penyebab: <b>Dying Gasp</b> — listrik/adaptor ONU mati.");
        } else if (r.isLos) {
            lines.push("⚠️ Penyebab: <b>LOS</b> — fiber putus / redaman sangat buruk.");
        } else if (hasValue(r.lastDownCause)) {
            lines.push(`⚠️ Penyebab terakhir: ${escapeHtml(String(r.lastDownCause))}`);
        }
    }

    return lines;
}

module.exports = { fmtOltLines, hasValue };
