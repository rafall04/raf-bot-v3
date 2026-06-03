const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3');

describe('financial ledger', () => {
  let db;
  let dbPath;
  let tempDir;
  let ledger;

  function run(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function onRun(err) {
        if (err) {
          reject(err);
          return;
        }
        resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  function get(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(row || null);
      });
    });
  }

  beforeEach(async () => {
    jest.resetModules();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'raf-financial-ledger-'));
    dbPath = path.join(tempDir, 'users-test.sqlite');
    db = new sqlite3.Database(dbPath);
    global.db = db;
    global.accounts = [
      { id: 77, role: 'teknisi', name: 'Teknisi A', username: 'teknisi-a' }
    ];

    jest.doMock('../env-config', () => ({
      getDatabasePath: jest.fn(() => dbPath)
    }));

    ledger = require('../financial-ledger');
    await ledger.ensureFinancialLedgerTable();

    await run(`
      CREATE TABLE payment_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        amount_paid INTEGER,
        amount_due INTEGER,
        is_partial INTEGER,
        period_month INTEGER,
        period_year INTEGER,
        payment_method TEXT,
        notes TEXT,
        created_by TEXT,
        created_at TEXT
      )
    `);

    await run(`
      CREATE TABLE payment_reversals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        period_month INTEGER NOT NULL,
        period_year INTEGER NOT NULL,
        amount_reversed INTEGER NOT NULL,
        source_request_id TEXT,
        source_admin_action TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        reason TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'completed',
        event_key TEXT NOT NULL
      )
    `);

    await run(`
      CREATE TABLE technician_collection_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teknisi_id TEXT NOT NULL,
        teknisi_name TEXT NOT NULL,
        user_id TEXT NOT NULL,
        user_name TEXT NOT NULL,
        period_month INTEGER NOT NULL,
        period_year INTEGER NOT NULL,
        commission_amount INTEGER NOT NULL,
        direction TEXT NOT NULL,
        reason TEXT NOT NULL,
        source_request_id TEXT,
        source_payment_history_id INTEGER,
        event_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        payroll_id INTEGER,
        payroll_locked_at TEXT
      )
    `);
  });

  afterEach(async () => {
    jest.dontMock('../env-config');
    await new Promise((resolve) => db.close(resolve));
    delete global.db;
    delete global.accounts;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('syncs payment history and collection entries idempotently', async () => {
    await run(
      `INSERT INTO payment_history (
        user_id, amount_paid, amount_due, is_partial, period_month, period_year,
        payment_method, notes, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [101, 150000, 150000, 0, 4, 2026, 'CASH', 'Lunas April', 'admin', '2026-04-01T10:00:00.000Z']
    );
    await run(
      `INSERT INTO payment_history (
        user_id, amount_paid, amount_due, is_partial, period_month, period_year,
        payment_method, notes, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [102, 50000, 150000, 1, 4, 2026, 'TRANSFER_BANK', 'Cicilan April', 'teknisi-a', '2026-04-02T10:00:00.000Z']
    );
    await run(
      `INSERT INTO technician_collection_ledger (
        teknisi_id, teknisi_name, user_id, user_name, period_month, period_year,
        commission_amount, direction, reason, source_request_id, source_payment_history_id,
        event_key, created_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['77', 'Teknisi A', '101', 'Customer A', 4, 2026, 5000, 'credit', 'customer_paid_final', 'REQ-1', 1, 'settlement-1', '2026-04-01T10:30:00.000Z', 'admin']
    );

    await ledger.syncFinancialLedgerSources({ domains: ['payment_history', 'technician_collection'] });
    await ledger.syncFinancialLedgerSources({ domains: ['payment_history', 'technician_collection'] });

    const row = await get('SELECT COUNT(*) AS total FROM financial_ledger');
    expect(row.total).toBe(3);

    const report = await ledger.getFinancialLedgerReport({ month: 4, year: 2026 });
    expect(report.summary.totalIncome).toBe(205000);
    expect(report.summary.totalExpense).toBe(0);
    expect(report.summary.netTotal).toBe(205000);
    expect(report.domainSummary.customer_payment.credit).toBe(150000);
    expect(report.domainSummary.partial_payment.credit).toBe(50000);
    expect(report.domainSummary.technician_collection_commission.credit).toBe(5000);
  });

  test('upserts existing ledger row when source status changes', async () => {
    await run(
      `INSERT INTO technician_collection_ledger (
        teknisi_id, teknisi_name, user_id, user_name, period_month, period_year,
        commission_amount, direction, reason, source_request_id, source_payment_history_id,
        event_key, created_at, created_by, payroll_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['77', 'Teknisi A', '101', 'Customer A', 4, 2026, 5000, 'credit', 'customer_paid_final', 'REQ-1', 1, 'settlement-1', '2026-04-01T10:30:00.000Z', 'admin', null]
    );

    await ledger.syncFinancialLedgerSources({ domains: ['technician_collection'] });
    await run(`UPDATE technician_collection_ledger SET payroll_id = 10 WHERE id = 1`);
    await ledger.syncFinancialLedgerSources({ domains: ['technician_collection'] });

    const row = await get(
      `SELECT status, metadata_json
       FROM financial_ledger
       WHERE event_key = 'technician_collection:1'`
    );

    expect(row.status).toBe('settled_to_payroll');
    expect(JSON.parse(row.metadata_json)).toMatchObject({ payroll_id: 10 });
  });

  test('syncs payment reversals into financial ledger', async () => {
    await run(
      `INSERT INTO payment_reversals (
        user_id, period_month, period_year, amount_reversed, source_request_id,
        source_admin_action, created_by, created_at, reason, status, event_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [101, 4, 2026, 150000, 'REQ-2', null, 'admin', '2026-04-03T10:00:00.000Z', 'Reversal April', 'completed', 'payment_reversal:test']
    );

    await ledger.syncFinancialLedgerSources({ domains: ['payment_reversal'] });
    const report = await ledger.getFinancialLedgerReport({ month: 4, year: 2026 });

    expect(report.domainSummary.customer_payment_reversal.debit).toBe(150000);
  });

  test('manual adjustment affects report without mutating source entries', async () => {
    await ledger.createManualAdjustment({
      direction: 'debit',
      amount: 25000,
      reason: 'Koreksi kas kecil',
      domainTarget: 'general_cash',
      periodMonth: 4,
      periodYear: 2026,
      notes: 'Adjustment audit'
    }, {
      id: 'admin-1',
      username: 'owner',
      name: 'Owner'
    });

    const report = await ledger.getFinancialLedgerReport({ month: 4, year: 2026 });
    expect(report.summary.totalExpense).toBe(25000);
    expect(report.summary.netTotal).toBe(-25000);
    expect(report.domainSummary.manual_adjustment.debit).toBe(25000);
    expect(report.domainSummary.manual_adjustment.net).toBe(-25000);
  });

  test('manual adjustment creates unique entries per action and dedupes same request action', async () => {
    const first = await ledger.createManualAdjustment({
      direction: 'debit',
      amount: 25000,
      reason: 'Koreksi kas kecil',
      domainTarget: 'general_cash',
      periodMonth: 4,
      periodYear: 2026,
      notes: 'Adjustment audit',
      requestActionId: 'req-1'
    }, {
      id: 'admin-1',
      username: 'owner',
      name: 'Owner'
    });

    const duplicate = await ledger.createManualAdjustment({
      direction: 'debit',
      amount: 25000,
      reason: 'Koreksi kas kecil',
      domainTarget: 'general_cash',
      periodMonth: 4,
      periodYear: 2026,
      notes: 'Adjustment audit',
      requestActionId: 'req-1'
    }, {
      id: 'admin-1',
      username: 'owner',
      name: 'Owner'
    });

    const second = await ledger.createManualAdjustment({
      direction: 'debit',
      amount: 25000,
      reason: 'Koreksi kas kecil',
      domainTarget: 'general_cash',
      periodMonth: 4,
      periodYear: 2026,
      notes: 'Adjustment audit',
      requestActionId: 'req-2'
    }, {
      id: 'admin-1',
      username: 'owner',
      name: 'Owner'
    });

    const count = await get(`SELECT COUNT(*) AS total FROM financial_ledger WHERE domain = 'manual_adjustment'`);

    expect(first.status).toBe('created');
    expect(duplicate.status).toBe('duplicate_retry');
    expect(second.status).toBe('created');
    expect(count.total).toBe(2);
  });
});
