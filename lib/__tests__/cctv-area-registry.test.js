/**
 * Header Doc
 * Purpose: Test registry area/koordinator — matching nama case-insensitive + validasi upsert.
 *          (CRUD round-trip ke disk diverifikasi live; di sini cukup logika murni + validasi.)
 * Caller: jest.
 * Deps: ../cctv-area-registry.
 */
'use strict';
const fs = require('fs');
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

    test('upsert wajib nama; penerima boleh nomor ATAU grup (minimal salah satu)', () => {
        expect(() => reg.upsert({ name: '', coordinatorPhone: '628' })).toThrow(/nama wajib/);
        // tanpa nomor DAN tanpa grup → tolak
        expect(() => reg.upsert({ name: 'X' })).toThrow(/nomor WA koordinator atau pilih grup/);
    });

    test('upsert menerima grup WA tanpa nomor (target = grup RT)', () => {
        // File ini sengaja tak menulis disk (round-trip diverifikasi live) → mock writeFileSync.
        const spy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
        reg._resetCache();
        const saved = reg.upsert({ name: 'RT-GRUP-TEST', coordinatorGroupId: '12036300@g.us', coordinatorGroupName: 'RT 05', customersInGroup: true });
        expect(saved.coordinatorGroupId).toBe('12036300@g.us');
        expect(saved.coordinatorGroupName).toBe('RT 05');
        expect(saved.coordinatorPhone).toBe('');
        expect(saved.customersInGroup).toBe(true);
        spy.mockRestore();
        reg._resetCache();
    });
});
