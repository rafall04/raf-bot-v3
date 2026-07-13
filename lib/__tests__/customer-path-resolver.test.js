/**
 * Header Doc
 * Purpose: Uji resolusi IP pelanggan -> jalur upstream dari STEERING LIVE (address-list RAF-STEER-*):
 *          default 'gmdp' saat tak di-steer / list kosong, jalur sesuai list saat di-steer, dan
 *          FAIL-CLOSED (null) saat router tak terbaca. + cache (1x baca per TTL).
 * Caller: Jest.
 * Deps: mock lib/mikrotik (getSteeringAddressLists).
 * MainFuncs: -
 * SideEffects: reset cache in-memori per test.
 */
'use strict';

jest.mock('../mikrotik', () => ({ getSteeringAddressLists: jest.fn() }));

const { getSteeringAddressLists } = require('../mikrotik');
const { resolveCustomerPath, _resetCacheForTest } = require('../customer-path-resolver');

const okData = (entries) => ({ ok: true, data: entries });

beforeEach(() => {
    jest.clearAllMocks();
    _resetCacheForTest();
});

describe('resolveCustomerPath', () => {
    test('read gagal (router tak terbaca) → null (fail-closed, jangan asal "normal")', async () => {
        getSteeringAddressLists.mockResolvedValue({ ok: false, message: 'timeout' });
        expect(await resolveCustomerPath('192.168.70.5')).toBeNull();
    });

    test('read gagal via throw → null', async () => {
        getSteeringAddressLists.mockRejectedValue(new Error('boom'));
        expect(await resolveCustomerPath('192.168.70.5')).toBeNull();
    });

    test('list steering KOSONG (kondisi sekarang) → default gmdp (jalur utama)', async () => {
        getSteeringAddressLists.mockResolvedValue(okData([]));
        expect(await resolveCustomerPath('192.168.70.5')).toBe('gmdp');
    });

    test('IP di RAF-STEER-MNI → mni', async () => {
        getSteeringAddressLists.mockResolvedValue(okData([{ list: 'RAF-STEER-MNI', address: '192.168.61.5' }]));
        expect(await resolveCustomerPath('192.168.61.5')).toBe('mni');
    });

    test('IP di RAF-STEER-IH (CIDR) → ih; IP di RAF-STEER-SF → sf', async () => {
        getSteeringAddressLists.mockResolvedValue(okData([
            { list: 'RAF-STEER-IH', address: '192.168.71.0/24' },
            { list: 'RAF-STEER-SF', address: '192.168.62.9' }
        ]));
        expect(await resolveCustomerPath('192.168.71.88')).toBe('ih');
        expect(await resolveCustomerPath('192.168.62.9')).toBe('sf');
    });

    test('IP tak masuk list steering mana pun (ada isi, bukan IP ini) → gmdp', async () => {
        getSteeringAddressLists.mockResolvedValue(okData([{ list: 'RAF-STEER-MNI', address: '192.168.61.0/24' }]));
        expect(await resolveCustomerPath('192.168.70.5')).toBe('gmdp');
    });

    test('range address didukung', async () => {
        getSteeringAddressLists.mockResolvedValue(okData([{ list: 'RAF-STEER-MNI', address: '192.168.62.10-192.168.62.20' }]));
        expect(await resolveCustomerPath('192.168.62.15')).toBe('mni');
        expect(await resolveCustomerPath('192.168.62.25')).toBe('gmdp');
    });

    test('IP kosong / invalid → null', async () => {
        expect(await resolveCustomerPath('')).toBeNull();
        expect(await resolveCustomerPath('bukan-ip')).toBeNull();
        expect(getSteeringAddressLists).not.toHaveBeenCalled();
    });

    test('cache: dua panggilan dalam TTL hanya 1x baca router', async () => {
        getSteeringAddressLists.mockResolvedValue(okData([{ list: 'RAF-STEER-MNI', address: '192.168.61.5' }]));
        await resolveCustomerPath('192.168.61.5');
        await resolveCustomerPath('192.168.70.9');
        expect(getSteeringAddressLists).toHaveBeenCalledTimes(1);
    });
});
