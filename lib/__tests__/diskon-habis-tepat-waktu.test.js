/**
 * Header Doc
 * Purpose: Membuktikan jatah diskon N-bulan benar-benar HABIS setelah N periode dibayar —
 *          juga (terutama) ketika komisi penarikan teknisi aktif.
 * Caller: Jest test runner.
 * Deps: `../payment-finance-service` dengan DB SQLite sementara (pola dari
 *       `payment-finance-service.test.js`).
 * MainFuncs: `run`, `get`.
 * SideEffects: Membuat & menghapus direktori DB sementara per tes.
 *
 * KENAPA ADA: `consumeDiscountForPeriod` memakai keberadaan kredit komisi teknisi pada
 * (user, periode) sebagai penanda "sudah dihitung" — padahal kredit itu disisipkan beberapa
 * baris SEBELUMNYA dalam pemanggilan yang sama (`evaluateCollectionSettlement` lalu
 * `consumeDiscountForPeriod`). Dengan `teknisiCollectionCommissionEnabled: true` gerbangnya
 * SELALU tertutup: `discount_months_used` tak pernah naik dan diskon berlaku SELAMANYA —
 * bocor sebesar nominal diskon tiap bulan per pelanggan, tanpa peringatan, sementara halaman
 * Diskon tetap menampilkan "sisa N bulan".
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const sqlite3 = require("sqlite3");

describe("jatah diskon habis tepat waktu", () => {
    let db;
    let tempDir;
    let service;

    function run(sql, params = []) {
        return new Promise((resolve, reject) => {
            db.run(sql, params, function onRun(err) {
                if (err) return reject(err);
                resolve({ lastID: this.lastID, changes: this.changes });
            });
        });
    }

    function get(sql, params = []) {
        return new Promise((resolve, reject) => {
            db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
        });
    }

    beforeEach(async () => {
        jest.resetModules();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "raf-diskon-"));
        const dbPath = path.join(tempDir, "users-test.sqlite");
        db = new sqlite3.Database(dbPath);
        global.db = db;
        global.accounts = [{ id: 77, role: "teknisi", name: "Teknisi A", username: "teknisi-a" }];
        // INI kondisi pemicunya: komisi penarikan teknisi AKTIF.
        global.config = {
            teknisiCollectionCommissionEnabled: true,
            teknisiCollectionCommissionAmount: 5000,
        };
        global.users = [
            {
                id: 101,
                name: "Customer A",
                subscription: "Paket 150K",
                subscription_price: 150000,
                paid: 0,
                discount_months: 3,
                discount_months_used: 0,
                discount_amount: 50000,
            },
        ];

        jest.doMock("../env-config", () => ({ getDatabasePath: jest.fn(() => dbPath) }));
        service = require("../payment-finance-service");
        await service.ensurePaymentFinanceTables();

        await run(`
            CREATE TABLE users (
                id INTEGER PRIMARY KEY, name TEXT, subscription TEXT,
                subscription_price INTEGER, phone_number TEXT, paid INTEGER DEFAULT 0,
                discount_months INTEGER DEFAULT 0, discount_months_used INTEGER DEFAULT 0,
                discount_amount INTEGER DEFAULT 0, discount_percentage INTEGER DEFAULT 0,
                discount_reason TEXT, discount_valid_until TEXT,
                discount_created_by TEXT, discount_created_at TEXT
            )
        `);
        await run(
            `INSERT INTO users (id, name, subscription, subscription_price, phone_number, paid,
                discount_months, discount_months_used, discount_amount)
             VALUES (101, 'Customer A', 'Paket 150K', 150000, '08123', 0, 3, 0, 50000)`
        );
    });

    afterEach(async () => {
        jest.dontMock("../env-config");
        await require("../sqlite-shared-reader").closeSharedReaders();
        await new Promise((resolve) => db.close(resolve));
        delete global.db;
        delete global.accounts;
        delete global.config;
        delete global.users;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    // Melunasi satu periode lewat penagihan TEKNISI — jalur yang menyisipkan kredit komisi.
    async function lunasiPeriode(periodMonth, periodYear) {
        return service.applyPaymentStatusChange({
            user: global.users[0],
            paid: true,
            periodMonth,
            periodYear,
            amountPaid: 100000, // 150.000 - diskon 50.000
            amountDue: 100000,
            paymentMethod: "CASH",
            notes: `Bayar ${periodMonth}/${periodYear}`,
            createdBy: "teknisi-a",
            teknisiId: "77",
            teknisiName: "Teknisi A",
        });
    }

    test("tiga periode dibayar → jatah 3 bulan HABIS (bukan tetap 0)", async () => {
        await lunasiPeriode(4, 2026);
        await lunasiPeriode(5, 2026);
        await lunasiPeriode(6, 2026);

        const baris = await get("SELECT discount_months_used, discount_amount FROM users WHERE id = 101");

        // Sebelum perbaikan angka ini SELALU 0 — diskon tak pernah kedaluwarsa.
        expect(baris.discount_months_used).toBe(3);
        // Jatah habis ⇒ nominal diskon dinolkan supaya getEffectivePrice berhenti memotong.
        expect(baris.discount_amount).toBe(0);
    });

    test("setiap periode hanya memakai SATU jatah, walau pembayarannya diulang", async () => {
        await lunasiPeriode(4, 2026);
        // Panggilan kedua untuk periode yang SAMA: sudah lunas, tak boleh menambah pemakaian.
        await lunasiPeriode(4, 2026);

        const baris = await get("SELECT discount_months_used FROM users WHERE id = 101");
        expect(baris.discount_months_used).toBe(1);
    });

    test("penanda tercatat per (user, periode), bukan menumpuk", async () => {
        await lunasiPeriode(4, 2026);
        await lunasiPeriode(5, 2026);

        const jumlah = await get(
            "SELECT COUNT(*) AS n FROM discount_consumption WHERE user_id = 101"
        );
        expect(jumlah.n).toBe(2);
    });

    test("jatah tak bertambah dipakai setelah habis", async () => {
        await lunasiPeriode(4, 2026);
        await lunasiPeriode(5, 2026);
        await lunasiPeriode(6, 2026);
        await lunasiPeriode(7, 2026);
        await lunasiPeriode(8, 2026);

        const baris = await get("SELECT discount_months_used FROM users WHERE id = 101");
        expect(baris.discount_months_used).toBe(3);
    });

    // ── Pembalikan mengembalikan jatah ────────────────────────────────────────────────
    // Tanpa ini, admin yang salah menandai lunas lalu membatalkannya membuat pelanggan
    // kehilangan satu bulan diskon PERMANEN: `discount_months_used` sudah naik dan tak
    // pernah turun lagi. Pelanggan ditagih harga penuh untuk bulan yang seharusnya
    // masih berdiskon, tanpa jejak apa pun.
    async function balikkanPeriode(periodMonth, periodYear) {
        return service.applyPaymentStatusChange({
            user: global.users[0],
            paid: false,
            periodMonth,
            periodYear,
            amountDue: 100000,
            notes: "Salah tandai lunas",
            createdBy: "admin",
        });
    }

    test("bayar lalu dibalikkan → jatah kembali seperti semula", async () => {
        await lunasiPeriode(4, 2026);
        expect((await get("SELECT discount_months_used AS n FROM users WHERE id = 101")).n).toBe(1);

        await balikkanPeriode(4, 2026);

        expect((await get("SELECT discount_months_used AS n FROM users WHERE id = 101")).n).toBe(0);
    });

    test("penanda periodenya ikut dibuang, jadi periode itu bisa dipakai lagi", async () => {
        await lunasiPeriode(4, 2026);
        await balikkanPeriode(4, 2026);

        expect((await get("SELECT COUNT(*) AS n FROM discount_consumption WHERE user_id = 101")).n).toBe(0);

        // Dibayar lagi → jatahnya dipakai lagi, sekali saja.
        await lunasiPeriode(4, 2026);
        expect((await get("SELECT discount_months_used AS n FROM users WHERE id = 101")).n).toBe(1);
    });

    test("pembalikan BERULANG tak menambah jatah dari udara", async () => {
        await lunasiPeriode(4, 2026);
        await balikkanPeriode(4, 2026);
        await balikkanPeriode(4, 2026);
        await balikkanPeriode(4, 2026);

        expect((await get("SELECT discount_months_used AS n FROM users WHERE id = 101")).n).toBe(0);
    });
});
