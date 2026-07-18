/**
 * Header Doc
 * Purpose: Mesin SPINTAX untuk variasi isi pesan (anti-ban + terasa segar). Sintaks `{a|b|c}` →
 *   dipilih acak SATU opsi tiap render, sehingga tiap penerima/tiap bulan dapat kombinasi berbeda
 *   (isi identik massal = tanda tangan spam). Mendukung nesting `{A {x|y}|B}`. INERT bila teks tak
 *   memakai sintaks (tanpa `{...|...}`) → aman dipasang global di jalur render template.
 *   KUNCI KESELAMATAN: hanya grup ber-PIPE yang diekspansi → `${slot}` (tanpa pipe) TIDAK tersentuh.
 * Caller: lib/templating.renderTemplate, lib/response-template-helper.renderResponseTemplate (post-render).
 * Deps: tidak ada (pure). `random` diinjeksi untuk test deterministik.
 * MainFuncs: expandSpintax(text, {random}); countVariants(text).
 * SideEffects: tidak ada.
 */
"use strict";

// Grup spintax = `{...}` PALING DALAM yang mengandung minimal satu `|`. Karena harus ada pipe,
// `${nama}` / `{slot}` (tanpa pipe) tak pernah cocok → slot template aman.
const SPIN_RE = /\{([^{}]*\|[^{}]*)\}/;

/**
 * Ekspansi spintax: pilih acak satu opsi tiap grup, dari dalam ke luar (dukung nesting).
 * @param {string} text
 * @param {{random?:function}} [opts]
 * @returns {string}
 */
function expandSpintax(text, opts = {}) {
    if (typeof text !== "string" || text.indexOf("|") === -1 || text.indexOf("{") === -1) return text;
    const random = typeof opts.random === "function" ? opts.random : Math.random;
    let out = text;
    let guard = 0;
    while (guard < 500) {
        guard += 1;
        const m = SPIN_RE.exec(out);
        if (!m) break;
        const options = m[1].split("|");
        const idx = Math.min(options.length - 1, Math.floor(random() * options.length));
        const pick = options[idx] !== undefined ? options[idx] : options[0];
        out = out.slice(0, m.index) + pick + out.slice(m.index + m[0].length);
    }
    return out;
}

/**
 * Hitung jumlah kombinasi variasi (untuk pratinjau admin "template ini punya N variasi").
 * Perkiraan: kalikan jumlah opsi tiap grup ber-pipe (abaikan nesting untuk kesederhanaan).
 * @returns {number}
 */
function countVariants(text) {
    if (typeof text !== "string") return 1;
    const re = /\{([^{}]*\|[^{}]*)\}/g;
    let total = 1;
    let m;
    while ((m = re.exec(text)) !== null) {
        total *= m[1].split("|").length;
    }
    return total;
}

module.exports = { expandSpintax, countVariants };
