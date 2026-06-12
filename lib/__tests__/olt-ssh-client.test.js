/**
 * Header Doc
 * Purpose: Unit test helper murni klien SSH OLT — pembersihan output terminal (ANSI,
 *          backspace, --More--), deteksi prompt ZXAN, deteksi error CLI, strip echo/prompt,
 *          dan konversi script → daftar perintah.
 * Caller: Jest (npm test).
 * Deps: lib/olt-ssh-client (__test).
 * MainFuncs: -
 * SideEffects: tidak ada (tanpa koneksi SSH).
 */

'use strict';

const { __test } = require('../olt-ssh-client');

const { cleanTerminalOutput, endsWithPrompt, stripEchoAndPrompt, detectCliError, scriptToCommands } = __test;

describe('olt-ssh-client helpers', () => {
    describe('cleanTerminalOutput', () => {
        test('membuang escape ANSI dan CR', () => {
            expect(cleanTerminalOutput('\x1b[2Jhalo\r\ndunia\r')).toBe('halo\ndunia\n');
        });

        test('membuang penanda --More-- dan backspace', () => {
            const raw = 'baris1\n --More-- \x08\x08\x08baris2';
            const out = cleanTerminalOutput(raw);
            expect(out).not.toMatch(/more/i);
            expect(out).toContain('baris1');
            expect(out).toContain('baris2');
        });

        test('menerapkan backspace (hapus karakter sebelumnya)', () => {
            expect(cleanTerminalOutput('abcd\x08\x08xy')).toBe('abxy');
        });
    });

    describe('endsWithPrompt', () => {
        test.each([
            ['ZXAN#'],
            ['ZXAN# '],
            ['ZXAN(config)#'],
            ['ZXAN(config-if)#'],
            ['OLT-NGAJUK(config-pon-onu-mng)#'],
            ['ZXAN>'],
        ])('mengenali prompt "%s"', (prompt) => {
            expect(endsWithPrompt('output sebelumnya\n' + prompt)).toBe(true);
        });

        test('tidak menganggap output biasa sebagai prompt', () => {
            expect(endsWithPrompt('OnuIndex   Sn   State\n')).toBe(false);
            expect(endsWithPrompt('')).toBe(false);
            // Baris data yang mengandung spasi tidak boleh dianggap prompt.
            expect(endsWithPrompt('Building configuration...\nonu 8 type ALL')).toBe(false);
        });
    });

    describe('detectCliError', () => {
        test('mendeteksi %Error ZXAN', () => {
            expect(detectCliError('%Error 326: The onu of this position exists')).toMatch(/%Error 326/);
        });

        test('mendeteksi % Invalid input', () => {
            expect(detectCliError("% Invalid input detected at '^' marker.")).toMatch(/Invalid input/);
        });

        test('mendeteksi Unknown command', () => {
            expect(detectCliError('Unknown command: onuu')).toMatch(/Unknown command/i);
        });

        test('output normal tidak dianggap error', () => {
            expect(detectCliError('')).toBeNull();
            expect(detectCliError('OnuIndex  Sn  State\ngpon-onu_1/3/16:8  ZTEGCCA16805  unknown')).toBeNull();
            // Kata "error" di tengah kalimat data tidak boleh false-positive.
            expect(detectCliError('Last down cause: no error recorded')).toBeNull();
        });

        test('notice %Code "No related information" BUKAN error (verif live C320)', () => {
            expect(detectCliError('%Code 62310-GPONSRV : No related information to show.')).toBeNull();
        });

        test('notice %Info BUKAN error (mis. masuk conf t — verif live C320)', () => {
            expect(detectCliError('%Info 20272: Enter configuration commands, one per line. End with CTRL/Z.')).toBeNull();
        });

        test('format error asli C320: %Error 20200/20203', () => {
            expect(detectCliError("           ^\n%Error 20200: Invalid input detected at '^' marker.")).toMatch(/20200/);
            expect(detectCliError('%Error 20203: Incomplete command.')).toMatch(/20203/);
        });
    });

    describe('stripEchoAndPrompt', () => {
        test('membuang echo perintah di awal dan prompt di akhir', () => {
            const raw = 'show gpon onu uncfg\nOnuIndex  Sn  State\ngpon-onu_1/3/16:8  ZTEGCCA16805  unknown\nZXAN#';
            const out = stripEchoAndPrompt(raw, 'show gpon onu uncfg');
            expect(out).not.toMatch(/show gpon onu uncfg/);
            expect(out).not.toMatch(/ZXAN#/);
            expect(out).toContain('ZTEGCCA16805');
        });
    });

    describe('scriptToCommands', () => {
        test('separator "!" menjadi `exit` (keluar konteks — wajib di ZXAN), komentar dibuang', () => {
            const script = 'conf t\nint gpon-olt_1/3/16\nonu 8 type ALL sn ZTEGCCA16805\n!\nint gpon-onu_1/3/16:8\n!komentar dibuang\n\nend';
            expect(scriptToCommands(script)).toEqual([
                'conf t',
                'int gpon-olt_1/3/16',
                'onu 8 type ALL sn ZTEGCCA16805',
                'exit',
                'int gpon-onu_1/3/16:8',
                'end',
            ]);
        });

        test('trim spasi tiap baris', () => {
            expect(scriptToCommands('  end  ')).toEqual(['end']);
        });
    });
});
