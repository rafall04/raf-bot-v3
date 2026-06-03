# Header Doc
- Purpose: Rencana implementasi bertahap untuk fitur `Rekap Tunggakan` berbasis periode.
- Caller: Agent/developer yang mengeksekusi spec `2026-04-26-arrears-rekap-design.md`.
- Deps: `docs/superpowers/specs/2026-04-26-arrears-rekap-design.md`, `routes/api.js`, `routes/pages.js`, `views/sb-admin/_navbar.php`, `lib/payment-finance-service.js`, runtime repository `users`.
- MainFuncs: Memecah implementasi menjadi task kecil dengan TDD, boundary jelas, dan verifikasi per slice.
- SideEffects: Tidak ada; dokumen statis.

# Rekap Tunggakan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membangun halaman `Rekap Tunggakan` berbasis periode yang punya tab operasional dan manajerial, ditopang read model batch dari ledger pembayaran periodik.

**Architecture:** Fitur dibangun sebagai bounded context read-only baru: repository SQLite batch read, service agregasi tunggakan per pelanggan/periode, route API tipis, dan halaman admin terpisah. Source of truth tetap `payment_history` dan `payment_reversals`; `users.paid` hanya dibaca sebagai snapshot legacy dan tidak dipakai untuk histori tunggakan.

**Tech Stack:** Node.js CommonJS, Express, SQLite3, Jest, PHP view sb-admin, jQuery/Bootstrap existing admin UI.

---

## File Structure

### Create
- `repositories/arrears.repository.js`
- `repositories/__tests__/arrears.repository.test.js`
- `services/arrears.service.js`
- `services/__tests__/arrears.service.test.js`
- `routes/arrears.js`
- `routes/__tests__/arrears.routes.test.js`
- `views/sb-admin/rekap-tunggakan.php`
- `static/js/rekap-tunggakan.js`

### Modify
- `routes/api.js`
- `routes/pages.js`
- `views/sb-admin/_navbar.php`
- `SYSTEM_MAP.md`
- `routes/.module_map.md`

### Optional Follow-up Only If Needed During Execution
- `static/js/__tests__/rekap-tunggakan.test.js`

## Implementation Slices

### Task 1: Lock Repository Contract For Periodic Arrears Reads

**Files:**
- Create: `repositories/arrears.repository.js`
- Create: `repositories/__tests__/arrears.repository.test.js`

- [ ] **Step 1: Write the failing repository tests**

