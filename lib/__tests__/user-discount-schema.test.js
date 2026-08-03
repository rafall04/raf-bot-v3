/**
 * Header Doc
 * Purpose: Mengunci self-heal kolom `users.discount_*`. Skema diskon dulu hanya hidup di skrip
 *   sekali-jalan `scripts/run-new-features-migration.js` (dihapus di commit `e90f191` dengan asumsi
 *   sudah diterapkan) — padahal di DUA DB produksi kolomnya tak pernah ada, sehingga
 *   `/api/discount/*` selalu 500 dan menu Diskon di sidebar mati tanpa `npm test` pernah merah.
 *   Test ini memakai bentuk tabel `users` PERSIS seperti prod (tanpa kolom discount) supaya
 *   regresi yang sama tertangkap.
 * Caller: Jest test runner.
 * Deps: `fs`, `os`, `path`, `sqlite3`, `../payment-finance-service`, `../sqlite-shared-reader`.
 * MainFuncs: - (suite test).
 * SideEffects: Membuat DB sqlite sementara lalu menghapusnya saat teardown.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const sqlite3 = require("sqlite3");

const KOLOM_DISKON = [
    "discount_amount",
    "discount_percentage",
    "discount_reason",
    "discount_valid_until",
    "discount_months",
    "discount_months_used",
    "discount_created_by",
    "discount_created_at"
];

describe("self-heal skema diskon users", () => {
    let db;
    let dbPath;
    let tempDir;
    let service;

    function run(sql, params = []) {
        return new Promise((resolve, reject) => {
            db.run(sql, params, function onRun(err) {
                if (err) reject(err);
                else resolve({ changes: this.changes });
            });
        });
    }

    function all(sql, params = []) {
        return new Promise((resolve, reject) => {
            db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
        });
    }

    async function namaKolomUsers() {
        const rows = await all("PRAGMA table_info(users)");
        return rows.map((r) => r.name);
    }

    beforeEach(async () => {
        jest.resetModules();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "raf-discount-schema-"));
        dbPath = path.join(tempDir, "users-test.sqlite");
        db = new sqlite3.Database(dbPath);
        global.db = db;

        jest.doMock("../env-config", () => ({
            getDatabasePath: jest.fn(() => dbPath)
        }));

        // Bentuk PERSIS prod: users TANPA satu pun kolom discount_*.
        await run(`
            CREATE TABLE users (
                id INTEGER PRIMARY KEY,
                name TEXT,
                subscription TEXT,
                subscription_price INTEGER,
                phone_number TEXT,
                paid INTEGER DEFAULT 0
            )
        `);
        await run("INSERT INTO users (id, name, subscription, subscription_price, paid) VALUES (13, 'Pak Parno', 'PAKET-150K', 150000, 1)");

        service = require("../payment-finance-service");
    });

    afterEach(async () => {
        jest.dontMock("../env-config");
        await require("../sqlite-shared-reader").closeSharedReaders();
        await new Promise((resolve) => db.close(resolve));
        delete global.db;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test("tabel users tanpa kolom diskon: kedelapan kolom ditambahkan", async () => {
        const sebelum = await namaKolomUsers();
        expect(sebelum.filter((c) => c.startsWith("discount"))).toEqual([]);

        await service.ensurePaymentFinanceTables();

        const sesudah = await namaKolomUsers();
        for (const kolom of KOLOM_DISKON) {
            expect(sesudah).toContain(kolom);
        }
    });

    test("idempoten: dipanggil dua kali tidak melempar & tidak menggandakan kolom", async () => {
        await service.ensurePaymentFinanceTables();
        await expect(service.ensurePaymentFinanceTables()).resolves.not.toThrow();

        const kolom = await namaKolomUsers();
        for (const nama of KOLOM_DISKON) {
            expect(kolom.filter((c) => c === nama)).toHaveLength(1);
        }
    });

    test("data pelanggan yang sudah ada tidak tersentuh, kolom baru bernilai default", async () => {
        await service.ensurePaymentFinanceTables();

        const rows = await all("SELECT * FROM users WHERE id = 13");
        expect(rows).toHaveLength(1);
        expect(rows[0].name).toBe("Pak Parno");
        expect(rows[0].subscription_price).toBe(150000);
        expect(rows[0].paid).toBe(1);
        // Default nol = "tanpa diskon", jadi harga efektif tak berubah bagi pelanggan lama.
        expect(rows[0].discount_amount).toBe(0);
        expect(rows[0].discount_percentage).toBe(0);
        expect(rows[0].discount_months).toBe(0);
        expect(rows[0].discount_months_used).toBe(0);
        expect(rows[0].discount_reason).toBeNull();
    });

    test("query yang dulu 500 di prod kini jalan (SELECT kolom diskon)", async () => {
        await service.ensurePaymentFinanceTables();

        const rows = await all(`
            SELECT id, name, subscription, subscription_price,
                   discount_amount, discount_percentage, discount_reason,
                   discount_months, discount_months_used,
                   discount_valid_until, discount_created_by, discount_created_at
              FROM users WHERE id = ?
        `, [13]);

        expect(rows).toHaveLength(1);
        expect(rows[0].id).toBe(13);
    });
});
