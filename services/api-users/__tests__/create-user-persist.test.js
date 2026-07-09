/**
 * Test create-user-persist — toggle "free_first_month" (waiver bulan pertama pelanggan baru).
 * Fokus: kapan applyFreeMonth dipanggil, mutual-eksklusif dgn paid, guard tagihan>0, best-effort.
 */
"use strict";

const { persistAndNotifyNewUser } = require('../create-user-persist');

function makeDeps(overrides = {}) {
    return {
        repository: {
            insertUserRecord: jest.fn().mockResolvedValue(),
            getUsersSnapshot: jest.fn(() => []),
            replaceUsersSnapshot: jest.fn(),
            deleteUserRecord: jest.fn().mockResolvedValue()
        },
        applyPaymentStatusChange: jest.fn().mockResolvedValue({ action: 'paid' }),
        applyFreeMonth: jest.fn().mockResolvedValue({ action: 'waived', positionAfter: { is_waived: true } }),
        handlePaidStatusChange: jest.fn().mockResolvedValue(),
        getPeriodParts: jest.fn(() => ({ periodMonth: 7, periodYear: 2026 })),
        getEffectivePrice: jest.fn(() => 100000),
        logActivity: jest.fn().mockResolvedValue(),
        getConfig: jest.fn(() => ({ welcomeMessage: { enabled: false } })),
        getPackages: jest.fn(() => []),
        renderTemplate: jest.fn(() => 'x'),
        sendMessage: jest.fn().mockResolvedValue({ sent: true }),
        getStatusSnapshot: jest.fn(() => ({ connectionState: 'close' })),
        logger: { error: jest.fn() },
        ...overrides
    };
}

const actor = { id: 2, username: 'raf', role: 'admin' };

function buildArgs(newUser, userData, extra = {}) {
    return {
        newUser,
        plainTextPassword: 'p',
        finalUsername: 'u',
        paymentMethod: null,
        registrationMode: 'legacy',
        mikrotikSync: { status: 'skipped', message: '' },
        syncEnabled: false,
        userData,
        actor,
        requestMeta: {},
        ...extra
    };
}

describe('create-user-persist — free_first_month waiver', () => {
    test('toggle ON + belum bayar + tagihan>0 → applyFreeMonth dipanggil + free_month_applied true', async () => {
        const deps = makeDeps();
        const newUser = { id: 1, name: 'Baru', paid: false, subscription: 'PAKET-100K', phone_number: '' };
        const res = await persistAndNotifyNewUser(deps, buildArgs(newUser, { free_first_month: true }));
        expect(deps.applyFreeMonth).toHaveBeenCalledTimes(1);
        expect(deps.applyFreeMonth).toHaveBeenCalledWith(expect.objectContaining({
            user: newUser, periodMonth: 7, periodYear: 2026
        }));
        expect(res.body.free_month_applied).toBe(true);
    });

    test('toggle "true" (string) juga diterima', async () => {
        const deps = makeDeps();
        const newUser = { id: 1, name: 'Baru', paid: false, subscription: 'PAKET-100K', phone_number: '' };
        await persistAndNotifyNewUser(deps, buildArgs(newUser, { free_first_month: 'true' }));
        expect(deps.applyFreeMonth).toHaveBeenCalledTimes(1);
    });

    test('toggle OFF → applyFreeMonth TIDAK dipanggil', async () => {
        const deps = makeDeps();
        const newUser = { id: 1, name: 'Baru', paid: false, subscription: 'PAKET-100K', phone_number: '' };
        const res = await persistAndNotifyNewUser(deps, buildArgs(newUser, { free_first_month: false }));
        expect(deps.applyFreeMonth).not.toHaveBeenCalled();
        expect(res.body.free_month_applied).toBe(false);
    });

    test('paid=true meski toggle ON → waiver dilewati (mutual eksklusif)', async () => {
        const deps = makeDeps();
        const newUser = { id: 1, name: 'Baru', paid: true, subscription: 'PAKET-100K', phone_number: '' };
        await persistAndNotifyNewUser(deps, buildArgs(newUser, { free_first_month: true }, { paymentMethod: 'CASH' }));
        expect(deps.applyFreeMonth).not.toHaveBeenCalled();
    });

    test('tagihan 0 (paket gratis) → waiver dilewati', async () => {
        const deps = makeDeps({ getEffectivePrice: jest.fn(() => 0) });
        const newUser = { id: 1, name: 'Baru', paid: false, subscription: 'PAKET-KHUSUS', phone_number: '' };
        await persistAndNotifyNewUser(deps, buildArgs(newUser, { free_first_month: true }));
        expect(deps.applyFreeMonth).not.toHaveBeenCalled();
    });

    test('waiver gagal → user tetap dibuat (best-effort), free_month_applied false', async () => {
        const deps = makeDeps({ applyFreeMonth: jest.fn().mockRejectedValue(new Error('db')) });
        const newUser = { id: 1, name: 'Baru', paid: false, subscription: 'PAKET-100K', phone_number: '' };
        const res = await persistAndNotifyNewUser(deps, buildArgs(newUser, { free_first_month: true }));
        expect(res.status).toBe(201);
        expect(res.body.free_month_applied).toBe(false);
        expect(deps.logger.error).toHaveBeenCalled();
    });
});
