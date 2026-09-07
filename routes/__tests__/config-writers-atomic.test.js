/**
 * Header Doc
 * Purpose: Mengunci #b343/#b345 — invoice.js membaca config SEGAR dari disk + saveConfigAtomic
 *   (bukan menyerialkan global.config boot yang basi → menghapus subkey hand-edit/penulis lain
 *   pasca-boot; sisi PENULIS landmine #b336).
 *   CATATAN #b345: penegakan "SEMUA penulis config.json tulis ATOMIK" TIDAK LAGI di sini dengan
 *   daftar hardcode CONFIG_WRITERS — allowlist itu membuat lib/technician-salary-plan.js lolos.
 *   Kini ditegakkan PEMINDAI REPO scripts/__tests__/atomic-json-writers.test.js (config.json +
 *   ledger kritis lain). Jangan hidupkan lagi daftar manual di sini.
 * Caller: Jest.
 * Deps: baca sumber routes/invoice.js.
 * SideEffects: -
 */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

describe('penulis config.json tulis ATOMIK (#b343/#b345)', () => {
    test('invoice.js: baca config SEGAR (readConfigFresh) + tulis saveConfigAtomic, TIDAK serialkan global.config', () => {
        const src = read('routes/invoice.js');
        expect(src).toMatch(/readConfigFresh\(\)/);
        expect(src).toMatch(/saveConfigAtomic\(/);
        // Pola lama yang menghapus subkey lain: menyerialkan global.config apa adanya ke config.json.
        expect(src).not.toMatch(/writeFileSync\(\s*['"]\.\/config\.json['"]/);
        expect(src).not.toMatch(/JSON\.stringify\(\s*global\.config/);
    });
});
