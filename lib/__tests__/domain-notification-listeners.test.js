/**
 * Header Doc
 * Purpose: Guardrail untuk event bridge notifikasi domain agar listener meneruskan payload ke delivery service yang sama.
 * Caller: Suite Jest tranche event bridge tipis.
 * Deps: `../domain-events`, `../domain-notification-listeners`, dan `../whatsapp-delivery-service`.
 * MainFuncs: Menguji event package change, partial payment, dan ticket customer update.
 * SideEffects: Memock singleton emitter dan delivery layer WhatsApp.
 */
jest.mock('../whatsapp-delivery-service', () => ({
    sendMessage: jest.fn(async (recipient, message) => ({
        sent: true,
        successCount: 1,
        recipients: [recipient],
        result: { ok: true, message }
    }))
}));

describe('domain-notification-listeners', () => {
    let events;
    let listeners;
    let delivery;

    beforeEach(() => {
        jest.resetModules();
        events = require('../domain-events');
        listeners = require('../domain-notification-listeners');
        delivery = require('../whatsapp-delivery-service');
        listeners.initializeDomainNotificationListeners();
        listeners.initializeDomainNotificationListeners();
    });

    test('package.change.approved forwards one recipient payload to delivery service', async () => {
        await events.emitAsync(events.DOMAIN_EVENTS.PACKAGE_CHANGE_APPROVED, {
            recipient: '628123456789@s.whatsapp.net',
            message: { text: 'package changed' }
        });

        expect(delivery.sendMessage).toHaveBeenCalledTimes(1);
        expect(delivery.sendMessage).toHaveBeenCalledWith(
            '628123456789@s.whatsapp.net',
            { text: 'package changed' },
            {}
        );
    });

    test('payment.partial.requested forwards each recipient to delivery service', async () => {
        await events.emitAsync(events.DOMAIN_EVENTS.PARTIAL_PAYMENT_REQUESTED, {
            recipients: ['628111111111@s.whatsapp.net', '628222222222@s.whatsapp.net'],
            message: { text: 'partial payment' }
        });

        expect(delivery.sendMessage).toHaveBeenCalledTimes(2);
        expect(delivery.sendMessage).toHaveBeenNthCalledWith(
            1,
            '628111111111@s.whatsapp.net',
            { text: 'partial payment' },
            {}
        );
        expect(delivery.sendMessage).toHaveBeenNthCalledWith(
            2,
            '628222222222@s.whatsapp.net',
            { text: 'partial payment' },
            {}
        );
    });

    test('ticket.customer.update.requested fans out payloads to all recipients', async () => {
        await events.emitAsync(events.DOMAIN_EVENTS.TICKET_CUSTOMER_UPDATE_REQUESTED, {
            recipients: ['628111111111@s.whatsapp.net', '628222222222@s.whatsapp.net'],
            payloads: [{ text: 'update' }, { image: Buffer.from('a'), caption: 'foto' }]
        });

        expect(delivery.sendMessage).toHaveBeenCalledTimes(4);
        expect(delivery.sendMessage).toHaveBeenCalledWith(
            '628111111111@s.whatsapp.net',
            { text: 'update' },
            {}
        );
        expect(delivery.sendMessage).toHaveBeenCalledWith(
            '628222222222@s.whatsapp.net',
            { image: Buffer.from('a'), caption: 'foto' },
            {}
        );
    });

    test('native emitter async rejection is redirected to error listener', async () => {
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        const rejectionError = new Error('listener rejected');
        const listener = async () => {
            throw rejectionError;
        };

        events.domainEvents.on('test.rejection', listener);
        events.domainEvents.emit('test.rejection', { ok: true });
        await new Promise((resolve) => setImmediate(resolve));

        expect(errorSpy).toHaveBeenCalledWith('[DOMAIN_EVENTS_ERROR]', rejectionError);

        events.domainEvents.off('test.rejection', listener);
        errorSpy.mockRestore();
    });
});
