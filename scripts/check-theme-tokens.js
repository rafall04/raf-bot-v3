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

function main() {
    const violations = scan();
    if (!violations.length) {
        console.log("✓ [theme-tokens] Semua CSS halaman memakai token semantik — dark-mode aman.");
        process.exit(0);
    }
    console.error(`✗ [theme-tokens] ${violations.length} pemakaian primitif TETAP untuk surface/teks/border (rawan gelap-di-gelap):`);
    for (const v of violations) console.error(`  static/css/${v.file}:${v.line}  ${v.text}`);
    console.error(`\n→ ${SUGGEST}`);
    console.error("  (Kalau file ini memang fondasi pemetaan token, tambahkan ke ALLOW di scripts/check-theme-tokens.js.)");
    process.exit(1);
}

module.exports = { scan, SUGGEST };

if (require.main === module) main();
