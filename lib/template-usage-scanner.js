/**
 * Header Doc
 * Purpose: Memindai source repo untuk mengetahui template mana yang BENAR-BENAR dipakai kode, dan
 *          slot apa saja yang di-pass ke tiap key. Dipakai diagnostics admin (`/api/templates/
 *          diagnostics`) untuk melaporkan key yatim / hilang / slot tak dikenal, dan oleh validasi
 *          simpan template. Tanpa ini admin tak punya sinyal kesehatan: key yang hilang dari JSON
 *          tetap terkirim lewat fallback runtime (tanpa gejala) tapi jadi tak bisa diedit.
 * Caller: `lib/template-service.js` (getDiagnostics), `routes/admin-content-routes.js` (validasi simpan).
 * Deps: `fs`, `path`.
 * MainFuncs: `scanTemplateUsage`, `getTemplateUsage` (ber-cache), `extractSlots`.
 * SideEffects: Membaca file source (read-only). Hasil di-cache di memori dengan TTL.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..");
const SKIP_DIRS = new Set([
    "node_modules", ".git", "coverage", "tmp", "dist", ".worktrees", "backups", "sessions", "static"
]);

const SLOT_PATTERN = /\$\{\s*([A-Za-z0-9_.]+)\s*\}/g;

// Slot yang SELALU tersedia dari `getBrandDefaults()` di template-service, jadi tak pernah
// dianggap "tak dikenal" walau tidak di-pass eksplisit oleh pemanggil.
const BRAND_SLOTS = new Set([
    "nama_wifi", "wifiName", "nama_layanan", "nama_layanan_upper",
    "nama_bot", "namabot", "nama", "company_name", "telfon"
]);

// Key yang dirakit dinamis saat runtime — tak bisa diverifikasi statis.
const DYNAMIC_KEY_PREFIXES = [
    "speed_boost_payment_method_",
    "speed_boost_payment_label_",
    "speed_boost_confirmation_note_",
    "speed_status_icon_",
    "speed_status_payment_"
];

function isDynamicKey(key) {
    return key.includes("${") || DYNAMIC_KEY_PREFIXES.some((p) => key.startsWith(p));
}

/**
 * Ambil nama slot `${...}` dari sebuah string template.
 * @param {string} text
 * @returns {Set<string>}
 */
function extractSlots(text) {
    const out = new Set();
    let match;
    SLOT_PATTERN.lastIndex = 0;
    while ((match = SLOT_PATTERN.exec(String(text || ""))) !== null) {
        out.add(match[1].split(".")[0]);
    }
    return out;
}

/** Pecah daftar argumen (string mentah) menjadi argumen level-atas. */
function splitTopLevel(buf) {
    const parts = [];
    let depth = 0, inStr = null, esc = false, cur = "";
    for (let i = 0; i < buf.length; i++) {
        const c = buf[i];
        if (esc) { cur += c; esc = false; continue; }
        if (c === "\\") { cur += c; esc = true; continue; }
        if (inStr) { cur += c; if (c === inStr) inStr = null; continue; }
        if (c === '"' || c === "'" || c === "`") { inStr = c; cur += c; continue; }
        if ("{[(".includes(c)) depth++;
        if ("}])".includes(c)) depth--;
        if (c === "," && depth === 0) { parts.push(cur); cur = ""; continue; }
        cur += c;
    }
    if (cur.trim()) parts.push(cur);
    return parts;
}

/** Nama properti level-atas dari sebuah object literal. `__SPREAD__` bila ada `...spread`. */
function objectLiteralKeys(src) {
    const out = new Set();
    const trimmed = String(src || "").trim();
    if (!trimmed.startsWith("{")) return out;
    for (const part of splitTopLevel(trimmed.slice(1, -1))) {
        const t = part.trim();
        if (!t) continue;
        if (t.startsWith("...")) { out.add("__SPREAD__"); continue; }
        const m = t.match(/^['"]?([A-Za-z0-9_]+)['"]?\s*[:,]?/);
        if (m) out.add(m[1]);
    }
    return out;
}

/**
 * Repo ini punya EMPAT signature `renderResponseTemplate` yang berbeda — `(key, fallback, data)`,
 * `(key, data)`, `(key, data, fallback)`, dan satu polimorfik — plus wrapper `renderTpl(context,
 * key, fallback, data)` di state domain. Alih-alih mendeteksi signature per file (rapuh), ambil
 * argumen PERTAMA yang berbentuk object literal: di semua varian itulah argumen data, karena
 * `fallback` selalu string.
 */
function pickDataArg(argsAfterKey) {
    for (const arg of argsAfterKey) {
        if (String(arg || "").trim().startsWith("{")) return arg;
    }
    return null;
}

function collectJsFiles(root) {
    const files = [];
    (function walk(dir) {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_e) { return; }
        for (const entry of entries) {
            if (SKIP_DIRS.has(entry.name)) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) { walk(full); continue; }
            if (!entry.name.endsWith(".js") || entry.name.endsWith(".test.js")) continue;
            // Lewati file ini sendiri: pola regex di dalamnya ikut cocok dan menghasilkan key palsu.
            if (path.resolve(full) === path.resolve(__filename)) continue;
            files.push(full);
        }
    })(root);
    return files;
}

