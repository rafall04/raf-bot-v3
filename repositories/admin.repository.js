/**
 * Header Doc
 * Purpose: Repository admin untuk membungkus akses cache global, SQLite user, dan persistence request perubahan paket.
 * Caller: `services/admin.service.js`.
 * Deps: `sqlite3`, `lib/env-config`, `lib/migration-helper`, dan `lib/admin-request-persistence`.
 * MainFuncs: `createAdminRepository`, helper lookup user/package/account, reload users cache, dan persist package change request.
 * SideEffects: Membaca SQLite read-only, memperbarui `global.users`, dan menulis package change request JSON.
 */
"use strict";

const sqlite3 = require("sqlite3").verbose();
const { getDatabasePath } = require("../lib/env-config");
const { transformUsersFromDb } = require("../lib/migration-helper");
const {
    persistPackageChangeRequests,
    cancelExpiredPackageChangeRequests,
    createPackageChangeRequestRecord
} = require("../lib/admin-request-persistence");

function getPackageChangeRequestsStore() {
    if (!Array.isArray(global.packageChangeRequests)) {
        global.packageChangeRequests = [];
    }
    return global.packageChangeRequests;
}

function createAdminRepository() {
    return {
        getUserById(userId) {
            return (global.users || []).find((user) => String(user.id) === String(userId)) || null;
        },

        getPackageByName(packageName) {
            return (global.packages || []).find((item) => item.name === packageName) || null;
        },

        getAccountById(accountId) {
            return (global.accounts || []).find((account) => String(account.id) === String(accountId)) || null;
        },

        getUsersList() {
            return (global.users || []).map((user) => ({
                id: user.id,
                name: user.name,
                pppoe_username: user.pppoe_username,
                subscription: user.subscription
            }));
        },

        getPackagesList() {
            return (global.packages || []).map((item) => ({
                ...item,
                price: Number(item.price) || 0
            }));
        },

        getPackageChangeRequests() {
            return getPackageChangeRequestsStore();
        },

        findPackageChangeRequestIndexById(requestId) {
            return getPackageChangeRequestsStore().findIndex((item) => String(item.id) === String(requestId));
        },

        findPendingPackageChangeRequestByUserId(userId) {
            return getPackageChangeRequestsStore().find(
                (item) => String(item.userId) === String(userId) && item.status === "pending"
            ) || null;
        },

        cancelExpiredPackageChangeRequests() {
            return cancelExpiredPackageChangeRequests(getPackageChangeRequestsStore());
        },

        createPackageChangeRequestRecord(payload) {
            return createPackageChangeRequestRecord(payload);
        },

        appendPackageChangeRequest(request) {
            getPackageChangeRequestsStore().push(request);
            return request;
        },

        replacePackageChangeRequest(index, request) {
            getPackageChangeRequestsStore()[index] = request;
            return request;
        },

        persistPackageChangeRequests() {
            persistPackageChangeRequests(getPackageChangeRequestsStore());
        },

        getOwnerNumbers() {
            return Array.isArray(global.config && global.config.ownerNumber) ? global.config.ownerNumber : [];
        },

        getConfig() {
            return global.config || {};
        },

        async updateUserSubscription(userId, subscription) {
            const db = global.db;
            if (!db) {
                throw new Error("Database not initialized");
            }

            await new Promise((resolve, reject) => {
                db.run(
                    "UPDATE users SET subscription = ? WHERE id = ?",
                    [subscription, userId],
                    function onUpdate(err) {
                        if (err) {
                            reject(err);
                            return;
                        }
                        resolve();
                    }
                );
            });
        },

        syncUserSubscriptionCache(userId, subscription) {
            const user = this.getUserById(userId);
            if (user) {
                user.subscription = subscription;
            }
            return user;
        },

        async reloadUsersFromDatabase() {
            const dbPath = getDatabasePath("users.sqlite");
            const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);

            try {
                const dbCount = await new Promise((resolve, reject) => {
                    db.get("SELECT COUNT(*) as count FROM users", [], (err, row) => {
                        if (err) {
                            reject(err);
                            return;
                        }
                        resolve(row ? row.count : 0);
                    });
                });

                const rows = await new Promise((resolve, reject) => {
                    db.all("SELECT * FROM users ORDER BY id", [], (err, result) => {
                        if (err) {
                            reject(err);
                            return;
                        }
                        resolve(result || []);
                    });
                });

                const memoryCountBefore = Array.isArray(global.users) ? global.users.length : 0;
                const transformed = transformUsersFromDb(rows);
                global.users = transformed.transformedUsers;

                return {
                    databaseCount: dbCount,
                    memoryCountBefore,
                    memoryCountAfter: global.users.length,
                    rowsLoaded: rows.length,
                    transformErrors: transformed.errorCount,
                    missing: rows.length - global.users.length
                };
            } finally {
                await new Promise((resolve) => {
                    db.close(() => resolve());
                });
            }
        }
    };
}

module.exports = {
    createAdminRepository
};