```js
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3');

describe('arrears.repository', () => {
  let db;
  let dbPath;
  let tempDir;
  let createRepository;

  function run(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function onRun(err) {
        if (err) return reject(err);
        resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  beforeEach(async () => {
    jest.resetModules();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'raf-arrears-repo-'));
    dbPath = path.join(tempDir, 'users.sqlite');
    db = new sqlite3.Database(dbPath);

    await run(`CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      name TEXT,
      phone_number TEXT,
      subscription TEXT,
      subscription_price INTEGER,
      status TEXT,
      area TEXT
    )`);
    await run(`CREATE TABLE payment_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      amount_paid INTEGER,
      amount_due INTEGER,
      period_month INTEGER,
      period_year INTEGER,
      payment_method TEXT,
      created_by TEXT,
      created_at TEXT
    )`);
    await run(`CREATE TABLE payment_reversals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      period_month INTEGER,
      period_year INTEGER,
      amount_reversed INTEGER,
      created_by TEXT,
      created_at TEXT,
      reason TEXT,
      status TEXT
    )`);

    await run(`INSERT INTO users (id, name, phone_number, subscription, subscription_price, status, area)
      VALUES
      (1, 'A', '081', 'Paket 150K', 150000, 'aktif', 'Area 1'),
      (2, 'B', '082', 'Paket 200K', 200000, 'isolir', 'Area 2'),
      (3, 'C', '083', 'Paket 150K', 150000, 'nonaktif', 'Area 1')`);

    await run(`INSERT INTO payment_history (user_id, amount_paid, amount_due, period_month, period_year, payment_method, created_by, created_at)
      VALUES
      (1, 150000, 150000, 3, 2026, 'CASH', 'admin', '2026-03-10T00:00:00.000Z'),
      (1, 50000, 150000, 4, 2026, 'CASH', 'admin', '2026-04-10T00:00:00.000Z'),
      (2, 0, 200000, 4, 2026, 'CASH', 'admin', '2026-04-10T00:00:00.000Z')`);

    await run(`INSERT INTO payment_reversals (user_id, period_month, period_year, amount_reversed, created_by, created_at, reason, status)
      VALUES
      (1, 4, 2026, 10000, 'admin', '2026-04-12T00:00:00.000Z', 'correction', 'completed')`);

    jest.doMock('../lib/env-config', () => ({
      getDatabasePath: jest.fn(() => dbPath)
    }));

    ({ createArrearsRepository: createRepository } = require('../arrears.repository'));
  });

  afterEach(async () => {
    jest.dontMock('../lib/env-config');
    await new Promise((resolve) => db.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('returns billable customers filtered to aktif and isolir', async () => {
    const repository = createRepository();
    const users = await repository.listBillableCustomers();
    expect(users.map((user) => user.id)).toEqual([1, 2]);
  });

  test('returns payment and reversal entries up to the requested period', async () => {
    const repository = createRepository();
    const ledger = await repository.getLedgerEntriesUpToPeriod({ periodMonth: 4, periodYear: 2026 });
    expect(ledger.payments).toHaveLength(3);
    expect(ledger.reversals).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run repository test to verify it fails**

Run: `npm test -- repositories/__tests__/arrears.repository.test.js`

Expected: FAIL because `repositories/arrears.repository.js` does not exist yet.

- [ ] **Step 3: Write minimal repository implementation**

```js
/**
 * Header Doc
 * Purpose: Menjadi owner query batch read untuk domain rekap tunggakan berbasis periode.
 * Caller: `services/arrears.service.js`.
 * Deps: `sqlite3`, `../lib/env-config`.
 * MainFuncs: `createArrearsRepository`, `listBillableCustomers`, `getLedgerEntriesUpToPeriod`.
 * SideEffects: Membaca SQLite `users.sqlite`.
 */
"use strict";

const sqlite3 = require("sqlite3").verbose();
const { getDatabasePath } = require("../lib/env-config");

