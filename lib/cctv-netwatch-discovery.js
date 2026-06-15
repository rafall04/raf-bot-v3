/**
 * Header Doc
 * Purpose: Parser + classifier ENTRI NETWATCH → kandidat CCTV untuk fitur "Discovery".
 *          Membaca isi up-script/down-script netwatch, mengenali pola CCTV (`:local cctv`,
 *          `:local area`) vs infra/backhaul (`:local dev`, teks "KONEKSI PUTUS/PULIH") vs
 *          noise (uji konektivitas/AP/modem). Tujuan: admin tak perlu ketik ulang IP/nama
 *          yang sudah ada di netwatch — cukup tempel nomor WA pelanggan. Cross-check ke
 *          registry agar yang sudah diadopsi tidak ditawarkan lagi (anti tumpang-tindih).
 *          READ-ONLY total — tidak pernah menulis ke MikroTik.
 * Caller: routes/cctv.js (GET /api/cctv/discovery).
 * Deps: ./cctv-registry (normalizeHost — agar normalisasi host identik dgn registry & monitor).
 * MainFuncs: extractLocal, classifyEntry, classifyNetwatchEntries, markRegistered.
 * SideEffects: none (semua fungsi murni).
 */
'use strict';

const { normalizeHost } = require('./cctv-registry');

/**
 * Ambil nilai `:local <name> "<value>"` dari script RouterOS.
 * @returns {string|null} isi string (apa adanya, tanpa unescape) atau null bila tak ada.
 */
function extractLocal(script, name) {
    if (!script) return null;
    const re = new RegExp(':local\\s+' + name + '\\s+"((?:[^"\\\\]|\\\\.)*)"', 'i');
    const m = re.exec(String(script));
    return m ? m[1] : null;
}

/**
 * Klasifikasikan satu entri netwatch.
 * @param {object} entry {id?, host, status, comment, disabled, up_script, down_script}
 * @returns {object} { klass:'cctv'|'excluded', conformant, name, area, host, status,
 *                     disabled, comment, netwatchId, excludedReason? }
 */
function classifyEntry(entry) {
    const e = entry || {};
    const host = normalizeHost(e.host);
    const comment = String(e.comment || '').trim();
    const script = String(e.down_script || '') + '\n' + String(e.up_script || '');

    const cctvName = extractLocal(script, 'cctv');
    const area = extractLocal(script, 'area');
    const dev = extractLocal(script, 'dev');

    const base = {
        host,
        status: String(e.status || '').toLowerCase() || null,
        disabled: String(e.disabled) === 'true',
        comment,
        netwatchId: e.id || null,
        area: area || null,
    };

    // Sinyal infra/backhaul (OLT, link, AP terpantau) → BUKAN CCTV.
    const looksInfra = !!dev || /KONEKSI\s+(PUTUS|PULIH)/i.test(script);
    // Sinyal CCTV via comment — untuk entri yang script-nya belum standar.
    const commentLooksCctv = /\b(cctv|nvr)\b/i.test(comment);

    if (cctvName) {
        // Script sudah format CCTV standar → nama & area diambil dari script.
        return { ...base, klass: 'cctv', conformant: true, name: cctvName };
    }
    if (commentLooksCctv && !looksInfra) {
        // CCTV menurut comment, tapi script belum standar (mis. "/tool fetch url").
        return { ...base, klass: 'cctv', conformant: false, name: comment };
    }
    return {
        ...base,
        klass: 'excluded',
        conformant: false,
        name: comment || host,
        excludedReason: looksInfra ? 'infra' : 'noise',
    };
}

/** Petakan array entri netwatch → array hasil klasifikasi. */
function classifyNetwatchEntries(entries) {
    return (Array.isArray(entries) ? entries : []).map(classifyEntry);
}

/**
 * Tandai kandidat yang host-nya SUDAH ada di registry (anti tumpang-tindih).
 * @param {object[]} candidates hasil classify (umumnya yang klass==='cctv')
 * @param {string[]} registeredHosts daftar host yang sudah terdaftar di registry
 */
function markRegistered(candidates, registeredHosts) {
    const set = new Set((registeredHosts || []).map((h) => normalizeHost(h)));
    return (candidates || []).map((c) => ({ ...c, alreadyRegistered: set.has(normalizeHost(c.host)) }));
}

module.exports = { extractLocal, classifyEntry, classifyNetwatchEntries, markRegistered };
