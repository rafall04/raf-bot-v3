/**
 * Header Doc
 * Purpose: Guardrail untuk memastikan route stats membaca status bot dari gateway runtime, bukan global WA mentah.
 * Caller: Jest runner tranche cleanup final WA runtime.
 * Deps: `../stats` dan `../../lib/whatsapp-gateway`.
 * MainFuncs: `createApp`, `startServer`, `stopServer`.
 * SideEffects: Mengubah socket/state gateway selama pengujian.
 */
"use strict";

const express = require('express');
const http = require('http');

function createApp(router) {
    const app = express();
    app.use((req, _res, next) => {
        req.user = { id: '1', username: 'admin', role: 'admin' };
        next();
    });
    app.use('/api/stats', router);
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

describe('routes/stats runtime route', () => {
    let gateway;
    let router;

    beforeEach(() => {
        jest.resetModules();
        gateway = require('../../lib/whatsapp-gateway');
        gateway.clearActiveSocket({ nextState: 'close' });
        delete global.conn;
        delete global.raf;
        delete global.whatsappConnectionState;
        global.users = [];
        global.packages = [];
        router = require('../stats');
    });

    test('sync-status membaca snapshot gateway', async () => {
        gateway.setActiveSocket(
            { sendMessage: jest.fn(), user: { id: '6281@s.whatsapp.net' }, ws: { readyState: 1 } },
            { state: 'open' }
        );

        const { server, baseUrl } = await startServer(createApp(router));
        try {
            const response = await fetch(`${baseUrl}/api/stats/sync-status`);
            const payload = await response.json();

            expect(response.status).toBe(200);
            expect(payload.success).toBe(true);
            expect(payload.status.connectionState).toBe('open');
            expect(payload.status.hasUser).toBe(true);
        } finally {
            await stopServer(server);
        }
    });

    test('bot-status tetap memberi shape status saat runtime offline', async () => {
        const { server, baseUrl } = await startServer(createApp(router));
        try {
            const response = await fetch(`${baseUrl}/api/stats/bot-status`);
            const payload = await response.json();

            expect(response.status).toBe(200);
            expect(payload.botStatus).toBe(false);
            expect(payload.connectionState).toBe('close');
        } finally {
            await stopServer(server);
        }
    });

    test('start memakai helper reconnect bootstrap saat runtime offline', async () => {
        jest.resetModules();
        const triggerWhatsAppReconnect = jest.fn(async () => true);
        jest.doMock('../../lib/whatsapp-bootstrap', () => ({
            triggerWhatsAppReconnect
        }));

        gateway = require('../../lib/whatsapp-gateway');
        gateway.clearActiveSocket({ nextState: 'close' });
        router = require('../stats');

        const { server, baseUrl } = await startServer(createApp(router));
        try {
            const response = await fetch(`${baseUrl}/api/stats/start`);
            const payload = await response.json();

            expect(response.status).toBe(200);
            expect(payload.message).toBe('starting bot');
            expect(triggerWhatsAppReconnect).toHaveBeenCalledTimes(1);
        } finally {
            await stopServer(server);
            jest.dontMock('../../lib/whatsapp-bootstrap');
        }
    });
});
