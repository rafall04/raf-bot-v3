/**
 * Header Doc
 * Purpose: Test helper penyusun status modem infrastruktur (PPPoE + enrichment OLT).
 * Caller: jest.
 * Deps: ../infra-status.
 */
'use strict';

const { classifyInfraStatus, buildInfraRow } = require('../infra-status');

describe('infra-status', () => {
    describe('classifyInfraStatus', () => {
        test('pppoeOnline menang walau OLT lapor LOS/dying', () => {
            expect(classifyInfraStatus({ pppoeOnline: true, isLos: true }).key).toBe('online');
            expect(classifyInfraStatus({ pppoeOnline: true, isDyingGasp: true }).key).toBe('online');
        });

        test('offline → LOS > dying > offline generik', () => {
            expect(classifyInfraStatus({ pppoeOnline: false, isLos: true }).key).toBe('los');
            expect(classifyInfraStatus({ pppoeOnline: false, isDyingGasp: true }).key).toBe('dying');
            expect(classifyInfraStatus({ pppoeOnline: false }).key).toBe('offline');
            expect(classifyInfraStatus({}).key).toBe('offline');
        });
    });

    describe('buildInfraRow', () => {
        test('online: bawa IP, status online, tanpa OLT (in_olt false)', () => {
            const row = buildInfraRow(
                { id: 1, name: 'CCTV Pasar', pppoe_username: 'cctv@pasar', address: 'Pasar' },
                { pppoeOnline: true, ip: '10.0.0.5', onu: null }
            );
            expect(row).toMatchObject({
                user_id: 1,
                name: 'CCTV Pasar',
                pppoe_username: 'cctv@pasar',
                address: 'Pasar',
                pppoe_status: 'online',
                ip: '10.0.0.5',
                status_key: 'online',
                in_olt: false,
                rx_power: null
            });
        });

        test('offline + OLT LOS: status los, redaman & sebab dari ONU, ip null', () => {
            const row = buildInfraRow(
                { id: 2, name: 'CCTV Gerbang', pppoe_username: 'cctv@gerbang' },
                {
                    pppoeOnline: false,
                    ip: '1.2.3.4', // diabaikan karena offline
                    onu: { status: 'LOS', isLos: true, rxPower: '-30 dBm', ponName: 'PON1', olt_name: 'OLT-A', lastDownCause: 'LOS' }
                }
            );
            expect(row).toMatchObject({
                pppoe_status: 'offline',
                ip: null,
                status_key: 'los',
                in_olt: true,
                olt_status: 'LOS',
                rx_power: '-30 dBm',
                is_los: true,
                pon_name: 'PON1',
                olt_name: 'OLT-A',
                last_down_cause: 'LOS'
            });
        });

        test('offline tanpa OLT match: tetap muncul sebagai offline (kelengkapan terjaga)', () => {
            const row = buildInfraRow({ id: 3, name: 'CCTV Lapangan', pppoe_username: 'cctv@lapangan' }, { pppoeOnline: false, onu: null });
            expect(row.status_key).toBe('offline');
            expect(row.in_olt).toBe(false);
            expect(row.olt_status).toBeNull();
        });

        test('fallback alamat pakai field alamat; field aman saat user minim', () => {
            expect(buildInfraRow({ id: 4, alamat: 'Jl. X' }, {}).address).toBe('Jl. X');
            const bare = buildInfraRow({}, {});
            expect(bare).toMatchObject({ user_id: null, name: null, pppoe_username: null, status_key: 'offline', in_olt: false });
        });
    });
});
