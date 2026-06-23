/**
 * Header Doc
 * Purpose: Owner persistensi pelacakan voucher (database/voucher.sqlite) — fondasi fitur tracking hybrid (expiry tetap Mikhmon, bot pemilik laporan). Berisi parser nama log-script Mikhmon, ingest aktivasi (idempotent), record batch generate, dan agregat laporan.
 * Caller: cron reconcile voucher (slice berikut), script seed historis, dan service laporan voucher.
 * Deps: `sqlite3` (lazy/inject), `../lib/env-config` (getDatabasePath) untuk default path (test -> voucher_test.sqlite).
 * MainFuncs: `createVoucherTrackingRepository` -> parseMikhmonLogName, ingestLogNames, recordBatch, getReport, listActivations, close.
 * SideEffects: Membuat/menulis voucher.sqlite (3 tabel: voucher_activations, voucher_batches, vouchers).
 */
"use strict";

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function pad2(value) { return String(value).padStart(2, "0"); }

// "apr/03/2025" + "01:28:42" -> "2025-04-03 01:28:42" (string sortable, asumsi Asia/Jakarta).
function parseMikhmonDate(dateStr, timeStr) {
    const d = String(dateStr || "").toLowerCase().split("/");
    if (d.length !== 3) return null;
    const mon = MONTHS[d[0]];
    const day = parseInt(d[1], 10);
    const year = parseInt(d[2], 10);
    if (!mon || Number.isNaN(day) || Number.isNaN(year)) return null;
    const t = String(timeStr || "0:0:0").split(":");
    const hh = parseInt(t[0], 10) || 0;
    const mm = parseInt(t[1], 10) || 0;
    const ss = parseInt(t[2], 10) || 0;
    return `${year}-${pad2(mon)}-${pad2(day)} ${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`;
}

// Nama log Mikhmon: "tgl-|-jam-|-user-|-harga-|-ip-|-mac-|-validity-|-profil-|-komen".
function parseMikhmonLogName(name) {
    const parts = String(name || "").split("-|-");
    if (parts.length < 8) return null;
    const username = String(parts[2] || "").trim();
    if (!username) return null;
    return {
        login_at: parseMikhmonDate(parts[0], parts[1]),
        username,
        price: parseInt(String(parts[3] || "").replace(/[^0-9]/g, ""), 10) || 0,
        ip: String(parts[4] || "").trim(),
        mac: String(parts[5] || "").trim(),
        validity: String(parts[6] || "").trim(),
        profile: String(parts[7] || "").trim(),
        voucher_comment: parts.length > 8 ? parts.slice(8).join("-|-").trim() : "",
        raw: String(name || "")
    };
}

function defaultDeps() {
    return {
        sqlite3: null,
        dbPath: null
    };
}

