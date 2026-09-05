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

    test('upsert wajib nama; koordinator OPSIONAL (#b316 — area boleh cuma label)', () => {
        expect(() => reg.upsert({ name: '', coordinatorPhone: '628' })).toThrow(/nama wajib/);
        // Nama-saja kini SAH: area jadi label lokasi tanpa koordinator (tak lagi throw).
        const spy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
        reg._resetCache();
        const labelOnly = reg.upsert({ name: 'KARANG' });
        expect(labelOnly.name).toBe('KARANG');
        expect(labelOnly.coordinatorPhone).toBe('');
        expect(labelOnly.coordinatorGroupId).toBe('');
        spy.mockRestore();
    });

    test('upsert nama-saja TAK menggandakan area bernama sama — reuse id + jaga createdAt (#b317)', () => {
        // Skenario: form CCTV auto-daftar label "KARANG" (routes/cctv.js autoRegisterArea), lalu admin
        // isi koordinatornya di tab Area/Lokasi TANPA mengirim id. Harus UPDATE label itu, bukan bikin
        // baris kedua bernama sama (kalau kembar, matchByName jadi ambigu → registry bukan 1 sumber).
        reg._resetCache();
        const seeded = [{ id: 'area_karang', name: 'KARANG', coordinatorPhone: '', coordinatorGroupId: '', createdAt: '2020-01-01T00:00:00.000Z' }];
        jest.spyOn(fs, 'existsSync').mockReturnValue(true);
        jest.spyOn(fs, 'statSync').mockReturnValue({ mtimeMs: 111 });
        jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(seeded));
        let written = null;
        jest.spyOn(fs, 'writeFileSync').mockImplementation((_f, data) => { written = JSON.parse(data); });
        const saved = reg.upsert({ name: 'karang', coordinatorPhone: '628999' });
        expect(saved.id).toBe('area_karang');                       // reuse id label lama
        expect(saved.coordinatorPhone).toBe('628999');              // koordinator terisi
        expect(saved.createdAt).toBe('2020-01-01T00:00:00.000Z');   // createdAt asli TAK direset
        expect(written.filter((a) => reg.normalizeName(a.name) === 'karang').length).toBe(1); // TANPA kembar
        jest.restoreAllMocks();
        reg._resetCache();
    });

    test('upsert menerima grup WA tanpa nomor (target = grup RT)', () => {
        // File ini sengaja tak menulis disk (round-trip diverifikasi live) → mock writeFileSync.
        const spy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
        reg._resetCache();
        const saved = reg.upsert({ name: 'RT-GRUP-TEST', coordinatorGroupId: '12036300@g.us', coordinatorGroupName: 'RT 05', customersInGroup: true, coordinatorInGroup: true, quietMode: 'custom', quietStart: '00:00', quietEnd: '05:00' });
        expect(saved.coordinatorGroupId).toBe('12036300@g.us');
        expect(saved.coordinatorGroupName).toBe('RT 05');
        expect(saved.coordinatorPhone).toBe('');
        expect(saved.customersInGroup).toBe(true);
        expect(saved.coordinatorInGroup).toBe(true);
        expect(saved.quietMode).toBe('custom');
        expect(saved.quietStart).toBe('00:00');
        expect(saved.quietEnd).toBe('05:00');
        // quietMode tak dikenal → fallback 'inherit'
        expect(reg.upsert({ name: 'X', coordinatorPhone: '628', quietMode: 'ngawur' }).quietMode).toBe('inherit');
        spy.mockRestore();
        reg._resetCache();
    });
});
