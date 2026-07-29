#!/usr/bin/env node
/**
 * Header Doc
 * Purpose: GUARD anti-bug "gelap-di-gelap". Memindai CSS HALAMAN (static/css/*.css, kecuali fondasi
 *          tema) untuk pemakaian PRIMITIF TETAP (`var(--white)`, `var(--slate-900)`, …) pada properti
 *          background/color/border. Primitif tetap TIDAK ikut mode gelap (body.tk-dark) → teks gelap di
 *          latar gelap = akar bug "tiap halaman baru selalu gelap". Halaman WAJIB pakai token SEMANTIK
 *          sadar-mode: --surface/--surface-2/--canvas (bg), --ink/--ink-soft/--muted (teks), --line (border).
 * Caller: `npm run check:theme` / `npm test` (via scripts/__tests__/theme-tokens.test.js) / hook pre-push.
 *         Exit 1 bila ada pelanggaran.
 * Deps: fs, path (tanpa dependensi eksternal).
 * MainFuncs: scan() — kembalikan daftar pelanggaran (di-export); main() CLI.
 * SideEffects: hanya baca file + cetak laporan.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const CSS_DIR = path.join(__dirname, "..", "static", "css");

// File FONDASI tema yang MEMANG memetakan primitif → token semantik (dikecualikan dari guard).
const ALLOW = new Set([
    "tokens.css", "admin-theme.css", "teknisi-theme.css",
    "dashboard-modern.css", "sb-admin-2.min.css", "sb-admin-2.css",
]);

// Primitif TETAP yang berbahaya bila dipakai untuk surface/teks (tak ikut mode gelap).
const FIXED = /var\(\s*--(white|black|slate-(?:50|100|200|300|400|500|600|700|800|900))\s*\)/;
// Properti yang menentukan warna surface/teks/garis.
const PROP = /\b(?:color|background(?:-color)?|border(?:-(?:color|top|bottom|left|right))?|fill|stroke|box-shadow|outline)\b\s*:/i;

const SUGGEST =
    "Pakai token SEMANTIK sadar-mode: --surface/--surface-2/--canvas (bg), " +
    "--ink/--ink-soft/--muted (teks), --line (border). Lihat static/css/tokens.css.";

function scan() {
    const violations = [];
    let files = [];
    try { files = fs.readdirSync(CSS_DIR); } catch (e) { console.error("Tak bisa baca", CSS_DIR, e.message); process.exit(2); }
    for (const f of files) {
        if (!f.endsWith(".css") || ALLOW.has(f)) continue;
        const raw = fs.readFileSync(path.join(CSS_DIR, f), "utf8").split("\n");
        raw.forEach((line, i) => {
            // Lewati baris komentar penuh.
            const t = line.trim();
            if (t.startsWith("/*") || t.startsWith("*")) return;
            if (PROP.test(line) && FIXED.test(line)) {
                violations.push({ file: f, line: i + 1, text: t.slice(0, 100) });
            }
        });
    }
    return violations;
}

/* ============================================================
   BAGIAN 2 — Literal warna yang TIDAK AMAN di mode gelap
   ------------------------------------------------------------
   scan() di atas hanya menangkap `var(--white)` dkk. Ia BUTA terhadap hex/rgb
   MENTAH — padahal itulah akar bug nyata: rekap-keuangan.php menulis
   `color:#111827` di blok <style> inline, dan di mode gelap nilai uangnya
   jatuh ke kontras 1.03 (praktis tak terlihat). Guard lama juga tidak pernah
   membaca file .php sama sekali.

   Yang diperiksa DIPERSEMPIT ke dua pola yang benar-benar merusak:
     • latar TERANG tetap  (background luminance > 0.75) → blok putih menyilaukan
     • teks GELAP tetap    (color luminance < 0.25)      → teks hilang di latar gelap
   Aturan di dalam selector ber-.tk-dark / prefers-color-scheme:dark dilewati
   (itu memang override mode gelap yang disengaja).

   RATCHET: repo ini masih membawa utang lama (ratusan deklarasi). Menjadikan
   semuanya error sekaligus akan memblokir semua orang, jadi jumlah per file
   dibekukan di theme-literal-baseline.json. Build GAGAL hanya kalau sebuah file
   MELEBIHI baselinenya atau file baru muncul — utang tidak bisa bertambah, dan
   setiap perbaikan otomatis mengencangkan batasnya lewat --update-baseline.
   ============================================================ */

const VIEWS_DIR = path.join(__dirname, "..", "views");
const BASELINE_PATH = path.join(__dirname, "theme-literal-baseline.json");

// components-modern.css ikut ALLOW: ia lapisan pemetaan token, bukan CSS halaman.
const LITERAL_ALLOW = new Set([...ALLOW, "components-modern.css"]);

const NAMED_COLORS = {
    white: "#ffffff", black: "#000000", whitesmoke: "#f5f5f5",
    ivory: "#fffff0", lightgray: "#d3d3d3", silver: "#c0c0c0",
};
const COLOR_TOKEN = /(#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black|whitesmoke|ivory|lightgray|silver)\b)/g;

function parseColor(tok) {
    let m = tok.match(/^#([0-9a-fA-F]{3,8})$/);
    if (m) {
        let h = m[1];
        if (h.length === 3) h = h.split("").map((c) => c + c).join("");
        else if (h.length === 4) h = h.slice(0, 3).split("").map((c) => c + c).join("");
        else if (h.length === 8) h = h.slice(0, 6);
        if (h.length !== 6) return null;
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
    }
    m = tok.match(/^rgba?\(([^)]*)\)$/i);
    if (m) {
        const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
        if (p.length < 3 || p.slice(0, 3).some(Number.isNaN)) return null;
        return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
    }
    const named = NAMED_COLORS[tok.toLowerCase()];
    return named ? parseColor(named) : null;
}

function luminance(c) {
    const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}

function cssRules(css) {
    const out = [];
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(clean))) out.push({ sel: m[1].trim(), body: m[2], idx: m.index });
    return out;
}

