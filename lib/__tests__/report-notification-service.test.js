/**
 * Header Doc
 * Purpose: Guardrail untuk dedup dan delivery notifikasi laporan/tiket melalui delivery service.
 * Caller: Suite Jest tranche WA Facade service notification.
 * Deps: `../report-notification-service`, `../notification-tracker`, `../templating`, dan `../whatsapp-delivery-service`.
 * MainFuncs: Menguji `notifyCustomerTicketUpdate` dan `notifyNewReport`.
 * SideEffects: Memock state global WhatsApp dan delivery layer.
 */
jest.mock('../notification-tracker', () => ({
    deduplicatePhones: (phones) => {
        const seen = new Set();
        return (phones || []).filter(Boolean).filter((phone) => {
            const normalized = String(phone).replace(/[^0-9]/g, '').replace(/^0/, '62');
            if (!normalized || seen.has(normalized)) return false;
            seen.add(normalized);
            return true;
        });
    },
    normalizePhone: (phone) => String(phone || '').replace(/[^0-9]/g, '').replace(/^0/, '62'),
    isNotificationDuplicate: jest.fn(() => false),
    markNotificationSent: jest.fn()
}));

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

describe('report-notification-service', () => {
    let service;
    let delivery;

    beforeEach(() => {
        jest.resetModules();
        global.whatsappConnectionState = 'open';
        global.raf = { sendMessage: jest.fn().mockResolvedValue({ ok: true }) };
        global.accounts = [];
        global.config = {};
        delivery = require('../whatsapp-delivery-service');
        service = require('../report-notification-service');
    });

    test('notifyCustomerTicketUpdate deduplicates pelangganId and pelangganPhone that point to the same customer', async () => {
        const ticket = {
            ticketId: 'TST001',
            pelangganId: '628123456789@s.whatsapp.net',
            pelangganPhone: '08123456789|628123456789'
        };

        const result = await service.notifyCustomerTicketUpdate(ticket, 'status update');

        expect(result.sent).toBe(true);
        expect(delivery.sendMessage).toHaveBeenCalledTimes(1);
        expect(delivery.sendMessage).toHaveBeenCalledWith('628123456789@s.whatsapp.net', { text: 'status update' });
    });

    test('notifyNewReport excludes creator teknisi from teknisi broadcast', async () => {
        global.accounts = [
            { role: 'teknisi', phone_number: '081111111111', username: 'creator' },
            { role: 'teknisi', phone_number: '082222222222', username: 'other' }
        ];

        const result = await service.notifyNewReport({
            ticketId: 'TST002',
            pelangganName: 'Budi',
            pelangganPhone: '08123456789',
            pelangganAddress: 'Jl. Test',
            laporanText: 'Internet mati',
            priority: 'MEDIUM',
            customerPhotos: []
        }, {
            notifyAdmins: false,
            excludeJids: ['628111111111@s.whatsapp.net']
        });

        expect(result.sent).toBe(true);
        expect(delivery.sendMessage.mock.calls.some(([jid]) => jid === '628111111111@s.whatsapp.net')).toBe(false);
        expect(delivery.sendMessage).not.toHaveBeenCalledWith(
            '628111111111@s.whatsapp.net',
            expect.anything()
        );
    });

    test('notifyCustomerTicketUpdate skips sending when WhatsApp connection is unavailable', async () => {
        global.whatsappConnectionState = 'close';

        const result = await service.notifyCustomerTicketUpdate({
            ticketId: 'TST003',
            pelangganId: '628123456789@s.whatsapp.net'
        }, 'status update');

        expect(result.sent).toBe(false);
        expect(result.successCount).toBe(0);
        expect(delivery.sendMessage).not.toHaveBeenCalled();
    });
});
