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

// #b355: prefs per-teknisi dikontrol via map; resolver ASLI menyaring penerima notif per-area.
const PREFS = {};
jest.mock('../../repositories/teknisi-prefs.repository', () => ({
    getPrefs: (id) => Object.assign(
        { enabled: true, alerts: { los: true, redaman: true, ticket_new: true, post_repair: true }, areas: [], quietHours: { enabled: false }, snoozeUntil: null },
        PREFS[String(id)] || {}
    ),
}));

describe('report-notification-service', () => {
    let service;
    let delivery;

    beforeEach(() => {
        jest.resetModules();
        for (const k of Object.keys(PREFS)) delete PREFS[k];
        global.whatsappConnectionState = 'open';
        global.raf = { sendMessage: jest.fn().mockResolvedValue({ ok: true }) };
        global.accounts = [];
        global.users = [];
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

    test('#b355 gate ON → hanya teknisi yang area-nya mencakup pelanggan yang di-notif', async () => {
        global.config = { teknisiPrefs: { enabled: true } };
        global.users = [{ id: 7, connected_odp_id: 'ODP-09', phone_number: '08123456789' }];
        global.accounts = [
            { role: 'teknisi', phone_number: '081200000001', username: 'luar', id: 't1' },
            { role: 'teknisi', phone_number: '081200000002', username: 'dalam', id: 't2' }
        ];
        PREFS.t1 = { areas: ['ODP-01'] }; // luar area → TIDAK di-notif
        PREFS.t2 = { areas: ['ODP-09'] }; // cocok → di-notif

        await service.notifyNewReport({
            ticketId: 'TST-AREA', user_id: 7, pelangganName: 'Budi', pelangganPhone: '08123456789',
            laporanText: 'Internet mati', priority: 'MEDIUM', customerPhotos: []
        }, { notifyAdmins: false });

        const jids = delivery.sendMessage.mock.calls.map(([jid]) => jid);
        expect(jids).toContain('6281200000002@s.whatsapp.net');   // teknisi area cocok
        expect(jids).not.toContain('6281200000001@s.whatsapp.net'); // teknisi luar area disaring
    });

    test('#b355 gate OFF → SEMUA teknisi di-notif (perilaku lama, prefs diabaikan)', async () => {
        global.config = {}; // teknisiPrefs tak ada = gate off
        global.users = [{ id: 7, connected_odp_id: 'ODP-09', phone_number: '08123456789' }];
        global.accounts = [
            { role: 'teknisi', phone_number: '081200000001', username: 'luar', id: 't1' },
            { role: 'teknisi', phone_number: '081200000002', username: 'dalam', id: 't2' }
        ];
        PREFS.t1 = { areas: ['ODP-01'] };
        PREFS.t2 = { areas: ['ODP-09'] };

        await service.notifyNewReport({
            ticketId: 'TST-OFF', user_id: 7, pelangganPhone: '08123456789', laporanText: 'x', priority: 'LOW'
        }, { notifyAdmins: false });

        const jids = delivery.sendMessage.mock.calls.map(([jid]) => jid);
        expect(jids).toContain('6281200000001@s.whatsapp.net');
        expect(jids).toContain('6281200000002@s.whatsapp.net');
    });

    test('#b356 gate ON → teknisi yang SNOOZE tak di-notif tiket baru (non-critical)', async () => {
        global.config = { teknisiPrefs: { enabled: true } };
        global.users = [{ id: 7, phone_number: '08123456789' }]; // tanpa area → area tak men-drop
        global.accounts = [
            { role: 'teknisi', phone_number: '081200000001', username: 'snooze', id: 't1' },
            { role: 'teknisi', phone_number: '081200000002', username: 'aktif', id: 't2' }
        ];
        PREFS.t1 = { snoozeUntil: '2099-01-01T00:00:00.000Z' }; // di-snooze jauh ke depan → DIBUNGKAM
        // t2 default → tetap di-notif

        await service.notifyNewReport({
            ticketId: 'TST-SNZ', user_id: 7, pelangganPhone: '08123456789', laporanText: 'x', priority: 'LOW'
        }, { notifyAdmins: false });

        const jids = delivery.sendMessage.mock.calls.map(([jid]) => jid);
        expect(jids).toContain('6281200000002@s.whatsapp.net');     // aktif → di-notif
        expect(jids).not.toContain('6281200000001@s.whatsapp.net');  // snooze → dibungkam
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
