/**
 * Header Doc
 * Purpose: Menjadi owner persistence/read-model awal untuk domain users/customer API selama normalisasi route `api-users-routes`.
 * Caller: `services/api-users.service.js`.
 * Deps: Runtime repository users/accounts/network-assets, helper SQLite/env-config untuk verifikasi integritas awal, dan DB runtime utama.
 * MainFuncs: `createApiUsersRepository`, `getUsersSnapshot`, `findUserById`, `getUserCountComparison`, `deleteUserRecord`, `deleteAllUserRecords`, `replaceUsersSnapshot`, `replaceNetworkAssetsSnapshot`, `insertUserRecord`, `updateUserRecord`.
 * SideEffects: Membaca snapshot users/accounts/network-assets runtime/global, menghitung perbandingan jumlah users runtime vs SQLite, dan menulis delete/update ke DB runtime serta state repository.
 */
"use strict";

function defaultDeps() {
    return {
        runtime: global.__appRuntime || null,
        sqlite3: require("sqlite3").verbose(),
        getDatabasePath: require("../lib/env-config").getDatabasePath,
        getDb: () => global.db || null
    };
}

function createApiUsersRepository(overrides = {}) {
    const deps = {
        ...defaultDeps(),
        ...overrides
    };

    return {
        deps,
        getUsersSnapshot() {
            const usersRepository = deps.runtime?.repositories?.users || null;
            if (usersRepository?.getAll) {
                return usersRepository.getAll();
            }
            if (deps.runtime?.state?.has?.("users")) {
                return deps.runtime.state.get("users");
            }
            if (typeof global.users !== "undefined") {
                return global.users;
            }
            return [];
        },

        getAccountsSnapshot() {
            const accountsRepository = deps.runtime?.repositories?.accounts || null;
            if (accountsRepository?.getAll) {
                return accountsRepository.getAll();
            }
            if (deps.runtime?.state?.has?.("accounts")) {
                return deps.runtime.state.get("accounts");
            }
            if (typeof global.accounts !== "undefined") {
                return global.accounts;
            }
            return [];
        },

        getNetworkAssetsSnapshot() {
            const networkAssetsRepository = deps.runtime?.repositories?.networkAssets || null;
            if (networkAssetsRepository?.getAll) {
                return networkAssetsRepository.getAll();
            }
            if (deps.runtime?.state?.has?.("networkAssets")) {
                return deps.runtime.state.get("networkAssets");
            }
            if (typeof global.networkAssets !== "undefined") {
                return global.networkAssets;
            }
            return [];
        },

        findUserById(id) {
            return this.getUsersSnapshot().find((user) => String(user.id) === String(id)) || null;
        },

        findAccountById(id) {
            return this.getAccountsSnapshot().find((account) => String(account.id) === String(id)) || null;
        },

        async getUserCountComparison() {
            const users = this.getUsersSnapshot();
            const dbPath = deps.getDatabasePath("users.sqlite");
            const db = new deps.sqlite3.Database(dbPath, deps.sqlite3.OPEN_READONLY);

            return new Promise((resolve) => {
                db.get("SELECT COUNT(*) as count FROM users", [], (err, row) => {
                    if (err) {
                        db.close();
                        resolve({
                            users,
                            memoryCount: users.length,
                            dbCount: null,
                            verificationFailed: true,
                            error: err
                        });
                        return;
                    }

                    db.close();
                    resolve({
                        users,
                        memoryCount: users.length,
                        dbCount: row ? row.count : 0,
                        verificationFailed: false,
                        error: null
                    });
                });
            });
        },

        async deleteUserRecord(id) {
            const db = deps.runtime?.getDb?.() || deps.getDb();
            if (!db?.run) {
                throw new Error("Database runtime tidak tersedia");
            }

            return new Promise((resolve, reject) => {
                db.run("DELETE FROM users WHERE id = ?", [id], function onDeleteUser(err) {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve();
                });
            });
        },

        async deleteAllUserRecords() {
            const db = deps.runtime?.getDb?.() || deps.getDb();
            if (!db?.run) {
                throw new Error("Database runtime tidak tersedia");
            }

            return new Promise((resolve, reject) => {
                db.run("DELETE FROM users", function onDeleteAllUsers(err) {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve();
                });
            });
        },

        replaceUsersSnapshot(nextUsers) {
            const usersRepository = deps.runtime?.repositories?.users || null;
            if (usersRepository?.setAll) {
                return usersRepository.setAll(nextUsers);
            }
            global.users = nextUsers;
            return nextUsers;
        },

        replaceNetworkAssetsSnapshot(nextAssets) {
            const networkAssetsRepository = deps.runtime?.repositories?.networkAssets || null;
            if (networkAssetsRepository?.setAll) {
                return networkAssetsRepository.setAll(nextAssets);
            }
            global.networkAssets = nextAssets;
            return nextAssets;
        },

        async insertUserRecord(newUser) {
            const db = deps.runtime?.getDb?.() || deps.getDb();
            if (!db?.run) {
                throw new Error("Database runtime tidak tersedia");
            }

            const insertQuery = `
                INSERT INTO users (
                    id, name, phone_number, subscription, device_id, paid,
                    pppoe_username, pppoe_password, connected_odp_id,
                    send_invoice, is_corporate, corporate_name,
                    corporate_address, corporate_npwp, corporate_pic_name,
                    corporate_pic_phone, corporate_pic_email, bulk, notify_outage
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            await new Promise((resolve, reject) => {
                db.run(insertQuery, [
                    newUser.id,
                    newUser.name,
                    newUser.phone_number || newUser.phone,
                    newUser.subscription || newUser.package,
                    newUser.device_id,
                    newUser.paid ? 1 : 0,
                    newUser.pppoe_username,
                    newUser.pppoe_password,
                    newUser.connected_odp_id || newUser.odp_id || null,
                    newUser.send_invoice ? 1 : 0,
                    newUser.is_corporate ? 1 : 0,
                    newUser.corporate_name || null,
                    newUser.corporate_address || null,
                    newUser.corporate_npwp || null,
                    newUser.corporate_pic_name || null,
                    newUser.corporate_pic_phone || null,
                    newUser.corporate_pic_email || null,
                    JSON.stringify(newUser.bulk || ["1"]),
                    newUser.notify_outage === false ? 0 : 1
                ], function onInsertUser(err) {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve();
                });
            });
        },

        async updateUserRecord({ id, fields, draftUser, skipPaidField = false }) {
            const db = deps.runtime?.getDb?.() || deps.getDb();
            if (!db?.run) {
                throw new Error("Database runtime tidak tersedia");
            }

            const validColumns = [
                "name", "phone_number", "address", "subscription", "pppoe_username",
                "device_id", "paid", "username", "password", "otp", "otpTimestamp",
                "bulk", "connected_odp_id", "latitude", "longitude", "pppoe_password",
                "send_invoice", "is_corporate", "corporate_name", "corporate_address",
                "corporate_npwp", "corporate_pic_name", "corporate_pic_phone",
                "corporate_pic_email", "notify_outage"
            ];
            const updateFields = [];
            const updateValues = [];

            fields.forEach((field) => {
                let dbField = field;
                if (field === "phone") dbField = "phone_number";
                else if (field === "package") dbField = "subscription";
                else if (field === "odp_id") dbField = "connected_odp_id";
                else dbField = field.replace(/-/g, "_");

                if (!validColumns.includes(dbField)) {
                    return;
                }

                if (dbField === "paid" && skipPaidField) {
                    return;
                }

                updateFields.push(dbField);
                const value = draftUser[dbField];
                if (typeof value === "boolean") {
                    updateValues.push(value ? 1 : 0);
                } else if (dbField === "bulk") {
                    updateValues.push(Array.isArray(value) ? JSON.stringify(value) : (value || null));
                } else {
                    updateValues.push(value);
                }
            });

            if (updateFields.length === 0) {
                return { updated: false, fields: [] };
            }

            const setClause = updateFields.map((field) => `"${field}" = ?`).join(", ");
            updateValues.push(id);
            const updateQuery = `UPDATE users SET ${setClause} WHERE id = ?`;

            await new Promise((resolve, reject) => {
                db.run(updateQuery, updateValues, function onUpdateUser(err) {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve();
                });
            });

            return {
                updated: true,
                fields: updateFields
            };
        }
    };
}

module.exports = {
    createApiUsersRepository
};
