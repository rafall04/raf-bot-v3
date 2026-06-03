/**
 * Header Doc
 * Purpose: Test untuk pre-warm pemetaan LID↔PN dari daftar pelanggan via USync.
 * Caller: Jest test runner.
 * Deps: `../lid-prewarm`.
 * MainFuncs: Memverifikasi collectCustomerPnJids & prewarmLidMappings (batching, skip, throttle).
 * SideEffects: Tidak ada (store di-mock).
 */
"use strict";

const { prewarmLidMappings, collectCustomerPnJids, _resetThrottleForTest } = require('../lid-prewarm');

describe('lid-prewarm', () => {
    beforeEach(() => {
        _resetThrottleForTest();
    });

    test('collectCustomerPnJids normalizes, dedupes, and skips @lid', () => {
        const users = [
            { phone_number: '08123456789' },
            { phone_number: '6281234567890 | 08123456789' },
            { phone_number: '111@lid' },
            { phone_number: '' },
            null
        ];

        const jids = collectCustomerPnJids(users);

        expect(jids).toContain('628123456789@s.whatsapp.net'); // 08123456789 -> 628...
        expect(jids).toContain('6281234567890@s.whatsapp.net');
        expect(jids.every((j) => j.endsWith('@s.whatsapp.net'))).toBe(true);
        expect(new Set(jids).size).toBe(jids.length); // tidak ada duplikat
    });

    test('prewarm calls getLIDsForPNs in throttled batches and counts mapped', async () => {
        const getLIDsForPNs = jest.fn(async (batch) => batch.map((pn) => ({ lid: '1@lid', pn })));
        const raf = { signalRepository: { lidMapping: { getLIDsForPNs } } };
        const users = Array.from({ length: 5 }, (_, i) => ({ phone_number: `628111000${i}` }));

        const res = await prewarmLidMappings(raf, users, {
            batchSize: 2,
            delayMs: 0,
            logger: { log() {}, warn() {} }
        });

        expect(res.skipped).toBe(false);
        expect(res.attempted).toBe(5);
        expect(getLIDsForPNs).toHaveBeenCalledTimes(3); // 2 + 2 + 1
        expect(res.mapped).toBe(5);
    });

    test('prewarm skips when lidMapping store is unavailable', async () => {
        const res = await prewarmLidMappings({}, [{ phone_number: '628111222333' }], {
            force: true,
            logger: { warn() {} }
        });
        expect(res).toEqual(expect.objectContaining({ skipped: true, reason: 'unavailable' }));
    });

    test('prewarm throttles repeated runs', async () => {
        const getLIDsForPNs = jest.fn(async (batch) => batch.map((pn) => ({ lid: '1@lid', pn })));
        const raf = { signalRepository: { lidMapping: { getLIDsForPNs } } };
        const users = [{ phone_number: '628111222333' }];

        const first = await prewarmLidMappings(raf, users, { delayMs: 0, logger: { log() {}, warn() {} } });
        expect(first.skipped).toBe(false);

        const second = await prewarmLidMappings(raf, users, { delayMs: 0, logger: { log() {}, warn() {} } });
        expect(second).toEqual(expect.objectContaining({ skipped: true, reason: 'throttled' }));
        expect(getLIDsForPNs).toHaveBeenCalledTimes(1); // run kedua tidak memanggil store
    });
});
