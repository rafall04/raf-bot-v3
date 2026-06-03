const sqlite3 = require('sqlite3').verbose();
jest.mock('../mikrotik', () => ({
    getActivePPPoEUsers: jest.fn(),
}));

let getActivePPPoEUsers;

function closeDb(db) {
    return new Promise((resolve, reject) => {
        if (!db) {
            resolve();
            return;
        }
        db.close((err) => (err ? reject(err) : resolve()));
    });
}

describe('customer traffic usage service', () => {
    let CustomerTrafficUsageService;

    beforeEach(async () => {
        jest.resetModules();
        jest.clearAllMocks();
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-04-14T00:00:00.000Z'));

        global.__dbInitPromise = Promise.resolve();
        global.db = new sqlite3.Database(':memory:');
        global.config = {
            customerTrafficUsageEnabled: true,
            customerTrafficLiveEnabled: true,
        };

        getActivePPPoEUsers = require('../mikrotik').getActivePPPoEUsers;
        CustomerTrafficUsageService = require('../customer-traffic-usage-service');
        await CustomerTrafficUsageService.ensureTables();
    });

    afterEach(async () => {
        if (CustomerTrafficUsageService) {
            CustomerTrafficUsageService.stopCollector();
        }
        await closeDb(global.db);
        delete global.db;
        delete global.__dbInitPromise;
        delete global.config;
        jest.useRealTimers();
    });

    test('collectUsageSnapshot keeps first snapshot as seed and accumulates deltas after that', async () => {
        getActivePPPoEUsers
            .mockResolvedValueOnce({
                ok: true,
                data: [{
                    name: 'cust-1',
                    rx_bytes: 1000,
                    tx_bytes: 500,
                    interface_name: 'pppoe-cust-1',
                }],
            })
            .mockResolvedValueOnce({
                ok: true,
                data: [{
                    name: 'cust-1',
                    rx_bytes: 2200,
                    tx_bytes: 1100,
                    interface_name: 'pppoe-cust-1',
                }],
            });

        await CustomerTrafficUsageService.collectUsageSnapshot();

        jest.setSystemTime(new Date('2026-04-14T00:02:00.000Z'));
        await CustomerTrafficUsageService.collectUsageSnapshot();

        const usage = await CustomerTrafficUsageService.getCustomerUsage({
            pppoe_username: 'cust-1',
        });

        expect(usage.today.downloadBytes).toBe(1200);
        expect(usage.today.uploadBytes).toBe(600);
        expect(usage.today.totalBytes).toBe(1800);
        expect(usage.currentMonth.totalBytes).toBe(1800);
    });

    test('getCustomerLiveUsage computes rates from shared snapshots', async () => {
        getActivePPPoEUsers
            .mockResolvedValueOnce({
                ok: true,
                data: [{
                    name: 'cust-live',
                    rx_bytes: 2000,
                    tx_bytes: 500,
                    interface_name: 'pppoe-cust-live',
                }],
            })
            .mockResolvedValueOnce({
                ok: true,
                data: [{
                    name: 'cust-live',
                    rx_bytes: 4500,
                    tx_bytes: 1500,
                    interface_name: 'pppoe-cust-live',
                }],
            });

        const first = await CustomerTrafficUsageService.getCustomerLiveUsage({
            pppoe_username: 'cust-live',
        });

        expect(first.online).toBe(true);
        expect(first.warmup).toBe(true);
        expect(first.downloadBps).toBe(0);
        expect(first.uploadBps).toBe(0);

        jest.setSystemTime(new Date('2026-04-14T00:00:05.000Z'));

        const second = await CustomerTrafficUsageService.getCustomerLiveUsage({
            pppoe_username: 'cust-live',
        });

        expect(second.online).toBe(true);
        expect(second.warmup).toBe(false);
        expect(second.sampleIntervalMs).toBe(5000);
        expect(second.downloadBps).toBe(4000);
        expect(second.uploadBps).toBe(1600);
        expect(second.interfaceName).toBe('pppoe-cust-live');
    });
});
