/**
 * Header Doc
 * Purpose: Test psb-genieacs-service — kandidat modem wizard PSB 3 jalur (registrasi baru +
 *          factory-reset `_lastBootstrap` + modem polos `tes@hw` online), fallback query `$or`
 *          utk ACS tua, dan pencarian bebas sadar-bentuk-stiker (insiden Dander 2026-08-07:
 *          modem BEKAS tak terdeteksi padahal SN stiker diketik LENGKAP).
 * Caller: Jest.
 * Deps: ../psb-genieacs-service dengan ../genieacs di-mock (tak menembak ACS nyata).
 * SideEffects: tidak ada.
 */
"use strict";

jest.mock('../genieacs', () => ({
    queryDevices: jest.fn(),
    getPsbDevice: jest.fn(),
    updatePsbDeviceConfig: jest.fn(),
    getGenieAcsDiagnostics: jest.fn(),
    resolvePathTemplates: jest.fn(() => ['PPPUsername']),
    getParameterPaths: jest.fn(() => []),
    getNestedValue: (obj, path) => (obj ? obj[path] : undefined),
    unwrapValue: (v) => v,
    extractPppoeUsername: (device) => (device && device.PPPUsername) || null,
    // Bentuk plural meniru pemindai lintas-index: username utama + daftar tambahan (index lain).
    extractPppoeUsernames: (device) => {
        const all = [];
        if (device && device.PPPUsername) all.push(device.PPPUsername);
        if (device && Array.isArray(device.PPPUsernamesExtra)) all.push(...device.PPPUsernamesExtra);
        return all;
    },
    extractSerialNumber: (device) => (device && device._serialNumber) || null,
    extractDeviceModel: () => 'HG8145V5',
    extractDeviceManufacturer: () => 'Huawei',
}));

const { queryDevices } = require('../genieacs');
const { findRecentPsbCandidates, findPsbCandidatesByHint } = require('../psb-genieacs-service');

const NOW = Date.parse('2026-08-07T10:00:00.000Z');
const FRESH = '2026-08-07T09:30:00.000Z'; // 30 mnt lalu (dalam window 120)
const FRESH2 = '2026-08-07T09:50:00.000Z'; // 10 mnt lalu
const ANCIENT = '2024-03-01T00:00:00.000Z';

function rawDevice({ id, sn, pppoe, pppoeExtra, registered, bootstrap, lastInform }) {
    return {
        _id: id,
        _serialNumber: sn,
        PPPUsername: pppoe,
        PPPUsernamesExtra: pppoeExtra,
        _registered: registered,
        _lastBootstrap: bootstrap,
        _lastInform: lastInform,
    };
}

afterEach(() => jest.clearAllMocks());

