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
                // Catatan: kolom `area` TIDAK ada di skema `users` (lib/database.js) — menyebutnya
                // di SELECT melempar "no such column: area" di prod → rekap-tunggakan & filter Menunggak
                // rusak. Dibuang sampai kolom area benar-benar dibuat (roadmap P0 penagihan per-area).
                //
                // FILTER STATUS: dulu `status IN ('aktif','isolir')` — dua ejaan yang TIDAK PERNAH
                // ditulis kode mana pun. Terukur di produksi 2026-08-10: 100% baris bernilai
                // 'active' (60 Dander, 98 Tanjungharjo), sehingga query ini memulangkan NOL baris
                // dan SELURUH rekap tunggakan selalu 0 — bukan "tak ada yang menunggak", melainkan
                // "tak ada yang diperiksa". Isolir pun bukan di kolom ini melainkan profil PPPoE
                // MikroTik, jadi 'isolir' memang tak akan pernah muncul.
                //
                // Kini DAFTAR-HITAM, bukan daftar-putih: status yang tak dikenal tetap ditagih.
                // Arahnya disengaja — sama dengan cron pengingat: lebih baik menagih orang yang
                // ternyata sudah berhenti daripada diam-diam berhenti menagih seluruh pelanggan.
                //
                // Kolom diskon ikut diambil karena harga efektif dihitung dari sana (lihat
                // `services/arrears.service`); tanpa itu pelanggan berdiskon salah tagih.
                return await all(
                    db,
                    `SELECT id, name, phone_number, subscription, subscription_price, status,
                            discount_percentage, discount_amount, discount_months,
                            discount_months_used, discount_valid_until
                       FROM users
                      WHERE LOWER(COALESCE(account_type, 'pelanggan')) != 'infrastruktur'
                        AND LOWER(COALESCE(status, 'active')) NOT IN
                            ('nonaktif', 'non-aktif', 'inactive', 'cancelled', 'canceled', 'berhenti', 'keluar')
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
