/**
 * Header Doc
 * Purpose: Unit test service provisioning ZTE — parser output CLI (uncfg, okupansi,
 *          detail-info, pon power), saran ONU ID, render template, dan validasi variabel
 *          (anti injeksi CLI). Operasi SSH tidak disentuh (parser murni + guard pra-SSH).
 * Caller: Jest (npm test).
 * Deps: lib/olt-zte-provision.
 * MainFuncs: -
 * SideEffects: tidak ada.
 */

'use strict';

const provision = require('../olt-zte-provision');

const { parseUncfgOutput, parseOnuOccupancy, parseInterfaceName, parseOnuDetail, parsePonPower, parseCardPonPorts, parseOnuTypeNames, parseProfileNames, parseVlanSummary, suggestOnuId, renderScript, validateVars, listPlaceholders } = provision.__test;

describe('olt-zte-provision parsers', () => {
    test('parseUncfgOutput: tabel uncfg ZXAN', () => {
        const raw = [
            'OnuIndex                 Sn                  State',
            '---------------------------------------------------------------------',
            'gpon-onu_1/3/16:8        ZTEGCCA16805        unknown',
            'gpon-onu_1/2/1:1         ZTEGD5D42874        unknown',
        ].join('\n');
        expect(parseUncfgOutput(raw)).toEqual([
            { ponPort: '1/3/16', sn: 'ZTEGCCA16805', state: 'unknown' },
            { ponPort: '1/2/1', sn: 'ZTEGD5D42874', state: 'unknown' },
        ]);
    });

    test('parseUncfgOutput: tanpa ONU baru → kosong', () => {
        expect(parseUncfgOutput('No related information to show.')).toEqual([]);
        expect(parseUncfgOutput('')).toEqual([]);
    });

    test('parseOnuOccupancy: baris onu di running-config interface', () => {
        const raw = [
            'Building configuration...',
            'interface gpon-olt_1/3/16',
            '  onu 1 type ALL sn ZTEGC1111111',
            '  onu 2 type F609 sn ZTEGC2222222',
            '  onu 8 type ALL sn ZTEGCCA16805',
            '!',
            'end',
        ].join('\n');
        const used = parseOnuOccupancy(raw);
        expect(used).toHaveLength(3);
        expect(used.map((u) => u.onuId)).toEqual([1, 2, 8]);
        expect(used[1]).toEqual({ onuId: 2, type: 'F609', sn: 'ZTEGC2222222' });
    });

    test('parseInterfaceName: ambil nama ONU (=PPPoE) dari interface config', () => {
        const raw = [
            'Building configuration...',
            'interface gpon-onu_1/2/2:33',
            '  name home@kantor',
            '  tcont 1 name INET profile 1G',
            '  gemport 1 name INET tcont 1',
            '!',
        ].join('\n');
        expect(parseInterfaceName(raw)).toBe('home@kantor');
        expect(parseInterfaceName('interface gpon-onu_1/2/2:5\n  tcont 1 name INET profile 1G')).toBeNull();
        expect(parseInterfaceName('')).toBeNull();
    });

    test('suggestOnuId: ID kosong terendah; null bila penuh', () => {
        expect(suggestOnuId([1, 2, 3, 5])).toBe(4);
        expect(suggestOnuId([])).toBe(1);
        expect(suggestOnuId([2, 3])).toBe(1);
        const full = Array.from({ length: 128 }, (_v, i) => i + 1);
        expect(suggestOnuId(full)).toBeNull();
    });

    test('parseOnuDetail: field kunci detail-info', () => {
        const raw = [
            'ONU interface:        gpon-onu_1/3/16:8',
            'Name:                 NGJ-KAI-NGUJO-1/1',
            'Type:                 ALL',
            'State:                ready',
            'Configuration state:  active',
            'Phase state:          working',
            'Serial number:        ZTEGCCA16805',
            'ONU Distance:         1771m',
            'Online Duration:      0h 5m 12s',
        ].join('\n');
        const d = parseOnuDetail(raw);
        expect(d.phaseState).toBe('working');
        expect(d.serial).toBe('ZTEGCCA16805');
        expect(d.name).toBe('NGJ-KAI-NGUJO-1/1');
        expect(d.onlineDuration).toBe('0h 5m 12s');
    });

    test('parseOnuDetail: output kosong → null', () => {
        expect(parseOnuDetail('')).toBeNull();
        expect(parseOnuDetail('Tidak ada label dikenal')).toBeNull();
    });

    test('parsePonPower: nilai up/down + atenuasi', () => {
        const raw = [
            '           OLT                ONU            Attenuation',
            'up    Rx :-14.500(dbm)   Tx : 2.491(dbm)    16.991(db)',
            'down  Tx : 6.770(dbm)    Rx :-17.962(dbm)   24.732(db)',
        ].join('\n');
        const p = parsePonPower(raw);
        expect(p.up.oltRx).toBeCloseTo(-14.5);
        expect(p.up.onuTx).toBeCloseTo(2.491);
        expect(p.up.attenuation).toBeCloseTo(16.991);
        expect(p.down.onuRx).toBeCloseTo(-17.962);
        expect(p.down.attenuation).toBeCloseTo(24.732);
    });

    test('parsePonPower: ONU offline / output tak dikenal → null', () => {
        expect(parsePonPower('No related information to show.')).toBeNull();
    });

    // ── Fixture di bawah = output ASLI C320 V2.1.0 (capture live 172.17.1.2) ──

    test('parseOnuDetail: output asli C320 (label "Config state", name=pppoe)', () => {
        const raw = [
            'ONU interface:         gpon-onu_1/2/1:1',
            '  Name:                caper@suwito',
            '  Type:                F609',
            '  State:               ready',
            '  Admin state:         enable',
            '  Phase state:         working',
            '  Config state:        success',
            '  Authentication mode: sn',
            '  Serial number:       ZTEGD5D42874',
            '  ONU Distance:        6600m',
            '  Online Duration:     39h 37m 43s',
        ].join('\n');
        const d = parseOnuDetail(raw);
        expect(d.name).toBe('caper@suwito');
        expect(d.configState).toBe('success');
        expect(d.adminState).toBe('enable');
        expect(d.phaseState).toBe('working');
        expect(d.distance).toBe('6600m');
    });

    test('parsePonPower: format asli C320 ("Tx:3.097" tanpa spasi, "(dB)" kapital)', () => {
        const raw = [
            '           OLT                  ONU              Attenuation',
            '--------------------------------------------------------------------------',
            ' up      Rx :-27.785(dbm)      Tx:3.097(dbm)        30.882(dB)     ',
            ' ',
            ' down    Tx :6.949(dbm)        Rx:-24.814(dbm)      31.763(dB)     ',
        ].join('\n');
        const p = parsePonPower(raw);
        expect(p.up.oltRx).toBeCloseTo(-27.785);
        expect(p.up.onuTx).toBeCloseTo(3.097);
        expect(p.down.onuRx).toBeCloseTo(-24.814);
        expect(p.down.attenuation).toBeCloseTo(31.763);
    });

    test('parseCardPonPorts: output asli show card — hanya kartu GPON (GTxx)', () => {
        const raw = [
            'Rack Shelf Slot CfgType RealType Port  HardVer SoftVer         Status',
            '-------------------------------------------------------------------------------',
            '1    1     2    GTGH    GTGHG    16    V1.0.0  V2.1.0          INSERVICE',
            '1    1     3    SMXA    SMXA     3     V1.0.0  V2.1.0          INSERVICE',
            '1    1     4    SMXA             3                             OFFLINE',
        ].join('\n');
        const cards = parseCardPonPorts(raw);
        expect(cards).toHaveLength(1); // SMXA (uplink) tidak ikut
        expect(cards[0].slotPrefix).toBe('1/2');
        expect(cards[0].ports).toBe(16);
        expect(cards[0].ponPorts[0]).toBe('1/2/1');
        expect(cards[0].ponPorts[15]).toBe('1/2/16');
    });

    test('parseOnuTypeNames: blok show onu-type gpon', () => {
        const raw = [
            'ONU type name:          CM',
            'PON type:               gpon',
            'Description:            4eth,2pots,4wifi',
            'Max T-CONT:             40',
            '',
            'ONU type name:          ALL',
            'PON type:               gpon',
            'Description:            ',
            'Max T-CONT:             255',
        ].join('\n');
        const types = parseOnuTypeNames(raw);
        expect(types.map((t) => t.name)).toEqual(['CM', 'ALL']);
        expect(types[0].description).toBe('4eth,2pots,4wifi');
    });

    test('parseProfileNames: tcont & traffic ("Profile name :INET")', () => {
        const raw = [
            'Profile name :default  ',
            ' Type           FBW(kbps)   ABW(kbps)',
            ' 1              10000       0',
            'Profile name :INET  ',
            'Profile name :1G  ',
            'Profile name :50M  ',
        ].join('\n');
        expect(parseProfileNames(raw)).toEqual(['default', 'INET', '1G', '50M']);
    });

    test('parseVlanSummary: daftar VLAN asli + ekspansi range kecil', () => {
        const raw = 'All created vlan num: 7   \nDetails are following:\n    1,10,300,310,320,330,340 \n';
        expect(parseVlanSummary(raw)).toEqual(['1', '10', '300', '310', '320', '330', '340']);
        expect(parseVlanSummary('Details are following:\n 100-103,500')).toEqual(['100', '101', '102', '103', '500']);
    });
});

