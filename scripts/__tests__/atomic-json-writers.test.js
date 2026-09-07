/**
 * Header Doc
 * Purpose: Mengunci #b345 — penulis JSON KRITIS wajib ATOMIK. Memindai SELURUH repo (bukan
 *   allowlist penulis seperti #b343 yang membuat technician-salary-plan.js lolos) untuk raw
 *   `fs.writeFileSync` / bare `writeFileSync` yang menyasar config.json atau ledger uang/tiket/
 *   jadwal. Torn-write berkas ini = boot-fatal (config.json) atau kehilangan uang/tiket/jadwal
 *   permanen saat SIGKILL (prod restart 7-13x/hari). Penulis sah = saveJSON (lib/json-store) atau
 *   writeFileAtomicSync (lib/atomic-file) — keduanya tmp+rename. Meta-pelajaran: guard invarian
 *   harus MEMINDAI repo, bukan mencocokkan daftar tetap yang selalu ketinggalan penulis baru.
 * Caller: Jest (`npx jest scripts/__tests__/atomic-json-writers.test.js`).
 * Deps: fs, path (memindai sumber, TIDAK mengeksekusi).
 * SideEffects: -
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");

// Basename berkas JSON KRITIS. Target-based (bukan writer-based): penulis BARU ke berkas ini
// tertangkap dari file mana pun ia hidup.
const CRITICAL = new Set([
    "config.json",
    "payment.json",
    "reports.json",
    "packages.json",
    "cron.json",
    "speed_boost_matrix.json",
    "agent_transactions.json",
    "agent_credentials.json",
    "agent_vouchers.json",
    "voucher.json",
    "statik.json",
    "reseller.json",
    "agents.json",
    "reboot-followups.json",
    "lid-mappings.json",
    "laporan-drafts.json",
    "psb-drafts.json",
    "notification-digest.json",
]);

// Primitif penulis atomik — merekalah yang SAH memanggil fs.writeFileSync (ke berkas .tmp).
const EXCLUDE_REL = new Set([
    path.join("lib", "json-store.js"),
    path.join("lib", "atomic-file.js"),
]);
const EXCLUDE_DIRS = new Set([
    "node_modules", ".git", ".worktrees", "tmp", "dist", "build", "backups",
    "coverage", "scratchpad", "sessions", "database", "__tests__",
]);

function walk(dir, acc) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
    for (const ent of entries) {
        if (ent.isDirectory()) {
            if (EXCLUDE_DIRS.has(ent.name)) continue;
            walk(path.join(dir, ent.name), acc);
        } else if (ent.isFile() && ent.name.endsWith(".js")) {
            acc.push(path.join(dir, ent.name));
        }
    }
    return acc;
}

// Buang komentar block + line supaya potongan kode yang DIKOMENTARI tak jadi positif-palsu.
function stripComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

// Ekstrak argumen PERTAMA pemanggilan yang dimulai di indeks `open` (indeks '(' pembuka),
// dengan menyeimbangkan tanda kurung — supaya `path.join(a, b, 'x.json')` sebagai arg inline
// tidak terpotong di koma pertama.
function firstArg(src, open) {
    let depth = 0;
    let arg = "";
    for (let i = open; i < src.length; i++) {
        const c = src[i];
        if (c === "(") { depth++; if (depth === 1) continue; }
        else if (c === ")") { depth--; if (depth === 0) break; }
        else if (c === "," && depth === 1) break;
        if (depth >= 1) arg += c;
    }
    return arg.trim();
}

function jsonBasename(expr) {
    if (!expr) return null;
    const strLit = expr.match(/['"`]([^'"`]*\.json)['"`]/);
    if (strLit) return path.basename(strLit[1]);
    return null;
}

// Resolusi arg → basename .json. Dukung: string literal, path.join(...,'x.json'), dan variabel
// sederhana `const id = <string|path.join>`.
function resolveBasename(arg, consts) {
    let base = jsonBasename(arg);
    if (base) return base;
    // variabel identifier tunggal
    if (/^[A-Za-z0-9_$]+$/.test(arg) && consts[arg]) {
        base = jsonBasename(consts[arg]);
    }
    return base;
}

function scanFile(absPath) {
    const raw = stripComments(fs.readFileSync(absPath, "utf8"));
    // peta const/let/var sederhana untuk resolusi variabel path
    const consts = {};
    const constRe = /(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*([^;\n]+)/g;
    let cm;
    while ((cm = constRe.exec(raw)) !== null) consts[cm[1]] = cm[2];

    const offenders = [];
    // Cocokkan `fs.writeFileSync(` atau bare `writeFileSync(` — TAPI bukan `X.writeFileSync(`
    // dengan X != fs (DI seam mis. options.writeFileSync), dan bukan `writeFileAtomicSync(`.
    const callRe = /(^|[^.\w])(fs\.)?writeFileSync\s*\(/g;
    let m;
    while ((m = callRe.exec(raw)) !== null) {
        const open = raw.indexOf("(", m.index + m[0].length - 1);
        if (open === -1) continue;
        const arg = firstArg(raw, open);
        const base = resolveBasename(arg, consts);
        if (base && CRITICAL.has(base)) offenders.push(base);
    }
    return offenders;
}

describe("penulis JSON kritis wajib ATOMIK (#b345, pemindai repo)", () => {
    const files = walk(ROOT, []).filter((f) => !EXCLUDE_REL.has(path.relative(ROOT, f)));

    test("tidak ada raw fs.writeFileSync ke config.json / ledger kritis di seluruh repo", () => {
        const hits = [];
        for (const f of files) {
            const offenders = scanFile(f);
            if (offenders.length) {
                hits.push(`${path.relative(ROOT, f)} -> ${[...new Set(offenders)].join(", ")}`);
            }
        }
        // Bila gagal: salurkan tulis lewat saveJSON('<file>.json', data) (lib/json-store) atau
        // writeFileAtomicSync(path, content) (lib/atomic-file). JANGAN menambah pengecualian —
        // itu mengulang jebakan allowlist yang ditutup guard ini.
        expect(hits).toEqual([]);
    });

    test("scanner benar-benar memindai banyak berkas (sanity: bukan glob kosong)", () => {
        expect(files.length).toBeGreaterThan(200);
    });
});
