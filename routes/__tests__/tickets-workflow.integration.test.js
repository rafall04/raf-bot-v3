const express = require('express');
const http = require('http');

jest.mock('../../lib/activity-logger', () => ({
    logActivity: jest.fn().mockResolvedValue()
}));

jest.mock('../../lib/security', () => ({
    rateLimit: () => (req, res, next) => next()
}));

jest.mock('../../lib/request-lock', () => ({
    withLock: jest.fn(async (key, fn) => fn())
}));

jest.mock('../../lib/database', () => ({
    saveReports: jest.fn(),
    loadJSON: jest.fn(),
    saveJSON: jest.fn()
}));

const mockNotificationService = {
    notifyNewReport: jest.fn(async () => ({ sent: true, successCount: 1, recipients: ['628999999999@s.whatsapp.net'] })),
    notifyCustomerTicketUpdate: jest.fn(async () => ({ sent: true, successCount: 1, recipients: ['628123456789@s.whatsapp.net'] })),
    notifyTicketProcessed: jest.fn(async () => ({ sent: true, successCount: 1, recipients: ['628123456789@s.whatsapp.net'] })),
    notifyTicketOtw: jest.fn(async () => ({ sent: true, successCount: 1, recipients: ['628123456789@s.whatsapp.net'] })),
    notifyTicketArrived: jest.fn(async () => ({ sent: true, successCount: 1, recipients: ['628123456789@s.whatsapp.net'] })),
    notifyTicketWorking: jest.fn(async () => ({ sent: true, successCount: 1, recipients: ['628123456789@s.whatsapp.net'] })),
    notifyTicketCompleted: jest.fn(async () => ({ sent: true, successCount: 1, recipients: ['628123456789@s.whatsapp.net'] })),
    notifyTicketCancelled: jest.fn(async () => ({ sent: true, successCount: 1, recipients: ['628123456789@s.whatsapp.net'] })),
    toJid: jest.fn((phone) => {
        const normalized = String(phone || '').replace(/[^0-9]/g, '').replace(/^0/, '62');
        return normalized ? `${normalized}@s.whatsapp.net` : null;
    })
};

jest.mock('../../lib/report-notification-service', () => mockNotificationService);

const { createBaseTicket, appendTechnicianPhoto, completeTicket } = require('../../lib/ticket-workflow');
const ticketsRouter = require('../tickets');

function createApp(role = 'teknisi', overrides = {}) {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        req.user = {
            id: overrides.id || 'tek-1',
            username: overrides.username || 'teknisi1',
            role,
            name: overrides.name || 'Teknisi Satu',
            phone_number: overrides.phone_number || '081111111111',
            phone: overrides.phone || overrides.phone_number || '081111111111'
        };
        next();
    });
    app.use('/api', ticketsRouter);
    return app;
}

async function startServer(app) {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    return {
        server,
        baseUrl: `http://127.0.0.1:${port}`
    };
}