describe('renderScript & placeholders', () => {
    test('mengganti placeholder dan melaporkan yang hilang', () => {
        const tpl = 'onu {{onuId}} type {{onuType}} sn {{sn}}\nname {{name}}';
        const { script, missing } = renderScript(tpl, { onuId: '8', onuType: 'ALL', sn: 'ZTEGCCA16805' });
        expect(script).toContain('onu 8 type ALL sn ZTEGCCA16805');
        expect(missing).toEqual(['name']);
    });

    test('single-pass: nilai berisi {{...}} tidak dirender ulang', () => {
        const { script } = renderScript('name {{name}}', { name: '{{sn}}' });
        expect(script).toBe('name {{sn}}');
    });

    test('listPlaceholders: unik sesuai template', () => {
        expect(listPlaceholders('a {{x}} b {{y}} c {{x}}')).toEqual(['x', 'y']);
    });
});

describe('validateVars (anti injeksi CLI)', () => {
    test('menolak newline (injeksi perintah)', () => {
        const v = validateVars({ name: 'AMAN\nreboot' });
        expect(v.ok).toBe(false);
        expect(v.errors[0]).toMatch(/baris baru/);
    });

    test('menolak "?" (memicu help CLI ZXAN)', () => {
        const v = validateVars({ description: 'ODP?' });
        expect(v.ok).toBe(false);
    });

    test('menolak spasi pada identifier ZTE (name/pppoeUser)', () => {
        expect(validateVars({ name: 'ADA SPASI' }).ok).toBe(false);
        expect(validateVars({ pppoeUser: 'user satu' }).ok).toBe(false);
    });

    test('field angka di-clamp aturannya (onuId, VLAN)', () => {
        expect(validateVars({ onuId: '0' }).ok).toBe(false);
        expect(validateVars({ onuId: '129' }).ok).toBe(false);
        expect(validateVars({ pppoeVlan: '4095' }).ok).toBe(false);
        expect(validateVars({ onuId: '8', pppoeVlan: '3010' }).ok).toBe(true);
    });

    test('format ponPort & SN divalidasi ketat', () => {
        expect(validateVars({ ponPort: '1/3/16' }).ok).toBe(true);
        expect(validateVars({ ponPort: '1-3-16' }).ok).toBe(false);
        expect(validateVars({ sn: 'ZTEGCCA16805' }).ok).toBe(true);
        expect(validateVars({ sn: 'ZTEG CCA' }).ok).toBe(false);
    });

    test('nilai valid: name dengan garis miring & tanda hubung (konvensi lapangan)', () => {
        const v = validateVars({ name: 'NGJ-KAI-NGUJO-1/1', sn: 'zteGCca16805' });
        expect(v.ok).toBe(true);
        expect(v.values.name).toBe('NGJ-KAI-NGUJO-1/1');
    });
});

