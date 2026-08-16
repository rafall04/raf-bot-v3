/**
 * Test paid-flag-reconcile:
 * - Skip infrastruktur + whitelist
 * - Hitung flip dua arah (toPaid/toUnpaid) berdasar flag SEBELUM vs posisi ledger SESUDAH
 * - Toleran error per-user (batch tetap lanjut)
 * - Pakai periode yang diminta / periode berjalan
 * - runStartupPaidReconcileSafe: skip saat global.db belum siap
 */
"use strict";

jest.mock('../payment-finance-service', () => ({
    syncUserPaidStatusForPeriod: jest.fn(),
    getCurrentBillingPeriod: jest.fn(() => ({ periodMonth: 7, periodYear: 2026 }))
}));
jest.mock('../account-classification', () => ({
    isInfrastructure: jest.fn((u) => String(u && u.account_type || '').toLowerCase() === 'infrastruktur'),
    // Salinan lokal getWhitelistedPackageNames di paid-flag-reconcile sudah dihapus demi
    // satu pemilik (#b241) — mock ini WAJIB menyediakannya, dengan perilaku yang sama.
    getWhitelistedPackageNames: jest.fn(() => new Set(
        (global.packages || []).filter((p) => p && p.whitelist === true).map((p) => p.name)
    ))
}));

const {
    syncUserPaidStatusForPeriod,
    getCurrentBillingPeriod
} = require('../payment-finance-service');
const { reconcilePaidFlags, runStartupPaidReconcileSafe } = require('../paid-flag-reconcile');

describe('reconcilePaidFlags', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        getCurrentBillingPeriod.mockReturnValue({ periodMonth: 7, periodYear: 2026 });
        syncUserPaidStatusForPeriod.mockResolvedValue({ is_fully_paid: false });
        global.packages = [
            { name: 'PKT-FREE', whitelist: true },
            { name: 'PKT-REG', whitelist: false }
        ];
        global.users = [];
    });
    afterEach(() => {
        delete global.packages;
        delete global.users;
        delete global.db;
    });

    test('skip infrastruktur + paket whitelist; hanya reconcile yang billable', async () => {
        global.users = [
            { id: 1, subscription: 'PKT-REG', paid: true },
            { id: 2, subscription: 'PKT-FREE', paid: true },                                 // whitelist → skip
            { id: 3, subscription: 'PKT-REG', paid: true, account_type: 'infrastruktur' }    // infra → skip
        ];
        const r = await reconcilePaidFlags();
        expect(syncUserPaidStatusForPeriod).toHaveBeenCalledTimes(1);
        expect(syncUserPaidStatusForPeriod.mock.calls[0][0].user.id).toBe(1);
        expect(r.checked).toBe(1);
        expect(r.toUnpaid).toBe(1); // user1 flag paid=true → ledger unpaid
        expect(r.toPaid).toBe(0);
    });

    test('hitung flip dua arah + no-change tidak dihitung', async () => {
        global.packages = [];
        global.users = [
            { id: 1, subscription: 'X', paid: true },   // ledger unpaid → toUnpaid
            { id: 2, subscription: 'X', paid: false },  // ledger paid   → toPaid
            { id: 3, subscription: 'X', paid: true }    // ledger paid   → no change
        ];
        syncUserPaidStatusForPeriod
            .mockResolvedValueOnce({ is_fully_paid: false })
            .mockResolvedValueOnce({ is_fully_paid: true })
            .mockResolvedValueOnce({ is_fully_paid: true });

        const r = await reconcilePaidFlags();
        expect(r.checked).toBe(3);
        expect(r.toUnpaid).toBe(1);
        expect(r.toPaid).toBe(1);
        expect(r.failed).toBe(0);
    });

    test('error per-user tidak menghentikan batch', async () => {
        global.packages = [];
        global.users = [
            { id: 1, subscription: 'X', paid: true },
            { id: 2, subscription: 'X', paid: true },
            { id: 3, subscription: 'X', paid: true }
        ];
        syncUserPaidStatusForPeriod
            .mockResolvedValueOnce({ is_fully_paid: false })
            .mockRejectedValueOnce(new Error('DB error'))
            .mockResolvedValueOnce({ is_fully_paid: false });

        const r = await reconcilePaidFlags({ logger: { warn: () => {} } });
        expect(syncUserPaidStatusForPeriod).toHaveBeenCalledTimes(3);
        expect(r.failed).toBe(1);
        expect(r.toUnpaid).toBe(2);
    });

    test('pakai periode yang diminta (bukan periode berjalan)', async () => {
        global.packages = [];
        global.users = [{ id: 1, subscription: 'X', paid: false }];
        await reconcilePaidFlags({ periodMonth: 5, periodYear: 2026 });
        expect(getCurrentBillingPeriod).not.toHaveBeenCalled();
        expect(syncUserPaidStatusForPeriod).toHaveBeenCalledWith(
            expect.objectContaining({ periodMonth: 5, periodYear: 2026 })
        );
    });

    test('periode berjalan dipakai bila periode tak diberikan', async () => {
        global.packages = [];
        global.users = [{ id: 1, subscription: 'X', paid: false }];
        await reconcilePaidFlags();
        expect(getCurrentBillingPeriod).toHaveBeenCalled();
        expect(syncUserPaidStatusForPeriod).toHaveBeenCalledWith(
            expect.objectContaining({ periodMonth: 7, periodYear: 2026 })
        );
    });
});

describe('runStartupPaidReconcileSafe', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        global.users = [];
        global.packages = [];
    });
    afterEach(() => {
        delete global.users;
        delete global.packages;
        delete global.db;
    });

    test('skip saat global.db belum siap (tidak melempar)', async () => {
        delete global.db;
        const r = await runStartupPaidReconcileSafe();
        expect(r).toEqual({ skipped: true, reason: 'db_not_ready' });
        expect(syncUserPaidStatusForPeriod).not.toHaveBeenCalled();
    });

    test('jalan saat global.db siap', async () => {
        global.db = {};
        global.users = [{ id: 1, subscription: 'X', paid: true }];
        syncUserPaidStatusForPeriod.mockResolvedValue({ is_fully_paid: false });
        const r = await runStartupPaidReconcileSafe();
        expect(r.checked).toBe(1);
        expect(r.toUnpaid).toBe(1);
    });
});