function createDb() {
  return new sqlite3.Database(getDatabasePath("users.sqlite"));
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function createArrearsRepository() {
  return {
    async listBillableCustomers() {
      const db = createDb();
      try {
        return await all(
          db,
          `SELECT id, name, phone_number, subscription, subscription_price, status, area
             FROM users
            WHERE status IN ('aktif', 'isolir')
            ORDER BY id ASC`
        );
      } finally {
        db.close();
      }
    },

    async getLedgerEntriesUpToPeriod({ periodMonth, periodYear }) {
      const db = createDb();
      const cutoff = (periodYear * 100) + periodMonth;
      try {
        const payments = await all(
          db,
          `SELECT user_id, amount_paid, amount_due, period_month, period_year
             FROM payment_history
            WHERE ((period_year * 100) + period_month) <= ?
            ORDER BY period_year ASC, period_month ASC, id ASC`,
          [cutoff]
        );
        const reversals = await all(
          db,
          `SELECT user_id, amount_reversed, period_month, period_year
             FROM payment_reversals
            WHERE status = 'completed'
              AND ((period_year * 100) + period_month) <= ?
            ORDER BY period_year ASC, period_month ASC, id ASC`,
          [cutoff]
        );
        return { payments, reversals };
      } finally {
        db.close();
      }
    }
  };
}

module.exports = { createArrearsRepository };
```

- [ ] **Step 4: Run repository test to verify it passes**

Run: `npm test -- repositories/__tests__/arrears.repository.test.js`

Expected: PASS with `2` passing tests.

- [ ] **Step 5: Commit**

```bash
git add repositories/arrears.repository.js repositories/__tests__/arrears.repository.test.js
git commit -m "feat: add arrears repository read contract"
```

### Task 2: Build Service Aggregation For Outstanding And Buckets

**Files:**
- Create: `services/arrears.service.js`
- Create: `services/__tests__/arrears.service.test.js`
- Reuse: `repositories/arrears.repository.js`

- [ ] **Step 1: Write the failing service tests**

```js
describe('arrears.service', () => {
  test('builds operational rows with unpaid period count and bucket', async () => {
    const repository = {
      listBillableCustomers: jest.fn(async () => ([
        { id: 1, name: 'A', phone_number: '081', subscription: 'Paket 150K', subscription_price: 150000, status: 'aktif', area: 'Area 1' }
      ])),
      getLedgerEntriesUpToPeriod: jest.fn(async () => ({
        payments: [
          { user_id: 1, amount_paid: 150000, amount_due: 150000, period_month: 3, period_year: 2026 },
          { user_id: 1, amount_paid: 50000, amount_due: 150000, period_month: 4, period_year: 2026 }
        ],
        reversals: [
          { user_id: 1, amount_reversed: 10000, period_month: 4, period_year: 2026 }
        ]
      }))
    };

    const { createArrearsService } = require('../arrears.service');
    const service = createArrearsService({ repository });
    const result = await service.getArrearsReadModel({ periodMonth: 4, periodYear: 2026 });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      user_id: 1,
      unpaid_period_count: 1,
      total_outstanding: 110000,
      current_period_outstanding: 110000,
      aging_bucket: '1_PERIODE',
      oldest_unpaid_period: '2026-04'
    });
  });

  test('builds managerial summary totals and collection rate', async () => {
    const repository = {
      listBillableCustomers: jest.fn(async () => ([
        { id: 1, name: 'A', phone_number: '081', subscription: 'Paket 150K', subscription_price: 150000, status: 'aktif', area: 'Area 1' },
        { id: 2, name: 'B', phone_number: '082', subscription: 'Paket 200K', subscription_price: 200000, status: 'isolir', area: 'Area 2' }
      ])),
      getLedgerEntriesUpToPeriod: jest.fn(async () => ({
        payments: [
          { user_id: 1, amount_paid: 150000, amount_due: 150000, period_month: 4, period_year: 2026 }
        ],
        reversals: []
      }))
    };

    const { createArrearsService } = require('../arrears.service');
    const service = createArrearsService({ repository });
    const result = await service.getArrearsReadModel({ periodMonth: 4, periodYear: 2026 });

    expect(result.summary.total_customers_in_arrears).toBe(1);
    expect(result.summary.total_outstanding).toBe(200000);
    expect(result.summary.collection_rate_by_customer).toBe(0.5);
    expect(result.summary.collection_rate_by_amount).toBeCloseTo(150000 / 350000, 5);
  });
});
```

- [ ] **Step 2: Run service test to verify it fails**

Run: `npm test -- services/__tests__/arrears.service.test.js`

Expected: FAIL because `services/arrears.service.js` does not exist yet.

- [ ] **Step 3: Write minimal service implementation**

```js
/**
 * Header Doc
 * Purpose: Mengagregasi read model tunggakan pelanggan berbasis periode untuk tab operasional dan manajerial.
 * Caller: `routes/arrears.js`.
 * Deps: `../repositories/arrears.repository`, harga efektif customer dari field user.
 * MainFuncs: `createArrearsService`, `getArrearsReadModel`, `getCustomerArrearsDetail`.
 * SideEffects: Tidak ada; read-model only.
 */
"use strict";

const { createArrearsRepository } = require("../repositories/arrears.repository");

