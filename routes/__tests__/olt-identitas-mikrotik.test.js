/**
 * Header Doc
 * Purpose: Mengunci SUMBER IDENTITAS GANDA pada GET /api/olt/onus (#b284) — pelanggan yang
 *          PPPoE-nya ada di MikroTik tapi BELUM didaftarkan di bot harus tetap punya nama.
 * Caller: Jest
 * Deps: routes/olt.js dengan seluruh I/O di-mock (OLT, MikroTik, scraper, manager).
 * MainFuncs: —
 * SideEffects: server HTTP lokal ephemeral selama test.
 *
 * KENAPA ADA: nama PPPoE-nya SUDAH berhasil di-resolve dari MikroTik lalu DIBUANG kalau
 * pelanggannya tak terdaftar. ONU EPON tak membawa description/serial, jadi barisnya tampil
 * tanpa nama sama sekali dan teknisi tak bisa mengerjakannya. Terukur di produksi: 5 baris
 * di Dander + 1 di Tanjungharjo, tiga di antaranya redaman buruk (-26,2 · -28,54 · -26,58).
 */
'use strict';

const express = require('express');
const http = require('http');

const ONU_TERDAFTAR = { olt_id: 'olt1', olt_name: 'OLT A', olt_host: '10.0.0.1', olt_brand: 'hioso', slotId: '1', id: '1', macAddress: 'AA:BB:CC:11:00:01', rxPower: -21.5, status: 'Online', statusKnown: true };
const ONU_MIKROTIK  = { olt_id: 'olt1', olt_name: 'OLT A', olt_host: '10.0.0.1', olt_brand: 'hioso', slotId: '1', id: '2', macAddress: 'AA:BB:CC:22:00:11', rxPower: -28.54, status: 'Online', statusKnown: true };
const ONU_YATIM     = { olt_id: 'olt1', olt_name: 'OLT A', olt_host: '10.0.0.1', olt_brand: 'hioso', slotId: '1', id: '3', macAddress: 'DD:EE:FF:33:00:99', rxPower: -19.0, status: 'Online', statusKnown: true };

// caller_id MikroTik beda di oktet TERAKHIR — pencocokan EPON pakai 10 heksa pertama.
// !! JEBAKAN: karena hanya 10 heksa yang dipakai, MAC yang cuma beda di oktet terakhir
// BERTABRAKAN (AA:BB:CC:00:00:02 dan AA:BB:CC:00:00:12 sama-sama AABBCC0000). Fixture di
// sini sengaja dibuat beda di oktet ke-4 supaya mengujinya benar-benar terpisah.
const SESI = [
    { name: 'budi@rafnet', address: '10.1.1.5', caller_id: 'AA:BB:CC:11:00:02', uptime: '2w1d', service: 'pppoe', interface_name: 'pppoe-budi' },
    { name: 'gratis-mushola@rafnet', address: '10.1.1.9', caller_id: 'AA:BB:CC:22:00:12', uptime: '1h2m', service: 'pppoe', interface_name: 'pppoe-gratis' },
];

function pasangMock() {
    jest.doMock('../../lib/olt-optical-resolver', () => ({
        ambilDataOlt: jest.fn().mockResolvedValue({
            status: 'success', timestamp: 'x', onus: [ONU_TERDAFTAR, ONU_MIKROTIK, ONU_YATIM], oltResults: [], incompleteWalks: [],
        }),
        isRxPowerValid: () => true,
        getOltSnapshot: jest.fn(),
        resolveByCustomer: jest.fn(),
        buildOnuIndex: jest.fn(),
        matchOnu: jest.fn(),
        createOpticalResolver: jest.fn(),
    }));
    jest.doMock('../../lib/mikrotik', () => ({
        getActivePPPoEUsers: jest.fn().mockResolvedValue({ ok: true, data: SESI }),
    }));
    jest.doMock('../../lib/olt-manager', () => ({
        getOltGlobalConfig: () => ({ enabled: true }),
        getOltDevices: () => [{ id: 'olt1', name: 'OLT A', host: '10.0.0.1', brand: 'hioso' }],
        getOltDevice: () => null,
        getOltFromMac: () => null,
        updateMacCache: jest.fn(),
        saveMacCache: jest.fn(),
    }));
    jest.doMock('../../lib/olt-log-scraper', () => ({
        getOnuStatusMap: jest.fn().mockResolvedValue(new Map()),
        getEventByMAC: jest.fn(),
    }));
}

