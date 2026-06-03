/**
 * Header Doc
 * Purpose: Repository billing untuk membungkus akses approval request, SQLite users, dan sinkronisasi cache pembayaran.
 * Caller: `services/billing.service.js`.
 * Deps: `lib/admin-request-persistence` dan koneksi `global.db`.
 * MainFuncs: `createBillingRepository`, load/persist approval request, query user DB, dan update paid status.
 * SideEffects: Membaca/menulis SQLite `users`, memperbarui `global.users`, dan menulis approval request JSON.
 */
"use strict";

const {
    loadApprovalRequests,
    persistApprovalRequests
} = require("../lib/admin-request-persistence");

function createBillingRepository() {
    return {
        ensureDatabaseReady() {
            if (!global.db) {
                throw new Error("Database not initialized");
            }
            return global.db;
        },

        loadApprovalRequests() {
            return loadApprovalRequests();
        },

        persistApprovalRequests(requests) {
            persistApprovalRequests(requests);
        },

        getCachedUserById(userId) {
            return (global.users || []).find((user) => String(user.id) === String(userId)) || null;
        },

        async getUserFromDatabase(userId) {
            const db = this.ensureDatabaseReady();
            return new Promise((resolve, reject) => {
                db.get("SELECT * FROM users WHERE id = ?", [userId], (err, row) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve(row || null);
                });
            });
        },

        async updateUserPaidStatus(userId, newPaidStatus) {
            const db = this.ensureDatabaseReady();
            await new Promise((resolve, reject) => {
                db.run(
                    "UPDATE users SET paid = ? WHERE id = ?",
                    [newPaidStatus, userId],
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

        syncUserPaidCache(userId, paid) {
            const user = this.getCachedUserById(userId);
            if (user) {
                user.paid = paid;
            }
            return user;
        }
    };
}

module.exports = {
    createBillingRepository
};
