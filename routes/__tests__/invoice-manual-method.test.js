const express = require('express');
const http = require('http');

jest.mock('../../lib/templating', () => ({
  renderTemplate: jest.fn(() => 'Invoice')
}));

jest.mock('../../lib/whatsapp-delivery-service', () => ({
  sendMessageToMany: jest.fn(async () => ({ sent: true }))
}));

jest.mock('../../lib/payment-finance-service', () => ({
  normalizeUserPaymentMethod: jest.fn((value) => {
    if (value === undefined || value === null) return null;
    const normalized = String(value).trim().toUpperCase();
    return ['CASH', 'TRANSFER_BANK'].includes(normalized) ? normalized : null;
  })
}));

jest.mock('../../lib/invoice-generator', () => ({
  createInvoice: jest.fn((_user, paymentData) => ({
    invoiceNumber: 'INV-001',
    payment: { method: paymentData.method },
    customer: { id: 101 }
  })),
  calculateInvoiceDueDate: jest.fn(),
  getInvoiceSettings: jest.fn(() => ({}))
}));

jest.mock('../../lib/pdf-invoice-generator', () => ({
  createInvoicePDF: jest.fn(async () => ({ buffer: Buffer.from('pdf') })),
  generatePDFInvoice: jest.fn(async () => Buffer.from('pdf')),
  generateInvoiceHTML: jest.fn(() => '<html></html>')
}));

const router = require('../invoice');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: 'admin-1', username: 'owner', role: 'owner' };
    next();
  });
  app.use('/api', router);
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

describe('manual invoice payment method', () => {
  beforeEach(() => {
    global.users = [
      { id: 101, name: 'Customer A', phone_number: '08123' }
    ];
    global.config = {};
  });

  afterEach(() => {
    delete global.users;
    delete global.config;
  });

  test('rejects BANK_TRANSFER alias on manual invoice route', async () => {
    const app = createApp();
    const { server, baseUrl } = await startServer(app);

    try {
      const response = await fetch(`${baseUrl}/api/send-invoice-manual`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId: 101,
          userName: 'Customer A',
          phoneNumber: '08123',
          method: 'BANK_TRANSFER',
          noSend: true
        })
      });
      const payload = await response.json();

      expect(response.status).toBe(400);
      expect(payload.message).toMatch(/CASH atau TRANSFER_BANK/i);
    } finally {
      await stopServer(server);
    }
  });
});
