const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3');

// Regression: ensureFinanceTables must create the base technician_kasbon table
// (bukan hanya *_ledger / technician_gaji), supaya /api/kasbon tidak gagal dengan
// "no such table: technician_kasbon" pada DB yang belum punya tabel ini.
describe('ensureFinanceTables creates base tables on a fresh DB', () => {
  let db;
  let dbPath;
  let tempDir;
  let service;

  function all(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
    });
  }

  beforeEach(() => {
    jest.resetModules();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'raf-fin-ensure-'));
    dbPath = path.join(tempDir, 'users-test.sqlite');
    db = new sqlite3.Database(dbPath);
    global.db = db;
    global.accounts = [];
    global.config = {};
    service = require('../technician-finance-service');
  });

  afterEach(async () => {
    await new Promise((resolve) => db.close(resolve));
    delete global.db;
    delete global.accounts;
    delete global.config;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('technician_kasbon table exists and getKasbonList works (empty)', async () => {
    await service.ensureFinanceTables();

    const tables = await all("SELECT name FROM sqlite_master WHERE type='table'");
    const names = tables.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining([
      'technician_kasbon',
      'technician_kasbon_ledger',
      'technician_gaji'
    ]));

    // The query used by GET /api/kasbon must not throw on a fresh DB.
    const rows = await service.getKasbonList({ teknisiId: null });
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(0);
  });
});
