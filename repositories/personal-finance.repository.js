/**
 * Header Doc
 * Purpose: Owner persistensi domain KEUANGAN PRIBADI owner (catatan pemasukan/pengeluaran +
 *          rekap). Domain ini SENGAJA terisolasi penuh dari saldo pelanggan: file SQLite
 *          sendiri (`personal_finance.sqlite`), tabel sendiri, dan kosakata sendiri
 *          (`entry`, bukan `saldo`) supaya tidak ada jalur kode yang bisa tertukar dan
 *          mendebit dompet pelanggan.
 * Caller: `lib/personal-finance-service.js`, `routes/admin-personal-finance-routes.js`,
 *         `message/handlers/personal-finance-wa.js`.
 * Deps: `sqlite3`, `../lib/env-config.getDatabasePath`, `../lib/sqlite-pragmas.applySqlitePragmas`.
 * MainFuncs: `createPersonalFinanceRepository` → `initSchema`, `addEntry`, `listEntries`,
 *            `getEntry`, `deleteEntry`, `summary`.
 * SideEffects: Membuat/menulis `database/personal_finance.sqlite` (di test → `_test`).
 */
"use strict";

const DB_NAME = "personal_finance.sqlite";

const SCHEMA_SQL = [
    `CREATE TABLE IF NOT EXISTS pf_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        tanggal TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('in','out')),
        amount INTEGER NOT NULL CHECK (amount > 0),
        category TEXT NOT NULL DEFAULT 'lain',
        note TEXT,
        source TEXT NOT NULL DEFAULT 'wa',
        created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_pf_tanggal ON pf_entries (tanggal)`,
    `CREATE INDEX IF NOT EXISTS idx_pf_kind_tanggal ON pf_entries (kind, tanggal)`
];

function defaultDeps() {
    return {
        sqlite3: require("sqlite3").verbose(),
        getDatabasePath: require("../lib/env-config").getDatabasePath,
        applySqlitePragmas: require("../lib/sqlite-pragmas").applySqlitePragmas
    };
}

