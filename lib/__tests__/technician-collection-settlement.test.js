const sqlite3 = require('sqlite3');

describe('technician collection settlement', () => {
  let service;
  let db;

  beforeEach(async () => {
    jest.resetModules();
    db = new sqlite3.Database(':memory:');
    global.db = db;
    global.config = {
      teknisiCollectionCommissionEnabled: true,
      teknisiCollectionCommissionAmount: 5000
    };
    global.requests = [];
    service = require('../technician-collection-settlement');
    await service.ensureSettlementTable();
  });

  afterEach(async () => {
    await new Promise((resolve) => db.close(resolve));
    delete global.db;
    delete global.config;
    delete global.requests;
  });

  test('creates one credit for first paid settlement', async () => {
    const user = { id: 101, name: 'Pelanggan A' };

    const result = await service.evaluateCollectionSettlement({
      user,
      paid: true,
      periodMonth: 4,
      periodYear: 2026,
      teknisiId: '77',
      teknisiName: 'Teknisi A',
      sourceRequestId: 'req-1',
      createdBy: 'admin'
    });

    expect(result.applied).toBe(true);
    expect(result.direction).toBe('credit');

    const report = await service.getSettlementReport({ month: 4, year: 2026, teknisiId: '77' });
    expect(report.totals.total_credit).toBe(5000);
    expect(report.totals.total_debit).toBe(0);
    expect(report.totals.net_total).toBe(5000);
    expect(report.summary[0].unique_paid_customers).toBe(1);
    // Tanpa tabel payment_history → total_collected graceful 0 (tidak error).
    expect(report.totals.total_collected).toBe(0);
    expect(report.summary[0].total_collected).toBe(0);
  });

  test('total_collected = amount_paid payment_history via source_payment_history_id', async () => {
    const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, (e) => (e ? reject(e) : resolve())));
    await run("CREATE TABLE payment_history (id INTEGER PRIMARY KEY, amount_paid INTEGER)");
    await run("INSERT INTO payment_history (id, amount_paid) VALUES (555, 118000)");

    await service.evaluateCollectionSettlement({
      user: { id: 201, name: 'Pelanggan E' },
      paid: true,
      periodMonth: 7,
      periodYear: 2026,
      teknisiId: '3',
      teknisiName: 'DAVIN',
      sourceRequestId: 'req-e',
      sourcePaymentHistoryId: 555,
      createdBy: 'admin'
    });

    const report = await service.getSettlementReport({ month: 7, year: 2026, teknisiId: '3' });
    expect(report.totals.total_credit).toBe(5000);       // komisi tetap flat
    expect(report.totals.total_collected).toBe(118000);  // nominal ditarik dari pelanggan
    expect(report.summary[0].total_collected).toBe(118000);
    expect(report.summary[0].collected_count).toBe(1);
  });

  test('#b309 (T8): pembatalan MENGURANGI total_collected — debit warisi source_payment_history_id dari kredit', async () => {
    const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, (e) => (e ? reject(e) : resolve())));
    await run("CREATE TABLE payment_history (id INTEGER PRIMARY KEY, amount_paid INTEGER)");
    await run("INSERT INTO payment_history (id, amount_paid) VALUES (777, 125000)");

    const user = { id: 301, name: 'Pelanggan F' };
    await service.evaluateCollectionSettlement({
      user, paid: true, periodMonth: 8, periodYear: 2026,
      teknisiId: '9', teknisiName: 'IVAN', sourceRequestId: 'req-f', sourcePaymentHistoryId: 777, createdBy: 'admin'
    });

    // Pembatalan TANPA sourcePaymentHistoryId — PERSIS jalur reversal nyata. Sebelum #b309 debit
    // bersumber-NULL → total_collected tetap 125000 (menggelembung). Sesudah fix → 0.
    const reversed = await service.evaluateCollectionSettlement({
      user, paid: false, periodMonth: 8, periodYear: 2026, sourceRequestId: 'req-f2', createdBy: 'admin'
    });
    expect(reversed.direction).toBe('debit');

    const report = await service.getSettlementReport({ month: 8, year: 2026, teknisiId: '9' });
    expect(report.totals.total_credit).toBe(5000);
    expect(report.totals.total_debit).toBe(5000);
    expect(report.totals.net_total).toBe(0);
    // INTI FIX: penarikan yang dibatalkan TIDAK lagi menggelembungkan "Total Ditarik".
    expect(report.totals.total_collected).toBe(0);
    expect(report.summary[0].total_collected).toBe(0);
  });

  test('reverses commission when customer reverted to unpaid in same period', async () => {
    const user = { id: 102, name: 'Pelanggan B' };

    await service.evaluateCollectionSettlement({
      user,
      paid: true,
      periodMonth: 4,
      periodYear: 2026,
      teknisiId: '88',
      teknisiName: 'Teknisi B',
      sourceRequestId: 'req-2',
      createdBy: 'admin'
    });

    const reversed = await service.evaluateCollectionSettlement({
      user,
      paid: false,
      periodMonth: 4,
      periodYear: 2026,
      sourceRequestId: 'req-3',
      createdBy: 'admin'
    });

    expect(reversed.applied).toBe(true);
    expect(reversed.direction).toBe('debit');

    const report = await service.getSettlementReport({ month: 4, year: 2026, teknisiId: '88' });
    expect(report.totals.total_credit).toBe(5000);
    expect(report.totals.total_debit).toBe(5000);
    expect(report.totals.net_total).toBe(0);
    expect(report.summary[0].unique_paid_customers).toBe(0);
  });

  test('supports paid to unpaid to paid again without duplicate drift', async () => {
    const user = { id: 103, name: 'Pelanggan C' };

    await service.evaluateCollectionSettlement({
      user,
      paid: true,
      periodMonth: 4,
      periodYear: 2026,
      teknisiId: '99',
      teknisiName: 'Teknisi C',
      sourceRequestId: 'req-4',
      createdBy: 'admin'
    });

    await service.evaluateCollectionSettlement({
      user,
      paid: false,
      periodMonth: 4,
      periodYear: 2026,
      sourceRequestId: 'req-5',
      createdBy: 'admin'
    });

    const recredit = await service.evaluateCollectionSettlement({
      user,
      paid: true,
      periodMonth: 4,
      periodYear: 2026,
      teknisiId: '99',
      teknisiName: 'Teknisi C',
      sourceRequestId: 'req-6',
      createdBy: 'admin'
    });

    expect(recredit.applied).toBe(true);
    expect(recredit.direction).toBe('credit');

    const report = await service.getSettlementReport({ month: 4, year: 2026, teknisiId: '99' });
    expect(report.totals.total_credit).toBe(10000);
    expect(report.totals.total_debit).toBe(5000);
    expect(report.totals.net_total).toBe(5000);
    expect(report.entries).toHaveLength(3);
  });

  test('does not create duplicate reversal when no outstanding credit remains', async () => {
    const user = { id: 104, name: 'Pelanggan D' };

    await service.evaluateCollectionSettlement({
      user,
      paid: true,
      periodMonth: 4,
      periodYear: 2026,
      teknisiId: '100',
      teknisiName: 'Teknisi D',
      sourceRequestId: 'req-7',
      createdBy: 'admin'
    });

    await service.evaluateCollectionSettlement({
      user,
      paid: false,
      periodMonth: 4,
      periodYear: 2026,
      sourceRequestId: 'req-8',
      createdBy: 'admin'
    });

    const secondReverse = await service.evaluateCollectionSettlement({
      user,
      paid: false,
      periodMonth: 4,
      periodYear: 2026,
      sourceRequestId: 'req-9',
      createdBy: 'admin'
    });

    expect(secondReverse.applied).toBe(false);
    expect(secondReverse.reason).toBe('no_credit_to_reverse');

    const report = await service.getSettlementReport({ month: 4, year: 2026, teknisiId: '100' });
    expect(report.entries).toHaveLength(2);
    expect(report.totals.net_total).toBe(0);
  });
});
