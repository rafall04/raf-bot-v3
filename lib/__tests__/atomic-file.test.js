/**
 * Header Doc
 * Purpose: Uji writeFileAtomicSync (#b343) — tulis via tmp+rename (atomik), dukung fs yang di-inject
 *   (route ber-DI), dan bersihkan tmp + melempar bila gagal. config.json terpotong = bot gagal boot,
 *   jadi penulisan atomik wajib.
 * Caller: Jest.
 * Deps: lib/atomic-file, fs, os, path.
 * SideEffects: menulis berkas sementara di os.tmpdir lalu menghapusnya.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeFileAtomicSync } = require('../atomic-file');

describe('writeFileAtomicSync (#b343)', () => {
    let target;
    beforeEach(() => { target = path.join(os.tmpdir(), `raf-atomic-${process.pid}-${Math.random().toString(36).slice(2)}.json`); });
    afterEach(() => { try { fs.existsSync(target) && fs.unlinkSync(target); } catch (_e) { /* */ } });

    test('menulis isi dengan benar & tak meninggalkan berkas .tmp', () => {
        writeFileAtomicSync(target, '{"a":1}');
        expect(fs.readFileSync(target, 'utf8')).toBe('{"a":1}');
        expect(fs.existsSync(`${target}.tmp-${process.pid}`)).toBe(false);
    });

    test('menimpa isi lama secara utuh (bukan setengah)', () => {
        fs.writeFileSync(target, 'LAMA');
        writeFileAtomicSync(target, 'BARU-UTUH');
        expect(fs.readFileSync(target, 'utf8')).toBe('BARU-UTUH');
    });

    test('memakai renameSync (bukti jalur tmp+rename)', () => {
        const calls = [];
        const fakeFs = {
            writeFileSync: (p, c) => calls.push(['write', p, c]),
            renameSync: (a, b) => calls.push(['rename', a, b]),
            existsSync: () => false,
            unlinkSync: () => {},
        };
        writeFileAtomicSync('/x/config.json', 'DATA', fakeFs);
        expect(calls[0][0]).toBe('write');
        expect(calls[0][1]).toMatch(/\.tmp-/);           // tulis ke tmp dulu
        expect(calls[1]).toEqual(['rename', calls[0][1], '/x/config.json']); // lalu rename ke tujuan
    });

    test('gagal tulis → melempar + bersihkan tmp (tak menyisakan sampah)', () => {
        const fakeFs = {
            writeFileSync: () => { throw new Error('disk penuh'); },
            renameSync: () => {},
            existsSync: () => true,
            unlinkSync: jest.fn(),
        };
        expect(() => writeFileAtomicSync('/x/config.json', 'DATA', fakeFs)).toThrow('disk penuh');
        expect(fakeFs.unlinkSync).toHaveBeenCalled(); // sisa tmp dibersihkan
    });
});
