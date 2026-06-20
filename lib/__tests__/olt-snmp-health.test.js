/**
 * Header Doc
 * Purpose: Unit test decoder SNMP kesehatan OLT (olt-snmp-health) terhadap NILAI ASLI OLT VANS
 *          C320 V2.1.0 (ditangkap walk SNMP read-only). Murni, tanpa I/O SNMP.
 * Caller: Jest.
 * Deps: lib/olt-snmp-health (decoder di-export).
 * MainFuncs: -
 * SideEffects: -
 */
'use strict';

const snmpHealth = require('../olt-snmp-health');
const { OID } = snmpHealth;

describe('decodeCards (SNMP)', () => {
    const realType = { '1.1.2': 'GTGHG', '1.1.3': 'SMXA', '1.1.4': '' };
    const status = { '1.1.2': 1, '1.1.3': 1, '1.1.4': 2 };
    const cpu = { '1.1.2': 22, '1.1.3': 7, '1.1.4': 0 };
    const memPct = { '1.1.2': 39, '1.1.3': 26, '1.1.4': 0 };
    const phyMem = { '1.1.2': 512, '1.1.3': 2048, '1.1.4': 0 };
    const port = { '1.1.2': 16, '1.1.3': 3, '1.1.4': 3 };
    const cards = snmpHealth.decodeCards({ realType, port, cpu, memPct, status, phyMem });

    test('3 kartu, status terbaca', () => {
        expect(cards).toHaveLength(3);
        expect(cards[0]).toMatchObject({ slot: 2, realType: 'GTGHG', cpu5m: 22, memPct: 39, phyMemMb: 512, ok: true });
        expect(cards[2]).toMatchObject({ slot: 4, status: 'OFFLINE', ok: false });
    });
});

describe('decodeFans (SNMP)', () => {
    test('RPM per unit', () => {
        const fans = snmpHealth.decodeFans({ '1.1.1': 3438, '1.1.2': 3372 });
        expect(fans).toEqual([
            { id: 1, rpm: 3438 },
            { id: 2, rpm: 3372 }
        ]);
    });
});

describe('decodeTemperature (SNMP)', () => {
    test('suhu + ambang dari scalar', () => {
        const scalars = {
            [OID.tempCur]: 32,
            [OID.tempHigh]: 65,
            [OID.tempCrit]: 160,
            [OID.tempLow]: -20
        };
        expect(snmpHealth.decodeTemperature(scalars)).toEqual({
            envTempC: 32,
            highTempC: 65,
            criticalTempC: 160,
            lowTempC: -20
        });
    });
});

describe('decodeIdentity (SNMP)', () => {
    test('versi dari sysDescr + uptime dari timeticks', () => {
        const ticks = (1 * 86400 + 2 * 3600 + 3 * 60) * 100; // 1 hari 2 jam 3 menit
        const id = snmpHealth.decodeIdentity({
            [OID.sysDescr]: 'C320 Version V2.1.0 Software, Copyright (c) by ZTE',
            [OID.sysName]: 'ZXAN',
            [OID.sysLocation]: 'Jember',
            [OID.sysContact]: 'WA +62',
            [OID.sysUptime]: ticks
        });
        expect(id).toMatchObject({
            version: 'V2.1.0',
            name: 'ZXAN',
            location: 'Jember',
            uptime: '1 hari, 2 jam, 3 menit'
        });
    });
});

describe('decodePowerEnv (EMU)', () => {
    test('VANS: 8 kanal belum dikabeli (255) → 0 alarm aktif', () => {
        const names = { 1: '2nd-Power-Monitor', 6: 'RECTIFIER-FAIL' };
        const state = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0 };
        const map = { 1: 255, 2: 255, 3: 255, 4: 255, 5: 255, 6: 255, 7: 255, 8: 255 };
        const pe = snmpHealth.decodePowerEnv(names, state, map);
        expect(pe.catalog).toBe(2);
        expect(pe.channels).toHaveLength(8);
        expect(pe.mappedCount).toBe(0);
        expect(pe.activeAlarms).toEqual([]);
    });

    test('kanal terpetakan + aktif → alarm bernama', () => {
        const names = { 6: 'RECTIFIER-FAIL' };
        const state = { 1: 1 }; // aktif
        const map = { 1: 6 }; // terpetakan ke katalog #6
        const pe = snmpHealth.decodePowerEnv(names, state, map);
        expect(pe.activeAlarms).toEqual(['RECTIFIER-FAIL']);
        expect(pe.channels[0]).toMatchObject({ channel: 1, label: 'RECTIFIER-FAIL', mapped: true, active: true });
    });
});
