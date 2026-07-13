/**
 * Header Doc
 * Purpose: Uji resolusi IP pelanggan -> jalur upstream 3 LAPIS: (1) OVERRIDE RAF-STEER-* menang,
 *          (2) PROFIL live freedns(mni)/lokaldns(gmdp) sebagai sumber kebenaran (entri disabled
 *          diabaikan, menimpa peta pool), (3) peta pool sbg jaring pengaman; FAIL-CLOSED (null)
 *          saat router tak terbaca; + cache; + computeSteeringDrift (peta pool vs profil live).
 * Caller: Jest.
 * Deps: mock lib/mikrotik (getSteeringAddressLists).
 * MainFuncs: -
 * SideEffects: reset cache in-memori per test.
 */
'use strict';

jest.mock('../mikrotik', () => ({ getSteeringAddressLists: jest.fn() }));

const { getSteeringAddressLists } = require('../mikrotik');
const { resolveCustomerPath, getSteeringSnapshot, computeSteeringDrift, _resetCacheForTest } = require('../customer-path-resolver');

const okData = (entries) => ({ ok: true, data: entries });

beforeEach(() => {
    jest.clearAllMocks();
    _resetCacheForTest();
    // Peta pool (jaring pengaman) dari upstream-path-resolver DEFAULT_PATH_POOLS: 61/62/71=mni, 70=gmdp.
    global.config = { upstreamMonitor: {} };
});

describe('resolveCustomerPath — 3 lapis', () => {
    test('router tak terbaca (ok:false) → null (fail-closed, jangan asal "normal")', async () => {
        getSteeringAddressLists.mockResolvedValue({ ok: false, message: 'timeout' });
        expect(await resolveCustomerPath('192.168.70.5')).toBeNull();
    });

    test('router throw → null', async () => {
        getSteeringAddressLists.mockRejectedValue(new Error('boom'));
        expect(await resolveCustomerPath('192.168.70.5')).toBeNull();
    });

    test('SEMUA list kosong → jaring pengaman peta pool (61/62/71=mni, 70=gmdp)', async () => {
        getSteeringAddressLists.mockResolvedValue(okData([]));
        expect(await resolveCustomerPath('192.168.70.5')).toBe('gmdp');
        expect(await resolveCustomerPath('192.168.61.5')).toBe('mni');
        expect(await resolveCustomerPath('192.168.62.9')).toBe('mni');
        expect(await resolveCustomerPath('192.168.71.3')).toBe('mni');
    });

    test('LAPIS 2 — PROFIL freedns → mni, dibuktikan di subnet yg TAK ada di peta pool', async () => {
        // 10.10.99.0/24 tak ada di DEFAULT_PATH_POOLS → kalau hasil mni, itu dari profil live, bukan pool.
        getSteeringAddressLists.mockResolvedValue(okData([{ list: 'freedns', address: '10.10.99.0/24' }]));
        expect(await resolveCustomerPath('10.10.99.7')).toBe('mni');
    });

    test('LAPIS 2 — PROFIL lokaldns MENIMPA peta pool: 61 (pool=mni) tapi di lokaldns → gmdp', async () => {
        getSteeringAddressLists.mockResolvedValue(okData([{ list: 'lokaldns', address: '192.168.61.0/24' }]));
        expect(await resolveCustomerPath('192.168.61.5')).toBe('gmdp');
    });

    test('entri PROFIL disabled DIABAIKAN → jatuh ke jaring pengaman peta pool', async () => {
        // lokaldns 61 tapi DISABLED → diabaikan → 61 lewat peta pool → mni (bukan gmdp).
        getSteeringAddressLists.mockResolvedValue(okData([{ list: 'lokaldns', address: '192.168.61.0/24', disabled: true }]));
        expect(await resolveCustomerPath('192.168.61.5')).toBe('mni');
    });

    test('freedns menang atas lokaldns bila keduanya cocok (urutan mangle router)', async () => {
        getSteeringAddressLists.mockResolvedValue(okData([
            { list: 'lokaldns', address: '192.168.90.0/24' },
            { list: 'freedns', address: '192.168.90.0/24' },
        ]));
        expect(await resolveCustomerPath('192.168.90.5')).toBe('mni');
    });

    test('LAPIS 1 — OVERRIDE RAF-STEER MENANG atas profil: IP di freedns TAPI juga RAF-STEER-SF → sf', async () => {
        getSteeringAddressLists.mockResolvedValue(okData([
            { list: 'freedns', address: '192.168.61.0/24' },
            { list: 'RAF-STEER-SF', address: '192.168.61.5' },
        ]));
        expect(await resolveCustomerPath('192.168.61.5')).toBe('sf');
    });

    test('override RAF-STEER-IH (CIDR) → ih', async () => {
        getSteeringAddressLists.mockResolvedValue(okData([{ list: 'RAF-STEER-IH', address: '192.168.71.0/24' }]));
        expect(await resolveCustomerPath('192.168.71.88')).toBe('ih');
    });

    test('IP kosong / invalid → null (tak baca router)', async () => {
        expect(await resolveCustomerPath('')).toBeNull();
        expect(await resolveCustomerPath('bukan-ip')).toBeNull();
        expect(getSteeringAddressLists).not.toHaveBeenCalled();
    });

    test('cache: dua panggilan dalam TTL hanya 1x baca router', async () => {
        getSteeringAddressLists.mockResolvedValue(okData([{ list: 'freedns', address: '192.168.61.0/24' }]));
        await resolveCustomerPath('192.168.61.5');
        await resolveCustomerPath('192.168.70.9');
        expect(getSteeringAddressLists).toHaveBeenCalledTimes(1);
    });
});

describe('getSteeringSnapshot', () => {
    test('memisahkan override & profil, mengabaikan disabled', async () => {
        getSteeringAddressLists.mockResolvedValue(okData([
            { list: 'freedns', address: '192.168.61.0/24' },
            { list: 'freedns', address: '192.168.70.0/24', disabled: true },
            { list: 'lokaldns', address: '192.168.70.0/24' },
            { list: 'RAF-STEER-MNI', address: '192.168.61.5' },
        ]));
        const snap = await getSteeringSnapshot();
        expect(snap.profiles.freedns).toEqual(['192.168.61.0/24']); // yg disabled dibuang
        expect(snap.profiles.lokaldns).toEqual(['192.168.70.0/24']);
        expect(snap.overrides).toEqual([{ path: 'mni', address: '192.168.61.5' }]);
    });
});

describe('computeSteeringDrift', () => {
    test('profil live selaras dgn peta pool → drift kosong', () => {
        const snapshot = { profiles: { freedns: ['192.168.61.0/24', '192.168.62.0/24', '192.168.71.0/24'], lokaldns: ['192.168.70.0/24'] } };
        expect(computeSteeringDrift(snapshot, {})).toEqual([]);
    });

    test('profil live BEDA dari peta pool (70 pindah ke freedns/mni) → drift terdeteksi', () => {
        const snapshot = { profiles: { freedns: ['192.168.70.0/24'], lokaldns: [] } };
        const drift = computeSteeringDrift(snapshot, {});
        expect(drift).toContainEqual({ cidr: '192.168.70.0/24', poolPath: 'gmdp', livePath: 'mni' });
    });

    test('subnet peta pool yg tak ada di profil live → BUKAN drift (tak bisa dibandingkan)', () => {
        const snapshot = { profiles: { freedns: [], lokaldns: [] } };
        expect(computeSteeringDrift(snapshot, {})).toEqual([]);
    });
});
