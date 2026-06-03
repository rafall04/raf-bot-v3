jest.mock('../notification-tracker', () => ({
    normalizePhone: jest.fn((value) => String(value || '').replace(/\D/g, '').replace(/^0/, '62')),
    deduplicatePhones: jest.fn((phones) => Array.from(new Set(phones)))
}));

describe('lib/whatsapp-delivery-service', () => {
    beforeEach(() => {
        jest.resetModules();
        global.whatsappConnectionState = 'open';
        global.raf = {
            sendMessage: jest.fn(async (jid, message) => ({ key: { remoteJid: jid }, message }))
        };
    });

    test('sendMessageToMany deduplicates recipients and reports success', async () => {
        const { sendMessageToMany } = require('../whatsapp-delivery-service');
        const result = await sendMessageToMany(
            ['08123', '08123', '628999@s.whatsapp.net'],
            { text: 'halo' }
        );

        expect(result.sent).toBe(true);
        expect(result.successCount).toBe(2);
        expect(global.raf.sendMessage).toHaveBeenCalledTimes(2);
    });

    test('sendMessage returns connection error when WhatsApp is offline', async () => {
        global.whatsappConnectionState = 'close';
        const { sendMessage } = require('../whatsapp-delivery-service');
        const result = await sendMessage('08123', { text: 'halo' });

        expect(result.sent).toBe(false);
        expect(result.errorCode).toBe('WHATSAPP_NOT_CONNECTED');
    });
});
