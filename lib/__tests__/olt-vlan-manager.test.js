/**
 * Header Doc
 * Purpose: Unit test guard + generator script VLAN OLT (olt-vlan-manager) — pastikan id/label/port
 *          divalidasi ketat dan script CLI yang dihasilkan persis sesuai sintaks ZXAN C320.
 * Caller: Jest.
 * Deps: lib/olt-vlan-manager.
 * MainFuncs: -
 * SideEffects: -
 */
'use strict';

const vm = require('../olt-vlan-manager');

describe('validateVlanId', () => {
    test('valid 2–4094', () => expect(vm.validateVlanId(300)).toEqual({ ok: true, id: 300 }));
    test('string angka', () => expect(vm.validateVlanId('310')).toEqual({ ok: true, id: 310 }));
    test.each([
        ['1', 'reserved'],
        ['0', 'range'],
        ['4095', 'range'],
        ['abc', 'angka'],
        ['', 'angka'],
        ['30x', 'angka']
    ])('tolak %s', (id) => expect(vm.validateVlanId(id).ok).toBe(false));
});

describe('sanitizeLabel', () => {
    test('token valid', () => expect(vm.sanitizeLabel('PPPoE', 'Nama')).toEqual({ ok: true, value: 'PPPoE' }));
    test('kosong → ok', () => expect(vm.sanitizeLabel('', 'Nama')).toEqual({ ok: true, value: '' }));
    test.each(['a b', 'a;b', 'a?b', 'a"b', 'drop\nvlan'])('tolak "%s"', (s) =>
        expect(vm.sanitizeLabel(s, 'Nama').ok).toBe(false)
    );
    test('terlalu panjang', () => expect(vm.sanitizeLabel('x'.repeat(33), 'Nama').ok).toBe(false));
});

describe('validateUplinkPort', () => {
    test('gei valid', () => expect(vm.validateUplinkPort('gei_1/3/1')).toEqual({ ok: true, port: 'gei_1/3/1' }));
    test.each(['gei_1/3', 'xgei_1/3/1', 'gei_1/3/1; reboot', 'gpon-onu_1/2/2'])('tolak %s', (p) =>
        expect(vm.validateUplinkPort(p).ok).toBe(false)
    );
});

describe('buildCreateVlan', () => {
    test('script create (sesuai CLI ZXAN)', () => {
        const r = vm.buildCreateVlan({ id: 300, name: 'NET', description: 'PPPoE' });
        expect(r.ok).toBe(true);
        expect(r.commands).toEqual(['configure terminal', 'vlan 300', 'name NET', 'description PPPoE', 'exit', 'end']);
    });
    test('tanpa name/description', () => {
        expect(vm.buildCreateVlan({ id: 333 }).commands).toEqual(['configure terminal', 'vlan 333', 'exit', 'end']);
    });
    test('id reserved ditolak', () => expect(vm.buildCreateVlan({ id: 1 }).ok).toBe(false));
    test('nama injeksi ditolak', () => expect(vm.buildCreateVlan({ id: 300, name: 'a;b' }).ok).toBe(false));
});

describe('buildDeleteVlan', () => {
    test('script delete', () =>
        expect(vm.buildDeleteVlan({ id: 300 }).commands).toEqual(['configure terminal', 'no vlan 300', 'end']));
});

describe('buildTrunk', () => {
    test('add ke trunk', () => {
        const r = vm.buildTrunk({ port: 'gei_1/3/1', id: 300, action: 'add' });
        expect(r.commands).toEqual([
            'configure terminal',
            'interface gei_1/3/1',
            'switchport vlan 300 tag',
            'exit',
            'end'
        ]);
    });
    test('remove dari trunk', () => {
        const r = vm.buildTrunk({ port: 'gei_1/3/1', id: 300, action: 'remove' });
        expect(r.commands).toEqual([
            'configure terminal',
            'interface gei_1/3/1',
            'no switchport vlan 300 tag',
            'exit',
            'end'
        ]);
    });
    test('aksi tak valid ditolak', () =>
        expect(vm.buildTrunk({ port: 'gei_1/3/1', id: 300, action: 'flush' }).ok).toBe(false));
    test('port tak valid ditolak', () => expect(vm.buildTrunk({ port: 'bad', id: 300, action: 'add' }).ok).toBe(false));
});
