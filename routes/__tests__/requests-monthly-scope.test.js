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

jest.mock('../../lib/approval-logic', () => ({
  handlePaidStatusChange: jest.fn(async () => true),
  sendTechnicianNotification: jest.fn(async () => true)
}));

jest.mock('../../lib/activity-logger', () => ({
  logActivity: jest.fn(async () => true)
}));

jest.mock('../../lib/security', () => ({
  rateLimit: jest.fn(() => (req, res, next) => next()),
  validateInput: jest.fn((value, type) => {
    if (type === 'boolean') {
      return value === true || value === 'true' || value === 1;
    }
    return value;
  })
}));

jest.mock('../../lib/request-lock', () => ({
  withLock: jest.fn(async (_key, callback) => callback())
}));

jest.mock('../../lib/whatsapp-delivery-service', () => ({
  sendMessageToMany: jest.fn(async () => ({ sent: true, successCount: 0 }))
}));

jest.mock('../../lib/technician-collection-settlement', () => ({
  getPeriodParts: jest.requireActual('../../lib/technician-collection-settlement').getPeriodParts
}));

jest.mock('../../lib/payment-finance-service', () => ({
  applyPaymentStatusChange: jest.fn(async () => ({ action: 'paid', becameFullyPaid: true })),
  getPackagePrice: jest.fn(() => 150000),
  getEffectivePrice: jest.fn(() => 150000),
  normalizePaymentRequestScope: jest.fn((request) => ({
    ...request,
    request_type: request?.request_type || (request?.is_partial_payment ? 'partial_payment' : 'payment_status_change')
  })),
  isSamePaymentRequestScope: jest.fn((left, right) =>
    String(left.userId) === String(right.userId)
    && String(left.request_type) === String(right.request_type)
    && Number(left.period_month) === Number(right.period_month)
    && Number(left.period_year) === Number(right.period_year)
  )
}));

const router = require('../requests');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: '77', username: 'teknisi-a', role: 'teknisi', name: 'Teknisi A' };
    next();
  });
  app.use('/api/requests', router);
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

describe('requests monthly scope', () => {
  beforeEach(() => {
    mockRequestStore = [];
    global.users = [
      { id: 101, name: 'Customer A', paid: 0, subscription: 'Paket 150K', phone_number: '08123', address: 'Jl Test' }
    ];
    global.accounts = [
      { id: 77, role: 'teknisi', username: 'teknisi-a', name: 'Teknisi A' }
    ];
    global.config = {
      site_url_bot: 'http://localhost:3100',
      ownerNumber: []
    };
  });

  afterEach(() => {
    delete global.users;
    delete global.accounts;
    delete global.config;
    delete global.raf;
  });

  test('allows new payment status request when pending request is from previous month', async () => {
    const now = new Date();
    const previousMonth = now.getMonth() === 0 ? 12 : now.getMonth();
    const previousYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    mockRequestStore = [
      {
        id: 1,
        userId: 101,
        userName: 'Customer A',
        newStatus: true,
        status: 'pending',
        request_type: 'payment_status_change',
        period_month: previousMonth,
        period_year: previousYear,
        created_at: new Date(previousYear, previousMonth - 1, 10).toISOString(),
        requested_by_teknisi_id: 77
      }
    ];

    const app = createApp();
    const { server, baseUrl } = await startServer(app);

    try {
      const response = await fetch(`${baseUrl}/api/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: 101, newStatus: true })
      });
      const payload = await response.json();

      expect(response.status).toBe(201);
      expect(payload.status).toBe(201);
      expect(mockRequestStore).toHaveLength(2);
      expect(mockRequestStore[1].request_type).toBe('payment_status_change');
    } finally {
      await stopServer(server);
    }
  });

  test('blocks conflicting pending request in the same month and same type', async () => {
    const now = new Date();
    mockRequestStore = [
      {
        id: 1,
        userId: 101,
        userName: 'Customer A',
        newStatus: true,
        status: 'pending',
        request_type: 'payment_status_change',
        period_month: now.getMonth() + 1,
        period_year: now.getFullYear(),
        created_at: now.toISOString(),
        requested_by_teknisi_id: 77
      }
    ];

    const app = createApp();
    const { server, baseUrl } = await startServer(app);

    try {
      const response = await fetch(`${baseUrl}/api/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: 101, newStatus: true })
      });

      expect(response.status).toBe(409);
    } finally {
      await stopServer(server);
    }
  });
});
