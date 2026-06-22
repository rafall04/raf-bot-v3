/**
 * Header Doc
 * Purpose: Pencarian pelanggan generik untuk bot Telegram teknisi. Beda dari Cek Koneksi
 *          pelanggan (yang resolve pakai NOMOR PENGIRIM), teknisi mencari pelanggan MANA SAJA
 *          via kata kunci: PPPoE username, serial ONU, nomor HP, atau nama. Murni & READ-ONLY:
 *          hanya membaca daftar pelanggan (default global.users), tidak ada I/O jaringan.
 * Caller: `message/telegram/command-handlers/*` (redaman/koneksi/modem/olt/pelanggan).
 * Deps: (tidak ada) — beroperasi atas array user yang diberikan / global.users.
 * MainFuncs: `findCustomers(query, users)`, `findOneCustomer(query, users)`.
 * SideEffects: tidak ada.
 *
 * Tier pencocokan (paling spesifik dulu; tier pertama yang menghasilkan ≥1 hasil dipakai):
 *   1) PPPoE username persis
 *   2) serial ONU (olt_serial) persis
 *   3) nomor HP (dinormalkan 0/62/8 → 62xxxx) persis
 *   4) substring pada nama ATAU PPPoE username
 * Field multi-nilai dipisah '|' (konvensi DB) lalu dicek per bagian.
 */
"use strict";

const MAX_CANDIDATES = 8;

function normStr(value) {
    return String(value == null ? "" : value)
        .trim()
        .toLowerCase();
}

function parts(value) {
    return String(value == null ? "" : value)
        .split("|")
        .map((p) => p.trim())
        .filter(Boolean);
}

// Normalkan nomor HP Indonesia ke bentuk '62xxxxxxxxx' agar 0812.. == 62812.. == 812..
function normalizePhone(value) {
    let d = String(value == null ? "" : value).replace(/\D/g, "");
    if (!d) return "";
    if (d.startsWith("0")) d = "62" + d.slice(1);
    else if (d.startsWith("8")) d = "62" + d;
    return d;
}

function anyPartEquals(field, queryNorm) {
    return parts(field).some((p) => normStr(p) === queryNorm);
}

function anyPartPhoneEquals(field, queryPhone) {
    if (!queryPhone) return false;
    return parts(field).some((p) => {
        const np = normalizePhone(p);
        return np && np === queryPhone;
    });
}

function anyPartIncludes(field, queryNorm) {
    return parts(field).some((p) => normStr(p).includes(queryNorm));
}

/**
 * Cari pelanggan yang cocok dengan query. Mengembalikan array (mungkin kosong),
 * berisi user dari tier paling spesifik yang menghasilkan hasil.
 * @param {string} query
 * @param {Array<object>} [users=global.users]
 * @returns {{ matches: Array<object>, tier: ('pppoe'|'serial'|'phone'|'name'|null) }}
 */
function findCustomers(query, users) {
    const list = Array.isArray(users) ? users : global.users || [];
    const q = normStr(query);
    if (!q) return { matches: [], tier: null };

    const valid = list.filter((u) => u && u.pppoe_username);

    // Tier 1: PPPoE persis
    let matches = valid.filter((u) => anyPartEquals(u.pppoe_username, q));
    if (matches.length) return { matches, tier: "pppoe" };

    // Tier 2: serial persis
    matches = valid.filter((u) => u.olt_serial && anyPartEquals(u.olt_serial, q));
    if (matches.length) return { matches, tier: "serial" };

    // Tier 3: nomor HP (butuh minimal 7 digit untuk dianggap nomor)
    const qPhone = normalizePhone(query);
    if (qPhone && qPhone.replace(/^62/, "").length >= 7) {
        matches = valid.filter((u) => anyPartPhoneEquals(u.phone_number, qPhone));
        if (matches.length) return { matches, tier: "phone" };
    }

    // Tier 4: substring nama atau pppoe
    matches = valid.filter((u) => anyPartIncludes(u.name, q) || anyPartIncludes(u.pppoe_username, q));
    if (matches.length) return { matches, tier: "name" };

    return { matches: [], tier: null };
}

/**
 * Versi "satu hasil" untuk handler: kembalikan user tunggal bila tepat satu,
 * atau daftar kandidat bila ambigu (>1), atau kosong bila tak ada.
 * @returns {{ user:(object|null), candidates:Array<object>, tier:(string|null), truncated:boolean }}
 */
function findOneCustomer(query, users) {
    const { matches, tier } = findCustomers(query, users);
    if (matches.length === 1) {
        return { user: matches[0], candidates: [], tier, truncated: false };
    }
    if (matches.length > 1) {
        const truncated = matches.length > MAX_CANDIDATES;
        return { user: null, candidates: matches.slice(0, MAX_CANDIDATES), tier, truncated };
    }
    return { user: null, candidates: [], tier: null, truncated: false };
}

/** Cari pelanggan by id (dipakai jalur tombol/callback). */
function findById(id, users) {
    const list = Array.isArray(users) ? users : global.users || [];
    const key = String(id == null ? "" : id);
    if (!key) return null;
    return list.find((u) => u && String(u.id) === key) || null;
}

module.exports = {
    findCustomers,
    findOneCustomer,
    findById,
    normalizePhone,
    MAX_CANDIDATES,
};
