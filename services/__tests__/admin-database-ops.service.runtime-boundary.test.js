/**
 * Header Doc
 * Purpose: Guardrail test untuk memastikan service admin-database-ops memakai db dan cache user via dependency injection.
 * Caller: Jest test runner.
 * Deps: `../admin-database-ops.service`.
 * MainFuncs: Memverifikasi migrasi users memakai `deps.getDb()` dan `deps.userRepository`.
 * SideEffects: Membuat file sementara lalu membersihkannya kembali.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createAdminDatabaseOpsService } = require("../admin-database-ops.service");

describe("admin-database-ops.service runtime boundary", () => {
    test("migrateUsersFromJsonUpload uses injected db and user repository", async () => {
        const tempFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "admin-db-ops-")), "users.json");
        fs.writeFileSync(tempFile, JSON.stringify([{ id: 1, name: "Raf" }]), "utf8");

        const db = {
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
        const userRepository = {
            getAll: jest.fn(() => []),
            setAll: jest.fn()
        };
        const service = createAdminDatabaseOpsService({
            getDb: jest.fn(() => db),
            userRepository,
            prepareUserData: jest.fn(async (user) => user),
            getFieldNames: jest.fn(() => ["id", "name"]),
            getPlaceholders: jest.fn(() => "?, ?"),
            getValuesArray: jest.fn((user) => [user.id, user.name]),
            transformUsersFromDb: jest.fn((rows) => ({ transformedUsers: rows, errorCount: 0 }))
        });

        const result = await service.migrateUsersFromJsonUpload({ filePath: tempFile });

        expect(result.status).toBe(200);
        expect(userRepository.setAll).toHaveBeenCalledWith([{ id: 1, name: "Raf" }]);
    });
});
