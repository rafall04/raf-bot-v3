/**
 * Header Doc
 * Purpose: Test registry area/koordinator — matching nama case-insensitive + validasi upsert.
 *          (CRUD round-trip ke disk diverifikasi live; di sini cukup logika murni + validasi.)
 * Caller: jest.
 * Deps: ../cctv-area-registry.
 */
'use strict';
const reg = require('../cctv-area-registry');

describe('cctv-area-registry', () => {
    test('normalizeName trim + lowercase', () => {
        expect(reg.normalizeName('  DANDER ')).toBe('dander');
    });

    test('matchByName case-insensitive', () => {
        const areas = [{ id: 'a1', name: 'DANDER', coordinatorPhone: '628' }, { id: 'a2', name: 'Tanjungharjo', coordinatorPhone: '629' }];
        expect(reg.matchByName(areas, 'dander').id).toBe('a1');
        expect(reg.matchByName(areas, ' TANJUNGHARJO ').id).toBe('a2');
        expect(reg.matchByName(areas, 'xxx')).toBeNull();
        expect(reg.matchByName(areas, '')).toBeNull();
        expect(reg.matchByName(null, 'dander')).toBeNull();
    });

    test('upsert wajib nama & nomor koordinator', () => {
        expect(() => reg.upsert({ name: '', coordinatorPhone: '628' })).toThrow(/nama wajib/);
        expect(() => reg.upsert({ name: 'X', coordinatorPhone: '' })).toThrow(/nomor WA koordinator wajib/);
    });
});
