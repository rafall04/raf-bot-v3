/**
 * Header Doc
 * Purpose: Menjadi owner query batch read untuk domain rekap tunggakan pelanggan berbasis periode.
 * Caller: `services/arrears.service.js`.
 * Deps: `sqlite3` dan `../lib/env-config`.
 * MainFuncs: `createArrearsRepository`, `listBillableCustomers`, `getLedgerEntriesUpToPeriod`.
 * SideEffects: Membaca SQLite `users.sqlite`.
 */
"use strict";

function defaultDeps() {
    return {
        sqlite3: require("sqlite3").verbose(),
        getDatabasePath: require("../lib/env-config").getDatabasePath
    };
}

function createArrearsRepository(overrides = {}) {
    const deps = {
        ...defaultDeps(),
        ...overrides
    };

    function createDb(mode = deps.sqlite3.OPEN_READONLY) {
        return new deps.sqlite3.Database(deps.getDatabasePath("users.sqlite"), mode);
    }

    function all(db, sql, params = []) {
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

    return {
        deps,

        async listBillableCustomers() {
            const db = createDb();
            try {
                return await all(
                    db,
                    `SELECT id, name, phone_number, subscription, subscription_price, status, area
                       FROM users
                      WHERE status IN ('aktif', 'isolir')
                      ORDER BY id ASC`
                );
            } finally {
                db.close();
            }
        },

        async getLedgerEntriesUpToPeriod({ periodMonth, periodYear }) {
            const db = createDb();
            const cutoff = (Number(periodYear) * 100) + Number(periodMonth);

            try {
                const payments = await all(
                    db,
                    `SELECT user_id, amount_paid, amount_due, period_month, period_year
                       FROM payment_history
                      WHERE ((period_year * 100) + period_month) <= ?
                      ORDER BY period_year ASC, period_month ASC, id ASC`,
                    [cutoff]
                );
                const reversals = await all(
                    db,
                    `SELECT user_id, amount_reversed, period_month, period_year
                       FROM payment_reversals
                      WHERE status = 'completed'
                        AND ((period_year * 100) + period_month) <= ?
                      ORDER BY period_year ASC, period_month ASC, id ASC`,
                    [cutoff]
                );

                return { payments, reversals };
            } finally {
                db.close();
            }
        }
    };
}

module.exports = { createArrearsRepository };
