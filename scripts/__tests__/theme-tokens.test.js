/**
 * Header Doc
 * Purpose: Test guard token tema — CSS halaman wajib token SEMANTIK sadar-mode (--surface/--ink/--muted/
 *          --line), bukan primitif tetap; pelanggaran = rawan "gelap-di-gelap" saat body.tk-dark.
 *          Membawa `npm run check:theme` ke dalam `npm test` supaya jalan otomatis, bukan manual.
 * Caller: Jest (`npm test` / `npx jest scripts/__tests__/theme-tokens.test.js`).
 * Deps: scripts/check-theme-tokens.js.
 * MainFuncs: -
 * SideEffects: Tidak ada; read-only terhadap static/css.
 */
'use strict';

const { scan, SUGGEST } = require('../check-theme-tokens');

describe('token tema semantik (guard gelap-di-gelap)', () => {
    test('CSS halaman tidak memakai primitif tetap untuk surface/teks/border', () => {
        const violations = scan();
        const rendered = violations.map((v) => `static/css/${v.file}:${v.line}  ${v.text}`);
        if (rendered.length) rendered.push(`→ ${SUGGEST}`);
        expect(rendered).toEqual([]);
    });
});
