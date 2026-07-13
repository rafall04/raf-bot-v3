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
    // Basis pool paket dari upstream-path-resolver (DEFAULT_PATH_POOLS: 61/62/71=mni, 70=gmdp)
    // dipakai saat RAF-STEER tak menimpa. upCfg kosong → resolver pakai DEFAULT pools.
    global.config = { upstreamMonitor: {} };
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

    test('RAF-STEER KOSONG → jatuh ke BASIS pool paket (reguler=gmdp, 110k/125k/FREE=mni), BUKAN semua gmdp', async () => {
        getSteeringAddressLists.mockResolvedValue(okData([]));
        expect(await resolveCustomerPath('192.168.70.5')).toBe('gmdp'); // reguler (pool 70)
        expect(await resolveCustomerPath('192.168.61.5')).toBe('mni'); // 110k (pool 61) — dulu keliru gmdp
        expect(await resolveCustomerPath('192.168.62.9')).toBe('mni'); // 125k (pool 62)
        expect(await resolveCustomerPath('192.168.71.3')).toBe('mni'); // FREE (pool 71)
    });

    test('IP di RAF-STEER-MNI → mni', async () => {
        getSteeringAddressLists.mockResolvedValue(okData([{ list: 'RAF-STEER-MNI', address: '192.168.61.5' }]));
        expect(await resolveCustomerPath('192.168.61.5')).toBe('mni');
    });

    test('OVERRIDE RAF-STEER MENANG atas basis pool: IP reguler(70) di RAF-STEER-SF → sf (bukan gmdp)', async () => {
        getSteeringAddressLists.mockResolvedValue(okData([{ list: 'RAF-STEER-SF', address: '192.168.70.55' }]));
        expect(await resolveCustomerPath('192.168.70.55')).toBe('sf');
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

    test('range address didukung (di dalam range → override; di luar → basis pool)', async () => {
        getSteeringAddressLists.mockResolvedValue(okData([{ list: 'RAF-STEER-SF', address: '192.168.70.10-192.168.70.20' }]));
        expect(await resolveCustomerPath('192.168.70.15')).toBe('sf'); // dalam range → override sf
        expect(await resolveCustomerPath('192.168.70.25')).toBe('gmdp'); // luar range → basis pool (reguler)
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
