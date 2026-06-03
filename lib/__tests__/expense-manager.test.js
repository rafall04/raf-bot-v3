const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3');

describe('expense manager', () => {
  let db;
  let dbPath;
  let tempDir;
  let expenseManager;

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

  function all(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(rows || []);
      });
    });
  }

  beforeEach(async () => {
    jest.resetModules();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'raf-expense-manager-'));
    dbPath = path.join(tempDir, 'users-test.sqlite');
    db = new sqlite3.Database(dbPath);
    global.db = db;
    global.accounts = [];

    jest.doMock('../env-config', () => ({
      getDatabasePath: jest.fn(() => dbPath)
    }));

    expenseManager = require('../expense-manager');
    const ledger = require('../financial-ledger');
    await ledger.ensureFinancialLedgerTable();
    await expenseManager.ensureExpenseTables();
  });

  afterEach(async () => {
    jest.dontMock('../env-config');
    await new Promise((resolve) => db.close(resolve));
    delete global.db;
    delete global.accounts;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('creates expense entry and debit ledger row', async () => {
    const expense = await expenseManager.createExpense({
      title: 'Beli kabel',
      category: 'maintenance',
      amount: 125000,
      expense_date: '2026-04-10T08:00:00.000Z',
      payment_method: 'cash',
      vendor_or_counterparty: 'Toko Kabel',
      notes: 'Perbaikan jaringan'
    }, {
      username: 'owner',
      name: 'Owner'
    });

    expect(expense.status).toBe('active');

    const ledgerRows = await all('SELECT domain, reference_type, amount, direction, status FROM financial_ledger');
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0]).toMatchObject({
      domain: 'expense_entry',
      reference_type: 'expense_entry',
      amount: 125000,
      direction: 'debit',
      status: 'active'
    });
  });

  test('revising expense creates reversal credit and new debit row', async () => {
    const created = await expenseManager.createExpense({
      title: 'Transport teknisi',
      category: 'transport',
      amount: 50000,
      expense_date: '2026-04-11T08:00:00.000Z',
      payment_method: 'cash'
    }, {
      username: 'owner',
      name: 'Owner'
    });

    const revised = await expenseManager.updateExpense(created.id, {
      title: 'Transport teknisi revisi',
      category: 'transport',
      amount: 65000,
      expense_date: '2026-04-11T10:00:00.000Z',
      payment_method: 'cash',
      notes: 'Revisi nominal'
    }, {
      username: 'owner',
      name: 'Owner'
    });

    expect(revised.previous.id).toBe(created.id);
    expect(revised.current.id).not.toBe(created.id);
    expect(revised.current.amount).toBe(65000);

    const headers = await all('SELECT id, status, replaced_by_id, revision_count FROM expense_entries ORDER BY id ASC');
    expect(headers).toHaveLength(2);
    expect(headers[0]).toMatchObject({
      id: created.id,
      status: 'revised',
      replaced_by_id: revised.current.id,
      revision_count: 1
    });
    expect(headers[1]).toMatchObject({
      id: revised.current.id,
      status: 'active',
      replaced_by_id: null,
      revision_count: 2
    });

    const ledgerRows = await all(
      'SELECT reference_type, amount, direction, status FROM financial_ledger ORDER BY id ASC'
    );
    expect(ledgerRows).toHaveLength(3);
    expect(ledgerRows[1]).toMatchObject({
      reference_type: 'expense_entry_revision_reversal',
      amount: 50000,
      direction: 'credit',
      status: 'revised'
    });
    expect(ledgerRows[2]).toMatchObject({
      reference_type: 'expense_entry_revision',
      amount: 65000,
      direction: 'debit',
      status: 'active'
    });
  });

  test('cancelling expense creates reversal entry and excludes it from active summary', async () => {
    const created = await expenseManager.createExpense({
      title: 'Beli ATK',
      category: 'office_supply',
      amount: 90000,
      expense_date: '2026-04-12T08:00:00.000Z',
      payment_method: 'transfer_bank'
    }, {
      username: 'admin',
      name: 'Admin'
    });

    const cancelled = await expenseManager.cancelExpense(created.id, {
      username: 'admin',
      name: 'Admin'
    }, 'Double input');

    expect(cancelled.status).toBe('cancelled');

    const summary = await expenseManager.getExpenseSummary({ month: 4, year: 2026 });
    expect(summary.total_expense).toBe(0);
    expect(summary.total_records).toBe(0);

    const latestLedger = await get(
      'SELECT reference_type, amount, direction, status FROM financial_ledger ORDER BY id DESC LIMIT 1'
    );
    expect(latestLedger).toMatchObject({
      reference_type: 'expense_entry_cancellation',
      amount: 90000,
      direction: 'credit',
      status: 'cancelled'
    });
  });

  test('invalid expense payload is rejected clearly', async () => {
    await expect(expenseManager.createExpense({
      title: 'Tanpa kategori valid',
      category: 'random',
      amount: 10000,
      expense_date: '2026-04-12T08:00:00.000Z',
      payment_method: 'cash'
    }, {
      username: 'admin'
    })).rejects.toThrow('Kategori pengeluaran tidak valid');
  });
});
