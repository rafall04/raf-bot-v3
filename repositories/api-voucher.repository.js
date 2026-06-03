/**
 * Header Doc
 * Purpose: Menjadi owner persistence/read-model awal untuk domain API voucher selama normalisasi `routes/api-voucher-routes.js`.
 * Caller: `services/api-voucher.service.js`.
 * Deps: Runtime repository voucher/users/config, fallback file voucher JSON, dan helper history voucher yang saat ini masih legacy.
 * MainFuncs: `createApiVoucherRepository`, `getVoucherProfiles`, `getVoucherProfileById`, `loadSentHistory`, `appendSentHistory`, `findHistoryByReference`, `getSentStats`, `findUserById`, `findPackageByName`.
 * SideEffects: Membaca katalog voucher runtime/file, membaca/menulis history pengiriman voucher, lookup user voucher termasuk fallback SQLite, dan lookup paket runtime.
 */
"use strict";

function defaultDeps() {
    return {
        runtime: global.__appRuntime || null,
        fs: require("fs"),
        path: require("path"),
        sqlite3: require("sqlite3").verbose(),
        loadVoucherSentHistory: null,
        appendVoucherSentHistory: null,
        findVoucherHistoryByReference: null,
        getVoucherSentStats: null
    };
}

function createApiVoucherRepository(overrides = {}) {
    const deps = {
        ...defaultDeps(),
        ...overrides
    };

    return {
        deps,

        getRuntimeStateValue(key, fallbackValue) {
            const runtime = deps.runtime;
            if (runtime?.state?.has?.(key)) {
                return runtime.state.get(key);
            }
            if (typeof global[key] !== "undefined") {
                return global[key];
            }
            return fallbackValue;
        },

        getVoucherProfiles() {
            const voucherRepository = deps.runtime?.repositories?.voucher || null;
            let profiles = voucherRepository?.getAll?.() || this.getRuntimeStateValue("voucher", []);

            if (!profiles || profiles.length === 0) {
                const voucherDbPath = deps.path.join(__dirname, "../database/voucher.json");
                if (deps.fs.existsSync(voucherDbPath)) {
                    profiles = JSON.parse(deps.fs.readFileSync(voucherDbPath, "utf8"));
                }
            }

            return Array.isArray(profiles) ? profiles : [];
        },

        getVoucherProfileById(profileId) {
            return this.getVoucherProfiles().find((item) => item.prof === profileId) || null;
        },

        getPackagesSnapshot() {
            const packagesRepository = deps.runtime?.repositories?.packages || null;
            return packagesRepository?.getAll?.() || this.getRuntimeStateValue("packages", []);
        },

        findPackageByName(packageName) {
            return this.getPackagesSnapshot().find((pkg) => pkg.nama === packageName || pkg.profile === packageName) || null;
        },

        loadSentHistory() {
            return deps.loadVoucherSentHistory();
        },

        appendSentHistory(entries) {
            return deps.appendVoucherSentHistory(entries);
        },

        findHistoryByReference(history, referenceId) {
            return deps.findVoucherHistoryByReference(history, referenceId);
        },

        getSentStats(history) {
            return deps.getVoucherSentStats(history);
        },

        async findUserById(userId) {
            const usersRepository = deps.runtime?.repositories?.users || null;
            const users = usersRepository?.getAll?.() || this.getRuntimeStateValue("users", []);
            const runtimeUser = users.find((entry) => entry.id == userId || entry.pppoe == userId);
            if (runtimeUser) {
                return runtimeUser;
            }

            const dbPath = deps.path.join(__dirname, "../database/users.sqlite");
            const db = new deps.sqlite3.Database(dbPath);
            return new Promise((resolve, reject) => {
                db.get("SELECT * FROM users WHERE id = ? OR pppoe = ?", [userId, userId], (err, row) => {
                    db.close();
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve(row || null);
                });
            });
        }
    };
}

module.exports = {
    createApiVoucherRepository
};
