/**
 * Header Doc
 * Purpose: Parser MURNI caption intake PSB grup — ubah caption `#PSB ...` (foto KTP) jadi data pelanggan
 *          `{ nama, dusun, rt_rw, paket, wifi_ssid, wifi_password, hp }` (+ `marketing` & `alamat` OPSIONAL:
 *          `marketing` = nama pemberi lead utk komisi PSB; `alamat` = alamat bebas yang MENGGANTIKAN alamat
 *          rakitan) + validasi (`hp` boleh MULTI-nomor pipe `628a|628b`, primary di depan — divalidasi
 *          per-nomor). `dusun`/`rt_rw` OPSIONAL di sini (jalur grup Fase 1 tak butuh); wizard DM
 *          (`psb.state.js`) yang MEWAJIBKAN keduanya — dusun utk merakit username PPPoE, RT/RW utk merakit
 *          ALAMAT (`Dsn. X RT 014 RW 002 Ds. Y Kec. Z`) karena hanya RT/RW yang khas per rumah.
 *          Tanpa side-effect / tanpa global (packages di-inject) supaya gampang di-unit-test.
 * Caller: `message/handlers/psb-group-intake.js`.
 * Deps: tidak ada (pure).
 * MainFuncs: `parsePsbCaption(caption, { packages })`, `isPsbCaption(caption)`, `resolvePackage(input, packages)`,
 *            `extractPsbFields(text)` (parse partial tanpa validasi — wizard slot-filling),
 *            `validatePsbData(data, { packages, requireDusun, requireRtRw })` (validasi terpusat + status per-field),
 *            `normalizeRtRw(input)` → `{rt,rw}` 3-digit, `composeAddress({dusun,rt,rw,desa,kecamatan})`,
 *            `titleCaseDusun(value)`.
 * SideEffects: Tidak ada.
 */
"use strict";

// Alias key caption (case-insensitive) → field kanonik. Toleran variasi ketikan teknisi.
const KEY_ALIASES = {
    nama: ["nama", "name"],
    dusun: ["dusun", "dsn", "dukuh", "kampung"],
    // RT/RW — satu-satunya bagian alamat yang KHAS per rumah. Sisanya (dusun/desa/kecamatan)
    // dirakit bot, jadi teknisi cukup mengetik "14/2".
    rt_rw: ["rt/rw", "rtrw", "rt rw", "rt-rw", "rt"],
    // Alamat bebas — jalan keluar untuk kasus tak lazim (mis. rumah di desa lain). Bila diisi,
    // dipakai APA ADANYA dan menggantikan alamat rakitan.
    alamat: ["alamat", "address", "almt"],
    paket: ["paket", "package", "pkt"],
    catatan: ["catatan", "note", "ket", "keterangan"],
    // Pemberi lead / marketing (OPSIONAL, Fase 1 komisi PSB) — nama bebas; klasifikasi type & nominal di web.
    marketing: ["marketing", "mkt", "pemberi lead", "pemberilead", "lead", "referral", "referrer", "sales"],
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

// Nama dusun → Title Case ("ngitik" → "Ngitik", "sumber rejo" → "Sumber Rejo") untuk alamat.
function titleCaseDusun(value) {
    return String(value || "").trim().toLowerCase()
        .split(/\s+/).filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
}

// Normalisasi RT/RW dari ketikan bebas teknisi → { rt, rw } 3-digit (samakan dgn data lama:
// "RT 014 RW 002"). Terima "14/2", "014/002", "RT 14 RW 2", "rt14rw2", "14-2", "14 2".
// null bila salah satu angka tak ketemu — DUA angka wajib, jangan tebak yang hilang.
function normalizeRtRw(input) {
    const s = String(input || "").trim().toLowerCase();
    if (!s) return null;

    const mRt = s.match(/rt\s*[.:-]?\s*(\d{1,3})/);
    const mRw = s.match(/rw\s*[.:-]?\s*(\d{1,3})/);
    let rt = mRt ? mRt[1] : null;
    let rw = mRw ? mRw[1] : null;

    if (rt === null || rw === null) {
        const nums = s.match(/\d{1,3}/g) || [];
        if (nums.length >= 2) {
            if (rt === null) rt = nums[0];
            if (rw === null) rw = nums[1];
        }
    }
    if (rt === null || rw === null) return null;

    const pad = (n) => String(parseInt(n, 10)).padStart(3, "0");
    return { rt: pad(rt), rw: pad(rw) };
}

// Rakit alamat baku dari potongan yang sudah kita tahu. Format mengikuti data existing:
// "Dsn. Ngitik RT 014 RW 002 Ds. Tanjungharjo Kec. Kapas". Bagian yang kosong dilewati
// (alamat parsial lebih berguna daripada alamat kosong — catatan insiden OLT ikut menyalinnya).
function composeAddress({ dusun, rt, rw, desa, kecamatan } = {}) {
    const parts = [];
    if (dusun) parts.push(`Dsn. ${titleCaseDusun(dusun)}`);
    if (rt && rw) parts.push(`RT ${rt} RW ${rw}`);
    if (desa) parts.push(`Ds. ${desa}`);
    if (kecamatan) parts.push(`Kec. ${kecamatan}`);
    return parts.join(" ");
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
function validatePsbData(data = {}, { packages = [], requireDusun = false, requireRtRw = false } = {}) {
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

    // RT/RW — dinormalisasi jadi 3-digit. Bila teknisi mengisi `alamat` bebas, RT/RW tak wajib
    // (alamat bebas menggantikan alamat rakitan sepenuhnya).
    let rtRw = null;
    const alamatOverride = String(data.alamat || "").trim();
    if (!data.rt_rw) {
        status.rt_rw = (requireRtRw && !alamatOverride) ? "missing" : "optional";
        if (status.rt_rw === "missing") errors.push("RT/RW kosong");
    } else {
        rtRw = normalizeRtRw(data.rt_rw);
        if (rtRw) status.rt_rw = "ok";
        else { status.rt_rw = "invalid"; errors.push(`RT/RW "${data.rt_rw}" tidak terbaca (contoh: 14/2)`); }
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

    const requiredKeys = [
        "nama",
        ...(requireDusun ? ["dusun"] : []),
        ...(requireRtRw && !alamatOverride ? ["rt_rw"] : []),
        "paket", "wifi_ssid", "wifi_password", "hp"
    ];
    const ok = requiredKeys.every((k) => status[k] === "ok");
    return {
        ok,
        status,
        errors,
        data: {
            ...data,
            paket: resolvedPaket || data.paket,
            hp: hpNorm,
            // RT/RW disimpan ternormalisasi + pecahannya, supaya perakit alamat tak perlu mengurai ulang.
            rt_rw: rtRw ? `${rtRw.rt}/${rtRw.rw}` : data.rt_rw,
            rt: rtRw ? rtRw.rt : undefined,
            rw: rtRw ? rtRw.rw : undefined
        }
    };
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

module.exports = {
    parsePsbCaption,
    isPsbCaption,
    resolvePackage,
    extractPsbFields,
    validatePsbData,
    normalizeRtRw,
    composeAddress,
    titleCaseDusun
};
