const rxHistory = require('../olt-rxpower-history');

describe('lib/olt-rxpower-history', () => {
    beforeEach(() => {
        rxHistory.clearAll();
    });

    describe('parseRxValue', () => {
        test('parses Hioso "X dBm" format', () => {
            expect(rxHistory.parseRxValue('-24.50 dBm')).toBe(-24.5);
            expect(rxHistory.parseRxValue('-18 dBm')).toBe(-18);
        });

        test('accepts plain number', () => {
            expect(rxHistory.parseRxValue(-22.3)).toBe(-22.3);
        });

        test('returns null for N/A and garbage', () => {
            expect(rxHistory.parseRxValue('N/A')).toBeNull();
            expect(rxHistory.parseRxValue('')).toBeNull();
            expect(rxHistory.parseRxValue(null)).toBeNull();
            expect(rxHistory.parseRxValue(undefined)).toBeNull();
        });
    });

    describe('recordSample + getHistory', () => {
        test('records valid samples, skips N/A', () => {
            const t = Date.now();
            rxHistory.recordSample('aa:bb:cc:dd:ee:ff', '-24.00 dBm', t);
            rxHistory.recordSample('aa:bb:cc:dd:ee:ff', 'N/A', t + 1000); // skipped
            rxHistory.recordSample('aa:bb:cc:dd:ee:ff', '-25.00 dBm', t + 2000);

            const hist = rxHistory.getHistory('AABBCCDDEEFF', 0);
            expect(hist).toHaveLength(2);
            expect(hist[0].rx).toBe(-24);
            expect(hist[1].rx).toBe(-25);
        });

        test('prunes samples older than retention', () => {
            const now = Date.now();
            const old = now - (40 * 60 * 1000); // 40 min ago, > 30 min retention
            rxHistory.recordSample('AABB', -24, old);
            rxHistory.recordSample('AABB', -25, now); // triggers prune of old

            const hist = rxHistory.getHistory('AABB', 0);
            expect(hist).toHaveLength(1);
            expect(hist[0].rx).toBe(-25);
        });

        test('normalizes MAC across separators', () => {
            const t = Date.now();
            rxHistory.recordSample('aa:bb:cc:dd:ee:ff', -24, t);
            // Query with different separator format → same buffer.
            expect(rxHistory.getHistory('AA-BB-CC-DD-EE-FF', 0)).toHaveLength(1);
        });
    });

    describe('recordBatch', () => {
        test('records multiple ONUs with same timestamp', () => {
            const t = Date.now();
            rxHistory.recordBatch([
                { mac: 'AA11', rxPower: '-22.00 dBm' },
                { macAddress: 'BB22', rxPower: '-26.00 dBm' },
                { mac: 'CC33', rxPower: 'N/A' }, // skipped
            ], t);

            expect(rxHistory.getHistory('AA11', 0)).toHaveLength(1);
            expect(rxHistory.getHistory('BB22', 0)).toHaveLength(1);
            expect(rxHistory.getHistory('CC33', 0)).toHaveLength(0);
        });
    });

    describe('computeSlopePerMinute', () => {
        test('detects declining trend (negative slope)', () => {
            const t0 = Date.now();
            const samples = [
                { rx: -20, at: t0 },
                { rx: -22, at: t0 + 60000 },
                { rx: -24, at: t0 + 120000 },
            ];
            const slope = rxHistory.computeSlopePerMinute(samples);
            expect(slope).toBeCloseTo(-2, 1); // -2 dBm per minute
        });

        test('detects stable trend (~0 slope)', () => {
            const t0 = Date.now();
            const samples = [
                { rx: -24, at: t0 },
                { rx: -24, at: t0 + 60000 },
                { rx: -24, at: t0 + 120000 },
            ];
            expect(rxHistory.computeSlopePerMinute(samples)).toBeCloseTo(0, 5);
        });

        test('returns null for single sample', () => {
            expect(rxHistory.computeSlopePerMinute([{ rx: -24, at: Date.now() }])).toBeNull();
        });
    });

    describe('analyzeOfflineEvent', () => {
        test('no history → available false, neutral', () => {
            const result = rxHistory.analyzeOfflineEvent('UNKNOWN', Date.now());
            expect(result.available).toBe(false);
            expect(result.hint).toBe('neutral');
            expect(result.weight).toBe(0);
        });

        test('healthy + stable rxPower → dying-gasp hint', () => {
            const now = Date.now();
            const mac = 'DG01';
            // 4 samples, healthy stable around -23 dBm, last 4 min.
            rxHistory.recordSample(mac, -23, now - 180000);
            rxHistory.recordSample(mac, -23.2, now - 120000);
            rxHistory.recordSample(mac, -22.8, now - 60000);
            rxHistory.recordSample(mac, -23, now - 5000);

            const result = rxHistory.analyzeOfflineEvent(mac, now);
            expect(result.available).toBe(true);
            expect(result.hint).toBe('dying-gasp');
            expect(result.weight).toBeGreaterThan(0);
            expect(result.last_rx_before).toBeCloseTo(-23, 1);
        });

        test('declining rxPower → los hint', () => {
            const now = Date.now();
            const mac = 'LOS01';
            // Declining from -20 to -29 over 4 min.
            rxHistory.recordSample(mac, -20, now - 180000);
            rxHistory.recordSample(mac, -23, now - 120000);
            rxHistory.recordSample(mac, -26, now - 60000);
            rxHistory.recordSample(mac, -29, now - 5000);

            const result = rxHistory.analyzeOfflineEvent(mac, now);
            expect(result.available).toBe(true);
            expect(result.hint).toBe('los');
            expect(result.trend).toBe('declining');
            expect(result.weight).toBeGreaterThan(0);
        });

        test('weak last rxPower (stable) → los hint', () => {
            const now = Date.now();
            const mac = 'WEAK01';
            // Stable but weak around -28 dBm.
            rxHistory.recordSample(mac, -28, now - 120000);
            rxHistory.recordSample(mac, -28.1, now - 60000);
            rxHistory.recordSample(mac, -28, now - 5000);

            const result = rxHistory.analyzeOfflineEvent(mac, now);
            expect(result.hint).toBe('los');
        });

        test('ignores samples after the event time', () => {
            const now = Date.now();
            const mac = 'TIME01';
            rxHistory.recordSample(mac, -23, now - 60000); // before
            rxHistory.recordSample(mac, -29, now + 60000); // after event — must be ignored

            const result = rxHistory.analyzeOfflineEvent(mac, now);
            expect(result.samples_in_window).toBe(1);
            expect(result.last_rx_before).toBe(-23);
        });
    });
});
