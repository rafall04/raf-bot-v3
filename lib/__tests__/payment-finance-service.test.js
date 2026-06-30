const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3');

describe('payment finance service', () => {
  let db;
  let dbPath;
  let tempDir;
  let service;

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
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'raf-payment-finance-'));
    dbPath = path.join(tempDir, 'users-test.sqlite');
    db = new sqlite3.Database(dbPath);
    global.db = db;
    global.accounts = [
      { id: 77, role: 'teknisi', name: 'Teknisi A', username: 'teknisi-a' }
    ];
    global.config = {
      teknisiCollectionCommissionEnabled: true,
      teknisiCollectionCommissionAmount: 5000
    };
    global.users = [
      {
        id: 101,
        name: 'Customer A',
        subscription: 'Paket 150K',
        subscription_price: 150000,
        paid: 0,
        discount_months: 0,
        discount_months_used: 0
      }
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
        phone_number TEXT,
        paid INTEGER DEFAULT 0,
        discount_months INTEGER DEFAULT 0,
        discount_months_used INTEGER DEFAULT 0,
        discount_amount INTEGER DEFAULT 0,
        discount_percentage INTEGER DEFAULT 0,
        discount_reason TEXT,
        discount_valid_until TEXT,
        discount_created_by TEXT,
        discount_created_at TEXT
      )
    `);

    await run(`
      INSERT INTO users (id, name, subscription, subscription_price, phone_number, paid)
      VALUES (101, 'Customer A', 'Paket 150K', 150000, '08123', 0)
    `);

  });

  afterEach(async () => {
    jest.dontMock('../env-config');
    await new Promise((resolve) => db.close(resolve));
    delete global.db;
    delete global.accounts;
    delete global.config;
    delete global.users;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('applies paid, unpaid, and paid again with correct net position', async () => {
    const user = global.users[0];

    const firstPaid = await service.applyPaymentStatusChange({
      user,
      paid: true,
      periodMonth: 4,
      periodYear: 2026,
      amountPaid: 150000,
      amountDue: 150000,
      paymentMethod: 'CASH',
      notes: 'Paid April',
      createdBy: 'admin',
      sourceRequestId: 'REQ-1',
      teknisiId: '77'
    });

    const firstPosition = await service.getPaymentPositionForPeriod(user, 4, 2026, { amountDue: 150000 });
    expect(firstPaid.becameFullyPaid).toBe(true);
    expect(firstPosition.net_paid).toBe(150000);
    expect(firstPosition.is_fully_paid).toBe(true);

    const unpaid = await service.applyPaymentStatusChange({
      user,
      paid: false,
      periodMonth: 4,
      periodYear: 2026,
      amountDue: 150000,
      notes: 'Reverse April',
      createdBy: 'admin',
      sourceRequestId: 'REQ-2'
    });

    const secondPosition = await service.getPaymentPositionForPeriod(user, 4, 2026, { amountDue: 150000 });
    expect(unpaid.action).toBe('reversed');
    expect(secondPosition.net_paid).toBe(0);
    expect(secondPosition.outstanding).toBe(150000);
    expect(secondPosition.is_fully_paid).toBe(false);

    const secondPaid = await service.applyPaymentStatusChange({
      user,
      paid: true,
      periodMonth: 4,
      periodYear: 2026,
      amountPaid: 150000,
      amountDue: 150000,
      paymentMethod: 'TRANSFER_BANK',
      notes: 'Paid Again',
      createdBy: 'admin',
      sourceRequestId: 'REQ-3',
      teknisiId: '77'
    });

    const finalPosition = await service.getPaymentPositionForPeriod(user, 4, 2026, { amountDue: 150000 });
    const paymentRows = await get('SELECT COUNT(*) AS total FROM payment_history');
    const reversalRows = await get('SELECT COUNT(*) AS total FROM payment_reversals');
    const settlementRows = await all('SELECT direction FROM technician_collection_ledger ORDER BY id ASC');

    expect(secondPaid.becameFullyPaid).toBe(true);
    expect(finalPosition.net_paid).toBe(150000);
    expect(finalPosition.is_fully_paid).toBe(true);
    expect(paymentRows.total).toBe(2);
    expect(reversalRows.total).toBe(1);
    expect(settlementRows.map((row) => row.direction)).toEqual(['credit', 'debit', 'credit']);
  });

  test('dedupes same unpaid action and syncs paid flag from net position', async () => {
    const user = global.users[0];

    await service.applyPaymentStatusChange({
      user,
      paid: true,
      periodMonth: 4,
      periodYear: 2026,
      amountPaid: 150000,
      amountDue: 150000,
      paymentMethod: 'CASH',
      notes: 'Paid April',
      createdBy: 'admin',
      sourceRequestId: 'REQ-1',
      teknisiId: '77'
    });

    const firstUnpaid = await service.applyPaymentStatusChange({
      user,
      paid: false,
      periodMonth: 4,
      periodYear: 2026,
      amountDue: 150000,
      notes: 'Reverse April',
      createdBy: 'admin',
      sourceAdminAction: 'bulk-1'
    });

    const duplicateUnpaid = await service.applyPaymentStatusChange({
      user,
      paid: false,
      periodMonth: 4,
      periodYear: 2026,
      amountDue: 150000,
      notes: 'Reverse April',
      createdBy: 'admin',
      sourceAdminAction: 'bulk-1'
    });

    await run('UPDATE users SET paid = 1 WHERE id = 101');
    user.paid = 1;
    const synced = await service.syncUserPaidStatusForPeriod({
      user,
      periodMonth: 4,
      periodYear: 2026,
      amountDue: 150000
    });

    const reversalRows = await get('SELECT COUNT(*) AS total FROM payment_reversals');
    const dbUser = await get('SELECT paid FROM users WHERE id = 101');

    expect(firstUnpaid.action).toBe('reversed');
    expect(duplicateUnpaid.action).toBe('no_change');
    expect(reversalRows.total).toBe(1);
    expect(synced.is_fully_paid).toBe(false);
    expect(dbUser.paid).toBe(0);
  });

  test('keeps users.paid bound to current billing period when reversing an older period', async () => {
    const user = global.users[0];
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    const previousMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const previousYear = currentMonth === 1 ? currentYear - 1 : currentYear;

    await service.applyPaymentStatusChange({
      user,
      paid: true,
      periodMonth: currentMonth,
      periodYear: currentYear,
      amountPaid: 150000,
      amountDue: 150000,
      paymentMethod: 'CASH',
      createdBy: 'admin',
      sourceRequestId: 'REQ-CURRENT'
    });

    await service.applyPaymentStatusChange({
      user,
      paid: true,
      periodMonth: previousMonth,
      periodYear: previousYear,
      amountPaid: 150000,
      amountDue: 150000,
      paymentMethod: 'CASH',
      createdBy: 'admin',
      sourceRequestId: 'REQ-PREV-PAID'
    });

    const reversePrevious = await service.applyPaymentStatusChange({
      user,
      paid: false,
      periodMonth: previousMonth,
      periodYear: previousYear,
      amountDue: 150000,
      createdBy: 'admin',
      sourceRequestId: 'REQ-PREV-UNPAID'
    });

    const dbUser = await get('SELECT paid FROM users WHERE id = 101');
    const currentPosition = await service.getPaymentPositionForPeriod(user, currentMonth, currentYear, { amountDue: 150000 });

    expect(reversePrevious.action).toBe('reversed');
    expect(currentPosition.is_fully_paid).toBe(true);
    expect(dbUser.paid).toBe(1);
  });

  test('builds payment timeline and report from gross and reversal sources', async () => {
    const user = global.users[0];

    await service.applyPaymentStatusChange({
      user,
      paid: true,
      periodMonth: 4,
      periodYear: 2026,
      amountPaid: 100000,
      amountDue: 150000,
      isPartial: true,
      paymentMethod: 'CASH',
      createdBy: 'admin',
      sourceRequestId: 'REQ-TIMELINE-1'
    });

    await service.applyPaymentStatusChange({
      user,
      paid: false,
      periodMonth: 4,
      periodYear: 2026,
      amountDue: 150000,
      createdBy: 'admin',
      sourceRequestId: 'REQ-TIMELINE-2'
    });

    const timeline = await service.getPaymentTimelineForPeriod(101, 4, 2026);
    const report = await service.getPaymentReportForPeriod(4, 2026);

    expect(timeline.summary.gross_paid).toBe(100000);
    expect(timeline.summary.total_reversal).toBe(100000);
    expect(timeline.summary.net_paid).toBe(0);
    expect(timeline.entries.map((entry) => entry.type)).toEqual(['reversal', 'payment']);

    expect(report.summary.gross_paid).toBe(100000);
    expect(report.summary.total_reversal).toBe(100000);
    expect(report.summary.net_paid).toBe(0);
    expect(report.summary.payment_transactions).toBe(1);
    expect(report.summary.reversal_transactions).toBe(1);
  });

  test('self-heals legacy payment_history schema without created_by before recording payment', async () => {
    const user = global.users[0];

    await run('DROP TABLE payment_history');
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
        created_at TEXT
      )
    `);

    await service.ensurePaymentFinanceTables();

    const applied = await service.applyPaymentStatusChange({
      user,
      paid: true,
      periodMonth: 4,
      periodYear: 2026,
      amountPaid: 150000,
      amountDue: 150000,
      paymentMethod: 'CASH',
      notes: 'Legacy schema paid',
      createdBy: 'admin'
    });

    const columns = await all('PRAGMA table_info(payment_history)');
    const paymentRow = await get('SELECT created_by FROM payment_history WHERE id = ?', [applied.paymentHistoryId]);

    expect(columns.some((column) => column.name === 'created_by')).toBe(true);
    expect(paymentRow.created_by).toBe('admin');
  });

  test('applyFreeMonth menandai periode lunas via waiver TANPA dihitung pemasukan', async () => {
    const user = global.users[0];
    const now = new Date();
    const periodMonth = now.getMonth() + 1;
    const periodYear = now.getFullYear();

    const before = await service.getPaymentPositionForPeriod(user, periodMonth, periodYear, { amountDue: 150000 });
    expect(before.is_fully_paid).toBe(false);
    expect(before.is_waived).toBe(false);

    const result = await service.applyFreeMonth({
      user, periodMonth, periodYear, reason: 'Gratis pemasangan', createdBy: 'admin'
    });

    const after = await service.getPaymentPositionForPeriod(user, periodMonth, periodYear, { amountDue: 150000 });
    const report = await service.getPaymentReportForPeriod(periodMonth, periodYear);
    const dbUser = await get('SELECT paid FROM users WHERE id = 101');
    const waiverRows = await get('SELECT COUNT(*) AS total, COALESCE(SUM(amount_waived),0) AS amt FROM payment_waivers');

    expect(result.action).toBe('waived');
    expect(after.is_waived).toBe(true);
    expect(after.is_fully_paid).toBe(true);
    expect(after.outstanding).toBe(0);
    // Pemasukan TIDAK bertambah — waiver tak masuk payment_history/gross_paid.
    expect(after.gross_paid).toBe(0);
    expect(report.summary.gross_paid).toBe(0);
    expect(report.summary.net_paid).toBe(0);
    // user.paid (periode berjalan) sinkron jadi lunas → aman dari isolir.
    expect(dbUser.paid).toBe(1);
    expect(waiverRows.total).toBe(1);
    expect(waiverRows.amt).toBe(150000);
  });

  test('applyFreeMonth idempoten untuk periode yang sama', async () => {
    const user = global.users[0];
    const now = new Date();
    const periodMonth = now.getMonth() + 1;
    const periodYear = now.getFullYear();

    const first = await service.applyFreeMonth({ user, periodMonth, periodYear, reason: 'g', createdBy: 'admin' });
    const second = await service.applyFreeMonth({ user, periodMonth, periodYear, reason: 'g', createdBy: 'admin' });
    const waiverRows = await get('SELECT COUNT(*) AS total FROM payment_waivers');

    expect(first.action).toBe('waived');
    expect(second.action).toBe('no_change');
    expect(second.reason).toBe('already_waived');
    expect(waiverRows.total).toBe(1);
  });

  test('waiver + reverse cash → tetap lunas via waiver, pemasukan bersih 0 (bentuk koreksi widodo Juni)', async () => {
    const user = global.users[0];
    const periodMonth = 6;
    const periodYear = 2026;

    // 1) Awalnya tercatat lunas cash (seperti widodo Juni).
    await service.applyPaymentStatusChange({
      user, paid: true, periodMonth, periodYear, amountPaid: 150000, amountDue: 150000,
      paymentMethod: 'CASH', createdBy: 'admin', sourceRequestId: 'REQ-J'
    });
    // 2) Koreksi → tandai gratis (waiver) + reverse cash.
    await service.applyFreeMonth({ user, periodMonth, periodYear, reason: 'Gratis pemasangan', createdBy: 'admin' });
    await service.applyPaymentStatusChange({
      user, paid: false, periodMonth, periodYear, amountDue: 150000, createdBy: 'admin', sourceAdminAction: 'free-correction'
    });

    const pos = await service.getPaymentPositionForPeriod(user, periodMonth, periodYear, { amountDue: 150000 });
    const report = await service.getPaymentReportForPeriod(periodMonth, periodYear);

    expect(pos.is_waived).toBe(true);
    expect(pos.is_fully_paid).toBe(true);    // tetap lunas via waiver
    expect(pos.net_paid).toBe(0);            // cash sudah di-reverse
    expect(report.summary.net_paid).toBe(0); // pemasukan bersih 0
  });
});
