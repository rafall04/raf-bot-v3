/**
 * Header Doc
 * Purpose: Guardrail untuk expiry dan reminder topup agar tetap memicu persist serta delivery service yang sama.
 * Caller: Suite Jest tranche WA Facade service notification.
 * Deps: `../topup-expiry`, `../saldo-manager`, `../logger`, dan `../whatsapp-delivery-service`.
 * MainFuncs: Menguji `checkExpiredTopupRequests` dan `sendTopupReminders`.
 * SideEffects: Memock request topup, logger, dan delivery layer WhatsApp.
 */
const mockGetAllTopupRequests = jest.fn();
const mockSaveTopupRequests = jest.fn();
const mockLoggerInfo = jest.fn();
const mockLoggerError = jest.fn();
const mockSendMessage = jest.fn(async (recipient, message) => ({
    sent: true,
    successCount: 1,
    recipients: [recipient],
    result: { ok: true, message }
}));

jest.mock('../saldo-manager', () => ({
    getAllTopupRequests: (...args) => mockGetAllTopupRequests(...args),
    saveTopupRequests: (...args) => mockSaveTopupRequests(...args)
}));

jest.mock('../logger', () => ({
    logger: {
        info: (...args) => mockLoggerInfo(...args),
        error: (...args) => mockLoggerError(...args)
    }
}));

jest.mock('../whatsapp-delivery-service', () => ({
    sendMessage: (...args) => mockSendMessage(...args)
}));

describe('topup-expiry', () => {
    let topupExpiry;

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        global.whatsappConnectionState = 'open';
        global.raf = { sendMessage: jest.fn().mockResolvedValue({ ok: true }) };
        topupExpiry = require('../topup-expiry');
    });

    test('checkExpiredTopupRequests expires stale request and notifies user', async () => {
        const request = {
            id: 'TOP001',
            userId: '628123456789@s.whatsapp.net',
            amount: 10000,
            status: 'pending',
            paymentProof: null,
            created_at: new Date(Date.now() - (25 * 60 * 60 * 1000)).toISOString()
        };
        mockGetAllTopupRequests.mockReturnValue([request]);

        topupExpiry.checkExpiredTopupRequests();
        await Promise.resolve();

        expect(request.status).toBe('expired');
        expect(request.expiry_reason).toBe('Tidak ada pembayaran dalam 24 jam');
        expect(mockSaveTopupRequests).toHaveBeenCalled();
        expect(mockSendMessage).toHaveBeenCalledWith(
            '628123456789@s.whatsapp.net',
            expect.objectContaining({
                text: expect.stringContaining('REQUEST TOPUP EXPIRED')
            })
        );
    });

    test('sendTopupReminders sends reminder and marks request as reminded', async () => {
        const request = {
            id: 'TOP002',
            userId: '628123456789@s.whatsapp.net',
            amount: 20000,
            status: 'pending',
            paymentProof: null,
            reminder_sent: false,
            paymentMethod: 'transfer',
            created_at: new Date(Date.now() - (13 * 60 * 60 * 1000)).toISOString()
        };
        mockGetAllTopupRequests.mockReturnValue([request]);

        topupExpiry.sendTopupReminders();
        await Promise.resolve();

        expect(mockSendMessage).toHaveBeenCalledWith(
            '628123456789@s.whatsapp.net',
            expect.objectContaining({
                text: expect.stringContaining('REMINDER TOPUP')
            })
        );
        expect(request.reminder_sent).toBe(true);
        expect(mockSaveTopupRequests).toHaveBeenCalled();
    });
});