function panggilOnus() {
    const router = require('../olt');
    const app = express();
    app.use((req, _res, next) => { req.user = { id: 1, role: 'admin' }; next(); });
    app.use('/api/olt', router);
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            http.get({ host: '127.0.0.1', port: server.address().port, path: '/api/olt/onus' }, (res) => {
                let d = '';
                res.on('data', (c) => { d += c; });
                res.on('end', () => server.close(() => {
                    try { resolve(JSON.parse(d)); } catch (e) { reject(new Error(d.slice(0, 300))); }
                }));
            }).on('error', (e) => server.close(() => reject(e)));
        });
    });
}

describe('#b284 — identitas baris punya DUA sumber', () => {
    let body;

    beforeAll(async () => {
        jest.resetModules();
        pasangMock();
        global.users = [{ id: 7, name: 'Budi Santoso', pppoe_username: 'budi@rafnet', address: 'Dsn Krajan' }];
        body = await panggilOnus();
    });

    afterAll(() => {
        jest.dontMock('../../lib/olt-optical-resolver');
        jest.dontMock('../../lib/mikrotik');
        jest.dontMock('../../lib/olt-manager');
        jest.dontMock('../../lib/olt-log-scraper');
        jest.resetModules();
        delete global.users;
    });

    const baris = (onuId) => body.data.find((r) => r.onu_id === onuId);

    test('ketiga ONU dikirim ke halaman', () => {
        expect(body.status).toBe(200);
        expect(body.data).toHaveLength(3);
    });

    test('pelanggan terdaftar → identitas dari bot', () => {
        const r = baris('1');
        expect(r.identitas_sumber).toBe('bot');
        expect(r.matched).toBe(true);
        expect(r.customer_name).toBe('Budi Santoso');
        expect(r.pppoe_username).toBe('budi@rafnet');
    });

    test('!! ada di MikroTik tapi TIDAK terdaftar → nama PPPoE-nya TETAP dioper', () => {
        const r = baris('2');
        expect(r.matched).toBe(false);
        expect(r.identitas_sumber).toBe('mikrotik');
        // Inti perbaikannya: dulu ini null dan barisnya jadi anonim.
        expect(r.pppoe_username).toBe('gratis-mushola@rafnet');
        expect(r.customer_name).toBeNull();
    });

    test('konteks jaringan ikut dikirim supaya teknisi punya bahan kerja', () => {
        const r = baris('2');
        expect(r.mikrotik_ip).toBe('10.1.1.9');
        expect(r.mikrotik_uptime).toBe('1h2m');
        expect(r.mikrotik_interface).toBe('pppoe-gratis');
    });

    test('tanpa sesi PPPoE & tanpa pelanggan → jujur null, bukan mengarang', () => {
        const r = baris('3');
        expect(r.identitas_sumber).toBeNull();
        expect(r.pppoe_username).toBeNull();
        expect(r.mikrotik_ip).toBeNull();
    });

    test('baris bot TIDAK ikut membawa konteks MikroTik (bukan sumbernya)', () => {
        const r = baris('1');
        expect(r.mikrotik_ip).toBeNull();
        expect(r.mikrotik_uptime).toBeNull();
    });

    test('ringkasan identitas cocok dengan barisnya — layar & server tak boleh beda', () => {
        expect(body.identitas).toEqual({ bot: 1, mikrotik: 1, tanpa: 1 });
        expect(body.identitas.bot).toBe(body.data.filter((r) => r.identitas_sumber === 'bot').length);
        expect(body.matchedCount).toBe(1);
    });
});
