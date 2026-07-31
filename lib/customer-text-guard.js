/**
 * Header Doc
 * Purpose: Penjaga terakhir sebelum teks keluar ke PELANGGAN. Memeriksa apakah sebuah pesan memuat
 *          DATA INTERNAL yang cukup diketahui teknisi & admin, lalu melaporkannya agar pemanggil bisa
 *          menolak kiriman. Dua kelas yang dijaga:
 *            1. JUMLAH PELANGGAN TERDAMPAK — saat gangguan massal angkanya nyaris sama dengan total
 *               pelanggan, jadi menyebutnya berarti memberi tahu pelanggan (dan siapa pun yang
 *               di-forward pesan itu) seberapa besar basis pelanggan kita. Pelanggan cukup tahu
 *               "sedang ada gangguan", bukan berapa orang yang kena.
 *            2. IDENTITAS INTERNAL JARINGAN — nama PPPoE, ODP/ODC. Tak berguna bagi pelanggan,
 *               membocorkan topologi, dan sudah lama jadi aturan keras di repo ini.
 *
 *          Kenapa perlu penjaga, bukan sekadar memperbaiki template: teks broadcast bisa DIKETIK
 *          BEBAS oleh admin dan template bisa diedit dari `/api/templates` maupun dikustomisasi di
 *          prod (file template di-merge-key, tak pernah ditimpa deploy). Memperbaiki satu template
 *          hanya menutup satu jalan; penjaga ini menutup semuanya sekaligus.
 *
 *          MURNI: tidak mengirim, tidak menulis, tidak melempar. Pemanggil yang memutuskan.
 * Caller: `services/admin-broadcast.service.js` (queueBroadcast — Broadcast GAMAS & broadcast manual).
 * Deps: tidak ada.
 * MainFuncs: `findCustomerTextLeaks(text)`, `describeLeaks(leaks)`.
 * SideEffects: Tidak ada.
 */
"use strict";

// Angka + "pelanggan" dalam satu tarikan napas ("96 pelanggan", "sekitar 40 orang pelanggan").
const COUNT_LITERAL = /\b\d{1,6}\s*(?:orang\s+)?pelanggan\b/i;
// Bentuk slot template ("${jumlah} pelanggan") — ketahuan SEBELUM tersubstitusi jadi angka.
const COUNT_SLOT = /\$\{\s*[a-z_]*(?:jumlah|count|total|jml)[a-z_]*\s*\}\s*(?:orang\s+)?pelanggan\b/i;
// Kalimat yang menyebut pelanggan terdampak beserta angkanya, urutan terbalik.
const COUNT_AFFECTED = /\bpelanggan\b[^.\n]{0,20}\b(?:terdampak|ikut terdampak|terganggu)\b[^.\n]{0,20}\d/i;

// Slot identitas internal yang tersedia di formatBroadcastMessage — tak satu pun layak dibaca pelanggan.
const INTERNAL_SLOT = /\$\{\s*(username_pppoe|pppoe_username|odp|odc)\s*\}/i;
// ODP/ODC yang sudah tercetak sebagai teks ("ODP MAWAR-03"). Pelanggan tak pernah perlu tahu ini,
// jadi sebutan ODP/ODC apa pun dianggap bocor — tak perlu menebak formatnya.
const INTERNAL_ID_LITERAL = /\bod[pc]\b/i;

const RULES = [
    {
        kind: "jumlah_pelanggan",
        pattern: COUNT_SLOT,
        why: "menyebut jumlah pelanggan terdampak (slot template)",
    },
    {
        kind: "jumlah_pelanggan",
        pattern: COUNT_LITERAL,
        why: "menyebut jumlah pelanggan",
    },
    {
        kind: "jumlah_pelanggan",
        pattern: COUNT_AFFECTED,
        why: "menyebut berapa pelanggan yang terdampak",
    },
    {
        kind: "identitas_internal",
        pattern: INTERNAL_SLOT,
        why: "memuat identitas internal (nama PPPoE / ODP / ODC)",
    },
    {
        kind: "identitas_internal",
        pattern: INTERNAL_ID_LITERAL,
        why: "menyebut ODP/ODC — identitas internal jaringan",
    },
];

/**
 * Cari data internal yang tidak boleh dibaca pelanggan.
 * @param {string} text teks pesan (mentah atau sudah tersubstitusi)
 * @returns {Array<{kind:string, why:string, phrase:string}>} kosong bila aman
 */
function findCustomerTextLeaks(text) {
    const value = String(text || "");
    if (!value.trim()) return [];

    const found = [];
    const seen = new Set();
    for (const rule of RULES) {
        const match = value.match(rule.pattern);
        if (!match) continue;
        const phrase = String(match[0]).trim();
        const key = `${rule.kind}::${phrase.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        found.push({ kind: rule.kind, why: rule.why, phrase });
    }
    return found;
}

/** Ringkasan siap-tampil untuk pesan error ke admin. */
function describeLeaks(leaks) {
    return (Array.isArray(leaks) ? leaks : [])
        .map((leak) => `"${leak.phrase}" (${leak.why})`)
        .join("; ");
}

module.exports = {
    findCustomerTextLeaks,
    describeLeaks,
};