async function stopServer(server) {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

describe('tickets workflow integration', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        global.reports = [];
        global.users = [];
        global.accounts = [
            { id: 'tek-1', username: 'teknisi1', role: 'teknisi', name: 'Teknisi Satu', phone_number: '081111111111' },
            { id: 'tek-2', username: 'teknisi2', role: 'teknisi', name: 'Teknisi Dua', phone_number: '082222222222' }
        ];
        global.config = {
            teknisiWorkingHours: {
                outOfHoursMessage: 'Di luar jam kerja'
            }
        };
        global.whatsappConnectionState = 'open';
        global.raf = { sendMessage: jest.fn() };
    });

    test('web workflow routes move a bot-created ticket to completed with shared notifiers', async () => {
        const user = { id: 1, name: 'Budi', phone_number: '08123456789', address: 'Jl. Test' };
        global.users = [user];
        const created = createBaseTicket({
            user,
            laporanText: 'Internet mati total',
            priority: 'MEDIUM',
            issueType: 'GENERAL',
            createdBy: 'bot',
            createdByRole: 'customer'
        });

        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            let response = await fetch(`${baseUrl}/api/ticket/process`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ticketId: created.ticketId })
            });
            let payload = await response.json();
            expect(response.status).toBe(200);
            expect(payload.data.status).toBe('process');
            expect(global.reports[0].status).toBe('process');
            expect(mockNotificationService.notifyTicketProcessed).toHaveBeenCalledTimes(1);

            response = await fetch(`${baseUrl}/api/ticket/otw`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ticketId: created.ticketId })
            });
            payload = await response.json();
            expect(response.status).toBe(200);
            expect(payload.data.status).toBe('otw');
            expect(global.reports[0].status).toBe('otw');
            expect(mockNotificationService.notifyTicketOtw).toHaveBeenCalledTimes(1);

            response = await fetch(`${baseUrl}/api/ticket/arrived`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ticketId: created.ticketId })
            });
            payload = await response.json();
            expect(response.status).toBe(200);
            expect(payload.data.status).toBe('arrived');
            expect(global.reports[0].status).toBe('arrived');
            expect(mockNotificationService.notifyTicketArrived).toHaveBeenCalledTimes(1);

            const otp = global.reports[0].otp;
            response = await fetch(`${baseUrl}/api/ticket/verify-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ticketId: created.ticketId, otp })
            });
            payload = await response.json();
            expect(response.status).toBe(200);
            expect(payload.data.status).toBe('working');
            expect(global.reports[0].status).toBe('working');
            expect(mockNotificationService.notifyTicketWorking).toHaveBeenCalledTimes(1);

            appendTechnicianPhoto({
                ticketId: created.ticketId,
                actor: {
                    id: 'tek-1',
                    username: 'teknisi1',
                    name: 'Teknisi Satu',
                    channel: 'wa'
                },
                photo: {
                    fileName: 'before.jpg',
                    path: '/uploads/tickets/2026/04/TST/before.jpg',
                    uploadedAt: new Date().toISOString(),
                    uploadedBy: 'teknisi1',
                    source: 'wa_teknisi',
                    order: 1
                }
            });
            appendTechnicianPhoto({
                ticketId: created.ticketId,
                actor: {
                    id: 'tek-1',
                    username: 'teknisi1',
                    name: 'Teknisi Satu',
                    channel: 'wa'
                },
                photo: {
                    fileName: 'after.jpg',
                    path: '/uploads/tickets/2026/04/TST/after.jpg',
                    uploadedAt: new Date().toISOString(),
                    uploadedBy: 'teknisi1',
                    source: 'wa_teknisi',
                    order: 2
                }
            });

            response = await fetch(`${baseUrl}/api/ticket/complete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ticketId: created.ticketId, resolutionNotes: 'Modem direstart dan normal kembali' })
            });
            payload = await response.json();
            expect(response.status).toBe(200);
            expect(payload.data.status).toBe('completed');
            expect(global.reports[0].status).toBe('completed');
            expect(global.reports[0].teknisiPhotos).toHaveLength(2);
            expect(mockNotificationService.notifyTicketCompleted).toHaveBeenCalledTimes(1);
        } finally {
            await stopServer(server);
        }
    });

    test('web teknisi create excludes the creator from teknisi broadcast recipients', async () => {
        const user = { id: 2, name: 'Siti', phone_number: '081298765432', address: 'Jl. Customer' };
        global.users = [user];

        const app = createApp('teknisi', {
            id: 'tek-1',
            username: 'teknisi1',
            name: 'Teknisi Satu',
            phone_number: '081111111111'
        });
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/ticket/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    customerUserId: user.id,
                    laporanText: 'Gangguan baru dari teknisi',
                    priority: 'MEDIUM',
                    issueType: 'GENERAL'
                })
            });
            const payload = await response.json();

            expect(response.status).toBe(200);
            expect(payload.data.ticketId).toBeTruthy();
            expect(mockNotificationService.notifyCustomerTicketUpdate).toHaveBeenCalledTimes(1);
            expect(mockNotificationService.notifyNewReport).toHaveBeenCalledTimes(1);
            expect(mockNotificationService.notifyNewReport.mock.calls[0][1]).toMatchObject({
                notifyAdmins: true,
                excludeJids: ['6281111111111@s.whatsapp.net']
            });
        } finally {
            await stopServer(server);
        }
    });

    test('web-created ticket can be completed by the shared workflow service without legacy status drift', () => {
        const user = { id: 3, name: 'Rina', phone_number: '081277700000', address: 'Jl. Cross Channel' };
        global.users = [user];
        const ticket = createBaseTicket({
            user,
            laporanText: 'Gangguan intermiten',
            priority: 'HIGH',
            issueType: 'GENERAL',
            createdBy: 'admin-web',
            createdByRole: 'admin'
        });

        expect(ticket.status).toBe('baru');

        const activeTicket = global.reports[0];
        activeTicket.status = 'working';
        appendTechnicianPhoto({
            ticketId: ticket.ticketId,
            actor: { id: 'tek-2', username: 'teknisi2', name: 'Teknisi Dua', channel: 'wa' },
            photo: {
                fileName: 'proof-1.jpg',
                path: '/uploads/tickets/2026/04/TST/proof-1.jpg',
                uploadedAt: new Date().toISOString(),
                uploadedBy: 'teknisi2',
                source: 'wa_teknisi',
                order: 1
            }
        });
        appendTechnicianPhoto({
            ticketId: ticket.ticketId,
            actor: { id: 'tek-2', username: 'teknisi2', name: 'Teknisi Dua', channel: 'wa' },
            photo: {
                fileName: 'proof-2.jpg',
                path: '/uploads/tickets/2026/04/TST/proof-2.jpg',
                uploadedAt: new Date().toISOString(),
                uploadedBy: 'teknisi2',
                source: 'wa_teknisi',
                order: 2
            }
        });

        const result = completeTicket({
            ticketId: ticket.ticketId,
            actor: {
                id: 'tek-2',
                username: 'teknisi2',
                name: 'Teknisi Dua',
                phoneNumber: '082222222222',
                channel: 'wa'
            },
            resolutionNotes: 'Diselesaikan dari jalur WA'
        });

        expect(result.ticket.status).toBe('completed');
        expect(result.ticket.teknisiPhotos).toHaveLength(2);
        expect(result.ticket).not.toHaveProperty('resolved_at');
    });

    test('web teknisi shares location on an active ticket and notifies the customer', async () => {
        const fs = require('fs');
        const { getLocationFilePath } = require('../../lib/ticket-location-service');
        const user = { id: 4, name: 'Joko', phone_number: '081255500000', address: 'Jl. Lokasi' };
        global.users = [user];
        const created = createBaseTicket({
            user,
            laporanText: 'Internet mati',
            priority: 'HIGH',
            issueType: 'GENERAL',
            createdBy: 'bot',
            createdByRole: 'customer'
        });
        // Tiket sedang ditangani teknisi
        global.reports[0].status = 'otw';
        global.reports[0].teknisiId = 'tek-1';

        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/ticket/share-location`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ticketId: created.ticketId,
                    location: { latitude: -2.123456, longitude: 113.987654, accuracy: 12 }
                })
            });
            const payload = await response.json();

            expect(response.status).toBe(200);
            expect(payload.data.customerNotified).toBe(true);
            expect(payload.data.googleMapsUrl).toContain('-2.123456,113.987654');
            expect(global.reports[0].lastLocation).toContain('-2.123456,113.987654');
            expect(mockNotificationService.notifyCustomerTicketUpdate).toHaveBeenCalledTimes(1);
            expect(fs.existsSync(getLocationFilePath(created.ticketId))).toBe(true);
        } finally {
            await stopServer(server);
            try {
                fs.unlinkSync(getLocationFilePath(created.ticketId));
            } catch (cleanupError) { /* ignore */ }
        }
    });

    test('web teknisi share-location is rejected when ticket is not being handled', async () => {
        const user = { id: 5, name: 'Wati', phone_number: '081266600000', address: 'Jl. Baru' };
        global.users = [user];
        const created = createBaseTicket({
            user,
            laporanText: 'Internet lemot',
            priority: 'MEDIUM',
            issueType: 'GENERAL',
            createdBy: 'bot',
            createdByRole: 'customer'
        });
        // Status masih 'baru' (belum diproses)

        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/ticket/share-location`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ticketId: created.ticketId,
                    location: { latitude: -2.1, longitude: 113.9 }
                })
            });
            const payload = await response.json();

            expect(response.status).toBe(400);
            expect(payload.message).toContain('Berbagi lokasi hanya tersedia');
            expect(mockNotificationService.notifyCustomerTicketUpdate).not.toHaveBeenCalled();
        } finally {
            await stopServer(server);
        }
    });
});
