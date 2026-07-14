/**
 * Header Doc
 * Purpose: Guardrail contract test untuk repository users/customer API.
 * Caller: Jest test runner.
 * Deps: `../api-users.repository`.
 * MainFuncs: Memverifikasi repository users API membaca snapshot users, account/network-assets snapshot, serta operasi delete/create/update path awal.
 *            PLUS uji ROUND-TRIP `insertUserRecord` ke SQLite NYATA (`:memory:`) — dulu test hanya
 *            memeriksa argumen yang dikirim ke mock, sehingga bug "kolom hilang senyap"
 *            (created_at/address/latitude/longitude/username/password terbuang) LOLOS bertahun.
 * SideEffects: Tidak ada; sebagian test memakai SQLite `:memory:` sungguhan (ditutup tiap test).
 */
"use strict";

const { createApiUsersRepository } = require("../api-users.repository");

describe("api-users repository contract", () => {
    test("repository exposes users snapshot, user lookup, and count comparison", async () => {
        const databaseGet = jest.fn((sql, params, callback) => callback(null, { count: 2 }));
        const close = jest.fn();
        const repository = createApiUsersRepository({
            runtime: {
                repositories: {
                    users: {
                        getAll: jest.fn(() => [
                            { id: 1, name: "User 1" },
                            { id: 2, name: "User 2" }
                        ])
                    }
                }
            },
            sqlite3: {
                OPEN_READONLY: 1,
                Database: jest.fn(() => ({
                    get: databaseGet,
                    close
                }))
            },
            getDatabasePath: jest.fn(() => "users.sqlite")
        });

        expect(repository.getUsersSnapshot()).toHaveLength(2);
        expect(repository.findUserById(2)).toEqual({ id: 2, name: "User 2" });

        const comparison = await repository.getUserCountComparison();
        expect(comparison).toEqual(expect.objectContaining({
            memoryCount: 2,
            dbCount: 2,
            verificationFailed: false
        }));
        expect(databaseGet).toHaveBeenCalled();
        expect(close).toHaveBeenCalled();
    });

    test("repository exposes delete path helpers for users, accounts, and network assets", async () => {
        const run = jest.fn((sql, paramsOrCallback, callback) => {
            if (typeof paramsOrCallback === "function") {
                paramsOrCallback(null);
                return;
            }
            callback(null);
        });
        const setUsers = jest.fn();
        const setNetworkAssets = jest.fn();
        const repository = createApiUsersRepository({
            runtime: {
                getDb: jest.fn(() => ({ run })),
                repositories: {
                    users: {
                        getAll: jest.fn(() => [{ id: 1, name: "User 1" }]),
                        setAll: setUsers
                    },
                    accounts: {
                        getAll: jest.fn(() => [{ id: 9, username: "admin" }])
                    },
                    networkAssets: {
                        getAll: jest.fn(() => [{ id: "odp-1", type: "ODP" }]),
                        setAll: setNetworkAssets
                    }
                }
            },
            sqlite3: {
                OPEN_READONLY: 1,
                Database: jest.fn(() => ({
                    get: jest.fn(),
                    close: jest.fn()
                }))
            },
            getDatabasePath: jest.fn(() => "users.sqlite")
        });

        expect(repository.findAccountById(9)).toEqual({ id: 9, username: "admin" });
        expect(repository.getNetworkAssetsSnapshot()).toEqual([{ id: "odp-1", type: "ODP" }]);

        await repository.deleteUserRecord(1);
        await repository.deleteAllUserRecords();
        repository.replaceUsersSnapshot([]);
        repository.replaceNetworkAssetsSnapshot([]);

        expect(run).toHaveBeenCalledWith("DELETE FROM users WHERE id = ?", [1], expect.any(Function));
        expect(run).toHaveBeenCalledWith("DELETE FROM users", expect.any(Function));
        expect(setUsers).toHaveBeenCalledWith([]);
        expect(setNetworkAssets).toHaveBeenCalledWith([]);
    });

    test("repository builds dynamic update query for user update path", async () => {
        const run = jest.fn((sql, values, callback) => callback(null));
        const repository = createApiUsersRepository({
            runtime: {
                getDb: jest.fn(() => ({ run }))
            },
            sqlite3: {
                OPEN_READONLY: 1,
                Database: jest.fn(() => ({
                    get: jest.fn(),
                    close: jest.fn()
                }))
            },
            getDatabasePath: jest.fn(() => "users.sqlite")
        });

        const result = await repository.updateUserRecord({
            id: "u-1",
            fields: ["phone", "subscription", "paid", "bulk"],
            draftUser: {
                phone_number: "08123",
                subscription: "Premium",
                paid: true,
                bulk: ["1", "2"]
            },
            skipPaidField: true
        });

        expect(result).toEqual({
            updated: true,
            fields: ["phone_number", "subscription", "bulk"]
        });
        expect(run).toHaveBeenCalledWith(
            'UPDATE users SET "phone_number" = ?, "subscription" = ?, "bulk" = ? WHERE id = ?',
            ["08123", "Premium", JSON.stringify(["1", "2"]), "u-1"],
            expect.any(Function)
        );
    });

    test("INSERT dibangun DINAMIS — created_at/address/koordinat/kredensial IKUT terkirim", async () => {
        const run = jest.fn((sql, values, callback) => callback(null));
        const repository = createApiUsersRepository({
            runtime: {
                getDb: jest.fn(() => ({ run }))
            },
            sqlite3: {
                OPEN_READONLY: 1,
                Database: jest.fn(() => ({
                    get: jest.fn(),
                    close: jest.fn()
                }))
            },
            getDatabasePath: jest.fn(() => "users.sqlite")
        });

        await repository.insertUserRecord({
            id: 7,
            name: "User 7",
            phone_number: "081",
            subscription: "Basic",
            device_id: "dev-1",
            paid: false,
            pppoe_username: "ppp-7",
            pppoe_password: "secret",
            connected_odp_id: "odp-1",
            send_invoice: true,
            is_corporate: false,
            bulk: ["1"],
            address: "Ds. Contoh",
            latitude: -7.1,
            longitude: 111.9,
            username: "user7",
            password: "rahasia",
            created_at: "2026-07-13T10:00:00.000Z"
        });

        const [sql, values] = run.mock.calls[0];
        // Kolom yang DULU terbuang senyap — sekarang WAJIB ada di query.
        ["created_at", "updated_at", "address", "latitude", "longitude", "username", "password"]
            .forEach((col) => expect(sql).toContain(col));
        // Nilainya ikut terkirim (bukan cuma nama kolomnya).
        expect(values).toContain("2026-07-13T10:00:00.000Z");
        expect(values).toContain("Ds. Contoh");
        expect(values).toContain(-7.1);
        expect(values).toContain("rahasia");
        // Perilaku lama dipertahankan (bool→0/1, bulk JSON, account_type default).
        expect(values).toContain(JSON.stringify(["1"]));
        expect(values).toContain("pelanggan");
    });
});