describe('findRecentPsbCandidates — 3 jalur deteksi', () => {
    test('gabung registered + reset(bootstrap) + default-online; tag & urutan stempel terbaru', async () => {
        queryDevices.mockImplementation(async ({ operation }) => {
            if (operation === 'psb.recentCandidates') {
                return {
                    ok: true,
                    data: [
                        rawDevice({ id: 'dev-new', sn: '48575443AAAA0001', pppoe: 'tes@hw', registered: FRESH, lastInform: FRESH2 }),
                        // Modem BEKAS di-reset: _registered KUNO, _lastBootstrap segar — dulu tak
                        // pernah muncul kecuali record GenieACS dihapus manual (insiden 2026-08-07).
                        rawDevice({ id: 'dev-reset', sn: '48575443BBBB0002', pppoe: 'tes@hw', registered: ANCIENT, bootstrap: FRESH2, lastInform: FRESH2 }),
                    ],
                };
            }
            if (operation === 'psb.defaultOnlineCandidates') {
                return {
                    ok: true,
                    data: [
                        // Modem bekas yang PPPoE-nya di-set manual ke tes@hw (tanpa factory reset).
                        rawDevice({ id: 'dev-polos-online', sn: '48575443CCCC0003', pppoe: 'tes@hw', registered: ANCIENT, lastInform: FRESH }),
                        // Pelanggan aktif yang kebetulan inform — BUKAN kandidat (pppoe bukan bawaan).
                        rawDevice({ id: 'dev-pelanggan', sn: '48575443DDDD0004', pppoe: 'budi@rafcybernet', registered: ANCIENT, lastInform: FRESH }),
                        // Duplikat dev-new (juga tes@hw & inform) — dedup: tag 'registered' menang.
                        rawDevice({ id: 'dev-new', sn: '48575443AAAA0001', pppoe: 'tes@hw', registered: FRESH, lastInform: FRESH2 }),
                    ],
                };
            }
            throw new Error(`operation tak terduga: ${operation}`);
        });

        const res = await findRecentPsbCandidates({ windowMinutes: 120, limit: 10, nowMs: NOW });
        expect(res.ok).toBe(true);
        const byId = Object.fromEntries(res.data.map((c) => [c.deviceId, c]));

        expect(byId['dev-new'].detectedVia).toBe('registered');
        expect(byId['dev-reset'].detectedVia).toBe('reset');
        expect(byId['dev-reset'].detectedAtIso).toBe(FRESH2);
        expect(byId['dev-polos-online'].detectedVia).toBe('default-online');
        expect(byId['dev-pelanggan']).toBeUndefined();
        expect(res.data).toHaveLength(3);
        // Urut stempel deteksi terbaru dulu: FRESH2 (dev-new via registered? registered=FRESH 30mnt)…
        // dev-reset(FRESH2, 10mnt) & dev-new(FRESH, 30mnt) & dev-polos-online(FRESH, 30mnt).
        expect(res.data[0].deviceId).toBe('dev-reset');

        // Query utama memakai $or registered/bootstrap.
        const firstCall = queryDevices.mock.calls.find(([args]) => args.operation === 'psb.recentCandidates')[0];
        expect(firstCall.query.$or).toEqual([
            { _registered: { $gte: new Date(NOW - 120 * 60 * 1000).toISOString() } },
            { _lastBootstrap: { $gte: new Date(NOW - 120 * 60 * 1000).toISOString() } },
        ]);
        expect(firstCall.projection).toEqual(expect.arrayContaining(['_lastBootstrap']));
    });

    test('ACS tua menolak $or → fallback query _registered lama (wizard tak boleh mati)', async () => {
        queryDevices.mockImplementation(async ({ operation }) => {
            if (operation === 'psb.recentCandidates') return { ok: false, message: 'Invalid query' };
            if (operation === 'psb.recentCandidates.legacy') {
                return { ok: true, data: [rawDevice({ id: 'dev-new', sn: '48575443AAAA0001', pppoe: 'tes@hw', registered: FRESH, lastInform: FRESH })] };
            }
            if (operation === 'psb.defaultOnlineCandidates') return { ok: true, data: [] };
            throw new Error(`operation tak terduga: ${operation}`);
        });

        const res = await findRecentPsbCandidates({ windowMinutes: 120, limit: 10, nowMs: NOW });
        expect(res.ok).toBe(true);
        expect(res.data.map((c) => c.deviceId)).toEqual(['dev-new']);
        const legacyCall = queryDevices.mock.calls.find(([args]) => args.operation === 'psb.recentCandidates.legacy')[0];
        expect(legacyCall.query).toEqual({ _registered: { $gte: new Date(NOW - 120 * 60 * 1000).toISOString() } });
    });

    test('jalur default-online GAGAL → kandidat jalur utama tetap kembali (best-effort)', async () => {
        queryDevices.mockImplementation(async ({ operation }) => {
            if (operation === 'psb.recentCandidates') {
                return { ok: true, data: [rawDevice({ id: 'dev-new', sn: '48575443AAAA0001', pppoe: 'tes@hw', registered: FRESH, lastInform: FRESH })] };
            }
            if (operation === 'psb.defaultOnlineCandidates') return { ok: false, message: 'timeout' };
            throw new Error(`operation tak terduga: ${operation}`);
        });

        const res = await findRecentPsbCandidates({ windowMinutes: 120, limit: 10, nowMs: NOW });
        expect(res.ok).toBe(true);
        expect(res.data.map((c) => c.deviceId)).toEqual(['dev-new']);
    });
});

