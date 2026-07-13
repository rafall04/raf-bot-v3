/**
 * Header Doc
 * Purpose: Parser MURNI caption intake PSB grup — ubah caption `#PSB ...` (foto KTP) jadi data pelanggan
 *          `{ nama, dusun, paket, wifi_ssid, wifi_password, hp }` + validasi (`hp` boleh MULTI-nomor
 *          pipe `628a|628b`, primary di depan — divalidasi per-nomor). `dusun` OPSIONAL di sini
 *          (jalur grup Fase 1 tak butuh); wizard DM (`psb.state.js`) yang MEWAJIBKAN dusun untuk merakit
 *          username PPPoE. Tanpa side-effect / tanpa global (packages di-inject) supaya gampang di-unit-test.
 * Caller: `message/handlers/psb-group-intake.js`.
 * Deps: tidak ada (pure).
 * MainFuncs: `parsePsbCaption(caption, { packages })`, `isPsbCaption(caption)`, `resolvePackage(input, packages)`.
 * SideEffects: Tidak ada.
 */
"use strict";

// Alias key caption (case-insensitive) → field kanonik. Toleran variasi ketikan teknisi.
const KEY_ALIASES = {
    nama: ["nama", "name"],
    dusun: ["dusun", "dsn", "dukuh", "kampung"],
    paket: ["paket", "package", "pkt"],
    wifi_ssid: ["wifi", "nama wifi", "namawifi", "ssid"],
    wifi_password: ["sandi", "sandi wifi", "password", "pass", "pw", "kata sandi", "katasandi"],
    hp: ["hp", "no hp", "nohp", "no", "nomor", "no wa", "wa", "telp", "telepon"]
};

function normKey(raw) {
    const k = String(raw || "").trim().toLowerCase().replace(/\s+/g, " ");
    for (const [field, aliases] of Object.entries(KEY_ALIASES)) {
        if (aliases.includes(k)) return field;
    }
    return null;
}

// Cocokkan input paket ke nama paket kanonik di packages (exact name → exact profile → fuzzy ringan).
function resolvePackage(input, packages) {
    const v = String(input || "").trim().toLowerCase();
    if (!v) return null;
    const list = Array.isArray(packages) ? packages : [];
    let m = list.find((p) => String(p.name || "").toLowerCase() === v);
    if (m) return m.name;
    m = list.find((p) => String(p.profile || "").toLowerCase() === v);
    if (m) return m.name;
    m = list.find((p) => {
        const n = String(p.name || "").toLowerCase();
        const pr = String(p.profile || "").toLowerCase();
        return (n && (n.includes(v) || v.includes(n))) || (pr && (pr.includes(v) || v.includes(pr)));
    });
    return m ? m.name : null;
}

function isPsbCaption(caption) {
    return /^\s*#psb\b/i.test(String(caption || ""));
}

function parsePsbCaption(caption, { packages = [] } = {}) {
    const raw = String(caption || "");
    if (!isPsbCaption(raw)) {
        return { ok: false, isPsb: false, errors: ["Bukan pesan PSB (caption harus diawali #PSB)."] };
    }
    const data = { nama: "", dusun: "", paket: "", wifi_ssid: "", wifi_password: "", hp: "" };
    for (const line of raw.split(/\r?\n/)) {
        const idx = line.indexOf(":");
        if (idx < 0) continue;
        const field = normKey(line.slice(0, idx));
        const val = line.slice(idx + 1).trim();
        if (field && val && !data[field]) data[field] = val;
    }

    const errors = [];
    if (!data.nama) errors.push("Nama kosong");
    let resolvedPaket = null;
    if (!data.paket) {
        errors.push("Paket kosong");
    } else {
        resolvedPaket = resolvePackage(data.paket, packages);
        if (!resolvedPaket) errors.push(`Paket "${data.paket}" tak dikenal`);
    }
    if (!data.wifi_ssid) errors.push("Nama WiFi kosong");
    if (!data.wifi_password) {
        errors.push("Sandi WiFi kosong");
    } else if (String(data.wifi_password).length < 8) {
        errors.push("Sandi WiFi minimal 8 karakter");
    }
    // No HP — dukung MULTI-NOMOR pipe-separated (628xxx|628yyy); nomor PERTAMA = primary.
    // Validasi PER-nomor (9-15 digit) selaras konvensi phone_number seluruh sistem (welcome/
    // reminder/lookup semua split "|"). Normalisasi: trim tiap nomor + join kembali dgn "|".
    if (!data.hp) {
        errors.push("No HP kosong");
    } else {
        const hpParts = String(data.hp).split("|").map((s) => s.trim()).filter(Boolean);
        const badHp = hpParts.filter((p) => {
            const d = p.replace(/[^0-9]/g, "");
            return d.length < 9 || d.length > 15;
        });
        if (hpParts.length === 0) errors.push("No HP kosong");
        else if (badHp.length) errors.push(`No HP tidak valid: ${badHp.join(", ")}`);
        else data.hp = hpParts.join("|");
    }

    return {
        ok: errors.length === 0,
        isPsb: true,
        data: { ...data, paket: resolvedPaket || data.paket },
        errors
    };
}

module.exports = { parsePsbCaption, isPsbCaption, resolvePackage };
