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

// ── Kolom users yang boleh ditulis saat CREATE ───────────────────────────────────────────
// Daftar VALUES dibangun DINAMIS dari whitelist ini (bukan diketik manual). Dulu INSERT hanya
// memuat 20 kolom, sehingga created_at/updated_at/address/latitude/longitude/username/password
// TERBUANG tanpa error — data tampak utuh di snapshot in-memory lalu RAIB saat bot restart
// (users di-reload dari SQLite). Menambah field baru cukup di sini; tak ada lagi kolom hilang senyap.
const USER_INSERT_COLUMNS = [
    "id", "name", "phone_number", "address",
    "subscription", "subscription_price", "payment_due_date",
    "pppoe_username", "pppoe_password", "device_id",
    "username", "password",
    "latitude", "longitude", "maps_url",
    "connected_odp_id", "odc", "odp", "olt",
    "bulk", "paid", "is_paid", "send_invoice", "notify_outage", "auto_isolir",
    "is_corporate", "corporate_name", "corporate_address", "corporate_npwp",
    "corporate_pic_name", "corporate_pic_phone", "corporate_pic_email",
    "status", "account_type", "assigned_agen_id",
    "email", "alternative_phone", "notes",
    "registration_date", "created_at", "updated_at"
];

/** boolean → 0/1, array/objek → JSON string; sisanya apa adanya. */
function toDbValue(value) {
    if (typeof value === "boolean") return value ? 1 : 0;
    if (value !== null && typeof value === "object") return JSON.stringify(value);
    return value;
}

/**
 * Samakan alias historis (phone/package/odp_id) + normalisasi ke bentuk kolom DB. TIDAK memutasi
 * objek asal. `created_at`/`updated_at` DIJAMIN terisi di sini (lapis aplikasi); lapis DB dijaga
 * trigger `trg_users_stamp_timestamps` (lib/database.js) karena tabel prod lama ber-DEFAULT NULL.
 */
function buildUserInsertRecord(newUser) {
    const u = newUser || {};
    const nowIso = new Date().toISOString();
    return {
        ...u,
        phone_number: u.phone_number || u.phone,
        subscription: u.subscription || u.package,
        connected_odp_id: u.connected_odp_id || u.odp_id || null,
        paid: u.paid ? 1 : 0,
        send_invoice: u.send_invoice ? 1 : 0,
        is_corporate: u.is_corporate ? 1 : 0,
        bulk: typeof u.bulk === "string" ? u.bulk : JSON.stringify(u.bulk || ["1"]),
        notify_outage: u.notify_outage === false ? 0 : 1,
        account_type: String(u.account_type || "").trim().toLowerCase() === "infrastruktur" ? "infrastruktur" : "pelanggan",
        created_at: u.created_at || nowIso,
        updated_at: u.updated_at || u.created_at || nowIso
    };
}

function createApiUsersRepository(overrides = {}) {
    const deps = {
        ...defaultDeps(),
        ...overrides
    };

    // Cache kolom tabel users (PER INSTANCE — aman untuk test dengan DB berbeda). Dipakai sebagai
    // guard drift skema: kolom whitelist yang tak ada di tabel di-SKIP, bukan bikin INSERT gagal.
    let usersColumnsCache = null;
    function getUsersTableColumns(db) {
        if (usersColumnsCache) return Promise.resolve(usersColumnsCache);
        return new Promise((resolve) => {
            if (!db || typeof db.all !== "function") { resolve(null); return; }
            db.all("PRAGMA table_info(users)", [], (err, rows) => {
                if (err || !Array.isArray(rows) || !rows.length) { resolve(null); return; }
                usersColumnsCache = new Set(rows.map((row) => row.name));
                resolve(usersColumnsCache);
            });
        });
    }

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

            // INSERT DIBANGUN DINAMIS dari USER_INSERT_COLUMNS ∩ kolom tabel ∩ field yang ada di
            // record. Sebelumnya daftar kolom diketik manual dan LUPA memuat created_at/address/
            // latitude/longitude/username/password → data terbuang senyap (lihat komentar whitelist).
            const record = buildUserInsertRecord(newUser);
            const tableColumns = await getUsersTableColumns(db);
            const columns = USER_INSERT_COLUMNS.filter(
                (col) => record[col] !== undefined && (!tableColumns || tableColumns.has(col))
            );
            const insertQuery =
                `INSERT INTO users (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`;
            const values = columns.map((col) => toDbValue(record[col]));

            await new Promise((resolve, reject) => {
                db.run(insertQuery, values, function onInsertUser(err) {
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
                "corporate_pic_email", "notify_outage", "account_type"
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
