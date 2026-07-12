/**
 * Header Doc
 * Purpose: Guardrail contract test untuk repository read-model rekap tunggakan berbasis periode.
 * Caller: Jest test runner.
 * Deps: `../arrears.repository`.
 * MainFuncs: Memverifikasi filter pelanggan billable dan pembacaan batch payment/reversal sampai periode acuan.
 * SideEffects: Tidak ada; SQLite sementara dibuat per test.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const sqlite3 = require("sqlite3");

describe("arrears repository contract", () => {
    let db;
    let dbPath;
    let tempDir;
    let createRepository;

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
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "raf-arrears-repo-"));
        dbPath = path.join(tempDir, "users.sqlite");
        db = new sqlite3.Database(dbPath);

        // Fixture SENGAJA tanpa kolom `area` agar setara skema `users` produksi (lib/database.js).
        // Dulu fixture punya `area` sehingga test hijau padahal query SELECT area rusak di prod.
        await run(`CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            name TEXT,
            phone_number TEXT,
            subscription TEXT,
            subscription_price INTEGER,
            status TEXT,
            account_type TEXT DEFAULT 'pelanggan'
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

        await run(`INSERT INTO users (id, name, phone_number, subscription, subscription_price, status)
            VALUES
            (1, 'A', '081', 'Paket 150K', 150000, 'aktif'),
            (2, 'B', '082', 'Paket 200K', 200000, 'isolir'),
            (3, 'C', '083', 'Paket 150K', 150000, 'nonaktif')`);

        await run(`INSERT INTO payment_history (user_id, amount_paid, amount_due, period_month, period_year, payment_method, created_by, created_at)
            VALUES
            (1, 150000, 150000, 3, 2026, 'CASH', 'admin', '2026-03-10T00:00:00.000Z'),
            (1, 50000, 150000, 4, 2026, 'CASH', 'admin', '2026-04-10T00:00:00.000Z'),
            (2, 0, 200000, 4, 2026, 'CASH', 'admin', '2026-04-10T00:00:00.000Z'),
            (1, 100000, 150000, 5, 2026, 'CASH', 'admin', '2026-05-10T00:00:00.000Z')`);

        await run(`INSERT INTO payment_reversals (user_id, period_month, period_year, amount_reversed, created_by, created_at, reason, status)
            VALUES
            (1, 4, 2026, 10000, 'admin', '2026-04-12T00:00:00.000Z', 'correction', 'completed'),
            (1, 5, 2026, 15000, 'admin', '2026-05-12T00:00:00.000Z', 'future', 'completed'),
            (2, 4, 2026, 5000, 'admin', '2026-04-12T00:00:00.000Z', 'ignored', 'pending')`);

        jest.doMock("../../lib/env-config", () => ({
            getDatabasePath: jest.fn(() => dbPath)
        }));

        ({ createArrearsRepository: createRepository } = require("../arrears.repository"));
    });

    afterEach(async () => {
        jest.dontMock("../../lib/env-config");
        await new Promise((resolve) => db.close(resolve));
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test("repository returns billable customers filtered to aktif and isolir", async () => {
        const repository = createRepository();
        const users = await repository.listBillableCustomers();

        expect(users.map((user) => user.id)).toEqual([1, 2]);
    });

    test("repository returns payment and completed reversal entries up to the requested period", async () => {
        const repository = createRepository();
        const ledger = await repository.getLedgerEntriesUpToPeriod({ periodMonth: 4, periodYear: 2026 });

        expect(ledger.payments).toHaveLength(3);
        expect(ledger.reversals).toHaveLength(1);
        expect(ledger.reversals[0]).toEqual(expect.objectContaining({
            user_id: 1,
            amount_reversed: 10000,
            period_month: 4,
            period_year: 2026
        }));
    });
});
