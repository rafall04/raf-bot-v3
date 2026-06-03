const express = require('express');
const http = require('http');

jest.mock('../../lib/activity-logger', () => ({
  logActivity: jest.fn(async () => true)
}));

jest.mock('../../lib/financial-ledger', () => ({
  ensureFinancialLedgerTable: jest.fn(async () => true),
  syncFinancialLedgerSources: jest.fn(async () => ({
    payment_history: { inserted: 1, updated: 0, unchanged: 0 }
  })),
  createManualAdjustment: jest.fn(async ({ requestActionId }) => ({ id: 1, status: 'created', requestActionId })),
  getFinancialLedgerEntries: jest.fn(async () => []),
  buildCashflowSummary: jest.fn((entries = []) => {
    const totalIncome = entries
      .filter((entry) => ['customer_payment', 'partial_payment', 'topup_request_approved', 'voucher_purchase', 'agent_transaction_confirmed'].includes(entry.domain))
      .reduce((sum, entry) => sum + entry.amount, 0);
    const totalExpense = entries
      .filter((entry) => ['expense_entry', 'technician_payroll_paid', 'technician_kasbon_credit', 'customer_payment_reversal'].includes(entry.domain))
      .reduce((sum, entry) => sum + (entry.direction === 'credit' ? -entry.amount : entry.amount), 0);
    return {
      totalIncome,
      totalExpense,
      netTotal: totalIncome - totalExpense,
      totalTransactions: entries.length
    };
  }),
  getFinancialLedgerReport: jest.fn(async ({ month, year }) => ({
    entries: [
      {
        id: 1,
        domain: 'customer_payment',
        reference_type: 'payment_history',
        reference_id: '1',
        amount: 300000,
        direction: 'credit',
        payment_method: 'CASH',
        period_month: month,
        period_year: year,
        status: 'completed',
        occurred_at: '2026-04-10T10:00:00.000Z',
        created_by: 'admin',
        notes: 'Pembayaran pelanggan',
        source: 'admin',
        metadata_json: '{}'
      },
      {
        id: 2,
        domain: 'expense_entry',
        reference_type: 'expense_entry',
        reference_id: '2',
        amount: 120000,
        direction: 'debit',
        payment_method: 'CASH',
        period_month: month,
        period_year: year,
        status: 'active',
        occurred_at: '2026-04-11T10:00:00.000Z',
        created_by: 'admin',
        notes: 'Operasional',
        source: 'admin',
        metadata_json: '{}'
      },
      {
        id: 3,
        domain: 'customer_payment_reversal',
        reference_type: 'payment_reversal',
        reference_id: '3',
        amount: 50000,
        direction: 'debit',
        payment_method: 'REVERSAL',
        period_month: month,
        period_year: year,
        status: 'completed',
        occurred_at: '2026-04-12T10:00:00.000Z',
        created_by: 'admin',
        notes: 'Reversal pelanggan',
        source: 'admin',
        metadata_json: '{}'
      }
    ],
    summary: {
      totalIncome: 300000,
      totalExpense: 120000,
      netTotal: 180000,
      totalTransactions: 2
    },
    domainSummary: {
      customer_payment: { count: 1, credit: 300000, debit: 0, net: 300000 },
      expense_entry: { count: 1, credit: 0, debit: 120000, net: -120000 }
    },
    methodSummary: {
      CASH: { count: 2, amount: 420000 }
    },
    sourceSummary: {
      admin: { count: 2, amount: 420000 }
    }
  }))
}));

jest.mock('../../lib/payment-finance-service', () => ({
  getPaymentDiagnostics: jest.fn(async () => ({
    reversal_count: 1,
    reversal_amount: 50000,
    current_period_month: 4,
    current_period_year: 2026,
    mismatched_paid_status: []
  })),
  getPaymentPositionForPeriod: jest.fn(async () => ({
    total_reversal: 0,
    net_paid: 300000,
    is_fully_paid: true
  })),
  getEffectivePrice: jest.fn(() => 300000),
  normalizePaymentRequestScope: jest.fn((request) => request)
}));

jest.mock('../../lib/expense-manager', () => ({
  getExpenseSummary: jest.fn(async () => ({
    total_expense: 120000,
    total_records: 1,
    by_category: {
      operasional: { count: 1, amount: 120000 }
    },
    recent: [
      {
        id: 10,
        title: 'Beli alat',
        category: 'operasional',
        amount: 120000,
        expense_date: '2026-04-11T10:00:00.000Z',
        payment_method: 'CASH',
        vendor_or_counterparty: 'Toko'
      }
    ],
    largest: [
      {
        id: 10,
        title: 'Beli alat',
        category: 'operasional',
        amount: 120000,
        expense_date: '2026-04-11T10:00:00.000Z',
        payment_method: 'CASH',
        vendor_or_counterparty: 'Toko'
      }
    ]
  }))
}));

const router = require('../rekap-keuangan');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: 'admin-1', username: 'owner', role: 'owner' };
    next();
  });
  app.use('/api/rekap-keuangan', router);
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

describe('rekap keuangan dashboard route', () => {
  test('returns finance dashboard payload with expense and health sections', async () => {
    const app = createApp();
    const { server, baseUrl } = await startServer(app);

    try {
      const response = await fetch(`${baseUrl}/api/rekap-keuangan?month=4&year=2026`);
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.status).toBe(200);
      expect(payload.data.summary).toMatchObject({
        totalIncome: 300000,
        totalExpense: 170000,
        netTotal: 130000
      });
      expect(payload.data.expenseCategorySummary.operasional.amount).toBe(120000);
      expect(payload.data.recentExpenses).toHaveLength(1);
      expect(payload.data.largestExpenses).toHaveLength(1);
      expect(payload.data.monthlyTrend).toHaveLength(6);
      expect(payload.data.cashflowHealth).toHaveProperty('status');
      expect(payload.data.cashflowHealth).toHaveProperty('warnings');
    } finally {
      await stopServer(server);
    }
  });

  test('returns diagnostics payload', async () => {
    const app = createApp();
    const { server, baseUrl } = await startServer(app);

    try {
      const response = await fetch(`${baseUrl}/api/rekap-keuangan/diagnostics?month=4&year=2026`);
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.status).toBe(200);
      expect(payload.data.paymentReversals).toMatchObject({
        count: 1,
        amount: 50000
      });
      expect(payload.data.ledgerSync.payment_history.inserted).toBe(1);
    } finally {
      await stopServer(server);
    }
  });

  test('returns yearly diagnostics payload with yearly scope label', async () => {
    const app = createApp();
    const { server, baseUrl } = await startServer(app);

    try {
      const response = await fetch(`${baseUrl}/api/rekap-keuangan/diagnostics?type=year&year=2026`);
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.status).toBe(200);
      expect(payload.data.period).toBe('Tahun 2026');
      expect(payload.data).toHaveProperty('paymentReversals');
      expect(payload.data).toHaveProperty('approvalConsistency');
    } finally {
      await stopServer(server);
    }
  });
});
