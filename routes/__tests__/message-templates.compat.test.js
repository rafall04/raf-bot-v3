/**
 * Header Doc
 * Purpose: Guardrail compat route `/api/message-templates` agar tetap notification-template adapter, bukan full template editor.
 * Caller: Jest test runner.
 * Deps: express, http, ../../lib/template-service, ../message-templates.
 * MainFuncs: createApp, startServer, stopServer.
 * SideEffects: Membuka HTTP server lokal selama test.
 */

const express = require('express');
const http = require('http');

jest.mock('../../lib/activity-logger', () => ({
    logActivity: jest.fn().mockResolvedValue()
}));

jest.mock('../../lib/database', () => ({
    loadJSON: jest.fn((file) => {
        if (file === 'message_templates.json') {
            return {
                discount_notification: {
                    name: 'Diskon',
                    category: 'discount',
                    template: 'Halo ${customer_name}'
                }
            };
        }
        return {};
    }),
    saveJSON: jest.fn()
}));

const templateService = require('../../lib/template-service');
const messageTemplatesRouter = require('../message-templates');

function createApp() {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        req.user = {
            id: 'admin-1',
            username: 'owner',
            role: 'owner',
            name: 'Owner'
        };
        next();
    });
    app.use('/api/message-templates', messageTemplatesRouter);
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

describe('message-templates compat route', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        templateService.resetLegacyUsage();
        templateService.loadAllCategories();
    });

    test('diagnostics route exposes unified source dan message-template-helper bukan legacy lagi', async () => {
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            await fetch(`${baseUrl}/api/message-templates`);
            const response = await fetch(`${baseUrl}/api/message-templates/diagnostics`);
            const payload = await response.json();

            expect(response.status).toBe(200);
            expect(payload.data.sourceFiles.notificationTemplates).toBe('message_templates.json');
            expect(payload.data.sourceFiles.menuTemplates).toBe('menu_templates.json');
            expect(payload.data.sourceFiles.reportTemplates).toBe('report_templates.json');
            expect(payload.data.categories).toEqual(expect.objectContaining({
                notificationTemplates: expect.any(Number),
                menuTemplates: expect.any(Number),
                reportTemplates: expect.any(Number)
            }));
            // Guardrail: message-template-helper sudah dipromote ke proper facade,
            // tidak boleh lagi muncul di legacyUsage diagnostic.
            const messageTemplateHelperUsage = (payload.data.legacyUsage || []).find(
                (entry) => entry.adapter === 'message-template-helper'
            );
            expect(messageTemplateHelperUsage).toBeUndefined();
        } finally {
            await stopServer(server);
        }
    });
});