function scanUnsafeCss(css, label, out) {
    for (const r of cssRules(css)) {
        if (/\.tk-dark|prefers-color-scheme\s*:\s*dark/i.test(r.sel)) continue;
        const line = css.slice(0, r.idx).split("\n").length;
        for (const decl of r.body.split(";")) {
            const i = decl.indexOf(":");
            if (i < 0) continue;
            const prop = decl.slice(0, i).trim().toLowerCase();
            const val = decl.slice(i + 1);
            if (/var\(\s*--/.test(val)) continue;
            const isText = prop === "color";
            const isBg = prop === "background" || prop === "background-color";
            if (!isText && !isBg) continue;
            for (const tok of val.match(COLOR_TOKEN) || []) {
                const c = parseColor(tok);
                if (!c || c[3] < 0.5) continue;
                const L = luminance(c);
                if (isText && L < 0.25) out.push({ file: label, line, kind: "teks gelap tetap", prop, tok });
                else if (isBg && L > 0.75) out.push({ file: label, line, kind: "latar terang tetap", prop, tok });
            }
        }
    }
}

function walkPhp(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walkPhp(p, out);
        else if (e.name.endsWith(".php")) out.push(p);
    }
    return out;
}

function scanModeUnsafe() {
    const out = [];
    for (const f of fs.readdirSync(CSS_DIR)) {
        if (!f.endsWith(".css") || LITERAL_ALLOW.has(f)) continue;
        scanUnsafeCss(fs.readFileSync(path.join(CSS_DIR, f), "utf8"), "static/css/" + f, out);
    }
    for (const f of walkPhp(VIEWS_DIR)) {
        const src = fs.readFileSync(f, "utf8");
        const rel = path.relative(path.join(__dirname, ".."), f).split(path.sep).join("/");
        for (const m of src.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) scanUnsafeCss(m[1], rel, out);
    }
    return out;
}

function countsByFile(violations) {
    const m = {};
    for (const v of violations) m[v.file] = (m[v.file] || 0) + 1;
    return m;
}

function readBaseline() {
    try { return JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")).files || {}; } catch (_e) { return {}; }
}

/** Bandingkan temuan dengan baseline. Kembalikan daftar regresi (file yang naik/baru). */
function checkRatchet() {
    const counts = countsByFile(scanModeUnsafe());
    const base = readBaseline();
    const regressions = [];
    for (const [file, n] of Object.entries(counts)) {
        const allowed = base[file] || 0;
        if (n > allowed) regressions.push({ file, now: n, allowed });
    }
    return { counts, base, regressions };
}

function main() {
    const argv = process.argv.slice(2);
    if (argv.includes("--update-baseline")) {
        const counts = countsByFile(scanModeUnsafe());
        fs.writeFileSync(
            BASELINE_PATH,
            JSON.stringify({
                _doc: "Utang literal warna tak-aman-mode-gelap per file. Angka hanya boleh TURUN. " +
                      "Regenerasi: node scripts/check-theme-tokens.js --update-baseline",
                total: Object.values(counts).reduce((a, b) => a + b, 0),
                files: Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1])),
            }, null, 2) + "\n"
        );
        console.log("✓ baseline diperbarui: " + Object.values(counts).reduce((a, b) => a + b, 0) + " deklarasi di " + Object.keys(counts).length + " file");
        process.exit(0);
    }

    const violations = scan();
    const { regressions, counts } = checkRatchet();
    let bad = false;

    if (violations.length) {
        bad = true;
        console.error(`✗ [theme-tokens] ${violations.length} pemakaian primitif TETAP untuk surface/teks/border (rawan gelap-di-gelap):`);
        for (const v of violations) console.error(`  static/css/${v.file}:${v.line}  ${v.text}`);
        console.error(`\n→ ${SUGGEST}`);
        console.error("  (Kalau file ini memang fondasi pemetaan token, tambahkan ke ALLOW di scripts/check-theme-tokens.js.)");
    }

    if (regressions.length) {
        bad = true;
        console.error(`\n✗ [theme-literal] ${regressions.length} file menambah literal warna yang TIDAK AMAN di mode gelap:`);
        for (const r of regressions) console.error(`  ${r.file}  → ${r.now} deklarasi (batas ${r.allowed})`);
        console.error("\n→ Latar terang TETAP jadi blok putih menyilaukan, teks gelap TETAP hilang saat body.tk-dark.");
        console.error(`  ${SUGGEST}`);
        console.error("  Kalau kamu justru MEMPERBAIKI (jumlah turun), jalankan: node scripts/check-theme-tokens.js --update-baseline");
    }

    if (bad) process.exit(1);

    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    console.log("✓ [theme-tokens] Semua CSS halaman memakai token semantik — dark-mode aman.");
    console.log(`✓ [theme-literal] Tidak ada literal tak-aman baru (utang terkunci: ${total} deklarasi).`);
    process.exit(0);
}

module.exports = { scan, SUGGEST, scanModeUnsafe, checkRatchet };

if (require.main === module) main();
