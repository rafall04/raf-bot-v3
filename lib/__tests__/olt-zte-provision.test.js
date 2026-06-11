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

const { parseUncfgOutput, parseOnuOccupancy, parseOnuDetail, parsePonPower, suggestOnuId, renderScript, validateVars, listPlaceholders } = provision.__test;

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
