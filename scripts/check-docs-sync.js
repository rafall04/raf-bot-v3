#!/usr/bin/env node
/**
 * Header Doc
 * Purpose: Guard sinkron DOKUMEN ↔ KODE, tiga cek: (1) path repo yang disebut dokumen keadaan-sekarang
 *          (CLAUDE.md, SYSTEM_MAP.md non-indeks, .claude/skills) benar-benar ADA — anti "file rule basi
 *          menunjuk path yang sudah tiada"; (2) tiap nama DB literal `getDatabasePath('X')` di kode
 *          terdokumentasi di SYSTEM_MAP.md seksi DB — anti DB siluman; (3) tiap gate langsung
 *          `config.<key>.enabled` di kode punya key di config.example.json — anti gate tak terdokumentasi.
 *          Indeks boundary & badan boundary-log SENGAJA dikecualikan dari cek path: itu CHANGELOG,
 *          menyebut path yang sudah dihapus adalah tugasnya.
 * Caller: `node scripts/check-docs-sync.js` (manual/pre-push) dan scripts/__tests__/docs-sync.test.js.
 * Deps: Node core (fs, path). Read-only.
 * MainFuncs: checkDocsSync(), main().
 * SideEffects: Tidak ada; hanya baca file dan tulis hasil ke stdout/exit code.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// ── Cek 1: path di dokumen keadaan-sekarang ─────────────────────────────────────
// Hanya token backtick ber-prefix direktori repo yang di-tracked git; `database/` dkk (gitignored,
// dibuat runtime) sengaja tidak dicek supaya guard tetap hijau di fresh clone.
const DOC_PATH_PREFIXES = [
    'lib/',
    'routes/',
    'services/',
    'repositories/',
    'message/',
    'scripts/',
    'static/',
    'views/',
    'docs/',
    'controllers/',
    'config/',
    '.claude/',
    '.githooks/'
];
const DOC_PATH_EXT = /\.(js|cjs|mjs|php|css|json|md|sql|sh)$/;
// Path yang boleh TIDAK ada (sebutan historis yang disengaja di dokumen keadaan-sekarang).
const DOC_PATH_ALLOWLIST = new Set([]);

const INDEX_HEADING = '## Boundary Refactor Baru (indeks)';

function stripFences(md) {
    return md.replace(/```[\s\S]*?```/g, '');
}

function stripBoundaryIndexSection(md) {
    const start = md.indexOf(INDEX_HEADING);
    if (start < 0) return md;
    const after = md.slice(start + INDEX_HEADING.length);
    const next = after.search(/\r?\n## /);
    return md.slice(0, start) + (next >= 0 ? after.slice(next) : '');
}

function extractDocPaths(md) {
    const out = [];
    for (const m of stripFences(md).matchAll(/`([^`\n]+)`/g)) {
        const raw = m[1].trim();
        if (/[*<>{}$,()\s]/.test(raw)) continue; // wildcard/placeholder/kalimat — bukan path literal
        const candidate = raw.split(':')[0]; // buang suffix `:baris` / `:namaFungsi`
        if (!DOC_PATH_PREFIXES.some((p) => candidate.startsWith(p))) continue;
        if (candidate.endsWith('/')) out.push({ raw, candidate, isDir: true });
        else if (DOC_PATH_EXT.test(candidate)) out.push({ raw, candidate, isDir: false });
    }
    return out;
}

// ── Cek 2 & 3: pemindaian kode ─────────────────────────────────────────────────
const CODE_DIRS = ['lib', 'routes', 'services', 'repositories', 'message', 'controllers'];

function walkJs(dir, acc) {
    let entries = [];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_e) {
        return acc;
    }
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (e.name === 'node_modules' || e.name === '__tests__') continue;
            walkJs(full, acc);
        } else if (/\.(js|cjs|mjs)$/.test(e.name) && !/\.test\.(js|cjs|mjs)$/.test(e.name)) {
            acc.push(full);
        }
    }
    return acc;
}

function checkDocsSync() {
    const errors = [];

    // Cek 1 — path dokumen.
    const docFiles = [path.join(ROOT, 'CLAUDE.md'), path.join(ROOT, 'SYSTEM_MAP.md')];
    const skillsDir = path.join(ROOT, '.claude', 'skills');
    try {
        for (const d of fs.readdirSync(skillsDir)) {
            const p = path.join(skillsDir, d, 'SKILL.md');
            if (fs.existsSync(p)) docFiles.push(p);
        }
    } catch (_e) {
        /* .claude/skills tidak ada → lewati */
    }

    let docPathCount = 0;
    for (const docFile of docFiles) {
        let md = fs.readFileSync(docFile, 'utf8');
        if (path.basename(docFile) === 'SYSTEM_MAP.md') md = stripBoundaryIndexSection(md);
        const rel = path.relative(ROOT, docFile).split(path.sep).join('/');
        for (const { raw, candidate, isDir } of extractDocPaths(md)) {
            docPathCount++;
            if (DOC_PATH_ALLOWLIST.has(candidate)) continue;
            const abs = path.join(ROOT, candidate);
            let ok = false;
            try {
                const st = fs.statSync(abs);
                ok = isDir ? st.isDirectory() : st.isFile();
            } catch (_e) {
                ok = false;
            }
            if (!ok) {
                errors.push(
                    `[docs-path] ${rel} menyebut \`${raw}\` tapi ${candidate} tidak ada — ` +
                        'update dokumennya atau (bila sebutan historis yang disengaja) masukkan DOC_PATH_ALLOWLIST.'
                );
            }
        }
    }

    // Kumpulkan sumber kode sekali untuk cek 2 & 3.
    const jsFiles = [];
    for (const d of CODE_DIRS) walkJs(path.join(ROOT, d), jsFiles);
    const dbNames = new Set();
    const gateKeys = new Set();
    const dbRe = /getDatabasePath\(\s*['"]([^'"]+)['"]/g;
    const gateRe = /(?:global\.)?config\??\.([A-Za-z_$][\w$]*)\??\.enabled\b/g;
    for (const f of jsFiles) {
        const src = fs.readFileSync(f, 'utf8');
        for (const m of src.matchAll(dbRe)) {
            if (!m[1].includes('_test')) dbNames.add(m[1]);
        }
        for (const m of src.matchAll(gateRe)) gateKeys.add(m[1]);
    }

    // Cek 2 — DB terdokumentasi di SYSTEM_MAP.
    const systemMap = fs.readFileSync(path.join(ROOT, 'SYSTEM_MAP.md'), 'utf8');
    for (const name of [...dbNames].sort()) {
        if (!systemMap.includes(name)) {
            errors.push(
                `[db-docs] \`getDatabasePath('${name}')\` dipakai kode tapi '${name}' tidak disebut di ` +
                    'SYSTEM_MAP.md — tambahkan satu baris owner di seksi "DB Config / Locations".'
            );
        }
    }

    // Cek 3 — gate config langsung ter-contoh di config.example.json.
    const example = fs.readFileSync(path.join(ROOT, 'config.example.json'), 'utf8');
    for (const key of [...gateKeys].sort()) {
        if (!example.includes(`"${key}"`)) {
            errors.push(
                `[config-gate] Kode membaca \`config.${key}.enabled\` tapi "${key}" tidak ada di ` +
                    'config.example.json — gate deploy-gelap wajib ter-contoh (default OFF).'
            );
        }
    }

    return {
        errors,
        stats: { docPaths: docPathCount, dbNames: dbNames.size, gateKeys: gateKeys.size, jsFiles: jsFiles.length }
    };
}

function main() {
    const { errors, stats } = checkDocsSync();
    if (errors.length) {
        console.error(`GAGAL — ${errors.length} masalah sinkron docs↔kode:`);
        for (const e of errors) console.error(`  • ${e}`);
        process.exit(1);
    }
    console.log(
        `OK — ${stats.docPaths} path dokumen valid, ${stats.dbNames} DB terdokumentasi, ` +
            `${stats.gateKeys} gate config ter-contoh (dipindai ${stats.jsFiles} file).`
    );
}

module.exports = { checkDocsSync };

if (require.main === module) main();
