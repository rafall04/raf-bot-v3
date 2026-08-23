const express = require('express');
const http = require('http');

let mockRequestStore = [];
let mockedApplyPaymentStatusChange;

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
    if (type === 'array') {
      return value;
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

jest.mock('../../lib/payment-finance-service', () => {
  mockedApplyPaymentStatusChange = jest.fn(async () => ({ action: 'paid', becameFullyPaid: true }));
  return {
    applyPaymentStatusChange: mockedApplyPaymentStatusChange,
    getPackagePrice: jest.fn(() => 150000),
    getEffectivePrice: jest.fn(() => 150000),
    normalizeUserPaymentMethod: jest.fn((value) => {
      if (value === undefined || value === null) {
        return null;
      }
      const normalized = String(value).trim().toUpperCase();
      return ['CASH', 'TRANSFER_BANK'].includes(normalized) ? normalized : null;
    }),
    normalizePaymentRequestScope: jest.fn((request) => ({
      ...request,
      request_type: request?.request_type || (request?.is_partial_payment ? 'partial_payment' : 'payment_status_change')
    })),
    isSamePaymentRequestScope: jest.fn((left, right) =>
      // #b254: request_type SENGAJA tidak ikut — satu pelanggan+periode = satu pengajuan menunggu.
      String(left.userId) === String(right.userId)
      && Number(left.period_month) === Number(right.period_month)
      && Number(left.period_year) === Number(right.period_year)
    )
  };
});

const router = require('../requests');

function createDbStub() {
  return {
    all(sql, callback) {
      callback(null, [{ name: 'send_invoice' }]);
    },
    run(_sql, _params, callback) {
      callback(null);
    }
  };
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: 'admin-1', username: 'owner', role: 'owner', name: 'Owner' };
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

describe('requests approval atomicity', () => {
  beforeEach(() => {
    mockRequestStore = [
      {
        id: 1,
        userId: 101,
        userName: 'Customer A',
        newStatus: true,
        status: 'pending',
        request_type: 'payment_status_change',
        period_month: 4,
        period_year: 2026,
        created_at: '2026-04-10T10:00:00.000Z',
        requested_by_teknisi_id: 77
      },
      {
        id: 2,
        userId: 102,
        userName: 'Customer B',
        newStatus: true,
        status: 'pending',
        request_type: 'payment_status_change',
        period_month: 4,
        period_year: 2026,
        created_at: '2026-04-10T10:00:00.000Z',
        requested_by_teknisi_id: 77
      }
    ];
    global.users = [
      { id: 101, name: 'Customer A', paid: 0, subscription: 'Paket 150K', send_invoice: 0 },
      { id: 102, name: 'Customer B', paid: 0, subscription: 'Paket 150K', send_invoice: 0 }
    ];
    global.accounts = [
      { id: 77, role: 'teknisi', username: 'teknisi-a', name: 'Teknisi A' }
    ];
    global.config = { ownerNumber: [] };
    global.db = createDbStub();
    mockedApplyPaymentStatusChange.mockReset();
  });

  afterEach(() => {
    delete global.users;
    delete global.accounts;
    delete global.config;
    delete global.db;
  });

  test('single approval keeps request pending when finance mutation is rejected', async () => {
    mockedApplyPaymentStatusChange.mockResolvedValueOnce({ action: 'no_change', reason: 'already_fully_paid' });
    const app = createApp();
    const { server, baseUrl } = await startServer(app);

    try {
      const response = await fetch(`${baseUrl}/api/requests/approve-paid-change`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: 1, approved: true })
      });

      expect(response.status).toBe(409);
      expect(mockRequestStore[0].status).toBe('pending');
    } finally {
      await stopServer(server);
    }
  });

  test('bulk approval only marks successful requests as approved', async () => {
    mockedApplyPaymentStatusChange
      .mockResolvedValueOnce({ action: 'paid' })
      .mockResolvedValueOnce({ action: 'no_change', reason: 'already_fully_paid' });

    const app = createApp();
    const { server, baseUrl } = await startServer(app);

    try {
      const response = await fetch(`${baseUrl}/api/requests/bulk-approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestIds: [1, 2] })
      });
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.results.approved).toHaveLength(1);
      expect(payload.results.failed).toHaveLength(1);
      expect(mockRequestStore[0].status).toBe('approved');
      expect(mockRequestStore[1].status).toBe('pending');
    } finally {
      await stopServer(server);
    }
  });

  test('bulk approval keeps teknisi legacy requests on CASH method', async () => {
    mockedApplyPaymentStatusChange.mockResolvedValueOnce({ action: 'paid' });

    const app = createApp();
    const { server, baseUrl } = await startServer(app);

    try {
      const response = await fetch(`${baseUrl}/api/requests/bulk-approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestIds: [1] })
      });

      expect(response.status).toBe(200);
      expect(mockedApplyPaymentStatusChange).toHaveBeenCalledWith(expect.objectContaining({
        paymentMethod: 'CASH'
      }));
      expect(mockRequestStore[0].payment_method).toBe('CASH');
    } finally {
      await stopServer(server);
    }
  });
});