describe('findPsbCandidatesByHint — sadar bentuk stiker', () => {
    function mockFullListing(devices) {
        queryDevices.mockImplementation(async ({ operation }) => {
            if (operation === 'psb.searchByHint') return { ok: true, data: devices };
            throw new Error(`operation tak terduga: ${operation}`);
        });
    }

    test('SN LENGKAP dari stiker (HWTC…) menemukan modem bekas ber-SN heksa ACS', async () => {
        mockFullListing([
            rawDevice({ id: '00259E-HG8145V5-4857544349B734AD', sn: '4857544349B734AD', pppoe: 'wimpi-krajan@rafcybernet', registered: ANCIENT, lastInform: ANCIENT }),
            rawDevice({ id: 'dev-lain', sn: '48575443EEEE0005', pppoe: 'tes@hw', registered: FRESH, lastInform: FRESH }),
        ]);

        const res = await findPsbCandidatesByHint({ hint: 'HWTC49B734AD' });
        expect(res.ok).toBe(true);
        expect(res.data.map((c) => c.serialNumber)).toEqual(['4857544349B734AD']);
        expect(res.matchedCount).toBe(1);
    });

    test('nama pemilik lama & potongan SN tetap jalan seperti sebelumnya', async () => {
        mockFullListing([
            rawDevice({ id: 'dev-wimpi', sn: '4857544349B734AD', pppoe: 'wimpi-krajan@rafcybernet', registered: ANCIENT, lastInform: ANCIENT }),
        ]);

        expect((await findPsbCandidatesByHint({ hint: 'wimpi' })).matchedCount).toBe(1);
        expect((await findPsbCandidatesByHint({ hint: '34AD' })).matchedCount).toBe(1);
        expect((await findPsbCandidatesByHint({ hint: 'sukirman' })).matchedCount).toBe(0);
    });

    test('PPPoE pelanggan di index NON-1 (WAN TR-069 terpisah) tetap ketemu — akar "by pppoe mustahil"', async () => {
        mockFullListing([
            rawDevice({ id: 'dev-multi-wan', sn: '4857544349B734AD', pppoe: null, pppoeExtra: ['wimpi-krajan@rafcybernet'], registered: ANCIENT, lastInform: FRESH }),
        ]);

        const res = await findPsbCandidatesByHint({ hint: 'wimpi-krajan' });
        expect(res.ok).toBe(true);
        expect(res.matchedCount).toBe(1);
        expect(res.data[0].deviceId).toBe('dev-multi-wan');
    });
});

describe('default-online melihat semua username (tes@hw di index non-1)', () => {
    test('modem polos yang tes@hw-nya hanya terbaca lewat pemindai tetap jadi kandidat', async () => {
        queryDevices.mockImplementation(async ({ operation }) => {
            if (operation === 'psb.recentCandidates') return { ok: true, data: [] };
            if (operation === 'psb.defaultOnlineCandidates') {
                return {
                    ok: true,
                    data: [
                        rawDevice({ id: 'dev-polos-idx2', sn: '48575443CCCC0003', pppoe: null, pppoeExtra: ['tes@hw'], registered: ANCIENT, lastInform: FRESH }),
                    ],
                };
            }
            throw new Error(`operation tak terduga: ${operation}`);
        });

        const res = await findRecentPsbCandidates({ windowMinutes: 120, limit: 10, nowMs: NOW });
        expect(res.ok).toBe(true);
        expect(res.data.map((c) => c.deviceId)).toEqual(['dev-polos-idx2']);
        expect(res.data[0].detectedVia).toBe('default-online');
    });
});
