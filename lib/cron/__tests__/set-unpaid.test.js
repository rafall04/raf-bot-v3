/**
 * Test cron set-unpaid hardening:
 * - Sequential (bukan Promise.all paralel) + overlap guard
 * - Skip whitelist + skip user yang sudah unpaid
 * - Null-safe global.packages
 */
"use strict";

jest.mock('node-cron', () => ({
    schedule: jest.fn(() => ({ stop: jest.fn() }))
}));
jest.mock('../shared', () => ({
    isValidCron: jest.fn(() => true),
    loadCronConfig: jest.fn(() => ({ status_unpaid_schedule: true }))
}));
jest.mock('../../myfunc', () => ({
    getProfileBySubscription: jest.fn((sub) => `profile-${sub}`)
}));
jest.mock('../../payment-finance-service', () => ({
    syncUserPaidStatusForCurrentPeriod: jest.fn().mockResolvedValue({ is_fully_paid: false })
}));

const cron = require('node-cron');
const { syncUserPaidStatusForCurrentPeriod } = require('../../payment-finance-service');
const { initSetUnpaidTask } = require('../jobs/set-unpaid');

function getScheduledCallback() {
    return cron.schedule.mock.calls[cron.schedule.mock.calls.length - 1][1];
}

describe('cron set-unpaid hardening', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        syncUserPaidStatusForCurrentPeriod.mockResolvedValue({ is_fully_paid: false });
        global.packages = [
            { profile: 'profile-VIP', whitelist: true },
            { profile: 'profile-REG', whitelist: false }
        ];
        global.users = [];
    });

    test('skip whitelist + skip user yang sudah unpaid; sync hanya yang relevan', async () => {
        global.users = [
            { id: 1, subscription: 'REG', paid: true },   // → sync
            { id: 2, subscription: 'VIP', paid: true },   // whitelist → skip
            { id: 3, subscription: 'REG', paid: false },  // sudah unpaid → skip
            { id: 4, subscription: 'REG', paid: true }    // → sync
        ];
        initSetUnpaidTask({ status_unpaid_schedule: true, unpaid_schedule: '0 0 1 * *' });
        await getScheduledCallback()();

        expect(syncUserPaidStatusForCurrentPeriod).toHaveBeenCalledTimes(2);
        const syncedIds = syncUserPaidStatusForCurrentPeriod.mock.calls.map((c) => c[0].user.id);
        expect(syncedIds).toEqual([1, 4]);
    });

    test('overlap guard: tick kedua saat tick pertama masih jalan → skip', async () => {
        let release;
        syncUserPaidStatusForCurrentPeriod.mockImplementation(() => new Promise((r) => { release = () => r({ is_fully_paid: false }); }));
        global.users = [{ id: 1, subscription: 'REG', paid: true }];

        initSetUnpaidTask({ status_unpaid_schedule: true, unpaid_schedule: '0 0 1 * *' });
        const cb = getScheduledCallback();

        const firstRun = cb();          // mulai, tertahan di sync pertama
        await Promise.resolve();
        await cb();                     // tick kedua → harus skip (guard)
        expect(syncUserPaidStatusForCurrentPeriod).toHaveBeenCalledTimes(1);

        release();
        await firstRun;
    });

    test('per-user error tidak menghentikan batch', async () => {
        global.users = [
            { id: 1, subscription: 'REG', paid: true },
            { id: 2, subscription: 'REG', paid: true },
            { id: 3, subscription: 'REG', paid: true }
        ];
        syncUserPaidStatusForCurrentPeriod
            .mockResolvedValueOnce({ is_fully_paid: false })
            .mockRejectedValueOnce(new Error('DB error'))
            .mockResolvedValueOnce({ is_fully_paid: false });

        initSetUnpaidTask({ status_unpaid_schedule: true, unpaid_schedule: '0 0 1 * *' });
        await getScheduledCallback()();

        // Semua 3 user tetap dicoba meski user 2 error.
        expect(syncUserPaidStatusForCurrentPeriod).toHaveBeenCalledTimes(3);
    });

    test('null-safe: global.packages undefined tidak crash', async () => {
        global.packages = undefined;
        global.users = [{ id: 1, subscription: 'REG', paid: true }];

        initSetUnpaidTask({ status_unpaid_schedule: true, unpaid_schedule: '0 0 1 * *' });
        await expect(getScheduledCallback()()).resolves.not.toThrow();
        expect(syncUserPaidStatusForCurrentPeriod).toHaveBeenCalledTimes(1);
    });
});