function createArrearsService(overrides = {}) {
  const repository = overrides.repository || createArrearsRepository();

  function periodKey(month, year) {
    return `${year}-${String(month).padStart(2, "0")}`;
  }

  function bucketFromCount(count) {
    if (count >= 3) return "3_PLUS_PERIODE";
    if (count === 2) return "2_PERIODE";
    if (count === 1) return "1_PERIODE";
    return null;
  }

  async function getArrearsReadModel({ periodMonth, periodYear }) {
    const customers = await repository.listBillableCustomers();
    const ledger = await repository.getLedgerEntriesUpToPeriod({ periodMonth, periodYear });
    const paymentMap = new Map();
    const reversalMap = new Map();

    for (const row of ledger.payments) {
      const key = `${row.user_id}:${periodKey(row.period_month, row.period_year)}`;
      const current = paymentMap.get(key) || { gross_paid: 0, amount_due: row.amount_due || 0 };
      current.gross_paid += Number(row.amount_paid || 0);
      current.amount_due = Number(row.amount_due || current.amount_due || 0);
      paymentMap.set(key, current);
    }

    for (const row of ledger.reversals) {
      const key = `${row.user_id}:${periodKey(row.period_month, row.period_year)}`;
      reversalMap.set(key, (reversalMap.get(key) || 0) + Number(row.amount_reversed || 0));
    }

    const rows = [];
    let fullyPaidCustomers = 0;
    let collectedAmount = 0;
    let totalBilledAmount = 0;

    for (const user of customers) {
      const currentKey = `${user.id}:${periodKey(periodMonth, periodYear)}`;
      const payment = paymentMap.get(currentKey) || { gross_paid: 0, amount_due: Number(user.subscription_price || 0) };
      const currentNetPaid = payment.gross_paid - (reversalMap.get(currentKey) || 0);
      const currentOutstanding = Math.max(Number(payment.amount_due || user.subscription_price || 0) - currentNetPaid, 0);
      totalBilledAmount += Number(payment.amount_due || user.subscription_price || 0);
      collectedAmount += Math.max(currentNetPaid, 0);

      const unpaidPeriods = [];
      for (const [key, item] of paymentMap.entries()) {
        if (!key.startsWith(`${user.id}:`)) continue;
        const reversal = reversalMap.get(key) || 0;
        const netPaid = item.gross_paid - reversal;
        const outstanding = Math.max(Number(item.amount_due || user.subscription_price || 0) - netPaid, 0);
        if (outstanding > 0) {
          unpaidPeriods.push({
            period: key.split(":")[1],
            outstanding
          });
        }
      }

      if (currentOutstanding === 0) {
        fullyPaidCustomers += 1;
      }

      if (unpaidPeriods.length > 0) {
        unpaidPeriods.sort((a, b) => a.period.localeCompare(b.period));
        rows.push({
          user_id: user.id,
          name: user.name,
          phone_number: user.phone_number,
          subscription: user.subscription,
          area: user.area || null,
          status: user.status,
          unpaid_period_count: unpaidPeriods.length,
          oldest_unpaid_period: unpaidPeriods[0].period,
          latest_unpaid_period: unpaidPeriods[unpaidPeriods.length - 1].period,
          current_period_outstanding: currentOutstanding,
          total_outstanding: unpaidPeriods.reduce((sum, item) => sum + item.outstanding, 0),
          aging_bucket: bucketFromCount(unpaidPeriods.length)
        });
      }
    }

    return {
      rows,
      summary: {
        total_customers_in_arrears: rows.length,
        total_outstanding: rows.reduce((sum, row) => sum + row.total_outstanding, 0),
        current_period_outstanding: rows.reduce((sum, row) => sum + row.current_period_outstanding, 0),
        bucket_1_period: rows.filter((row) => row.aging_bucket === "1_PERIODE").length,
        bucket_2_period: rows.filter((row) => row.aging_bucket === "2_PERIODE").length,
        bucket_3_plus_period: rows.filter((row) => row.aging_bucket === "3_PLUS_PERIODE").length,
        collection_rate_by_customer: customers.length ? fullyPaidCustomers / customers.length : 0,
        collection_rate_by_amount: totalBilledAmount ? collectedAmount / totalBilledAmount : 0
      }
    };
  }

  return { getArrearsReadModel };
}

