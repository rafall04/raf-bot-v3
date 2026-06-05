jest.mock('../olt-manager', () => ({
    getOltDevices: jest.fn(),
}));
jest.mock('../olt-hioso', () => ({
    getOltData: jest.fn(),
}));

const oltManager = require('../olt-manager');
const oltHioso = require('../olt-hioso');
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

    test('buildOltConfig maps device fields with fallbacks', () => {
        const cfg = poller._buildOltConfig({
            host: '10.0.0.1',
            snmpPort: 1161,
            snmpCommunity: 'sekret',
            snmpTimeout: 8000,
            snmpRetries: 1,
        });
        expect(cfg).toEqual({
            host: '10.0.0.1',
            port: 1161,
            community: 'sekret',
            timeout: 8000,
            retries: 1,
        });
    });

    test('buildOltConfig uses defaults when fields missing', () => {
        const cfg = poller._buildOltConfig({ host: '10.0.0.2' });
        expect(cfg).toEqual({
            host: '10.0.0.2',
            port: 161,
            community: 'public',
            timeout: 15000,
            retries: 2,
        });
    });

    test('pollOnce records rxPower for all ONUs into history', async () => {
        oltManager.getOltDevices.mockReturnValue([
            { id: 'olt1', host: '10.0.0.1' },
        ]);
        oltHioso.getOltData.mockResolvedValue({
            status: 'success',
            onus: [
                { macAddress: 'AA:BB:CC:00:00:01', rxPower: '-22.00 dBm' },
                { macAddress: 'AA:BB:CC:00:00:02', rxPower: '-27.50 dBm' },
                { macAddress: 'N/A', rxPower: 'N/A' }, // filtered out
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

        expect(oltHioso.getOltData).not.toHaveBeenCalled();
        expect(rxHistory.getStats().tracked_macs).toBe(0);
    });

    test('pollOnce tolerates device error without crashing', async () => {
        oltManager.getOltDevices.mockReturnValue([
            { id: 'olt1', host: '10.0.0.1' },
            { id: 'olt2', host: '10.0.0.2' },
        ]);
        oltHioso.getOltData
            .mockRejectedValueOnce(new Error('SNMP timeout'))
            .mockResolvedValueOnce({
                status: 'success',
                onus: [{ macAddress: 'BB:BB:BB:00:00:01', rxPower: '-24.00 dBm' }],
            });

        await expect(poller._pollOnceForTest()).resolves.not.toThrow();
        // OLT kedua tetap ter-record meski OLT pertama gagal.
        expect(rxHistory.getHistory('BBBBBB000001', 0)).toHaveLength(1);
    });
});
