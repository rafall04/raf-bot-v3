/**
 * Header Doc
 * Purpose: Mengunci perbaikan KRITIS "gagal baca MikroTik != semua pelanggan offline".
 *          `getActivePPPoEUsers` TIDAK PERNAH throw — saat timeout / circuit-breaker terbuka ia
 *          RESOLVE `{ok:false, data:null, errorCode}`. Versi lama menerjemahkannya jadi `[]`,
 *          sehingga setiap pelanggan dinilai offline, gerbang gangguan-area pasti menyala, dan
 *          pelanggan yang internetnya sehat dikabari "TERPUTUS — gangguan di area Anda".
 *          Test ini memastikan hasil baca yang gagal menjadi state KETIGA (`unknown`), tanpa
 *          klaim gangguan area, dan tanpa meracuni cache 30 detik.
 * Caller: Jest (`npx jest message/handlers/__tests__/connection-check-blind-guard.test.js`).
 * Deps: mock `lib/mikrotik` (getActivePPPoEUsers); handler `connection-check-handler`.
 * MainFuncs: -
 * SideEffects: Set global.config/global.users sementara; reset cache in-memori handler tiap test.
 */
'use strict';

jest.mock('../../../lib/jid-utils', () => ({ resolveCustomerBySender: jest.fn() }));
jest.mock('../../../lib/mikrotik', () => ({ getActivePPPoEUsers: jest.fn() }));
jest.mock('../../../lib/wifi', () => ({ getSSIDInfo: jest.fn() }));
jest.mock('../template-helpers', () => ({ renderResponseTemplate: jest.fn((key) => key) }));

const { getActivePPPoEUsers } = require('../../../lib/mikrotik');
const handler = require('../connection-check-handler');
const { resolveLineStatus } = handler;

const USER = { id: 1, name: 'Budi', pppoe_username: 'budi-krajan@rafcybernet' };
// Sengaja banyak: kalau kegagalan baca disalahartikan jadi "kosong", SEMUA ini dihitung offline
// dan gerbang gangguan-area (ambang 5) pasti menyala.
const USER_LIST = Array.from({ length: 12 }, (_v, i) => ({
    id: i + 1,
    name: `Pelanggan ${i + 1}`,
    pppoe_username: `pelanggan${i + 1}@rafcybernet`
})).concat([USER]);

beforeEach(() => {
    jest.clearAllMocks();
    handler._resetCachesForTest();
    global.config = { upstreamMonitor: { enabled: false } };
    global.users = USER_LIST;
});

describe('cek koneksi: pembacaan MikroTik yang GAGAL tidak boleh jadi vonis offline', () => {
    const KEGAGALAN = [
        ['timeout', { ok: false, data: null, errorCode: 'TIMEOUT_ERROR' }],
        ['circuit breaker terbuka', { ok: false, data: null, errorCode: 'CIRCUIT_OPEN' }],
        ['config router salah', { ok: false, data: null, errorCode: 'CONFIG_ERROR' }],
        ['bentuk hasil tak dikenal', { ok: true, data: null }]
    ];

    test.each(KEGAGALAN)('%s → lineStatus "unknown", TANPA klaim gangguan area', async (_label, hasil) => {
        getActivePPPoEUsers.mockResolvedValue(hasil);

        const out = await resolveLineStatus({ user: USER, userList: USER_LIST, routerId: 'default' });

        expect(out.lineStatus).toBe('unknown');
        expect(out.areaOutage).toBe(false);
        expect(out.offlineCount).toBe(0);
    });

    test('kegagalan di-cache sebagai KEGAGALAN — burst tak menghajar router yang sedang sakit', async () => {
        getActivePPPoEUsers.mockResolvedValue({ ok: false, data: null, errorCode: 'TIMEOUT_ERROR' });

        // Saat router bermasalah, "cek koneksi" datang berbondong-bondong.
        const hasil = [];
        for (let i = 0; i < 5; i += 1) {
            hasil.push(await resolveLineStatus({ user: USER, userList: USER_LIST, routerId: 'default' }));
        }

        // Yang di-cache adalah fakta "tak bisa dibaca" — jawabannya tetap unknown, tak pernah
        // berubah jadi vonis offline, dan routernya hanya ditembak sekali.
        expect(hasil.every((h) => h.lineStatus === 'unknown')).toBe(true);
        expect(hasil.every((h) => h.areaOutage === false)).toBe(true);
        expect(getActivePPPoEUsers).toHaveBeenCalledTimes(1);
    });

    test('cache kegagalan tidak menyimpan IP basi — pemetaan jalur tak memakai data lama', async () => {
        // Sukses dulu (mengisi addrByUser), lalu gagal.
        getActivePPPoEUsers.mockResolvedValueOnce({
            ok: true,
            data: [{ name: 'budi-krajan@rafcybernet', address: '10.0.0.5' }]
        });
        await resolveLineStatus({ user: USER, userList: USER_LIST, routerId: 'default' });

        handler._resetCachesForTest();
        getActivePPPoEUsers.mockResolvedValueOnce({ ok: false, data: null, errorCode: 'CIRCUIT_OPEN' });
        const out = await resolveLineStatus({ user: USER, userList: USER_LIST, routerId: 'default' });

        expect(out.lineStatus).toBe('unknown');
    });

    test('daftar KOSONG yang SAH tetap dibaca offline — perbaikan tidak menumpulkan deteksi asli', async () => {
        getActivePPPoEUsers.mockResolvedValue({ ok: true, data: [] });

        const out = await resolveLineStatus({ user: USER, userList: USER_LIST, routerId: 'default' });

        expect(out.lineStatus).toBe('offline');
        expect(out.offlineCount).toBe(USER_LIST.length);
        expect(out.areaOutage).toBe(true);
    });

    test('pelanggan online tetap online (jalur normal tidak berubah)', async () => {
        getActivePPPoEUsers.mockResolvedValue({
            ok: true,
            data: [{ name: 'budi-krajan@rafcybernet', address: '10.0.0.5' }]
        });

        const out = await resolveLineStatus({ user: USER, userList: USER_LIST, routerId: 'default' });

        expect(out.lineStatus).toBe('online');
        expect(out.areaOutage).toBe(false);
    });
});
