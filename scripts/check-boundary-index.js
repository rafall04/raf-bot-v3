#!/usr/bin/env node
/**
 * Header Doc
 * Purpose: Guard integritas indeks boundary — memastikan anchor `<a id="bNNN">` di docs/boundary-log.md
 *          unik & ber-heading, semua link indeks di SYSTEM_MAP.md menunjuk anchor yang ada, semua entri
 *          log punya baris indeks, dan baris indeks tetap SATU baris ringkas (bukan paragraf).
 *          Latar: indeks pernah membusuk jadi paragraf panjang + anchor dobel (b128, b166) sehingga
 *          menyesatkan; aturan yang hanya ditulis di skill terbukti tidak cukup (pelajaran #b169:
 *          guard daftar-manual bukan guard).
 * Caller: `node scripts/check-boundary-index.js` (manual/CI) dan scripts/__tests__/boundary-index.test.js.
 * Deps: Node core (fs, path). Read-only terhadap SYSTEM_MAP.md + docs/boundary-log.md.
 * MainFuncs: checkBoundaryIndex(), main().
 * SideEffects: Tidak ada; hanya membaca file dan menulis hasil ke stdout/exit code.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LOG_PATH = path.join(ROOT, 'docs', 'boundary-log.md');
const MAP_PATH = path.join(ROOT, 'SYSTEM_MAP.md');

// Ambang panjang baris indeks: legacy terpanjang ±375 char (heading berisi daftar file);
// paragraf hasil pembusukan dulu 800–2500 char. Naikkan HANYA kalau ada heading sah yang lebih panjang.
const MAX_INDEX_LINE_LENGTH = 450;

const INDEX_HEADING = '## Boundary Refactor Baru (indeks)';

/**
 * Periksa integritas boundary-log + indeks SYSTEM_MAP.
 * @returns {{ errors: string[], stats: { anchors: number, indexLinks: number } }}
 */
function checkBoundaryIndex() {
    const errors = [];
    const log = fs.readFileSync(LOG_PATH, 'utf8');
    const map = fs.readFileSync(MAP_PATH, 'utf8');

    // 1) Anchor unik + tiap anchor diikuti heading `### `.
    const logLines = log.split(/\r?\n/);
    const anchorIds = [];
    const seen = new Set();
    for (let i = 0; i < logLines.length; i++) {
        const m = logLines[i].match(/<a id="(b\d+)"><\/a>/);
        if (!m) continue;
        const id = m[1];
        if (seen.has(id)) {
            errors.push(`Anchor duplikat di boundary-log: ${id} (baris ${i + 1})`);
        }
        seen.add(id);
        anchorIds.push(id);
        let j = i + 1;
        while (j < logLines.length && logLines[j].trim() === '') j++;
        if (j >= logLines.length || !logLines[j].startsWith('### ')) {
            errors.push(`Anchor ${id} (baris ${i + 1}) tidak diikuti heading "### " — entri tanpa judul.`);
        }
    }
    if (anchorIds.length === 0) errors.push('Tidak ada anchor <a id="bNNN"> ditemukan di boundary-log.');

    // 2) Ambil seksi indeks di SYSTEM_MAP (dari heading indeks sampai heading "## " berikutnya).
    const idxStart = map.indexOf(INDEX_HEADING);
    let indexIds = [];
    if (idxStart < 0) {
        errors.push(`Heading "${INDEX_HEADING}" tidak ditemukan di SYSTEM_MAP.md.`);
    } else {
        const afterHeading = map.slice(idxStart + INDEX_HEADING.length);
        const nextHeading = afterHeading.search(/\r?\n## /);
        const section = nextHeading >= 0 ? afterHeading.slice(0, nextHeading) : afterHeading;
        const sectionLines = section.split(/\r?\n/);

        // 2a) Semua link #bNNN di seksi indeks menunjuk anchor yang ada.
        for (const line of sectionLines) {
            for (const lm of line.matchAll(/boundary-log\.md#(b\d+)/g)) {
                indexIds.push(lm[1]);
                if (!seen.has(lm[1])) {
                    errors.push(`Link indeks menunjuk anchor yang TIDAK ADA: #${lm[1]}`);
                }
            }
        }

        // 2b) Baris indeks harus tetap satu baris ringkas — paragraf = penyakit lama kambuh.
        for (const line of sectionLines) {
            if (line.startsWith('- [') && line.length > MAX_INDEX_LINE_LENGTH) {
                errors.push(
                    `Baris indeks ${line.length} char (> ${MAX_INDEX_LINE_LENGTH}) — tulis badan entri di ` +
                        `boundary-log, indeks cukup judul: "${line.slice(0, 80)}…"`
                );
            }
        }
    }

    // 3) Kelengkapan dua arah: tiap entri log punya baris indeks.
    const indexSet = new Set(indexIds);
    for (const id of anchorIds) {
        if (!indexSet.has(id)) {
            errors.push(`Entri ${id} ada di boundary-log tapi TIDAK terdaftar di indeks SYSTEM_MAP.`);
        }
    }

    return { errors, stats: { anchors: anchorIds.length, indexLinks: indexIds.length } };
}

function main() {
    const { errors, stats } = checkBoundaryIndex();
    if (errors.length) {
        console.error(`GAGAL — ${errors.length} masalah integritas indeks boundary:`);
        for (const e of errors) console.error(`  • ${e}`);
        process.exit(1);
    }
    console.log(`OK — ${stats.anchors} entri boundary-log, ${stats.indexLinks} link indeks, semuanya konsisten.`);
}

module.exports = { checkBoundaryIndex, MAX_INDEX_LINE_LENGTH };

if (require.main === module) main();
