const express = require('express');
const http = require('http');

jest.mock('../../lib/approval-logic', () => ({
  handlePaidStatusChange: jest.fn(async () => true)
}));

jest.mock('../../lib/technician-collection-settlement', () => ({
  getPeriodParts: jest.fn(({ periodMonth, periodYear }) => ({
    periodMonth,
    periodYear
  }))
}));

jest.mock('../../lib/payment-finance-service', () => ({
  applyPaymentStatusChange: jest.fn(async () => ({ action: 'paid' })),
  getEffectivePrice: jest.fn(() => 150000)
}));

const router = require('../payment-status');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: 'admin-1', username: 'owner', role: 'owner' };
    next();
  });
  app.use('/api/payment-status', router);
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

describe('payment status bulk update period requirement', () => {
  beforeEach(() => {
    global.users = [
      { id: 101, name: 'Customer A', subscription: 'Paket 150K', subscription_price: 150000, paid: 0 }
    ];
  });

  afterEach(() => {
    delete global.users;
  });

  test('rejects bulk update without explicit period context', async () => {
    const app = createApp();
    const { server, baseUrl } = await startServer(app);

    try {
      const response = await fetch(`${baseUrl}/api/payment-status/bulk-update`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userIds: [101], paid: true })
      });
      const payload = await response.json();

      expect(response.status).toBe(400);
      expect(payload.message).toMatch(/period_month/i);
    } finally {
      await stopServer(server);
    }
  });
});
