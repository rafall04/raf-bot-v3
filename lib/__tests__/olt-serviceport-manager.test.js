/**
 * Header Doc
 * Purpose: Unit test guard + generator + parser service-port OLT (olt-serviceport-manager)
 *          terhadap OUTPUT ASLI ONU VANS (gpon-onu_1/2/2:33 = home@kantor) + sintaks ZXAN.
 * Caller: Jest.
 * Deps: lib/olt-serviceport-manager.
 * MainFuncs: -
 * SideEffects: -
 */
'use strict';

const sp = require('../olt-serviceport-manager');

// Output ASLI `show running-config interface gpon-onu_1/2/2:33` (recon read-only VANS)
const FX_ONU = `Building configuration...
interface gpon-onu_1/2/2:33
  name home@kantor
  tcont 1 name INET profile 1G
  gemport 1 name INET tcont 1
  service-port 1 vport 1 user-vlan 300 vlan 300
  service-port 2 vport 1 user-vlan 310 vlan 310
  service-port 3 vport 1 user-vlan 100 vlan 100
!
end`;

describe('parseServicePorts', () => {
    const r = sp.parseServicePorts(FX_ONU);
    test('nama ONU', () => expect(r.name).toBe('home@kantor'));
    test('3 service-port terbaca', () => expect(r.servicePorts).toHaveLength(3));
    test('service-port 1 = INET vlan 300', () =>
        expect(r.servicePorts[0]).toEqual({ index: 1, vport: 1, userVlan: 300, svlan: 300 }));
    test('service-port 3 = mgmt vlan 100', () =>
        expect(r.servicePorts[2]).toEqual({ index: 3, vport: 1, userVlan: 100, svlan: 100 }));
});

describe('validateOnuInterface', () => {
    test('valid', () =>
        expect(sp.validateOnuInterface('gpon-onu_1/2/2:33')).toEqual({ ok: true, onu: 'gpon-onu_1/2/2:33' }));
    test.each(['gpon-onu_1/2/2', 'gpon-onu_1/2/2:33; reboot', 'gei_1/3/1', 'gpon-onu_1/2/2:33 extra', ''])(
        'tolak %s',
        (v) => expect(sp.validateOnuInterface(v).ok).toBe(false)
    );
});

describe('validasi range', () => {
    test('index 1–32', () => {
        expect(sp.validateIndex(1).ok).toBe(true);
        expect(sp.validateIndex(33).ok).toBe(false);
        expect(sp.validateIndex('x').ok).toBe(false);
    });
    test('vport 1–8', () => expect(sp.validateVport(9).ok).toBe(false));
    test('vlan 1–4094', () => {
        expect(sp.validateVlan(300).ok).toBe(true);
        expect(sp.validateVlan(4095).ok).toBe(false);
    });
});

describe('buildAddServicePort', () => {
    test('script add (sesuai CLI ZXAN)', () => {
        const r = sp.buildAddServicePort({ onu: 'gpon-onu_1/2/2:33', index: 4, vport: 1, userVlan: 320, svlan: 320 });
        expect(r.ok).toBe(true);
        expect(r.commands).toEqual([
            'configure terminal',
            'interface gpon-onu_1/2/2:33',
            'service-port 4 vport 1 user-vlan 320 vlan 320',
            'exit',
            'end'
        ]);
    });
    test('vport default 1 bila kosong', () => {
        const r = sp.buildAddServicePort({ onu: 'gpon-onu_1/2/2:33', index: 4, userVlan: 320, svlan: 320 });
        expect(r.commands[2]).toBe('service-port 4 vport 1 user-vlan 320 vlan 320');
    });
    test('onu injeksi ditolak', () =>
        expect(sp.buildAddServicePort({ onu: 'x; reboot', index: 4, userVlan: 320, svlan: 320 }).ok).toBe(false));
    test('vlan di luar range ditolak', () =>
        expect(sp.buildAddServicePort({ onu: 'gpon-onu_1/2/2:33', index: 4, userVlan: 9999, svlan: 320 }).ok).toBe(
            false
        ));
});

describe('buildDeleteServicePort', () => {
    test('script delete', () => {
        const r = sp.buildDeleteServicePort({ onu: 'gpon-onu_1/2/2:33', index: 3 });
        expect(r.commands).toEqual([
            'configure terminal',
            'interface gpon-onu_1/2/2:33',
            'no service-port 3',
            'exit',
            'end'
        ]);
    });
});
