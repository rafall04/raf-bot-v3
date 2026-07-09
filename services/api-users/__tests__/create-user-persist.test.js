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

describe('create-user-persist — welcome jujur saat push modem gagal (device_config)', () => {
    const welcomeDeps = (overrides = {}) => makeDeps({
        getConfig: jest.fn(() => ({ welcomeMessage: { enabled: true }, nama: 'RAFNET', namabot: 'BOT' })),
        getStatusSnapshot: jest.fn(() => ({ connectionState: 'close' })),
        logger: { error: jest.fn(), warn: jest.fn() },
        ...overrides
    });

    test('push modem GAGAL (attempted && !ok) → psb_welcome DITAHAN + warning device_config_failed', async () => {
        const deps = welcomeDeps();
        const newUser = { id: 5, name: 'Budi', paid: false, subscription: 'PAKET-100K', phone_number: '08123456789' };
        const res = await persistAndNotifyNewUser(deps, buildArgs(newUser, { wifi_ssid: 'BudiNet', wifi_password: 'budi12345' }, {
            registrationMode: 'new',
            deviceConfig: { attempted: true, ok: false, message: 'timeout' }
        }));
        expect(res.status).toBe(201);
        // Welcome ditahan SEBELUM render → template WiFi tak pernah dibuat/dikirim.
        expect(deps.renderTemplate).not.toHaveBeenCalled();
        expect(deps.sendMessage).not.toHaveBeenCalled();
        // Kegagalan dimunculkan ke teknisi/admin.
        expect(res.body.warning).toBe('device_config_failed');
        expect(res.body.device_config).toEqual({ attempted: true, ok: false, message: 'timeout' });
        expect(res.body.provisioning_note).toMatch(/DITAHAN|modem/i);
        expect(deps.logger.warn).toHaveBeenCalled();
    });

    test('push modem OK (attempted && ok) → psb_welcome dirender + device_config disurface tanpa warning', async () => {
        const deps = welcomeDeps();
        const newUser = { id: 6, name: 'Sari', paid: false, subscription: 'PAKET-100K', phone_number: '08123456789' };
        const res = await persistAndNotifyNewUser(deps, buildArgs(newUser, { wifi_ssid: 'SariNet', wifi_password: 'sari12345' }, {
            registrationMode: 'new',
            deviceConfig: { attempted: true, ok: true, message: 'ok' }
        }));
        expect(res.status).toBe(201);
        expect(deps.renderTemplate).toHaveBeenCalledWith('psb_welcome', expect.objectContaining({ wifi_ssid: 'SariNet' }));
        expect(res.body.device_config).toEqual({ attempted: true, ok: true, message: 'ok' });
        expect(res.body.warning).toBeUndefined();
    });

    test('tanpa push modem (attempted=false, legacy) → welcome normal jalan, tanpa warning', async () => {
        const deps = welcomeDeps();
        const newUser = { id: 7, name: 'Legacy', paid: false, subscription: 'PAKET-100K', phone_number: '08123456789', username: 'legacy' };
        const res = await persistAndNotifyNewUser(deps, buildArgs(newUser, {}, { registrationMode: 'legacy' }));
        expect(res.status).toBe(201);
        expect(res.body.warning).toBeUndefined();
        expect(deps.renderTemplate).toHaveBeenCalledWith('customer_welcome', expect.objectContaining({ username: 'legacy' }));
    });
});
