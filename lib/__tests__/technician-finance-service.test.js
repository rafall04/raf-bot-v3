const sqlite3 = require('sqlite3');

describe('technician finance service', () => {
  let db;
  let financeService;
  let settlementService;

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

  beforeEach(async () => {
    jest.resetModules();
    db = new sqlite3.Database(':memory:');
    global.db = db;
    global.accounts = [
      { id: 77, role: 'teknisi', name: 'Teknisi A', username: 'teknisi-a' }
    ];
    global.config = {
      teknisiCollectionCommissionEnabled: true,
      teknisiCollectionCommissionAmount: 5000
    };

    await run(`
      CREATE TABLE technician_kasbon (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teknisi_id INTEGER NOT NULL,
        teknisi_name TEXT NOT NULL,
        amount INTEGER NOT NULL,
        description TEXT,
        status TEXT,
        notes TEXT,
        created_at TEXT,
        approved_at TEXT,
        approved_by INTEGER,
        approved_by_name TEXT,
        paid_at TEXT,
        paid_by INTEGER,
        paid_by_name TEXT,
        updated_at TEXT
      )
    `);

    settlementService = require('../technician-collection-settlement');
    financeService = require('../technician-finance-service');
    await financeService.ensureFinanceTables();
  });

  afterEach(async () => {
    await new Promise((resolve) => db.close(resolve));
    delete global.db;
    delete global.accounts;
    delete global.config;
  });

  test('creates approved kasbon credit and reports outstanding balance', async () => {
    const created = await run(
      `INSERT INTO technician_kasbon (teknisi_id, teknisi_name, amount, status, created_at, approved_at, updated_at)
       VALUES (?, ?, ?, 'approved', ?, ?, ?)`,
      [77, 'Teknisi A', 300000, new Date('2026-04-01T00:00:00Z').toISOString(), new Date('2026-04-01T00:00:00Z').toISOString(), new Date('2026-04-01T00:00:00Z').toISOString()]
    );

    const result = await financeService.createKasbonApprovalEntry({
      id: created.lastID,
      teknisi_id: 77,
      teknisi_name: 'Teknisi A',
      amount: 300000
    }, {
      approved: true,
      createdBy: 'admin'
    });

    expect(result.applied).toBe(true);

    const summary = await financeService.getKasbonSummary({ teknisiId: 77 });
    expect(summary.total_outstanding).toBe(300000);
    expect(summary.active_count).toBe(1);
  });

  test('finalize payroll locks commission entries and pay applies FIFO kasbon deductions', async () => {
    const firstKasbon = await run(
      `INSERT INTO technician_kasbon (teknisi_id, teknisi_name, amount, status, created_at, approved_at, updated_at)
       VALUES (?, ?, ?, 'approved', ?, ?, ?)`,
      [77, 'Teknisi A', 200000, '2026-04-01T00:00:00.000Z', '2026-04-01T00:00:00.000Z', '2026-04-01T00:00:00.000Z']
    );
    const secondKasbon = await run(
      `INSERT INTO technician_kasbon (teknisi_id, teknisi_name, amount, status, created_at, approved_at, updated_at)
       VALUES (?, ?, ?, 'approved', ?, ?, ?)`,
      [77, 'Teknisi A', 150000, '2026-04-02T00:00:00.000Z', '2026-04-02T00:00:00.000Z', '2026-04-02T00:00:00.000Z']
    );

    await financeService.createKasbonApprovalEntry({
      id: firstKasbon.lastID,
      teknisi_id: 77,
      teknisi_name: 'Teknisi A',
      amount: 200000
    }, { approved: true, createdBy: 'admin' });
    await financeService.createKasbonApprovalEntry({
      id: secondKasbon.lastID,
      teknisi_id: 77,
      teknisi_name: 'Teknisi A',
      amount: 150000
    }, { approved: true, createdBy: 'admin' });

    await settlementService.evaluateCollectionSettlement({
      user: { id: 1001, name: 'Customer 1' },
      paid: true,
      periodMonth: 4,
      periodYear: 2026,
      teknisiId: 77,
      teknisiName: 'Teknisi A',
      sourceRequestId: 'req-1',
      createdBy: 'admin'
    });
    await settlementService.evaluateCollectionSettlement({
      user: { id: 1002, name: 'Customer 2' },
      paid: true,
      periodMonth: 4,
      periodYear: 2026,
      teknisiId: 77,
      teknisiName: 'Teknisi A',
      sourceRequestId: 'req-2',
      createdBy: 'admin'
    });

    const payrollCreate = await financeService.createPayrollDraft({
      teknisiId: 77,
      periodMonth: 4,
      periodYear: 2026,
      gajiPokok: 1000000,
      bonusManual: 100000,
      potonganKasbon: 250000,
      potonganLain: 10000,
      potonganLainKeterangan: 'Tes',
      notes: 'Draft'
    }, { id: 1, name: 'Admin' });

    expect(payrollCreate.created).toBe(true);
    expect(payrollCreate.draft.komisi_collection).toBe(10000);
    expect(payrollCreate.draft.net_amount).toBe(850000);

    const finalized = await financeService.finalizePayroll(payrollCreate.id, { id: 1, name: 'Admin' });
    expect(finalized.finalized).toBe(true);
    expect(finalized.komisiCollection).toBe(10000);

    const payableAfterFinalize = await financeService.getCollectionPayableSummary({
      teknisiId: 77,
      periodMonth: 4,
      periodYear: 2026
    });
    expect(payableAfterFinalize.net_total).toBe(0);

    const paid = await financeService.payPayroll(payrollCreate.id, { id: 1, name: 'Admin' }, 'Bayar payroll');
    expect(paid.paid).toBe(true);
    expect(paid.appliedKasbonAmount).toBe(250000);
    expect(paid.allocations).toEqual([
      { kasbon_id: firstKasbon.lastID, amount: 200000 },
      { kasbon_id: secondKasbon.lastID, amount: 50000 }
    ]);

    const kasbonRows = await financeService.getKasbonList({ teknisiId: 77 });
    const first = kasbonRows.find((row) => row.id === firstKasbon.lastID);
    const second = kasbonRows.find((row) => row.id === secondKasbon.lastID);

    expect(first.remaining_amount).toBe(0);
    expect(first.financial_status).toBe('paid');
    expect(second.remaining_amount).toBe(100000);
    expect(second.financial_status).toBe('approved');

    const payroll = await financeService.getPayrollRecord(payrollCreate.id);
    expect(payroll.status).toBe('paid');
    expect(payroll.komisi_collection).toBe(10000);
    expect(payroll.total_potongan).toBe(260000);
  });
});
