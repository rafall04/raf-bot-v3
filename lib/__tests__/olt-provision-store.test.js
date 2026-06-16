/**
 * Header Doc
 * Purpose: Unit test PURE untuk store profil tipe modem — bentuk profil bawaan VANS (3 tipe
 *          jelas + vendorMatch), render template tanpa placeholder hilang, dan sanitasi
 *          vendorMatch. TIDAK menyentuh file store (hanya __test exports + render murni).
 * Caller: Jest.
 * Deps: lib/olt-provision-store (__test), lib/olt-zte-provision (renderScript/validateVars).
 * SideEffects: tidak ada (tak baca/tulis database/olt_onu_types.json).
 */

'use strict';

const store = require('../olt-provision-store');
const provision = require('../olt-zte-provision');
const { DEFAULT_ONU_TYPES, sanitizeVendorMatch } = store.__test;

// Field inti yang diisi form registrasi (bukan default profil). Di VANS tak ada field
// nama/deskripsi terpisah — nama ONU = username PPPoE (template pakai {{pppoeUser}}).
const CORE = { ponPort: '1/2/1', onuId: '16', sn: 'ZTEGD0337233', pppoeUser: 'tester@vans', pppoePassword: 'rahasia' };

describe('olt-provision-store — profil bawaan VANS', () => {
    test('ada tepat 3 profil jelas dengan vendorMatch (anti salah-klik teknisi)', () => {
        expect(DEFAULT_ONU_TYPES).toHaveLength(3);
        const byId = Object.fromEntries(DEFAULT_ONU_TYPES.map((t) => [t.id, t]));
        expect(byId['vans-zte-router'].vendorMatch).toEqual(['zte']);
        expect(byId['vans-clone-router'].vendorMatch).toEqual(['clone']);
        expect(byId['vans-bridge'].vendorMatch).toEqual(['huawei']);
        DEFAULT_ONU_TYPES.forEach((t) => {
            expect(t.builtin).toBe(true);
            expect(t.name).toBeTruthy();
            expect(t.scriptTemplate).toContain('{{ponPort}}');
        });
    });

    test('setiap template default render bersih (tak ada placeholder hilang) & lolos validasi', () => {
        for (const t of DEFAULT_ONU_TYPES) {
            const merged = { ...t.vars, ...CORE };
            const v = provision.validateVars(merged);
            expect(v.ok).toBe(true);
            const { missing } = provision.renderScript(t.scriptTemplate, v.values);
            expect(missing).toEqual([]);
        }
    });

    test('ZTE = router penuh + ACS (tr069-mgmt); clone = router tanpa tr069-mgmt; bridge = transport saja', () => {
        const render = (id) => {
            const t = DEFAULT_ONU_TYPES.find((x) => x.id === id);
            return provision.renderScript(t.scriptTemplate, provision.validateVars({ ...t.vars, ...CORE }).values).script;
        };
        const zte = render('vans-zte-router');
        const clone = render('vans-clone-router');
        const bridge = render('vans-bridge');

        // Nama ONU = username PPPoE (tak ada field nama terpisah).
        expect(zte).toMatch(/^name tester@vans$/m);
        // ZTE asli: WAN PPPoE + SSID + TR069 lengkap (1 langkah → inform).
        expect(zte).toMatch(/wan-ip 1 mode pppoe/);
        expect(zte).toMatch(/ssid ctrl wifi_0\/2 name VANS-45NET/);
        expect(zte).toMatch(/tr069-mgmt 1 acs http:\/\/172\.17\.11\.2:7547/);
        expect(zte).toMatch(/service TR069 gemport 1 vlan 100/);

        // Clone: WAN + SSID, TAPI tanpa tr069-mgmt (ACS di modem).
        expect(clone).toMatch(/wan-ip 1 mode pppoe/);
        expect(clone).toMatch(/ssid ctrl wifi_0\/2/);
        expect(clone).not.toMatch(/tr069-mgmt/);

        // Bridge/Huawei: transport saja — tanpa wan-ip/ssid/tr069.
        expect(bridge).not.toMatch(/wan-ip/);
        expect(bridge).not.toMatch(/ssid/);
        expect(bridge).not.toMatch(/tr069/);
        expect(bridge).toMatch(/service INET gemport 1 vlan 300/);
    });
});

describe('olt-provision-store — sanitizeVendorMatch', () => {
    test('hanya menyimpan tier yang dikenal, unik, lowercase', () => {
        expect(sanitizeVendorMatch(['zte', 'ZTE', 'clone', 'ngawur', 5, null])).toEqual(['zte', 'clone']);
        expect(sanitizeVendorMatch('bukan-array')).toEqual([]);
        expect(sanitizeVendorMatch(undefined)).toEqual([]);
    });
});
