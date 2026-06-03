/**
 * Header Doc
 * Purpose: Guardrail untuk notifikasi PSB agar tetap memakai delivery service tanpa mengubah hasil boolean flow.
 * Caller: Suite Jest tranche WA Facade service notification.
 * Deps: `../psb-notification`, `../templating`, dan `../whatsapp-delivery-service`.
 * MainFuncs: Menguji `normalizePhoneToJID`, `sendPSBPhase1Notification`, dan `sendPSBPhase2Notification`.
 * SideEffects: Memock config global, connection state, dan delivery layer WhatsApp.
 */
jest.mock('../templating', () => ({
    renderTemplate: jest.fn((template, data) => `${template}:${JSON.stringify(data)}`)
}));

jest.mock('../whatsapp-delivery-service', () => ({
    sendMessage: jest.fn(async (recipient, message) => ({
        sent: true,
        successCount: 1,
        recipients: [recipient],
        result: { ok: true, message }
    }))
}));

describe('psb-notification', () => {
    let delivery;
    let psbNotification;

    beforeEach(() => {
        jest.resetModules();
        global.whatsappConnectionState = 'open';
        global.raf = { sendMessage: jest.fn().mockResolvedValue({ ok: true }) };
        global.config = {
            company: { name: 'RAF NET', website: 'https://rafnet.example' },
            welcomeMessage: { customerPortalUrl: 'https://portal.example/customer' }
        };
        delivery = require('../whatsapp-delivery-service');
        psbNotification = require('../psb-notification');
    });

    test('normalizePhoneToJID normalizes local phone format to WhatsApp JID', () => {
        expect(psbNotification.normalizePhoneToJID('08123-456')).toBe('628123456@s.whatsapp.net');
    });

    test('sendPSBPhase1Notification returns false for invalid phone number', async () => {
        const result = await psbNotification.sendPSBPhase1Notification({
            name: 'Budi',
            phone_number: ''
        });

        expect(result).toBe(false);
        expect(delivery.sendMessage).not.toHaveBeenCalled();
    });

    test('sendPSBPhase1Notification returns false when WhatsApp connection is unavailable', async () => {
        global.whatsappConnectionState = 'close';

        const result = await psbNotification.sendPSBPhase1Notification({
            name: 'Budi',
            phone_number: '08123456789'
        });

        expect(result).toBe(false);
        expect(delivery.sendMessage).not.toHaveBeenCalled();
    });

    test('sendPSBPhase1Notification sends template text through delivery service', async () => {
        const result = await psbNotification.sendPSBPhase1Notification({
            id: 'PSB001',
            name: 'Budi',
            phone_number: '08123456789',
            address: 'Jl. Test'
        });

        expect(result).toBe(true);
        expect(delivery.sendMessage).toHaveBeenCalledWith(
            '628123456789@s.whatsapp.net',
            expect.objectContaining({
                text: expect.stringContaining('psb_phase1_registered')
            })
        );
    });

    test('sendPSBPhase2Notification sends template text through delivery service', async () => {
        const result = await psbNotification.sendPSBPhase2Notification({
            name: 'Budi',
            phone_number: '08123456789',
            subscription: 'Paket Hemat'
        }, {
            pppoe_username: 'budi-user',
            pppoe_password: 'secret',
            wifi_ssid: 'RAF-Budi',
            wifi_password: 'wifi-secret'
        });

        expect(result).toBe(true);
        expect(delivery.sendMessage).toHaveBeenCalledWith(
            '628123456789@s.whatsapp.net',
            expect.objectContaining({
                text: expect.stringContaining('psb_welcome')
            })
        );
    });
});
