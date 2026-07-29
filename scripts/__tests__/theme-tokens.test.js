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

const { scan, SUGGEST, checkRatchet } = require('../check-theme-tokens');

describe('token tema semantik (guard gelap-di-gelap)', () => {
    test('CSS halaman tidak memakai primitif tetap untuk surface/teks/border', () => {
        const violations = scan();
        const rendered = violations.map((v) => `static/css/${v.file}:${v.line}  ${v.text}`);
        if (rendered.length) rendered.push(`→ ${SUGGEST}`);
        expect(rendered).toEqual([]);
    });

    // Ratchet: utang literal warna tak-aman-mode-gelap (latar terang TETAP / teks gelap
    // TETAP) dibekukan per file di theme-literal-baseline.json. Jumlahnya hanya boleh
    // TURUN — ini yang mencegah bug "gelap-di-gelap" baru masuk lagi lewat blok <style>
    // inline di .php, area yang dulu sama sekali tidak dipindai guard.
    test('tidak ada literal warna tak-aman mode gelap yang BARU', () => {
        const { regressions } = checkRatchet();
        const rendered = regressions.map((r) => `${r.file}: ${r.now} deklarasi (batas ${r.allowed})`);
        expect(rendered).toEqual([]);
    });
});
