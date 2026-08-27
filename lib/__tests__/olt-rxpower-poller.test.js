jest.mock('../olt-manager', () => ({
    getOltDevices: jest.fn(),
}));
jest.mock('../olt-optical-resolver', () => ({
    ambilDataOlt: jest.fn(),
}));

const oltManager = require('../olt-manager');
const { ambilDataOlt } = require('../olt-optical-resolver');
const rxHistory = require('../olt-rxpower-history');
const poller = require('../olt-rxpower-poller');

describe('lib/olt-rxpower-poller', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        rxHistory.clearAll();
        global.config = { oltRxPowerHistory: { enabled: false } };
    });

    test('disabled poller does not start', () => {
        global.config = { oltRxPowerHistory: { enabled: false } };
        poller.startRxPowerPoller();
        expect(poller.getStatus().running).toBe(false);
    });


    test('pollOnce records rxPower for all ONUs into history', async () => {
        oltManager.getOltDevices.mockReturnValue([
            { id: 'olt1', host: '10.0.0.1' },
        ]);
        ambilDataOlt.mockResolvedValue({
            status: 'success',
            onus: [
                { macAddress: 'AA:BB:CC:00:00:01', status: 'Online', rxPower: '-22.00 dBm' },
                { macAddress: 'AA:BB:CC:00:00:02', status: 'Online', rxPower: '-27.50 dBm' },
                { macAddress: 'N/A', status: 'Online', rxPower: 'N/A' },
                // !! ONU MATI yang masih memamerkan redaman lama — WAJIB tidak direkam.
                { macAddress: 'AA:BB:CC:00:00:03', status: 'Offline', rxPower: '-13.44 dBm' },
            ],
        });

        await poller._pollOnceForTest();

        expect(rxHistory.getHistory('AABBCC000001', 0)).toHaveLength(1);
        expect(rxHistory.getHistory('AABBCC000002', 0)).toHaveLength(1);
        expect(rxHistory.getStats().tracked_macs).toBe(2);
    });

    test('pollOnce skips unconfigured host (ISI_ placeholder)', async () => {
        oltManager.getOltDevices.mockReturnValue([
            { id: 'olt1', host: 'ISI_HOST_DISINI' },
        ]);

        await poller._pollOnceForTest();

        expect(ambilDataOlt).not.toHaveBeenCalled();
        expect(rxHistory.getStats().tracked_macs).toBe(0);
    });

    test('pollOnce tolerates device error without crashing', async () => {
        oltManager.getOltDevices.mockReturnValue([
            { id: 'olt1', host: '10.0.0.1' },
            { id: 'olt2', host: '10.0.0.2' },
        ]);
        ambilDataOlt.mockRejectedValue(new Error('OLT tak terjangkau'));

        await expect(poller._pollOnceForTest()).resolves.not.toThrow();
        // Gagal baca = tidak merekam apa pun. TIDAK boleh menanam sampel tebakan:
        // pembanding palsu membuat vonis "REDAMAN MEMBURUK" salah justru saat dibutuhkan.
        expect(rxHistory.getStats().tracked_macs).toBe(0);
        expect(poller.getStatus().stats.last_error).toBeTruthy();
    });

    test('!! ONU MATI yang masih memamerkan redaman lama TIDAK direkam', async () => {
        // Terukur di OLT Icak: 5 ONU Down, semuanya tetap menampilkan dBm terakhirnya.
        oltManager.getOltDevices.mockReturnValue([{ id: 'olt1', host: '10.0.0.1' }]);
        ambilDataOlt.mockResolvedValue({
            status: 'success',
            onus: [
                { macAddress: 'CC:CC:CC:00:00:01', status: 'Offline', rxPower: '-13.44 dBm' },
                { macAddress: 'CC:CC:CC:00:00:02', status: 'Online', rxPower: '-20.10 dBm' },
            ],
        });

        await poller._pollOnceForTest();

        expect(rxHistory.getHistory('CCCCCC000001', 0)).toHaveLength(0);
        expect(rxHistory.getHistory('CCCCCC000002', 0)).toHaveLength(1);
    });

    test('retensi cukup panjang untuk menjangkau SEBELUM gangguan (bukan 30 menit)', async () => {
        // post-repair-verification mencari sampel 6 JAM ke belakang, dan gangguan nyata
        // berdurasi 1-3 jam. Retensi bawaan penyimpan (30 mnt) tak akan pernah cukup.
        oltManager.getOltDevices.mockReturnValue([{ id: 'olt1', host: '10.0.0.1' }]);
        ambilDataOlt.mockResolvedValue({
            status: 'success',
            onus: [{ macAddress: 'DD:DD:DD:00:00:01', status: 'Online', rxPower: '-20.00 dBm' }],
        });

        await poller._pollOnceForTest();
        const cfg = poller.getStatus().config;
        if (cfg) expect(cfg.retentionMs).toBeGreaterThanOrEqual(6 * 60 * 60 * 1000);
        expect(rxHistory.getHistory('DDDDDD000001', 0)).toHaveLength(1);
    });
});
