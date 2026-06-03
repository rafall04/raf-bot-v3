/**
 * Header Doc
 * Purpose: Guardrail untuk memastikan restart service WhatsApp di monitoring dashboard memakai helper bootstrap runtime.
 * Caller: Jest runner tranche final WA runtime cleanup.
 * Deps: `../monitoring-dashboard` dan mock `../../lib/whatsapp-bootstrap`.
 * MainFuncs: `createApp`, `startServer`, `stopServer`.
 * SideEffects: Menjalankan server HTTP test sementara dan memanggil mock reconnect runtime.
 */
"use strict";

const express = require('express');
const http = require('http');

function createApp(router) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.user = { id: '1', username: 'admin', role: 'admin' };
        next();
    });
    app.use('/api/monitoring', router);
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

describe('routes/monitoring-dashboard runtime route', () => {
    test('restart-service whatsapp memakai helper reconnect bootstrap', async () => {
        jest.resetModules();
        const triggerWhatsAppReconnect = jest.fn(async () => true);
        jest.doMock('../../lib/whatsapp-bootstrap', () => ({
            triggerWhatsAppReconnect
        }));

        const router = require('../monitoring-dashboard');
        const { server, baseUrl } = await startServer(createApp(router));

        try {
            const response = await fetch(`${baseUrl}/api/monitoring/restart-service`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ service: 'whatsapp' })
            });
            const payload = await response.json();

            expect(response.status).toBe(200);
            expect(payload.success).toBe(true);
            expect(triggerWhatsAppReconnect).toHaveBeenCalledTimes(1);
        } finally {
            await stopServer(server);
            jest.dontMock('../../lib/whatsapp-bootstrap');
        }
    });
});
