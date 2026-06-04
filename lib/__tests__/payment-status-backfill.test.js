const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3');

describe('payment status backfill (ledger from paid flag)', () => {
  let db;
  let dbPath;
  let tempDir;
  let backfill;
  let service;

  function run(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function onRun(err) {
        if (err) return reject(err);
        resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  function all(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });
  }

  beforeEach(async () => {
    jest.resetModules();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'raf-paid-backfill-'));
    dbPath = path.join(tempDir, 'users-test.sqlite');
    db = new sqlite3.Database(dbPath);
    global.db = db;
    global.accounts = [];
    global.config = {};
    global.packages = [
      { name: 'PAKET-125K', price: 125000, whitelist: false },
      { name: 'PAKET-150K', price: 150000, whitelist: false },
      { name: 'PAKET-VOUCHER', price: 0, whitelist: true }
    ];
    global.users = [
      { id: 2, name: 'Pakdhe Pur', subscription: 'PAKET-150K', subscription_price: 0, paid: 1, discount_months: 0, discount_months_used: 0 },
      { id: 5, name: 'Dina', subscription: 'PAKET-125K', subscription_price: 0, paid: 1, discount_months: 0, discount_months_used: 0 },
      { id: 7, name: 'Belum Bayar', subscription: 'PAKET-125K', subscription_price: 0, paid: 0, discount_months: 0, discount_months_used: 0 },
      { id: 9, name: 'Gratisan', subscription: 'PAKET-VOUCHER', subscription_price: 0, paid: 1, discount_months: 0, discount_months_used: 0 }
    ];

    jest.doMock('../env-config', () => ({
      getDatabasePath: jest.fn(() => dbPath)
    }));

    service = require('../payment-finance-service');
    await service.ensurePaymentFinanceTables();

    await run(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT,
        subscription TEXT,
        subscription_price INTEGER,
        paid INTEGER DEFAULT 0,
        discount_months INTEGER DEFAULT 0,
        discount_months_used INTEGER DEFAULT 0,
        discount_amount INTEGER DEFAULT 0,
        discount_percentage INTEGER DEFAULT 0,
        discount_valid_until TEXT
      )
    `);
    for (const u of global.users) {
      await run('INSERT INTO users (id, name, subscription, subscription_price, paid) VALUES (?, ?, ?, ?, ?)',
        [u.id, u.name, u.subscription, u.subscription_price, u.paid]);
    }

    backfill = require('../payment-status-backfill');
  });

  afterEach(async () => {
    jest.dontMock('../env-config');
    await new Promise((resolve) => db.close(resolve));
    delete global.db;
    delete global.accounts;
    delete global.config;
    delete global.packages;
    delete global.users;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('creates ledger entries for paid-flag users, excludes whitelist and unpaid', async () => {
    const result = await backfill.backfillPaidLedgerFromFlag({ periodMonth: 6, periodYear: 2026 });

    expect(result.skipped).toBe(false);
    // Only id 2 and 5 (paid, non-whitelist). id 7 unpaid, id 9 whitelist -> excluded.
    expect(result.created.map((c) => c.id).sort()).toEqual([2, 5]);
    expect(result.failed).toEqual([]);

    const rows = await all('SELECT user_id, amount_paid, period_month, period_year FROM payment_history ORDER BY user_id');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ user_id: 2, amount_paid: 150000, period_month: 6, period_year: 2026 });
    expect(rows[1]).toMatchObject({ user_id: 5, amount_paid: 125000, period_month: 6, period_year: 2026 });

    // Ledger position now fully paid -> the two pages agree.
    const pos = await service.getPaymentPositionForPeriod(global.users[0], 6, 2026, { amountDue: 150000 });
    expect(pos.is_fully_paid).toBe(true);
  });

  test('is idempotent: second run is a no-op via marker', async () => {
    const first = await backfill.backfillPaidLedgerFromFlag({ periodMonth: 6, periodYear: 2026 });
    expect(first.created).toHaveLength(2);

    const second = await backfill.backfillPaidLedgerFromFlag({ periodMonth: 6, periodYear: 2026 });
    expect(second.skipped).toBe(true);
    expect(second.reason).toBe('already_applied');

    const rows = await all('SELECT COUNT(*) AS n FROM payment_history');
    expect(rows[0].n).toBe(2); // no duplicate rows
  });

  test('force re-run does not duplicate when ledger already fully paid', async () => {
    await backfill.backfillPaidLedgerFromFlag({ periodMonth: 6, periodYear: 2026 });
    const forced = await backfill.backfillPaidLedgerFromFlag({ periodMonth: 6, periodYear: 2026, force: true });

    expect(forced.created).toHaveLength(0);
    expect(forced.alreadyPaid.map((c) => c.id).sort()).toEqual([2, 5]);

    const rows = await all('SELECT COUNT(*) AS n FROM payment_history');
    expect(rows[0].n).toBe(2);
  });
});
