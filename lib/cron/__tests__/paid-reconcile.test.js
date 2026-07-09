/**
 * Test cron paid-reconcile:
 * - AKTIF default (jadwal 03:00) tanpa butuh key config
 * - Nonaktif hanya bila paid_reconcile_enabled === false
 * - Override jadwal via paid_reconcile_schedule
 * - Overlap guard: tick kedua saat tick pertama jalan → skip
 */
"use strict";

jest.mock('node-cron', () => ({
    schedule: jest.fn(() => ({ stop: jest.fn() }))
}));
// Mock meniru isValidCron ASLI: meneruskan ke cron-validator yang memanggil .trim()
// → THROW pada non-string (mis. undefined). Ini menjaga regresi "undefined schedule".
jest.mock('../shared', () => ({
    isValidCron: jest.fn((s) => {
        if (typeof s !== 'string') {
            throw new TypeError("Cannot read properties of undefined (reading 'trim')");
        }
        return s.trim().length > 0;
    })
}));
jest.mock('../../paid-flag-reconcile', () => ({
    reconcilePaidFlags: jest.fn().mockResolvedValue({ period: { periodMonth: 7, periodYear: 2026 }, checked: 0, toPaid: 0, toUnpaid: 0, failed: 0 })
}));

const cron = require('node-cron');
const { reconcilePaidFlags } = require('../../paid-flag-reconcile');
const { initPaidReconcileTask } = require('../jobs/paid-reconcile');

function lastScheduleCall() {
    return cron.schedule.mock.calls[cron.schedule.mock.calls.length - 1];
}

describe('cron paid-reconcile', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        global.db = {};
    });
    afterEach(() => { delete global.db; });

    test('aktif default dgn jadwal 03:00 saat config kosong', () => {
        initPaidReconcileTask({});
        expect(cron.schedule).toHaveBeenCalledTimes(1);
        expect(lastScheduleCall()[0]).toBe('0 3 * * *');
    });

    test('tidak throw saat paid_reconcile_schedule undefined (guard) → pakai default', () => {
        expect(() => initPaidReconcileTask({ status_schedule: true })).not.toThrow();
        expect(cron.schedule).toHaveBeenCalledTimes(1);
        expect(lastScheduleCall()[0]).toBe('0 3 * * *');
    });

    test('nonaktif bila paid_reconcile_enabled === false', () => {
        initPaidReconcileTask({ paid_reconcile_enabled: false });
        expect(cron.schedule).not.toHaveBeenCalled();
    });

    test('override jadwal via paid_reconcile_schedule', () => {
        initPaidReconcileTask({ paid_reconcile_schedule: '30 4 * * *' });
        expect(lastScheduleCall()[0]).toBe('30 4 * * *');
    });

    test('menjalankan reconcile saat tick + overlap guard', async () => {
        let release;
        reconcilePaidFlags.mockImplementation(() => new Promise((r) => { release = () => r({ period: {}, checked: 0, toPaid: 0, toUnpaid: 0, failed: 0 }); }));
        initPaidReconcileTask({});
        const cb = lastScheduleCall()[1];

        const first = cb();            // mulai, tertahan
        await Promise.resolve();
        await cb();                    // tick kedua → skip (guard)
        expect(reconcilePaidFlags).toHaveBeenCalledTimes(1);

        release();
        await first;
    });
});
