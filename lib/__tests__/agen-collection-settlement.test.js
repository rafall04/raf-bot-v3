const sqlite3 = require('sqlite3');

describe('agen collection settlement', () => {
  let service;
  let db;

  beforeEach(async () => {
    jest.resetModules();
    db = new sqlite3.Database(':memory:');
    global.db = db;
    global.config = {
      agenCollectionCommissionEnabled: true,
      agenCollectionCommissionAmount: 3000
    };
    global.accounts = [{ id: 77, username: 'agen-a', name: 'Agen A', role: 'agen' }];
    service = require('../agen-collection-settlement');
    await service.ensureSettlementTable();
  });

  afterEach(async () => {
    await new Promise((resolve) => db.close(resolve));
    delete global.db;
    delete global.config;
    delete global.accounts;
  });

  test('creates one credit for first paid settlement', async () => {
    const user = { id: 201, name: 'Pelanggan A' };

    const result = await service.evaluateAgenCollectionSettlement({
      user,
      paid: true,
      periodMonth: 6,
      periodYear: 2026,
      agenId: '77',
      agenName: 'Agen A',
      sourceRequestId: 'req-1',
      createdBy: 'admin'
    });

    expect(result.applied).toBe(true);
    expect(result.direction).toBe('credit');
    expect(result.amount).toBe(3000);

    const report = await service.getSettlementReport({ month: 6, year: 2026, agenId: '77' });
    expect(report.totals.total_credit).toBe(3000);
    expect(report.totals.total_debit).toBe(0);
    expect(report.totals.net_total).toBe(3000);
    expect(report.summary[0].unique_paid_customers).toBe(1);
  });

  test('does not credit twice for the same customer+period (idempotent)', async () => {
    const user = { id: 202, name: 'Pelanggan B' };
    const base = {
      user,
      paid: true,
      periodMonth: 6,
      periodYear: 2026,
      agenId: '77',
      agenName: 'Agen A',
      createdBy: 'admin'
    };

    await service.evaluateAgenCollectionSettlement({ ...base, sourceRequestId: 'req-2' });
    const second = await service.evaluateAgenCollectionSettlement({ ...base, sourceRequestId: 'req-2b' });

    expect(second.applied).toBe(false);
    expect(second.reason).toBe('already_credited');

    const report = await service.getSettlementReport({ month: 6, year: 2026, agenId: '77' });
    expect(report.totals.total_credit).toBe(3000);
    expect(report.entries).toHaveLength(1);
  });

  test('reverses fee when customer reverted to unpaid in same period', async () => {
    const user = { id: 203, name: 'Pelanggan C' };

    await service.evaluateAgenCollectionSettlement({
      user,
      paid: true,
      periodMonth: 6,
      periodYear: 2026,
      agenId: '77',
      agenName: 'Agen A',
      sourceRequestId: 'req-3',
      createdBy: 'admin'
    });

    const reversed = await service.evaluateAgenCollectionSettlement({
      user,
      paid: false,
      periodMonth: 6,
      periodYear: 2026,
      sourceRequestId: 'req-4',
      createdBy: 'admin'
    });

    expect(reversed.applied).toBe(true);
    expect(reversed.direction).toBe('debit');

    const report = await service.getSettlementReport({ month: 6, year: 2026, agenId: '77' });
    expect(report.totals.total_credit).toBe(3000);
    expect(report.totals.total_debit).toBe(3000);
    expect(report.totals.net_total).toBe(0);
    expect(report.summary[0].unique_paid_customers).toBe(0);
  });

  test('does not create duplicate reversal when no outstanding credit remains', async () => {
    const user = { id: 204, name: 'Pelanggan D' };

    await service.evaluateAgenCollectionSettlement({
      user, paid: true, periodMonth: 6, periodYear: 2026, agenId: '77', agenName: 'Agen A', sourceRequestId: 'req-5', createdBy: 'admin'
    });
    await service.evaluateAgenCollectionSettlement({
      user, paid: false, periodMonth: 6, periodYear: 2026, sourceRequestId: 'req-6', createdBy: 'admin'
    });
    const secondReverse = await service.evaluateAgenCollectionSettlement({
      user, paid: false, periodMonth: 6, periodYear: 2026, sourceRequestId: 'req-7', createdBy: 'admin'
    });

    expect(secondReverse.applied).toBe(false);
    expect(secondReverse.reason).toBe('no_credit_to_reverse');

    const report = await service.getSettlementReport({ month: 6, year: 2026, agenId: '77' });
    expect(report.entries).toHaveLength(2);
    expect(report.totals.net_total).toBe(0);
  });

  test('does nothing when agen commission disabled', async () => {
    global.config.agenCollectionCommissionEnabled = false;
    const user = { id: 205, name: 'Pelanggan E' };

    const result = await service.evaluateAgenCollectionSettlement({
      user, paid: true, periodMonth: 6, periodYear: 2026, agenId: '77', agenName: 'Agen A', sourceRequestId: 'req-8', createdBy: 'admin'
    });

    expect(result.applied).toBe(false);
    expect(result.reason).toBe('commission_disabled');

    const report = await service.getSettlementReport({ month: 6, year: 2026, agenId: '77' });
    expect(report.entries).toHaveLength(0);
  });
});
