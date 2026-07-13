/**
 * Header Doc
 * Purpose: Parser MURNI caption intake PSB grup — ubah caption `#PSB ...` (foto KTP) jadi data pelanggan
 *          `{ nama, dusun, paket, wifi_ssid, wifi_password, hp }` + validasi (`hp` boleh MULTI-nomor
 *          pipe `628a|628b`, primary di depan — divalidasi per-nomor). `dusun` OPSIONAL di sini
 *          (jalur grup Fase 1 tak butuh); wizard DM (`psb.state.js`) yang MEWAJIBKAN dusun untuk merakit
 *          username PPPoE. Tanpa side-effect / tanpa global (packages di-inject) supaya gampang di-unit-test.
 * Caller: `message/handlers/psb-group-intake.js`.
 * Deps: tidak ada (pure).
 * MainFuncs: `parsePsbCaption(caption, { packages })`, `isPsbCaption(caption)`, `resolvePackage(input, packages)`,
 *            `extractPsbFields(text)` (parse partial tanpa validasi — wizard slot-filling),
 *            `validatePsbData(data, { packages, requireDusun })` (validasi terpusat + status per-field).
 * SideEffects: Tidak ada.
 */
"use strict";

// Alias key caption (case-insensitive) → field kanonik. Toleran variasi ketikan teknisi.
const KEY_ALIASES = {
    nama: ["nama", "name"],
    dusun: ["dusun", "dsn", "dukuh", "kampung"],
    paket: ["paket", "package", "pkt"],
    catatan: ["catatan", "note", "ket", "keterangan"],
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

// Ekstrak field yang ADA dari teks (caption ATAU pesan lepas) — TANPA validasi, tanpa wajib #PSB.
// Strip prefix `#PSB` bila ada. Dipakai wizard slot-filling untuk kumpulkan data yang dicicil.
function extractPsbFields(text) {
    const raw = String(text || "").replace(/^\s*#psb\b[ \t]*/i, "");
    const found = {};
    for (const line of raw.split(/\r?\n/)) {
        const idx = line.indexOf(":");
        if (idx < 0) continue;
        const field = normKey(line.slice(0, idx));
        const val = line.slice(idx + 1).trim();
        if (field && val && !found[field]) found[field] = val;
    }
    return found;
}

// Validasi data PSB terkumpul → { ok, status(per-field), errors, data(paket resolved + hp normalized) }.
// `status[field]`: "ok" | "missing" | "unknown"(paket) | "short"(sandi) | "invalid"(hp) | "optional"(dusun).
// requireDusun: wizard DM = true (dusun wajib utk username); jalur grup Fase 1 = false (dusun opsional).
function validatePsbData(data = {}, { packages = [], requireDusun = false } = {}) {
    const status = {};
    const errors = [];

    status.nama = data.nama ? "ok" : "missing";
    if (!data.nama) errors.push("Nama kosong");

    if (requireDusun) {
        status.dusun = data.dusun ? "ok" : "missing";
        if (!data.dusun) errors.push("Dusun kosong");
    } else {
        status.dusun = data.dusun ? "ok" : "optional";
    }

    let resolvedPaket = null;
    if (!data.paket) { status.paket = "missing"; errors.push("Paket kosong"); }
    else {
        resolvedPaket = resolvePackage(data.paket, packages);
        if (resolvedPaket) status.paket = "ok";
        else { status.paket = "unknown"; errors.push(`Paket "${data.paket}" tak dikenal`); }
    }

    status.wifi_ssid = data.wifi_ssid ? "ok" : "missing";
    if (!data.wifi_ssid) errors.push("Nama WiFi kosong");

    if (!data.wifi_password) { status.wifi_password = "missing"; errors.push("Sandi WiFi kosong"); }
    else if (String(data.wifi_password).length < 8) { status.wifi_password = "short"; errors.push("Sandi WiFi minimal 8 karakter"); }
    else status.wifi_password = "ok";

    // No HP — MULTI-NOMOR pipe (628a|628b), nomor PERTAMA=primary, validasi per-nomor (9-15 digit).
    let hpNorm = data.hp;
    if (!data.hp) { status.hp = "missing"; errors.push("No HP kosong"); }
    else {
        const parts = String(data.hp).split("|").map((s) => s.trim()).filter(Boolean);
        const bad = parts.filter((p) => { const d = p.replace(/[^0-9]/g, ""); return d.length < 9 || d.length > 15; });
        if (!parts.length) { status.hp = "missing"; errors.push("No HP kosong"); }
        else if (bad.length) { status.hp = "invalid"; errors.push(`No HP tidak valid: ${bad.join(", ")}`); }
        else { status.hp = "ok"; hpNorm = parts.join("|"); }
    }

    const requiredKeys = ["nama", ...(requireDusun ? ["dusun"] : []), "paket", "wifi_ssid", "wifi_password", "hp"];
    const ok = requiredKeys.every((k) => status[k] === "ok");
    return { ok, status, errors, data: { ...data, paket: resolvedPaket || data.paket, hp: hpNorm } };
}

function parsePsbCaption(caption, { packages = [] } = {}) {
    const raw = String(caption || "");
    if (!isPsbCaption(raw)) {
        return { ok: false, isPsb: false, errors: ["Bukan pesan PSB (caption harus diawali #PSB)."] };
    }
    const base = { nama: "", dusun: "", paket: "", wifi_ssid: "", wifi_password: "", hp: "", ...extractPsbFields(raw) };
    const v = validatePsbData(base, { packages, requireDusun: false });
    return { ok: v.ok, isPsb: true, data: v.data, errors: v.errors };
}

module.exports = { parsePsbCaption, isPsbCaption, resolvePackage, extractPsbFields, validatePsbData };
