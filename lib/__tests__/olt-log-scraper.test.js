const oltScraper = require('../olt-log-scraper');

describe('olt-log-scraper runtime state', () => {
    const olt = {
        id: 'olt-1',
        name: 'OLT Pusat',
        host: '192.168.11.2'
    };

    afterEach(() => {
        oltScraper.__testHooks.resetDeviceStatuses();
    });

    test('marks first failure as degraded', () => {
        oltScraper.__testHooks.markDeviceFailure(olt, 'Request timeout');

        const state = oltScraper.__testHooks.getDeviceState(olt);
        expect(state.status).toBe('degraded');
        expect(state.failure_count).toBe(1);
        expect(oltScraper.__testHooks.shouldSkipDeviceScrape(olt)).toBe(false);
    });

    test('marks repeated failures as unreachable with backoff', () => {
        oltScraper.__testHooks.markDeviceFailure(olt, 'Request timeout');
        oltScraper.__testHooks.markDeviceFailure(olt, 'Request timeout');
        oltScraper.__testHooks.markDeviceFailure(olt, 'Request timeout');

        const state = oltScraper.__testHooks.getDeviceState(olt);
        expect(state.status).toBe('unreachable');
        expect(state.failure_count).toBe(3);
        expect(oltScraper.__testHooks.shouldSkipDeviceScrape(olt)).toBe(true);
    });

    test('resets device state to healthy after success', () => {
        oltScraper.__testHooks.markDeviceFailure(olt, 'socket hang up');
        oltScraper.__testHooks.markDeviceHealthy(olt);

        const state = oltScraper.__testHooks.getDeviceState(olt);
        expect(state.status).toBe('healthy');
        expect(state.failure_count).toBe(0);
        expect(state.last_error).toBeNull();
    });
});
