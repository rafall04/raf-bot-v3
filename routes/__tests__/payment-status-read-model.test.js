const express = require('express');
const http = require('http');

jest.mock('../../lib/approval-logic', () => ({
  handlePaidStatusChange: jest.fn(async () => true)
}));

jest.mock('../../lib/technician-collection-settlement', () => ({
  getPeriodParts: jest.fn(({ periodMonth, periodYear, date }) => {
    if (Number.isInteger(periodMonth) && Number.isInteger(periodYear)) {
      return { periodMonth, periodYear };
    }
    const sourceDate = date instanceof Date ? date : new Date(date);
    return { periodMonth: sourceDate.getMonth() + 1, periodYear: sourceDate.getFullYear() };
  })
}));

const mockGetPaymentPositionForPeriod = jest.fn();
const mockGetEffectivePrice = jest.fn();
const mockApplyPaymentStatusChange = jest.fn();

jest.mock('../../lib/payment-finance-service', () => ({
  applyPaymentStatusChange: (...args) => mockApplyPaymentStatusChange(...args),
  getEffectivePrice: (...args) => mockGetEffectivePrice(...args),
  getPaymentPositionForPeriod: (...args) => mockGetPaymentPositionForPeriod(...args)
}));

const router = require('../payment-status');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: '1', username: 'admin', role: 'admin' };
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

describe('payment-status read model', () => {
  beforeEach(() => {
    global.users = [
      { id: 101, name: 'Customer A', subscription: 'Paket 150K', subscription_price: 150000, paid: 0 }
    ];
    mockGetEffectivePrice.mockReset();
    mockGetPaymentPositionForPeriod.mockReset();
    mockApplyPaymentStatusChange.mockReset();
    mockGetEffectivePrice.mockReturnValue(150000);
    mockGetPaymentPositionForPeriod.mockResolvedValue({
      gross_paid: 150000,
      total_reversal: 0,
      net_paid: 150000,
      outstanding: 0,
      is_fully_paid: true
    });
  });

  afterEach(() => {
    delete global.users;
  });

  test('returns period-scoped paid status read model', async () => {
    const app = createApp();
    const { server, baseUrl } = await startServer(app);

    try {
      const response = await fetch(`${baseUrl}/api/payment-status/read-model?period_month=4&period_year=2026`);
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.status).toBe(200);
      expect(payload.period).toEqual({ month: 4, year: 2026 });
      expect(payload.data).toHaveLength(1);
      expect(payload.data[0]).toMatchObject({
        id: 101,
        paid: 1,
        amount_due: 150000,
        outstanding: 0,
        paid_status_period_month: 4,
        paid_status_period_year: 2026
      });
      expect(mockGetPaymentPositionForPeriod).toHaveBeenCalledWith(
        expect.objectContaining({ id: 101 }),
        4,
        2026,
        { amountDue: 150000 }
      );
    } finally {
      await stopServer(server);
    }
  });
});
