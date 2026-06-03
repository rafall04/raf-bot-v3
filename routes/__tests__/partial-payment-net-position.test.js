const express = require('express');
const http = require('http');

let mockRequestStore = [];

jest.mock('../../lib/database', () => ({
  loadJSON: jest.fn(() => mockRequestStore),
  saveJSON: jest.fn((target, value) => {
    if (target === 'database/requests.json') {
      mockRequestStore = value;
    }
  })
}));

jest.mock('../../lib/activity-logger', () => ({
  logActivity: jest.fn(async () => true)
}));

jest.mock('../../lib/security', () => ({
  rateLimit: jest.fn(() => (req, res, next) => next()),
  validateInput: jest.fn((value) => value)
}));

jest.mock('../../lib/request-lock', () => ({
  withLock: jest.fn(async (_key, callback) => callback())
}));

jest.mock('../../lib/payment-finance-service', () => ({
  applyPaymentStatusChange: jest.fn(async () => ({ action: 'paid' })),
  getEffectivePrice: jest.fn(() => 150000),
  getPaymentPositionForPeriod: jest.fn(async () => ({
    gross_paid: 150000,
    total_reversal: 150000,
    net_paid: 0,
    outstanding: 150000,
    is_fully_paid: false
  })),
  syncUserPaidStatusForCurrentPeriod: jest.fn(async () => ({
    gross_paid: 150000,
    total_reversal: 150000,
    net_paid: 0,
    outstanding: 150000,
    is_fully_paid: false
  })),
  getPaymentTimelineForPeriod: jest.fn(async () => ({ entries: [], summary: {} })),
  getPaymentReportForPeriod: jest.fn(async () => ({ summary: {}, transactions: [] })),
  normalizePaymentRequestScope: jest.fn((request) => ({
    ...request,
    request_type: request?.request_type || (request?.is_partial_payment ? 'partial_payment' : 'payment_status_change')
  }))
}));

const router = require('../partial-payment');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: '77', username: 'teknisi-a', role: 'teknisi', name: 'Teknisi A' };
    next();
  });
  app.use('/api/partial-payment', router);
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

describe('partial payment net position validation', () => {
  beforeEach(() => {
    mockRequestStore = [];
    global.users = [
      { id: 101, name: 'Customer A', subscription: 'Paket 150K', subscription_price: 150000, paid: 0 }
    ];
  });

  afterEach(() => {
    delete global.users;
  });

  test('allows new partial payment request after reversal because outstanding uses net payment', async () => {
    const app = createApp();
    const { server, baseUrl } = await startServer(app);

    try {
      const response = await fetch(`${baseUrl}/api/partial-payment/request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: 101, amountPaid: 50000, notes: 'Bayar ulang' })
      });
      const payload = await response.json();

      expect(response.status).toBe(201);
      expect(payload.status).toBe(201);
      expect(mockRequestStore).toHaveLength(1);
      expect(mockRequestStore[0].request_type).toBe('partial_payment');
      expect(mockRequestStore[0].total_paid_before).toBe(0);
    } finally {
      await stopServer(server);
    }
  });
});
