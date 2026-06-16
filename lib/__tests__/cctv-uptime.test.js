/**
 * Header Doc
 * Purpose: Test perhitungan uptime CCTV dari riwayat insiden (downtime irisan jendela).
 * Caller: jest.
 * Deps: ../cctv-uptime.
 */
'use strict';

const { downtimeMs, uptimePct, summarize, DAY_MS } = require('../cctv-uptime');

const NOW = Date.parse('2026-06-16T12:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

describe('cctv-uptime', () => {
    test('downtime: insiden dgn recoveredAt dihitung tepat', () => {
        const inc = [{ host: '10.0.0.1', detectedAt: iso(NOW - 2 * 3600000), recoveredAt: iso(NOW - 1 * 3600000) }]; // 1 jam
        expect(downtimeMs(inc, '10.0.0.1', NOW, DAY_MS)).toBe(3600000);
    });

    test('insiden masih berlangsung (tanpa recoveredAt) → sampai now', () => {
        const inc = [{ host: '10.0.0.1', detectedAt: iso(NOW - 30 * 60000) }]; // 30 menit s/d now
        expect(downtimeMs(inc, '10.0.0.1', NOW, DAY_MS)).toBe(30 * 60000);
    });

    test('insiden di luar jendela tak dihitung', () => {
        const inc = [{ host: '10.0.0.1', detectedAt: iso(NOW - 10 * DAY_MS), recoveredAt: iso(NOW - 10 * DAY_MS + 3600000) }];
        expect(downtimeMs(inc, '10.0.0.1', NOW, DAY_MS)).toBe(0); // 10 hari lalu, di luar 24 jam
        expect(downtimeMs(inc, '10.0.0.1', NOW, 30 * DAY_MS)).toBe(3600000); // masuk 30 hari
    });

    test('insiden yang menjorok melewati awal jendela → hanya irisan', () => {
        const inc = [{ host: '10.0.0.1', detectedAt: iso(NOW - 26 * 3600000), recoveredAt: iso(NOW - 22 * 3600000) }];
        // jendela 24 jam: irisan = dari (now-24h) sampai (now-22h) = 2 jam
        expect(downtimeMs(inc, '10.0.0.1', NOW, DAY_MS)).toBe(2 * 3600000);
    });

    test('uptimePct: 1 jam down dalam 24 jam ≈ 95.83%', () => {
        const inc = [{ host: '10.0.0.1', detectedAt: iso(NOW - 2 * 3600000), recoveredAt: iso(NOW - 1 * 3600000) }];
        expect(uptimePct(inc, '10.0.0.1', NOW, DAY_MS)).toBeCloseTo(95.83, 1);
    });

    test('host tanpa insiden → 100%', () => {
        expect(uptimePct([], '10.0.0.9', NOW, DAY_MS)).toBe(100);
    });

    test('summarize mengembalikan 24h/7d/30d per host (key lowercase)', () => {
        const inc = [{ host: '10.0.0.1', detectedAt: iso(NOW - 3600000), recoveredAt: iso(NOW) }]; // 1 jam baru saja pulih
        const s = summarize(inc, ['10.0.0.1', '10.0.0.2'], NOW);
        expect(s['10.0.0.1'].uptime24h).toBeLessThan(100);
        expect(s['10.0.0.1'].uptime30d).toBeGreaterThan(s['10.0.0.1'].uptime24h);
        expect(s['10.0.0.2'].uptime24h).toBe(100);
    });
});