function createPersonalFinanceRepository(overrides = {}) {
    const deps = { ...defaultDeps(), ...overrides };
    let schemaReady = false;

    function openDb() {
        const mode = deps.sqlite3.OPEN_READWRITE | deps.sqlite3.OPEN_CREATE;
        return new Promise((resolve, reject) => {
            const db = new deps.sqlite3.Database(deps.getDatabasePath(DB_NAME), mode, (err) => {
                if (err) return reject(err);
                resolve(db);
            });
        });
    }

    function run(db, sql, params = []) {
        return new Promise((resolve, reject) => {
            db.run(sql, params, function onDone(err) {
                if (err) return reject(err);
                resolve({ lastID: this.lastID, changes: this.changes });
            });
        });
    }

    function all(db, sql, params = []) {
        return new Promise((resolve, reject) => {
            db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
        });
    }

    function get(db, sql, params = []) {
        return new Promise((resolve, reject) => {
            db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
        });
    }

    /**
     * Buka koneksi + pastikan skema ada, jalankan `fn`, lalu SELALU tutup.
     * Pola open/close per operasi (sama seperti repository lain di repo ini) — beban
     * tulis domain ini sangat rendah (satu orang, beberapa catatan per hari) sehingga
     * tidak perlu koneksi persisten yang justru bisa nyangkut seperti users.sqlite.
     */
    async function withDb(fn) {
        const db = await openDb();
        try {
            await deps.applySqlitePragmas(db);
            if (!schemaReady) {
                for (const sql of SCHEMA_SQL) {
                    await run(db, sql);
                }
                schemaReady = true;
            }
            return await fn(db);
        } finally {
            db.close();
        }
    }

    /** Bangun klausa WHERE dari filter periode/jenis/kategori. */
    function buildFilter({ from, to, kind, category } = {}) {
        const where = [];
        const params = [];
        if (from) {
            where.push("tanggal >= ?");
            params.push(String(from));
        }
        if (to) {
            where.push("tanggal <= ?");
            params.push(String(to));
        }
        if (kind === "in" || kind === "out") {
            where.push("kind = ?");
            params.push(kind);
        }
        if (category) {
            where.push("LOWER(category) = ?");
            params.push(String(category).toLowerCase());
        }
        return { clause: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
    }

    return {
        deps,
        DB_NAME,

        async initSchema() {
            return withDb(async () => true);
        },

        /**
         * Simpan satu catatan. Nominal WAJIB bilangan bulat > 0 (rupiah) — divalidasi di
         * sini DAN oleh CHECK constraint, supaya nominal 0/negatif tak pernah masuk lewat
         * jalur mana pun. Ini cerminan aturan saldo pelanggan, walau ledgernya terpisah.
         */
        async addEntry(entry = {}) {
            const kind = entry.kind === "in" ? "in" : entry.kind === "out" ? "out" : null;
            if (!kind) throw new Error("kind wajib 'in' atau 'out'");

            const amount = Number(entry.amount);
            if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount <= 0) {
                throw new Error("amount wajib bilangan bulat lebih dari 0");
            }

            const ts = String(entry.ts || "").trim() || nowLocalStamp();
            const tanggal = ts.slice(0, 10);
            const category = String(entry.category || "lain").trim().toLowerCase() || "lain";
            const note = entry.note == null ? null : String(entry.note).trim() || null;
            const source = entry.source === "web" ? "web" : "wa";

            return withDb(async (db) => {
                const res = await run(
                    db,
                    `INSERT INTO pf_entries (ts, tanggal, kind, amount, category, note, source, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [ts, tanggal, kind, amount, category, note, source, nowLocalStamp()]
                );
                return { id: res.lastID, ts, tanggal, kind, amount, category, note, source };
            });
        },

        async listEntries(filter = {}) {
            const { clause, params } = buildFilter(filter);
            const limit = Number.isFinite(Number(filter.limit)) ? Math.max(1, Math.min(500, Number(filter.limit))) : 50;
            const offset = Number.isFinite(Number(filter.offset)) ? Math.max(0, Number(filter.offset)) : 0;
            return withDb((db) =>
                all(
                    db,
                    `SELECT id, ts, tanggal, kind, amount, category, note, source
                       FROM pf_entries ${clause}
                      ORDER BY ts DESC, id DESC
                      LIMIT ? OFFSET ?`,
                    [...params, limit, offset]
                )
            );
        },

        async getEntry(id) {
            const entryId = Number(id);
            if (!Number.isInteger(entryId) || entryId <= 0) return null;
            return withDb((db) =>
                get(db, `SELECT id, ts, tanggal, kind, amount, category, note, source FROM pf_entries WHERE id = ?`, [entryId])
            );
        },

        async deleteEntry(id) {
            const entryId = Number(id);
            if (!Number.isInteger(entryId) || entryId <= 0) return { deleted: false };
            return withDb(async (db) => {
                const res = await run(db, `DELETE FROM pf_entries WHERE id = ?`, [entryId]);
                return { deleted: res.changes > 0 };
            });
        },

        /**
         * Rekap periode: total masuk, total keluar, selisih, dan rincian per kategori.
         * Semua agregasi dilakukan di SQL supaya laporan bulanan tidak menarik ribuan
         * baris ke memori proses bot.
         */
        async summary(filter = {}) {
            const { clause, params } = buildFilter({ from: filter.from, to: filter.to });
            return withDb(async (db) => {
                const totals = await all(
                    db,
                    `SELECT kind, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS jumlah
                       FROM pf_entries ${clause}
                      GROUP BY kind`,
                    params
                );
                const perKategori = await all(
                    db,
                    `SELECT category, kind, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS jumlah
                       FROM pf_entries ${clause}
                      GROUP BY category, kind
                      ORDER BY total DESC`,
                    params
                );

                const masuk = Number(totals.find((r) => r.kind === "in")?.total || 0);
                const keluar = Number(totals.find((r) => r.kind === "out")?.total || 0);
                return {
                    from: filter.from || null,
                    to: filter.to || null,
                    masuk,
                    keluar,
                    selisih: masuk - keluar,
                    jumlahCatatan: totals.reduce((acc, r) => acc + Number(r.jumlah || 0), 0),
                    perKategori
                };
            });
        }
    };
}

/** Stempel waktu lokal `YYYY-MM-DD HH:MM:SS`. Proses dipaksa TZ Asia/Jakarta di index.js. */
function nowLocalStamp(date = new Date()) {
    const p = (n) => String(n).padStart(2, "0");
    return (
        `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ` +
        `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`
    );
}

module.exports = { createPersonalFinanceRepository, nowLocalStamp, DB_NAME };
