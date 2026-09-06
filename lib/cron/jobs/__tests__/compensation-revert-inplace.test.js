/**
 * Header Doc
 * Purpose: Kunci #b320 — compensation-revert MUTASI `global.compensations` in-place (mirror
 *   speed-revert), TIDAK membangun-ulang array dari snapshot disk lalu menimpanya (yang menggilas
 *   kompensasi yang admin tambah SELAMA jendela await revert).
 * Caller: Jest.
 * Deps: baca sumber lib/cron/jobs/compensation-revert.js.
 * SideEffects: -
 */
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'compensation-revert.js'), 'utf8');

describe('compensation-revert in-place (#b320)', () => {
    test('TIDAK menimpa global.compensations dari array yang dibangun-ulang (compensationsToKeep dibuang)', () => {
        expect(src).not.toMatch(/global\.compensations\s*=\s*compensationsToKeep/);
        expect(src).not.toMatch(/compensationsToKeep/);
    });
    test('sumber = global.compensations + mutasi status in-place', () => {
        expect(src).toMatch(/Array\.isArray\(global\.compensations\)/);
        expect(src).toMatch(/comp\.status = 'reverted'/);
    });
});