describe('guard pra-SSH (tidak ada koneksi yang dibuka)', () => {
    test('registerOnu menolak vars invalid sebelum menyentuh SSH', async () => {
        await expect(
            provision.registerOnu({ host: '127.0.0.1' }, 'onu {{onuId}}', { onuId: 'x?' })
        ).rejects.toThrow(/tidak valid/);
    });

    test('registerOnu menolak placeholder yang belum terisi', async () => {
        await expect(
            provision.registerOnu({ host: '127.0.0.1' }, 'onu {{onuId}} sn {{sn}}', { onuId: '8' })
        ).rejects.toThrow(/Placeholder/);
    });

    test('deleteOnu memvalidasi ponPort/onuId', async () => {
        await expect(provision.deleteOnu({ host: '127.0.0.1' }, 'salah', 8)).rejects.toThrow(/port PON/i);
        await expect(provision.deleteOnu({ host: '127.0.0.1' }, '1/3/16', 999)).rejects.toThrow(/1-128/);
    });

    test('getOnuStatus memvalidasi parameter', async () => {
        await expect(provision.getOnuStatus({ host: '127.0.0.1' }, 'x', 1)).rejects.toThrow(/port PON/i);
    });
});

describe('ACS / TR069 (retrofit)', () => {
    test('classifyVendorTier: hanya ZTE asli (ZTEG) yang oltPushable', () => {
        expect(provision.classifyVendorTier('ZTEGD5D42874')).toMatchObject({ tier: 'zte', oltPushable: true });
        ['RTEGCA985BEE', 'ZICG000111', 'ZXICFF2C0C28', 'CIOT9999'].forEach((sn) => {
            expect(provision.classifyVendorTier(sn)).toMatchObject({ tier: 'clone', oltPushable: false });
        });
        expect(provision.classifyVendorTier('HWTC1234ABCD')).toMatchObject({ tier: 'huawei', oltPushable: false });
        expect(provision.classifyVendorTier('FOOXYZ')).toMatchObject({ tier: 'unknown', oltPushable: false });
        expect(provision.classifyVendorTier('')).toMatchObject({ oltPushable: false });
    });

    test('vendorTierTable: tabel prefix→tier untuk auto-pilih profil di UI', () => {
        const table = provision.vendorTierTable();
        expect(Array.isArray(table)).toBe(true);
        const byPrefix = Object.fromEntries(table.map((t) => [t.prefix, t]));
        expect(byPrefix.ZTEG).toMatchObject({ tier: 'zte', oltPushable: true });
        expect(byPrefix.RTEG).toMatchObject({ tier: 'clone', oltPushable: false });
        expect(byPrefix.HWTC).toMatchObject({ tier: 'huawei', oltPushable: false });
        table.forEach((t) => expect(t).toEqual(expect.objectContaining({
            prefix: expect.any(String), vendor: expect.any(String), tier: expect.any(String), oltPushable: expect.any(Boolean),
        })));
    });

    test('render TR069 add-on: semua placeholder terisi & mengandung ACS + VLAN', () => {
        const vars = provision.buildTr069Vars('1/2/1', 1, { url: 'http://172.17.11.2:7547', user: 'acs', pass: 'acs123', mgmtVlan: 100 });
        const { script, missing } = provision.renderScript(provision.TR069_ADDON_TEMPLATE, vars);
        expect(missing).toHaveLength(0);
        expect(script).toContain('service-port 3 vport 1 user-vlan 100 vlan 100');
        expect(script).toContain('service TR069 gemport 1 vlan 100');
        expect(script).toContain('tr069-mgmt 1 acs http://172.17.11.2:7547 validate basic username acs password acs123');
        expect(script).toContain('tr069-mgmt 1 tag pri 0 vlan 100');
    });

    test('applyTr069Addon guard pra-SSH: param/setting invalid ditolak sebelum koneksi', async () => {
        const acs = { url: 'http://172.17.11.2:7547', user: 'acs', pass: 'acs123', mgmtVlan: 100 };
        await expect(provision.applyTr069Addon({ host: '127.0.0.1' }, 'salah', 1, acs)).rejects.toThrow(/port PON/i);
        await expect(provision.applyTr069Addon({ host: '127.0.0.1' }, '1/2/1', 999, acs)).rejects.toThrow(/1-128/);
        await expect(provision.applyTr069Addon({ host: '127.0.0.1' }, '1/2/1', 1, { url: '', user: '', pass: '' })).rejects.toThrow(/ACS/i);
    });

    test('removeTr069Addon memvalidasi ponPort/onuId', async () => {
        await expect(provision.removeTr069Addon({ host: '127.0.0.1' }, 'x', 1)).rejects.toThrow(/port PON/i);
        await expect(provision.removeTr069Addon({ host: '127.0.0.1' }, '1/2/1', 0)).rejects.toThrow(/1-128/);
    });
});
