const express = require('express');
const http = require('http');

jest.mock('../../lib/services/isolir-service', () => ({
    listCandidates: jest.fn(),
    getHistory: jest.fn(),
    getHistoryById: jest.fn(),
    manualIsolir: jest.fn(),
    openUsers: jest.fn(),
}));

const IsolirService = require('../../lib/services/isolir-service');
const { registerAdminIsolirRoutes } = require('../admin-isolir-routes');

function createApp() {
    const app = express();
    const router = express.Router();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.user = { id: 'admin-1', username: 'owner', role: 'owner' };
        next();
    });

    registerAdminIsolirRoutes({
        router,
        ensureAuthenticatedStaff: (_req, _res, next) => next(),
        logActivity: jest.fn(async () => undefined),
    });

    app.use(router);
    return app;
}

async function startServer(app) {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    return { server, baseUrl: `http://127.0.0.1:${port}` };
}

async function stopServer(server) {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

describe('admin isolir routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('GET /api/isolir/candidates returns paginated metadata for batch UI', async () => {
        IsolirService.listCandidates.mockResolvedValue({
            message: 'ok',
            data: {
                items: [{ id: 1, name: 'User 1', genieacsCapable: false, genieacsReason: 'missing device_id' }],
                pagination: { page: 1, limit: 20, totalItems: 1, totalPages: 1 },
                policy: { isolirManualDefaultProfile: 'ISOLIR' },
                availableProfiles: ['ISOLIR', 'VIP'],
                availableSubscriptions: ['Paket A'],
                summary: {
                    filteredCount: 1,
                    isolatedCount: 0,
                    rebootCapableCount: 0,
                    rebootUnavailableCount: 1,
                },
            },
        });

        const { server, baseUrl } = await startServer(createApp());
        try {
            const response = await fetch(`${baseUrl}/api/isolir/candidates`);
            const payload = await response.json();
            expect(response.status).toBe(200);
            expect(payload.data.items[0]).toMatchObject({
                genieacsCapable: false,
                genieacsReason: 'missing device_id',
            });
            expect(payload.data.pagination).toMatchObject({ totalItems: 1 });
            expect(payload.meta.summary).toMatchObject({ rebootUnavailableCount: 1 });
        } finally {
            await stopServer(server);
        }
    });

    test('GET /api/isolir/history returns paginated audit list', async () => {
        IsolirService.getHistory.mockResolvedValue({
            message: 'ok',
            data: {
                items: [{ id: 'h1', actionType: 'open_isolir', summary: { successCount: 1 } }],
                pagination: { page: 1, limit: 15, totalItems: 1, totalPages: 1 },
            },
        });

        const { server, baseUrl } = await startServer(createApp());
        try {
            const response = await fetch(`${baseUrl}/api/isolir/history?actionType=open_isolir`);
            const payload = await response.json();
            expect(response.status).toBe(200);
            expect(payload.data[0]).toMatchObject({ id: 'h1', actionType: 'open_isolir' });
            expect(payload.meta.pagination).toMatchObject({ totalItems: 1 });
        } finally {
            await stopServer(server);
        }
    });

    test('GET /api/isolir/history/:id returns detail payload', async () => {
        IsolirService.getHistoryById.mockResolvedValue({
            message: 'ok',
            data: {
                id: 'h1',
                actionType: 'manual_isolir',
                results: [{ userId: 1, ok: true }],
            },
        });

        const { server, baseUrl } = await startServer(createApp());
        try {
            const response = await fetch(`${baseUrl}/api/isolir/history/h1`);
            const payload = await response.json();
            expect(response.status).toBe(200);
            expect(payload.data).toMatchObject({
                id: 'h1',
                actionType: 'manual_isolir',
            });
            expect(payload.data.results[0]).toMatchObject({ userId: 1 });
        } finally {
            await stopServer(server);
        }
    });

    test('POST /api/isolir/open exposes standardized data payload', async () => {
        IsolirService.openUsers.mockResolvedValue({
            message: 'done',
            data: {
                historyId: 'open_1',
                summary: {
                    totalSelected: 1,
                    successCount: 1,
                    failedCount: 0,
                    rebootAppliedCount: 0,
                    rebootSkippedCount: 1,
                },
                results: [{
                    userId: 1,
                    name: 'User 1',
                    ok: true,
                    rebootRequested: true,
                    rebootApplied: false,
                    rebootSkippedReason: 'GenieACS dinonaktifkan oleh admin.',
                }],
            },
        });

        const { server, baseUrl } = await startServer(createApp());
        try {
            const response = await fetch(`${baseUrl}/api/isolir/open`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ userIds: [1], reboot: true }),
            });
            const payload = await response.json();
            expect(response.status).toBe(200);
            expect(payload.data.summary).toMatchObject({
                successCount: 1,
                rebootSkippedCount: 1,
            });
            expect(payload.data.historyId).toBe('open_1');
            expect(payload.data.results[0]).toMatchObject({
                rebootRequested: true,
                rebootApplied: false,
                rebootSkippedReason: 'GenieACS dinonaktifkan oleh admin.',
            });
        } finally {
            await stopServer(server);
        }
    });
});