/**
 * Pindai repo. Hasil: peta key → { files, dataKeys, hasSpread }.
 * @param {{root?: string}} [options]
 */
function scanTemplateUsage(options = {}) {
    const root = options.root || REPO_ROOT;
    const usage = new Map();

    const callPatterns = [
        /renderResponseTemplate(?:OrFallback)?\(\s*(['"`])([^'"`]+)\1\s*,/g,
        /renderTpl\(\s*[A-Za-z0-9_.]+\s*,\s*(['"`])([^'"`]+)\1\s*,/g,
        // Pemakaian tanpa argumen lain: `renderResponseTemplate('key')`
        /renderResponseTemplate(?:OrFallback)?\(\s*(['"`])([^'"`]+)\1\s*\)/g,
        // Jalur ketiga: `format(key, data)` dari conversation-handler, dipakai state handler.
        // Nama fungsinya generik, tapi untuk laporan YATIM sisi aman-nya memang "dianggap terpakai".
        /\bformat\(\s*(['"`])([a-z][a-z0-9_]*)\1\s*[,)]/g
    ];

    for (const file of collectJsFiles(root)) {
        let source;
        try { source = fs.readFileSync(file, "utf8"); } catch (_e) { continue; }
        if (!source.includes("renderResponseTemplate")
            && !source.includes("renderTpl(")
            && !source.includes("format(")) continue;
        const relative = path.relative(root, file).replace(/\\/g, "/");

        for (const pattern of callPatterns) {
            pattern.lastIndex = 0;
            let match;
            while ((match = pattern.exec(source)) !== null) {
                const key = match[2];
                if (isDynamicKey(key)) continue;

                // Baca sisa argumen sampai kurung tutup seimbang.
                let i = match.index + match[0].length;
                let depth = 1, buf = "", guard = 0;
                while (i < source.length && depth > 0 && guard++ < 40000) {
                    const c = source[i];
                    if (c === "(") depth++;
                    else if (c === ")") { depth--; if (!depth) break; }
                    buf += c; i++;
                }

                if (!usage.has(key)) {
                    usage.set(key, { files: new Set(), dataKeys: new Set(), hasSpread: false });
                }
                const entry = usage.get(key);
                entry.files.add(`${relative}:${source.slice(0, match.index).split("\n").length}`);

                const dataArg = pickDataArg(splitTopLevel(buf));
                if (dataArg) {
                    const keys = objectLiteralKeys(dataArg);
                    if (keys.has("__SPREAD__")) { entry.hasSpread = true; keys.delete("__SPREAD__"); }
                    for (const k of keys) entry.dataKeys.add(k);
                }
            }
        }
    }

    return usage;
}

let cached = null;
let cachedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Versi ber-cache; pemindaian repo cukup mahal untuk tidak diulang tiap request admin. */
function getTemplateUsage(options = {}) {
    const now = Date.now();
    if (!options.force && cached && (now - cachedAt) < CACHE_TTL_MS) return cached;
    cached = scanTemplateUsage(options);
    cachedAt = now;
    return cached;
}

/**
 * Laporan kesehatan template untuk satu kategori.
 * @param {Record<string, any>} templates - isi kategori (key → entry)
 * @param {{usage?: Map, force?: boolean}} [options]
 */
function buildHealthReport(templates, options = {}) {
    const usage = options.usage || getTemplateUsage({ force: options.force });
    const stored = templates || {};

    const orphanKeys = Object.keys(stored).filter((k) => !usage.has(k) && !isDynamicKey(k));
    const missingKeys = [...usage.keys()]
        .filter((k) => !stored[k])
        .map((k) => ({ key: k, usedAt: [...usage.get(k).files].slice(0, 5) }));

    const unknownSlots = [];
    for (const [key, entry] of Object.entries(stored)) {
        const record = usage.get(key);
        // Tanpa data pemakaian, atau saat pemanggil memakai spread, slot tak bisa dinilai statis.
        if (!record || record.hasSpread) continue;
        const template = (entry && entry.template) || "";
        const slots = extractSlots(template);
        if (!slots.size) continue;
        const unknown = [...slots].filter((s) => !record.dataKeys.has(s) && !BRAND_SLOTS.has(s));
        if (unknown.length) unknownSlots.push({ key, slots: unknown });
    }

    return {
        totalKeys: Object.keys(stored).length,
        orphanKeys,
        orphanCount: orphanKeys.length,
        missingKeys,
        missingCount: missingKeys.length,
        unknownSlots,
        unknownSlotCount: unknownSlots.length
    };
}

module.exports = {
    scanTemplateUsage,
    getTemplateUsage,
    buildHealthReport,
    extractSlots,
    BRAND_SLOTS,
    _internal: { pickDataArg, objectLiteralKeys, splitTopLevel, isDynamicKey }
};