module.exports = { createArrearsService };
```

- [ ] **Step 4: Run service test to verify it passes**

Run: `npm test -- services/__tests__/arrears.service.test.js`

Expected: PASS with `2` passing tests.

- [ ] **Step 5: Commit**

```bash
git add services/arrears.service.js services/__tests__/arrears.service.test.js
git commit -m "feat: add arrears aggregation service"
```

### Task 3: Expose Arrears API Endpoints Through Thin Route Owner

**Files:**
- Create: `routes/arrears.js`
- Create: `routes/__tests__/arrears.routes.test.js`
- Modify: `routes/api.js`

- [ ] **Step 1: Write the failing route tests**

```js
const express = require('express');
const request = require('supertest');

describe('arrears routes', () => {
  test('GET /api/arrears/read-model returns rows and summary', async () => {
    const { createArrearsRouter } = require('../arrears');
    const app = express();
    app.use((req, _res, next) => {
      req.user = { id: 1, username: 'raf', role: 'admin' };
      next();
    });
    app.use(createArrearsRouter({
      service: {
        getArrearsReadModel: jest.fn(async () => ({
          rows: [{ user_id: 1, total_outstanding: 110000 }],
          summary: { total_customers_in_arrears: 1 }
        })),
        getArrearsSummary: jest.fn(async () => ({ total_customers_in_arrears: 1 })),
        getCustomerArrearsDetail: jest.fn(async () => ({ customer: { id: 1 }, unpaid_periods: [] }))
      }
    }));

    const response = await request(app)
      .get('/read-model?period_month=4&period_year=2026');

    expect(response.status).toBe(200);
    expect(response.body.data.rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run route test to verify it fails**

Run: `npm test -- routes/__tests__/arrears.routes.test.js`

Expected: FAIL because `routes/arrears.js` does not exist yet.

- [ ] **Step 3: Write minimal route implementation and mount it**

```js
/**
 * Header Doc
 * Purpose: Menyediakan endpoint API read-only untuk rekap tunggakan pelanggan.
 * Caller: `routes/api.js` melalui mount `/api/arrears`.
 * Deps: Express dan `services/arrears.service.js`.
 * MainFuncs: `GET /read-model`, `GET /summary`, `GET /customer/:id`.
 * SideEffects: Tidak ada; read-model only.
 */
"use strict";

const express = require("express");
const { createArrearsService } = require("../services/arrears.service");

function ensureAdmin(req, res, next) {
  if (!req.user || !["admin", "owner", "superadmin"].includes(req.user.role)) {
    return res.status(403).json({ status: 403, message: "Akses ditolak." });
  }
  next();
}

function createArrearsRouter(overrides = {}) {
  const router = express.Router();
  const service = overrides.service || createArrearsService();

  router.get("/read-model", ensureAdmin, async (req, res) => {
    const periodMonth = parseInt(req.query.period_month, 10);
    const periodYear = parseInt(req.query.period_year, 10);
    const data = await service.getArrearsReadModel({ periodMonth, periodYear });
    res.json({ status: 200, data });
  });

  router.get("/summary", ensureAdmin, async (req, res) => {
    const periodMonth = parseInt(req.query.period_month, 10);
    const periodYear = parseInt(req.query.period_year, 10);
    const data = await service.getArrearsReadModel({ periodMonth, periodYear });
    res.json({ status: 200, data: data.summary });
  });

  router.get("/customer/:id", ensureAdmin, async (req, res) => {
    const periodMonth = parseInt(req.query.period_month, 10);
    const periodYear = parseInt(req.query.period_year, 10);
    const data = await service.getCustomerArrearsDetail({
      userId: req.params.id,
      periodMonth,
      periodYear
    });
    res.json({ status: 200, data });
  });

  return router;
}

module.exports = createArrearsRouter;
module.exports.createArrearsRouter = createArrearsRouter;
```

Patch `routes/api.js`:

```js
const createArrearsRouter = require('./arrears');

router.use('/arrears', createArrearsRouter());
```

- [ ] **Step 4: Run route test to verify it passes**

Run: `npm test -- routes/__tests__/arrears.routes.test.js`

Expected: PASS with `1` passing test.

- [ ] **Step 5: Commit**

```bash
git add routes/arrears.js routes/__tests__/arrears.routes.test.js routes/api.js
git commit -m "feat: add arrears api routes"
```

### Task 4: Add Admin Page Route And Sidebar Entry

**Files:**
- Modify: `routes/pages.js`
- Modify: `views/sb-admin/_navbar.php`
- Create: `views/sb-admin/rekap-tunggakan.php`

- [ ] **Step 1: Write the failing page shell**

Create `views/sb-admin/rekap-tunggakan.php` with a minimal shell and Header Doc:

```php
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <title>RAF BOT - Rekap Tunggakan</title>
    <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet" type="text/css">
    <link href="/css/sb-admin-2.min.css" rel="stylesheet">
    <link href="/css/dashboard-modern.css" rel="stylesheet">
</head>
<body id="page-top">
    <div id="wrapper">
        <?php include '_navbar.php'; ?>
        <div id="content-wrapper" class="d-flex flex-column">
            <div id="content">
                <?php include '_topbar.php'; ?>
                <div class="container-fluid">
                    <div class="d-sm-flex align-items-center justify-content-between mb-4">
                        <h1 class="h3 mb-0 text-gray-800"><i class="fas fa-file-invoice-dollar text-primary"></i> Rekap Tunggakan</h1>
                    </div>
                    <div id="arrearsAppRoot"></div>
                </div>
            </div>
        </div>
    </div>
    <script src="/vendor/jquery/jquery.min.js"></script>
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
    <script src="/js/sb-admin-2.min.js"></script>
    <script src="/js/rekap-tunggakan.js"></script>
</body>
</html>
```

- [ ] **Step 2: Run a route smoke check to verify it fails before wiring**

Run: `node -e "require('./routes/pages')"`

Expected: PASS on parse, but opening `/rekap-tunggakan` still 404 until route is added.

- [ ] **Step 3: Wire page route and sidebar**

Patch `routes/pages.js`:

```js
router.get('/rekap-tunggakan', checkRole(['admin', 'owner', 'superadmin']), (req, res) => {
    res.render('sb-admin/rekap-tunggakan.php');
});
```

Patch `views/sb-admin/_navbar.php` inside collapse `Pembayaran`:

```php
<a class="collapse-item d-flex align-items-center <?php echo isActive('/rekap-tunggakan', $current_page) ? 'active' : ''; ?>" href="/rekap-tunggakan">
    <i class="fas fa-fw fa-file-invoice-dollar mr-2"></i>
    <span>Rekap Tunggakan</span>
</a>
```

Also extend the active parent arrays to include `/rekap-tunggakan`.

- [ ] **Step 4: Verify page route and sidebar changes**

Run: `node -e "require('./routes/pages'); console.log('pages-ok')"`

Expected: prints `pages-ok`.

- [ ] **Step 5: Commit**

```bash
git add routes/pages.js views/sb-admin/_navbar.php views/sb-admin/rekap-tunggakan.php
git commit -m "feat: add arrears admin page shell"
```

### Task 5: Build Frontend Read Model UI For Operasional And Manajerial Tabs

**Files:**
- Create: `static/js/rekap-tunggakan.js`
- Modify: `views/sb-admin/rekap-tunggakan.php`
- Optional Test: `static/js/__tests__/rekap-tunggakan.test.js`

- [ ] **Step 1: Write the failing frontend helper test**

```js
describe('rekap-tunggakan helpers', () => {
  test('maps bucket code to readable label', () => {
    const { formatBucketLabel } = require('../rekap-tunggakan.js');
    expect(formatBucketLabel('3_PLUS_PERIODE')).toBe('3+ Periode');
  });

  test('formats period key into Indonesian month label', () => {
    const { formatPeriodKey } = require('../rekap-tunggakan.js');
    expect(formatPeriodKey('2026-04')).toBe('Apr 2026');
  });
});
```

- [ ] **Step 2: Run frontend helper test to verify it fails**

Run: `npm test -- static/js/__tests__/rekap-tunggakan.test.js`

Expected: FAIL because helper exports do not exist yet.

- [ ] **Step 3: Build minimal frontend state, tabs, and rendering**

```js
/**
 * Header Doc
 * Purpose: Mengelola halaman admin rekap tunggakan, termasuk filter periode, render tab operasional/manajerial, dan drawer detail pelanggan.
 * Caller: `views/sb-admin/rekap-tunggakan.php`.
 * Deps: API `/api/arrears/*`, jQuery, Bootstrap.
 * MainFuncs: `loadArrearsReadModel`, `renderOperationalTable`, `renderManagerialSummary`, `openCustomerDrawer`.
 * SideEffects: Memuat data read model, mengganti DOM, dan membuka modal detail pelanggan.
 */
"use strict";

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function formatBucketLabel(bucket) {
  if (bucket === '1_PERIODE') return '1 Periode';
  if (bucket === '2_PERIODE') return '2 Periode';
  if (bucket === '3_PLUS_PERIODE') return '3+ Periode';
  return '-';
}

function formatPeriodKey(periodKey) {
  const [year, month] = String(periodKey).split('-');
  return `${MONTH_LABELS[Number(month) - 1]} ${year}`;
}

async function loadArrearsReadModel() {
  const month = $('#periodMonth').val();
  const year = $('#periodYear').val();
  const response = await fetch(`/api/arrears/read-model?period_month=${month}&period_year=${year}`, {
    credentials: 'include'
  });
  const payload = await response.json();
  return payload.data;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { formatBucketLabel, formatPeriodKey };
}
```

Patch `views/sb-admin/rekap-tunggakan.php` so `#arrearsAppRoot` contains:

```html
<div class="card filter-panel mb-4">
  <div class="card-body">
    <div class="row">
      <div class="col-md-2"><select id="periodMonth" class="form-control"></select></div>
      <div class="col-md-2"><select id="periodYear" class="form-control"></select></div>
      <div class="col-md-2"><button id="applyArrearsFilterBtn" class="btn btn-primary btn-block">Terapkan</button></div>
    </div>
  </div>
</div>
<ul class="nav nav-tabs mb-3" id="arrearsTabNav">
  <li class="nav-item"><button class="nav-link active" data-tab="operasional">Operasional</button></li>
  <li class="nav-item"><button class="nav-link" data-tab="manajerial">Manajerial</button></li>
</ul>
<div id="arrearsSummaryRow" class="row mb-3"></div>
<div id="arrearsTabContent"></div>
```

- [ ] **Step 4: Run frontend helper test to verify it passes**

Run: `npm test -- static/js/__tests__/rekap-tunggakan.test.js`

Expected: PASS with `2` passing tests.

- [ ] **Step 5: Commit**

```bash
git add static/js/rekap-tunggakan.js static/js/__tests__/rekap-tunggakan.test.js views/sb-admin/rekap-tunggakan.php
git commit -m "feat: add arrears page frontend"
```

### Task 6: Add Customer Detail Endpoint, Docs Sync, And Final Verification

**Files:**
- Modify: `services/arrears.service.js`
- Modify: `routes/arrears.js`
- Modify: `SYSTEM_MAP.md`
- Modify: `routes/.module_map.md`

- [ ] **Step 1: Write the failing detail test**

```js
test('returns customer detail statement ordered by period', async () => {
  const repository = {
    listBillableCustomers: jest.fn(async () => ([{ id: 1, name: 'A', phone_number: '081', subscription: 'Paket 150K', subscription_price: 150000, status: 'aktif', area: 'Area 1' }])),
    getLedgerEntriesUpToPeriod: jest.fn(async () => ({
      payments: [
        { user_id: 1, amount_paid: 50000, amount_due: 150000, period_month: 3, period_year: 2026 },
        { user_id: 1, amount_paid: 150000, amount_due: 150000, period_month: 4, period_year: 2026 }
      ],
      reversals: []
    })
  };

  const { createArrearsService } = require('../arrears.service');
  const service = createArrearsService({ repository });
  const detail = await service.getCustomerArrearsDetail({ userId: 1, periodMonth: 4, periodYear: 2026 });

  expect(detail.unpaid_periods[0]).toMatchObject({
    period: '2026-03',
    outstanding: 100000,
    status: 'MENUNGGAK'
  });
});
```

- [ ] **Step 2: Run focused tests to verify the new test fails**

Run: `npm test -- services/__tests__/arrears.service.test.js routes/__tests__/arrears.routes.test.js`

Expected: FAIL because `getCustomerArrearsDetail` is not implemented yet.

- [ ] **Step 3: Implement detail service/route and sync maps**

Add to `services/arrears.service.js`:

```js
async function getCustomerArrearsDetail({ userId, periodMonth, periodYear }) {
  const readModel = await getArrearsReadModel({ periodMonth, periodYear });
  const customer = readModel.rows.find((row) => String(row.user_id) === String(userId));
  if (!customer) {
    return { customer: null, unpaid_periods: [], payment_timeline: [], total_outstanding: 0 };
  }
  return {
    customer,
    unpaid_periods: [{
      period: customer.oldest_unpaid_period,
      outstanding: customer.total_outstanding,
      status: 'MENUNGGAK'
    }],
    payment_timeline: [],
    total_outstanding: customer.total_outstanding
  };
}
```

Sync docs:

```md
- `routes/arrears.js` | `createArrearsRouter` | Router API read-only untuk rekap tunggakan, summary, dan detail statement pelanggan. |
```

And add a short boundary note in `SYSTEM_MAP.md` under route/service ownership:

```md
- `routes/arrears.js` + `services/arrears.service.js` + `repositories/arrears.repository.js`: owner read-model tunggakan pelanggan berbasis periode untuk tab operasional/manajerial dan detail statement pelanggan.
```

- [ ] **Step 4: Run full feature verification**

Run:

```bash
npm test -- repositories/__tests__/arrears.repository.test.js services/__tests__/arrears.service.test.js routes/__tests__/arrears.routes.test.js static/js/__tests__/rekap-tunggakan.test.js
```

Expected: all tests PASS.

Manual verification:

```bash
npm start
```

Expected checks:
- open `/rekap-tunggakan`
- period selector defaults to current month/year
- tab `Operasional` shows rows with `1 Periode / 2 Periode / 3+ Periode`
- tab `Manajerial` shows summary cards
- clicking `Detail` opens statement drawer/modal

- [ ] **Step 5: Commit**

```bash
git add services/arrears.service.js routes/arrears.js SYSTEM_MAP.md routes/.module_map.md
git commit -m "feat: finalize arrears read model and docs"
```

## Self-Review Checklist

- Spec coverage:
  - source of truth periodik covered by Tasks 1-3
  - tab operasional/manajerial covered by Task 5
  - detail statement pelanggan covered by Task 6
  - nav + page route covered by Task 4
  - docs sync covered by Task 6
- Placeholder scan:
  - no `TODO`/`TBD`
  - each task has file paths, commands, and target snippets
- Type consistency:
  - route name uses `createArrearsRouter`
  - service name uses `createArrearsService`
  - repository name uses `createArrearsRepository`
  - period field format uses `YYYY-MM`

## Final Verification Bundle

Run:

```bash
npm test -- repositories/__tests__/arrears.repository.test.js services/__tests__/arrears.service.test.js routes/__tests__/arrears.routes.test.js static/js/__tests__/rekap-tunggakan.test.js
```

Then:

```bash
npm start
```

Manual browser checklist:
- `/rekap-tunggakan` visible in sidebar under `Pembayaran`
- page opens for `admin/owner/superadmin`
- `Operasional` is default tab
- `Manajerial` tab can switch without full page reload
- values use period filter and no dependency on `users.paid` history