describe("insertUserRecord — ROUND-TRIP ke SQLite NYATA (anti bug 'kolom hilang senyap')", () => {
    const sqlite3 = require("sqlite3");

    // Skema MENIRU PROD: created_at/updated_at DEFAULT NULL (BUKAN CURRENT_TIMESTAMP) — SENGAJA,
    // supaya test membuktikan perbaikan lapis APLIKASI, bukan tertolong default DB.
    const USERS_DDL = `
        CREATE TABLE users (
            id INTEGER PRIMARY KEY, name TEXT, username TEXT, password TEXT,
            phone_number TEXT, address TEXT, device_id TEXT, status TEXT DEFAULT 'active',
            latitude REAL, longitude REAL, maps_url TEXT,
            subscription TEXT, subscription_price INTEGER DEFAULT 0, payment_due_date INTEGER DEFAULT 1,
            paid INTEGER DEFAULT 0, is_paid INTEGER DEFAULT 0, send_invoice INTEGER DEFAULT 0,
            auto_isolir INTEGER DEFAULT 1, is_corporate INTEGER DEFAULT 0,
            corporate_name TEXT, corporate_address TEXT, corporate_npwp TEXT,
            corporate_pic_name TEXT, corporate_pic_phone TEXT, corporate_pic_email TEXT,
            pppoe_username TEXT, pppoe_password TEXT, connected_odp_id TEXT, bulk TEXT,
            odc TEXT, odp TEXT, olt TEXT, registration_date TEXT,
            created_at TEXT DEFAULT NULL, updated_at TEXT DEFAULT NULL,
            email TEXT, alternative_phone TEXT, notes TEXT,
            notify_outage INTEGER DEFAULT 1, account_type TEXT DEFAULT 'pelanggan',
            assigned_agen_id INTEGER
        )`;

    // Trigger PERSIS seperti di lib/database.js (jaring pengaman lapis DB).
    const TRIGGER_DDL = `
        CREATE TRIGGER IF NOT EXISTS trg_users_stamp_timestamps
        AFTER INSERT ON users FOR EACH ROW
        WHEN (NEW.created_at IS NULL OR NEW.created_at = '') OR (NEW.updated_at IS NULL OR NEW.updated_at = '')
        BEGIN
            UPDATE users
               SET created_at = COALESCE(NULLIF(NEW.created_at, ''), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                   updated_at = COALESCE(NULLIF(NEW.updated_at, ''), NULLIF(NEW.created_at, ''), strftime('%Y-%m-%dT%H:%M:%fZ','now'))
             WHERE id = NEW.id;
        END`;

    const runSql = (db, sql, params = []) => new Promise((res, rej) => db.run(sql, params, (e) => (e ? rej(e) : res())));
    const getRow = (db, id) => new Promise((res, rej) => db.get("SELECT * FROM users WHERE id = ?", [id], (e, r) => (e ? rej(e) : res(r))));

    async function openDb(withTrigger) {
        const db = new sqlite3.Database(":memory:");
        await runSql(db, USERS_DDL);
        if (withTrigger) await runSql(db, TRIGGER_DDL);
        return db;
    }
    const repoFor = (db) => createApiUsersRepository({ runtime: null, getDb: () => db });

    test("field penting BENAR tersimpan ke DB (created_at, address, lat/long, username/password)", async () => {
        const db = await openDb(false);
        await repoFor(db).insertUserRecord({
            id: 96, name: "agus supriono", phone_number: "+62 856", subscription: "PAKET-110K",
            pppoe_username: "agus@rafcybernet", pppoe_password: "12345678", device_id: "HG8145V5",
            address: "Ds. Karang", latitude: -7.123456, longitude: 111.987654,
            username: "agus", password: "rahasia",
            created_at: "2026-07-13T10:00:00.000Z", paid: false, bulk: ["1", "5"]
        });
        const row = await getRow(db, 96);
        // Inti bug: SEMUA field di bawah ini DULU terbuang senyap (tampak ada di memori, raib saat restart).
        expect(row.created_at).toBe("2026-07-13T10:00:00.000Z");
        expect(row.updated_at).toBe("2026-07-13T10:00:00.000Z");
        expect(row.address).toBe("Ds. Karang");
        expect(row.latitude).toBeCloseTo(-7.123456);
        expect(row.longitude).toBeCloseTo(111.987654);
        expect(row.username).toBe("agus");
        expect(row.password).toBe("rahasia");
        // Perilaku lama tetap benar.
        expect(row.paid).toBe(0);
        expect(row.bulk).toBe(JSON.stringify(["1", "5"]));
        expect(row.account_type).toBe("pelanggan");
        db.close();
    });

    test("alias & default lama tetap jalan (phone/package/odp_id, bulk ['1'], notify_outage, infrastruktur) + created_at dijamin", async () => {
        const db = await openDb(false);
        await repoFor(db).insertUserRecord({
            id: 7, name: "CCTV Lapangan", phone: "628123", package: "PAKET-VOUCHER",
            odp_id: "ODP-1", notify_outage: false, account_type: "INFRASTRUKTUR"
        });
        const row = await getRow(db, 7);
        expect(row.phone_number).toBe("628123");
        expect(row.subscription).toBe("PAKET-VOUCHER");
        expect(row.connected_odp_id).toBe("ODP-1");
        expect(row.bulk).toBe(JSON.stringify(["1"]));
        expect(row.notify_outage).toBe(0);
        expect(row.account_type).toBe("infrastruktur");
        expect(row.created_at).toBeTruthy(); // dijamin lapis aplikasi walau pemanggil tak mengirim
        db.close();
    });

    test("JARING PENGAMAN DB: trigger mengisi created_at walau INSERT tak menyertakannya sama sekali", async () => {
        const db = await openDb(true);
        await runSql(db, "INSERT INTO users (id, name) VALUES (?, ?)", [50, "Tanpa Tanggal"]);
        const row = await getRow(db, 50);
        expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(row.updated_at).toBeTruthy();
        db.close();
    });
});
