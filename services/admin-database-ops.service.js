/**
 * Header Doc
 * Purpose: Memusatkan operasi admin database read-only dan migrasi users agar registrar database tetap tipis.
 * Caller: `routes/admin-database-routes.js`.
 * Deps: `fs`, `sqlite3`, `lib/env-config`, `lib/migration-helper`, dan `lib/error-handler`.
 * MainFuncs: `createAdminDatabaseOpsService`, `getDatabaseDiagnostics`, `migrateUsersFromJsonUpload`.
 * SideEffects: Membaca SQLite, menulis record user via dependency DB runtime, memperbarui repository cache users, dan membersihkan file upload sementara.
 */
"use strict";

const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();
const { getDatabasePath } = require("../lib/env-config");
const {
    prepareUserData,
    getFieldNames,
    getPlaceholders,
    getValuesArray,
    transformUsersFromDb
} = require("../lib/migration-helper");
const { createError, ErrorTypes } = require("../lib/error-handler");
const { createRuntimeCacheRepository } = require("../repositories/runtime-cache.repository");

function defaultDeps() {
    const runtime = global.__appRuntime || null;
    const runtimeScope = runtime?.globalScope || global;
    const runtimeCacheRepository = createRuntimeCacheRepository(runtime);
    return {
        fs,
        sqlite3,
        getDatabasePath,
        prepareUserData,
        getFieldNames,
        getPlaceholders,
        getValuesArray,
        transformUsersFromDb,
        getDb() {
            return runtime?.getDb?.() || runtimeScope.db || null;
        },
        userRepository: runtimeCacheRepository.users
    };
}

function dbAll(db, sql, params = []) {
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

function dbGet(db, sql, params = []) {
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

function dbRun(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function onRun(err) {
            if (err) {
                reject(err);
                return;
            }
            resolve(this);
        });
    });
}

function stmtRun(statement, params) {
    return new Promise((resolve, reject) => {
        statement.run(params, function onRun(err) {
            if (err) {
                reject(err);
                return;
            }
            resolve(this);
        });
    });
}

function stmtFinalize(statement) {
    return new Promise((resolve, reject) => {
        statement.finalize((err) => {
            if (err) {
                reject(err);
                return;
            }
            resolve();
        });
    });
}

function closeDb(db) {
    return new Promise((resolve) => {
        db.close(() => resolve());
    });
}

function createAdminDatabaseOpsService(overrides = {}) {
    const deps = {
        ...defaultDeps(),
        ...overrides
    };

    return {
        async getDatabaseDiagnostics() {
            const dbPath = deps.getDatabasePath("users.sqlite");
            const db = new deps.sqlite3.Database(dbPath, deps.sqlite3.OPEN_READONLY);

            try {
                const results = {};
                const tables = await dbAll(db, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
                results.tables = tables.map((item) => item.name);
                results.usersCount = (await dbGet(db, "SELECT COUNT(*) as count FROM users"))?.count || 0;
                results.columns = await dbAll(db, "PRAGMA table_info(users)");
                results.sampleUsers = await dbAll(db, "SELECT id, name, phone_number, subscription, status, paid FROM users ORDER BY id LIMIT 10");
                results.globalUsersCount = deps.userRepository.getAll().length;
                results.usersByStatus = await dbAll(db, "SELECT status, COUNT(*) as count FROM users GROUP BY status");

                return {
                    status: 200,
                    message: "Database inspection successful",
                    database: {
                        path: dbPath,
                        exists: deps.fs.existsSync(dbPath),
                        fileSize: deps.fs.existsSync(dbPath) ? deps.fs.statSync(dbPath).size : 0
                    },
                    data: results
                };
            } finally {
                await closeDb(db);
            }
        },

        async migrateUsersFromJsonUpload(input = {}) {
            const uploadedFilePath = input.filePath;
            if (!uploadedFilePath) {
                throw createError(ErrorTypes.VALIDATION_ERROR, "File users.json harus diupload.", 400);
            }

            let usersData;
            try {
                const fileContent = deps.fs.readFileSync(uploadedFilePath, "utf8");
                usersData = JSON.parse(fileContent);
            } catch (error) {
                throw createError(
                    ErrorTypes.VALIDATION_ERROR,
                    "File JSON tidak valid atau rusak. Pastikan file adalah JSON yang valid.",
                    400
                );
            } finally {
                try {
                    if (deps.fs.existsSync(uploadedFilePath)) {
                        deps.fs.unlinkSync(uploadedFilePath);
                    }
                } catch (cleanupError) {
                    console.warn("[MIGRATE_USERS] Failed to cleanup temp file:", cleanupError.message);
                }
            }

            if (!Array.isArray(usersData)) {
                throw createError(ErrorTypes.VALIDATION_ERROR, "Format users.json tidak valid, harus berupa array.", 400);
            }

            const db = deps.getDb();
            const existingUsers = await dbAll(db, "SELECT id FROM users");
            const existingIds = new Set(existingUsers.map((user) => String(user.id)));

            const usersToInsert = [];
            const skippedUsers = [];

            for (const user of usersData) {
                if (existingIds.has(String(user.id))) {
                    skippedUsers.push({ id: user.id, name: user.name, reason: "Duplicate ID" });
                } else {
                    usersToInsert.push(user);
                }
            }

            let insertCount = 0;
            let errorCount = 0;
            const errors = [];

            if (usersToInsert.length > 0) {
                const fieldNames = deps.getFieldNames();
                const placeholders = deps.getPlaceholders();
                const insertSQL = `INSERT OR IGNORE INTO users (${fieldNames.join(", ")}) VALUES (${placeholders})`;
                const statement = db.prepare(insertSQL);

                try {
                    await dbRun(db, "BEGIN TRANSACTION");
                    for (const user of usersToInsert) {
                        try {
                            const preparedData = await deps.prepareUserData(user);
                            const values = deps.getValuesArray(preparedData);
                            await stmtRun(statement, values);
                            insertCount += 1;
                        } catch (error) {
                            errorCount += 1;
                            errors.push({
                                userId: user.id,
                                userName: user.name,
                                error: error.message
                            });
                        }
                    }
                    await stmtFinalize(statement);
                    await dbRun(db, "COMMIT");
                } catch (error) {
                    try {
                        await dbRun(db, "ROLLBACK");
                    } catch (rollbackError) {
                        console.error("[MIGRATE_USERS] Error rolling back:", rollbackError.message);
                    }
                    throw createError(ErrorTypes.DATABASE_ERROR, `Gagal melakukan migrasi: ${error.message}`, 500);
                }
            }

            const rows = await dbAll(db, "SELECT * FROM users");
            const transformed = deps.transformUsersFromDb(rows);
            deps.userRepository.setAll(transformed.transformedUsers);

            if (transformed.errorCount > 0) {
                console.warn(`[MIGRATE_USERS] ${transformed.errorCount} users failed to transform`);
            }

            const message = errorCount > 0
                ? `Migrasi selesai dengan peringatan! ${insertCount} dari ${usersData.length} pengguna berhasil dimigrasikan. ${errorCount} pengguna gagal. ${skippedUsers.length} duplikat dilewati.`
                : `Migrasi berhasil! ${insertCount} pengguna telah dipindahkan ke database SQLite dan dimuat ke memori. ${skippedUsers.length} duplikat dilewati.`;

            return {
                status: 200,
                message,
                details: {
                    total: usersData.length,
                    success: insertCount,
                    failed: errorCount,
                    skipped: skippedUsers.length,
                    reloaded: rows.length,
                    errors
                }
            };
        }
    };
}

module.exports = {
    createAdminDatabaseOpsService
};
