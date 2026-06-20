/**
 * Header Doc
 * Purpose: Unit test guard konsol OLT read-only (validateShowCommand) — pastikan hanya `show ...`
 *          murni yang lolos dan semua jalur tulis/injeksi/output-masif ditolak.
 * Caller: Jest.
 * Deps: lib/olt-show-console.
 * MainFuncs: -
 * SideEffects: -
 */
'use strict';

const { validateShowCommand } = require('../olt-show-console');

describe('validateShowCommand', () => {
    test.each([
        'show card',
        'show fan',
        'show processor',
        'show interface gei_1/3/1',
        'show gpon onu state',
        'show ip interface brief'
    ])('izinkan: %s', (cmd) => {
        expect(validateShowCommand(cmd)).toEqual({ ok: true, command: cmd });
    });

    test('trim spasi', () => {
        expect(validateShowCommand('  show card  ')).toEqual({ ok: true, command: 'show card' });
    });

    test.each([
        ['', 'kosong'],
        ['conf t', 'bukan show'],
        ['reboot', 'bukan show'],
        ['no onu 1', 'bukan show'],
        ['write', 'bukan show'],
        ['show card; reboot', 'rangkai perintah'],
        ['show card | include x', 'pipe'],
        ['show card && reboot', 'rangkai'],
        ['show ?', 'tanda tanya'],
        ['show running-config', 'output masif'],
        ['show running-config interface gpon-onu_1/2/2', 'output masif'],
        ['show startup-config', 'output masif']
    ])('tolak: %s', (cmd) => {
        expect(validateShowCommand(cmd).ok).toBe(false);
    });
});
