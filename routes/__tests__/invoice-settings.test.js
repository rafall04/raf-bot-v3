const express = require('express');
const http = require('http');

jest.mock('../../lib/templating', () => ({
    renderTemplate: jest.fn(() => 'Invoice caption')
}));

jest.mock('../../lib/whatsapp-delivery-service', () => ({
    sendMessageToMany: jest.fn(async () => ({ sent: true, successCount: 1, recipients: ['628123@s.whatsapp.net'] }))
}));

const invoiceRouter = require('../invoice');

function createApp() {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        req.user = { id: 'admin-1', username: 'owner', role: 'owner' };
        next();
    });
    app.use('/api', invoiceRouter);
    return app;
}

async function startServer(app) {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    return { server, baseUrl: `http://127.0.0.1:${port}` };
}

async function stopServer(server) {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
}

describe('invoice settings route', () => {
    beforeEach(() => {
        global.config = {
            invoice: {
                prefix: 'INV',
                enableTax: false,
                taxRate: 11,
                dueDays: 30,
                dueDateDay: 10,
                dueDateType: 'fixed',
                autoSend: true,
                sendPDF: true
            },
            pdfCustomization: {
                showDueDate: true
            },
            company: {},
            bankAccount: {}
        };
    });

    test('GET invoice-settings defaults dueDateType to fixed', async () => {
        const app = createApp();
        const { server, baseUrl } = await startServer(app);
        try {
            const response = await fetch(`${baseUrl}/api/invoice-settings`);
            const payload = await response.json();
            expect(response.status).toBe(200);
            expect(payload.invoice.dueDateType).toBe('fixed');
        } finally {
            await stopServer(server);
        }
    });

    test('preview pdf sample keeps due date in the same month', async () => {
        const app = createApp();
        const { server, baseUrl } = await startServer(app);
        try {
            const response = await fetch(`${baseUrl}/api/preview-pdf-invoice`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ customization: {} })
            });
            const html = await response.text();
            expect(response.status).toBe(200);
            expect(html).toContain('Jatuh Tempo:');
            expect(html).not.toContain('Invalid Date');
        } finally {
            await stopServer(server);
        }
    });
});