function createVoucherTrackingRepository(overrides = {}) {
    const deps = { ...defaultDeps(), ...overrides };
    const sqlite3 = deps.sqlite3 || require("sqlite3");
    const dbPath = deps.dbPath || require("../lib/env-config").getDatabasePath("voucher.sqlite");

    let dbPromise = null;

    function run(db, sql, params = []) {
        return new Promise((resolve, reject) => {
            db.run(sql, params, function onRun(err) { if (err) reject(err); else resolve({ lastID: this.lastID, changes: this.changes }); });
        });
    }
    function get(db, sql, params = []) {
        return new Promise((resolve, reject) => { db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null))); });
    }
    function all(db, sql, params = []) {
        return new Promise((resolve, reject) => { db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(Array.isArray(rows) ? rows : []))); });
    }

    async function ensureSchema(db) {
        await run(db, `CREATE TABLE IF NOT EXISTS voucher_activations (
            id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, profile TEXT, price INTEGER,
            validity TEXT, login_at TEXT, mac TEXT, ip TEXT, voucher_comment TEXT, raw TEXT, ingested_at TEXT,
            UNIQUE(username, login_at))`);
        await run(db, `CREATE TABLE IF NOT EXISTS voucher_batches (
            id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT, profile TEXT, qty INTEGER,
            unit_price INTEGER, created_by TEXT, transaction_context TEXT, created_at TEXT)`);
        await run(db, `CREATE TABLE IF NOT EXISTS vouchers (
            id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, profile TEXT, price INTEGER,
            status TEXT, source TEXT, first_login_at TEXT, last_mac TEXT, last_ip TEXT, created_at TEXT, updated_at TEXT)`);
        await run(db, "CREATE INDEX IF NOT EXISTS idx_va_login ON voucher_activations(login_at)");
        await run(db, "CREATE INDEX IF NOT EXISTS idx_va_profile ON voucher_activations(profile)");
    }

    function getDb() {
        if (!dbPromise) {
            dbPromise = new Promise((resolve, reject) => {
                const db = new sqlite3.Database(dbPath, (err) => (err ? reject(err) : resolve(db)));
            }).then(async (db) => { await ensureSchema(db); return db; });
        }
        return dbPromise;
    }

    function nowIso() {
        // dipanggil runtime; di test bisa lewat tetapi tak kritis untuk assertion.
        const d = new Date();
        return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
    }

    return {
        deps,
        parseMikhmonLogName,

        async ingestLogNames(names = []) {
            const db = await getDb();
            let ingested = 0;
            let skipped = 0;
            const ts = nowIso();
            for (const name of names) {
                const row = parseMikhmonLogName(name);
                if (!row || !row.login_at) { skipped += 1; continue; }
                const res = await run(db,
                    `INSERT OR IGNORE INTO voucher_activations
                     (username, profile, price, validity, login_at, mac, ip, voucher_comment, raw, ingested_at)
                     VALUES (?,?,?,?,?,?,?,?,?,?)`,
                    [row.username, row.profile, row.price, row.validity, row.login_at, row.mac, row.ip, row.voucher_comment, row.raw, ts]
                );
                if (res.changes > 0) ingested += 1; else skipped += 1;
            }
            return { ingested, skipped, total: names.length };
        },

        async recordBatch({ source = "bot", profile = null, qty = 0, unit_price = 0, created_by = null, transaction_context = null } = {}) {
            const db = await getDb();
            const res = await run(db,
                `INSERT INTO voucher_batches (source, profile, qty, unit_price, created_by, transaction_context, created_at)
                 VALUES (?,?,?,?,?,?,?)`,
                [source, profile, qty, unit_price, created_by, transaction_context, nowIso()]
            );
            return { id: res.lastID };
        },

        async getReport({ from = null, to = null, profile = null } = {}) {
            const db = await getDb();
            const where = [];
            const params = [];
            if (from) { where.push("login_at >= ?"); params.push(from); }
            if (to) { where.push("login_at <= ?"); params.push(to); }
            if (profile) { where.push("profile = ?"); params.push(profile); }
            const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
            const totals = await get(db, `SELECT COUNT(*) AS aktivasi, COALESCE(SUM(price),0) AS revenue FROM voucher_activations ${clause}`, params);
            const byProfile = await all(db, `SELECT profile, COUNT(*) AS aktivasi, COALESCE(SUM(price),0) AS revenue FROM voucher_activations ${clause} GROUP BY profile ORDER BY revenue DESC`, params);
            return { aktivasi: totals ? totals.aktivasi : 0, revenue: totals ? totals.revenue : 0, byProfile };
        },

        async listActivations({ limit = 50, profile = null } = {}) {
            const db = await getDb();
            const params = [];
            let clause = "";
            if (profile) { clause = "WHERE profile = ?"; params.push(profile); }
            params.push(Math.max(1, Math.min(1000, parseInt(limit, 10) || 50)));
            return all(db, `SELECT username, profile, price, validity, login_at, mac, voucher_comment FROM voucher_activations ${clause} ORDER BY login_at DESC LIMIT ?`, params);
        },

        async close() {
            if (dbPromise) { const db = await dbPromise; await new Promise((r) => db.close(() => r())); dbPromise = null; }
        }
    };
}

module.exports = { createVoucherTrackingRepository, parseMikhmonLogName };
