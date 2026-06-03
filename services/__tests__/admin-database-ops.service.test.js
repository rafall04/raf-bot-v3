/**
 * Header Doc
 * Purpose: Guardrail test untuk memastikan service utility database admin mempertahankan debug inspection dan cleanup file migrasi.
 * Caller: Jest test runner.
 * Deps: `fs`, `os`, `path`, dan `../admin-database-ops.service`.
 * MainFuncs: Memverifikasi `getDatabaseDiagnostics` dan `migrateUsersFromJsonUpload`.
 * SideEffects: Membuat file sementara lalu menghapusnya saat test.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createAdminDatabaseOpsService } = require("../admin-database-ops.service");

describe("admin-database-ops.service", () => {
    test("getDatabaseDiagnostics mengembalikan inspeksi database legacy", async () => {
        const dbMock = {
            all: jest.fn((sql, _params, callback) => {
                if (sql.includes("sqlite_master")) return callback(null, [{ name: "users" }]);
                if (sql.includes("PRAGMA table_info")) return callback(null, [{ name: "id" }]);
                if (sql.includes("LIMIT 10")) return callback(null, [{ id: 1, name: "Raf" }]);
                return callback(null, [{ status: "active", count: 1 }]);
            }),
            get: jest.fn((_sql, _params, callback) => callback(null, { count: 1 })),
            close: jest.fn((callback) => callback())
        };
        const sqlite3Mock = {
            OPEN_READONLY: 1,
            Database: jest.fn(() => dbMock)
        };

        const service = createAdminDatabaseOpsService({
            sqlite3: sqlite3Mock,
            getDatabasePath: jest.fn(() => "users.sqlite"),
            fs: {
                existsSync: jest.fn(() => true),
                statSync: jest.fn(() => ({ size: 1024 }))
            }
        });

        const result = await service.getDatabaseDiagnostics();

        expect(result.status).toBe(200);
        expect(result.database.path).toBe("users.sqlite");
        expect(result.data.tables).toEqual(["users"]);
        expect(result.data.usersCount).toBe(1);
    });

    test("migrateUsersFromJsonUpload membersihkan file temp saat sukses", async () => {
        const tempFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "migrate-users-")), "users.json");
        fs.writeFileSync(tempFile, JSON.stringify([{ id: 1, name: "Raf" }]), "utf8");

        global.db = {
            all: jest.fn((sql, _params, callback) => {
                if (sql.includes("SELECT id FROM users")) return callback(null, []);
                return callback(null, [{ id: 1, name: "Raf" }]);
            }),
            run: jest.fn((sql, params, callback) => {
                const cb = typeof params === "function" ? params : callback;
                cb.call({ changes: 1 }, null);
            }),
            prepare: jest.fn(() => ({
                run: jest.fn((values, callback) => callback.call({ changes: 1 }, null)),
                finalize: jest.fn((callback) => callback(null))
            }))
        };
        global.users = [];

        const service = createAdminDatabaseOpsService({
            prepareUserData: jest.fn(async (user) => user),
            getFieldNames: jest.fn(() => ["id", "name"]),
            getPlaceholders: jest.fn(() => "?, ?"),
            getValuesArray: jest.fn((user) => [user.id, user.name]),
            transformUsersFromDb: jest.fn((rows) => ({ transformedUsers: rows, errorCount: 0 }))
        });

        const result = await service.migrateUsersFromJsonUpload({ filePath: tempFile });

        expect(result.status).toBe(200);
        expect(fs.existsSync(tempFile)).toBe(false);
        expect(global.users).toEqual([{ id: 1, name: "Raf" }]);
    });
});
