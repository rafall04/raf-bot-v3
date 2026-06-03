/**
 * Header Doc
 * Purpose: Menjadi owner persistence/read-model awal untuk domain API PSB selama normalisasi `routes/api-psb-routes.js`.
 * Caller: `services/api-psb.service.js`.
 * Deps: Runtime repository users/packages/accounts/config/cron/psbRecords, DB runtime, dan PSB DB runtime/global sebagai fallback.
 * MainFuncs: `createApiPsbRepository`, `getDb`, `getPsbDb`, `getUsersSnapshot`, `updateUsers`, `getPackagesSnapshot`, `getAccountsSnapshot`, `getConfigSnapshot`, `getCronConfigSnapshot`, `getPsbRecordsSnapshot`, `setPsbRecordsSnapshot`, `updatePsbRecordsSnapshot`, `deleteAllPsbRecords`.
 * SideEffects: Membaca snapshot runtime/global untuk users/packages/accounts/config/cron/PSB, akses DB runtime, dan menjalankan write-path snapshot/DB PSB tanpa memodifikasi business flow lain.
 */
"use strict";

function defaultDeps() {
    return {
        runtime: global.__appRuntime || null
    };
}

function createApiPsbRepository(overrides = {}) {
    const deps = {
        ...defaultDeps(),
        ...overrides
    };

    return {
        deps,

        getRuntimeStateValue(key, fallbackValue) {
            if (deps.runtime?.state?.has?.(key)) {
                return deps.runtime.state.get(key);
            }
            if (typeof global[key] !== "undefined") {
                return global[key];
            }
            return fallbackValue;
        },

        getDb() {
            return deps.runtime?.getDb?.() || this.getRuntimeStateValue("db", null);
        },

        getPsbDb() {
            return deps.runtime?.repositories?.psbDb?.get?.() || this.getRuntimeStateValue("psbDb", null);
        },

        getUsersSnapshot() {
            return deps.runtime?.repositories?.users?.getAll?.() || this.getRuntimeStateValue("users", []);
        },

        updateUsers(updater) {
            const usersRepo = deps.runtime?.repositories?.users || null;
            if (usersRepo?.update) {
                return usersRepo.update(updater);
            }

            const nextUsers = typeof updater === "function" ? updater(this.getUsersSnapshot()) : updater;
            global.users = nextUsers;
            return nextUsers;
        },

        getPackagesSnapshot() {
            return deps.runtime?.repositories?.packages?.getAll?.() || this.getRuntimeStateValue("packages", []);
        },

        getAccountsSnapshot() {
            return deps.runtime?.repositories?.accounts?.getAll?.() || this.getRuntimeStateValue("accounts", []);
        },

        getConfigSnapshot() {
            return deps.runtime?.getConfig?.() || this.getRuntimeStateValue("config", {}) || {};
        },

        getCronConfigSnapshot() {
            return deps.runtime?.repositories?.cronConfig?.get?.() || this.getRuntimeStateValue("cronConfig", {}) || {};
        },

        getPsbRecordsSnapshot() {
            return deps.runtime?.repositories?.psbRecords?.getAll?.() || this.getRuntimeStateValue("psbRecords", []);
        },

        setPsbRecordsSnapshot(nextRecords) {
            const psbRepo = deps.runtime?.repositories?.psbRecords || null;
            if (psbRepo?.setAll) {
                return psbRepo.setAll(nextRecords);
            }
            global.psbRecords = nextRecords;
            return nextRecords;
        },

        updatePsbRecordsSnapshot(updater) {
            const psbRepo = deps.runtime?.repositories?.psbRecords || null;
            if (psbRepo?.update) {
                return psbRepo.update(updater);
            }

            const nextRecords = typeof updater === "function" ? updater(this.getPsbRecordsSnapshot()) : updater;
            global.psbRecords = nextRecords;
            return nextRecords;
        },

        async deleteAllPsbRecords() {
            const psbDb = this.getPsbDb();
            if (!psbDb?.run) {
                throw new Error("Database PSB tidak tersedia");
            }

            return await new Promise((resolve, reject) => {
                psbDb.run("DELETE FROM psb_records", function onDelete(err) {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve(this.changes || 0);
                });
            });
        }
    };
}

module.exports = {
    createApiPsbRepository
};
