/**
 * Header Doc
 * Purpose: Guardrail test untuk memastikan helper WhatsApp di cron tetap stabil setelah didelegasikan ke delivery service.
 * Caller: Jest test runner.
 * Deps: `../cron` dan mock `../whatsapp-delivery-service`.
 * MainFuncs: Tidak ada.
 * SideEffects: Memodifikasi global connection state selama test lalu membersihkannya.
 */
"use strict";

const mockSendPayload = jest.fn();

jest.mock('../whatsapp-delivery-service', () => ({
    sendMessage: (...args) => mockSendPayload(...args)
}));

jest.mock('../templating', () => ({
    renderTemplate: jest.fn(),
    templatesCache: { notificationTemplates: {} }
}));

jest.mock('../mikrotik', () => ({
    updatePPPoEProfile: jest.fn(),
    deleteActivePPPoEUser: jest.fn(),
    getPPPoEUserProfile: jest.fn(),
    assertMikrotikResult: jest.fn((value) => value)
}));

jest.mock('../wifi', () => ({
    rebootRouter: jest.fn(),
    performAllDevicesRedamanCheck: jest.fn(),
    REDAMAN_PATHS: {}
}));

jest.mock('../genieacs', () => ({
    queryDevices: jest.fn(),
    refreshObjects: jest.fn()
}));

jest.mock('../database', () => ({
    saveCompensations: jest.fn(),
    saveSpeedRequests: jest.fn()
}));

jest.mock('../myfunc', () => ({
    getProfileBySubscription: jest.fn()
}));

jest.mock('../telegram-backup', () => ({
    performDatabaseBackup: jest.fn(),
    getTelegramConfig: jest.fn()
}));

jest.mock('../services/isolir-service', () => jest.fn());

const { __testHooks } = require('../cron');

describe('cron safeSendMessage', () => {
    beforeEach(() => {
        mockSendPayload.mockReset();
        global.conn = { sendMessage: jest.fn() };
        global.whatsappConnectionState = 'open';
    });

    afterEach(() => {
        delete global.conn;
        delete global.whatsappConnectionState;
        jest.clearAllMocks();
    });

    test('mengembalikan shouldStop saat koneksi tidak siap', async () => {
        global.whatsappConnectionState = 'close';

        const result = await __testHooks.safeSendMessage('6281@s.whatsapp.net', { text: 'halo' });

        expect(result).toEqual({
            success: false,
            error: 'WhatsApp not connected (state: close)',
            shouldStop: true
        });
        expect(mockSendPayload).not.toHaveBeenCalled();
    });

    test('mengembalikan sukses saat adapter berhasil', async () => {
        mockSendPayload.mockResolvedValue({ sent: true });

        const result = await __testHooks.safeSendMessage('6281@s.whatsapp.net', { text: 'halo' }, { skipDuplicateCheck: true });

        expect(result).toEqual({ success: true, error: null });
        expect(mockSendPayload).toHaveBeenCalledWith(
            '6281@s.whatsapp.net',
            { text: 'halo' },
            { skipDuplicateCheck: true }
        );
    });

    test('menandai shouldStop true untuk error koneksi', async () => {
        mockSendPayload.mockRejectedValue(new Error('socket closed unexpectedly'));

        const result = await __testHooks.safeSendMessage('6281@s.whatsapp.net', { text: 'halo' });

        expect(result).toEqual({
            success: false,
            error: 'socket closed unexpectedly',
            shouldStop: true
        });
    });

    test('menandai shouldStop false untuk error non-koneksi', async () => {
        mockSendPayload.mockRejectedValue(new Error('invalid media payload'));

        const result = await __testHooks.safeSendMessage('6281@s.whatsapp.net', { text: 'halo' });

        expect(result).toEqual({
            success: false,
            error: 'invalid media payload',
            shouldStop: false
        });
    });
});
