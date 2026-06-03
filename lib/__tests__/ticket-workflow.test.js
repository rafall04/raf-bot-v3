jest.mock('../database', () => ({
    saveReports: jest.fn()
}));

jest.mock('../ticket-id', () => ({
    generateTicketId: jest.fn(() => 'TICKET01')
}));

describe('lib/ticket-workflow', () => {
    beforeEach(() => {
        jest.resetModules();
        global.reports = [];
    });

    test('normalize legacy statuses and photo fields into final ticket shape', () => {
        const { ensureTicketShape } = require('../ticket-workflow');
        const ticket = ensureTicketShape({
            ticketId: 'ABC1234',
            status: 'resolved',
            pelangganPhone: '628123456789',
            completionPhotos: [{ filename: 'foto1.jpg', category: 'problem' }],
            photos: ['legacy.jpg']
        });

        expect(ticket.status).toBe('completed');
        expect(ticket.teknisiPhotos).toHaveLength(2);
        expect(ticket.photoCount).toBe(2);
    });

    test('createBaseTicket writes final customer ticket schema', () => {
        const { createBaseTicket } = require('../ticket-workflow');
        const ticket = createBaseTicket({
            user: {
                id: 10,
                name: 'Budi',
                phone_number: '628123456789|08123',
                address: 'Solo',
                subscription: '20 Mbps',
                pppoe_username: 'budi'
            },
            laporanText: 'Internet mati',
            issueType: 'MATI',
            priority: 'HIGH',
            createdBy: '628111@s.whatsapp.net',
            createdByRole: 'customer_wa',
            customerPhotos: [{ fileName: 'customer1.jpg', path: '/uploads/customer1.jpg' }]
        });

        expect(ticket.ticketId).toBe('TICKET01');
        expect(ticket.status).toBe('baru');
        expect(ticket.customerPhotos).toHaveLength(1);
        expect(ticket.customerPhotoCount).toBe(1);
        expect(ticket.pelangganId).toBe('628123456789@s.whatsapp.net');
    });

    test('workflow completes ticket with final completed status and teknisi photos', () => {
        const {
            createBaseTicket,
            processTicket,
            markTicketOtw,
            markTicketArrived,
            verifyTicketOtp,
            appendTechnicianPhoto,
            completeTicket
        } = require('../ticket-workflow');

        const ticket = createBaseTicket({
            user: {
                id: 20,
                name: 'Siti',
                phone_number: '628555111222'
            },
            laporanText: 'Internet lemot',
            issueType: 'LEMOT',
            priority: 'MEDIUM',
            createdBy: 'admin',
            createdByRole: 'admin'
        });

        const actor = {
            id: 'teknisi-1',
            username: 'teknisi1',
            name: 'Teknisi Satu',
            phoneNumber: '628777000111',
            channel: 'web'
        };

        const { otp } = processTicket({ ticketId: ticket.ticketId, actor });
        markTicketOtw({ ticketId: ticket.ticketId, actor });
        markTicketArrived({ ticketId: ticket.ticketId, actor });
        verifyTicketOtp({ ticketId: ticket.ticketId, actor, otp });
        appendTechnicianPhoto({
            ticketId: ticket.ticketId,
            actor,
            photo: { fileName: 'tek1.jpg', path: '/uploads/tickets/tek1.jpg' }
        });
        appendTechnicianPhoto({
            ticketId: ticket.ticketId,
            actor,
            photo: { fileName: 'tek2.jpg', path: '/uploads/tickets/tek2.jpg' }
        });

        const { ticket: completedTicket } = completeTicket({
            ticketId: ticket.ticketId,
            actor,
            resolutionNotes: 'Modem normal kembali'
        });

        expect(completedTicket.status).toBe('completed');
        expect(completedTicket.resolutionNotes).toBe('Modem normal kembali');
        expect(completedTicket.teknisiPhotos).toHaveLength(2);
        expect(completedTicket.photoCount).toBe(2);
    });

    test('cancelTicket writes final cancelled schema without reviving legacy status fields', () => {
        const { createBaseTicket, cancelTicket } = require('../ticket-workflow');

        const ticket = createBaseTicket({
            user: {
                id: 99,
                name: 'Andi',
                phone_number: '628888111222'
            },
            laporanText: 'Mau batal',
            issueType: 'GENERAL',
            priority: 'LOW',
            createdBy: '628123@s.whatsapp.net',
            createdByRole: 'customer_wa'
        });

        const { ticket: cancelledTicket } = cancelTicket({
            ticketId: ticket.ticketId,
            actor: {
                id: '628123@s.whatsapp.net',
                name: 'Andi',
                type: 'pelanggan',
                channel: 'wa'
            },
            reason: 'Dibatalkan pelanggan',
            cancelledByType: 'pelanggan'
        });

        expect(cancelledTicket.status).toBe('cancelled');
        expect(cancelledTicket.cancelledAt).toBeTruthy();
        expect(cancelledTicket.cancellationReason).toBe('Dibatalkan pelanggan');
        expect(cancelledTicket.cancelledBy).toEqual({
            id: '628123@s.whatsapp.net',
            name: 'Andi',
            type: 'pelanggan'
        });
        expect(cancelledTicket.resolvedAt).toBeFalsy();
    });
});
