/**
 * Header Doc
 * Purpose: Ledger pengiriman broadcast (anti-ban) — `database/broadcast_ledger.sqlite`. Mencatat
 *   kapan terakhir tiap nomor dikirimi broadcast + daftar BLOKIR (nomor yang tak boleh dikirimi
 *   broadcast apa pun, mis. opt-out/pernah lapor). Dipakai `lib/cron/wa-send-queue` untuk (a) LEWATI
 *   nomor terblokir, (b) opsional LEWATI nomor yang baru dikirimi < minGap (hindari over-messaging
 *   lintas kampanye → kurangi risiko "lapor spam"). FAIL-OPEN: error ledger TIDAK boleh menahan kirim.
 * Caller: lib/cron/wa-send-queue.js (getBroadcastLedger singleton), + admin/opt-out (block/unblock).
 * Deps: `sqlite3` (lazy/inject), `./env-config` (getDatabasePath → broadcast_ledger_test.sqlite saat test).
 * MainFuncs: createBroadcastLedger -> shouldSkip, recordSent, isBlocked, block, unblock, lastSentAt, stats, close;
 *   getBroadcastLedger (singleton runtime).
 * SideEffects: Membuat/menulis broadcast_ledger.sqlite (1 tabel: broadcast_ledger).
 */
"use strict";

function defaultDeps() {
    return { sqlite3: null, dbPath: null, now: () => Date.now() };
}

function createBroadcastLedger(overrides = {}) {
    const deps = { ...defaultDeps(), ...overrides };
    const sqlite3 = deps.sqlite3 || require("sqlite3");
    const dbPath = deps.dbPath || require("./env-config").getDatabasePath("broadcast_ledger.sqlite");
    const now = typeof deps.now === "function" ? deps.now : () => Date.now();

    let dbPromise = null;

    function run(db, sql, params = []) {
        return new Promise((resolve, reject) => {
            db.run(sql, params, function onRun(err) { if (err) reject(err); else resolve({ lastID: this.lastID, changes: this.changes }); });
        });
    }
    function get(db, sql, params = []) {
        return new Promise((resolve, reject) => { db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null))); });
    }

    async function ensureSchema(db) {
        await run(db, "PRAGMA journal_mode=WAL");
        await run(db, "PRAGMA busy_timeout=8000");
        await run(db, `CREATE TABLE IF NOT EXISTS broadcast_ledger (
            jid TEXT PRIMARY KEY,
            last_sent_at INTEGER,
            send_count INTEGER NOT NULL DEFAULT 0,
            blocked INTEGER NOT NULL DEFAULT 0,
            blocked_reason TEXT,
            updated_at INTEGER)`);
    }

    function getDb() {
        if (!dbPromise) {
            dbPromise = new Promise((resolve, reject) => {
                const db = new sqlite3.Database(dbPath, (err) => (err ? reject(err) : resolve(db)));
            }).then(async (db) => { await ensureSchema(db); return db; });
        }
        return dbPromise;
    }

    return {
        deps,

        /**
         * Apakah nomor ini harus DILEWATI untuk broadcast? FAIL-OPEN (error → {skip:false}).
         * @returns {Promise<{skip:boolean, reason?:string}>}
         */
        async shouldSkip(jid, { minGapMs = 0 } = {}) {
            if (!jid) return { skip: false };
            try {
                const db = await getDb();
                const row = await get(db, "SELECT last_sent_at, blocked FROM broadcast_ledger WHERE jid=?", [String(jid)]);
                if (!row) return { skip: false };
                if (row.blocked) return { skip: true, reason: "diblokir/opt-out broadcast" };
                if (minGapMs > 0 && row.last_sent_at && (now() - row.last_sent_at) < minGapMs) {
                    return { skip: true, reason: `baru dikirimi < ${Math.round(minGapMs / 3600000)} jam lalu` };
                }
                return { skip: false };
            } catch (_e) {
                return { skip: false }; // fail-open: JANGAN menahan kirim karena error ledger
            }
        },

        /** Catat pengiriman sukses (upsert last_sent_at + increment count). Never-throw. */
        async recordSent(jid) {
            if (!jid) return;
            try {
                const db = await getDb();
                const ts = now();
                await run(db,
                    `INSERT INTO broadcast_ledger (jid, last_sent_at, send_count, updated_at)
                     VALUES (?,?,1,?)
                     ON CONFLICT(jid) DO UPDATE SET last_sent_at=excluded.last_sent_at, send_count=send_count+1, updated_at=excluded.updated_at`,
                    [String(jid), ts, ts]);
            } catch (_e) { /* fail-open */ }
        },

        async isBlocked(jid) {
            try {
                const db = await getDb();
                const row = await get(db, "SELECT blocked FROM broadcast_ledger WHERE jid=?", [String(jid)]);
                return Boolean(row && row.blocked);
            } catch (_e) { return false; }
        },

        /** Blokir nomor dari SEMUA broadcast (opt-out / pernah lapor). */
        async block(jid, reason = null) {
            if (!jid) return;
            const db = await getDb();
            const ts = now();
            await run(db,
                `INSERT INTO broadcast_ledger (jid, blocked, blocked_reason, send_count, updated_at)
                 VALUES (?,1,?,0,?)
                 ON CONFLICT(jid) DO UPDATE SET blocked=1, blocked_reason=excluded.blocked_reason, updated_at=excluded.updated_at`,
                [String(jid), reason, ts]);
        },

        async unblock(jid) {
            if (!jid) return;
            const db = await getDb();
            await run(db, "UPDATE broadcast_ledger SET blocked=0, blocked_reason=NULL, updated_at=? WHERE jid=?", [now(), String(jid)]);
        },

        async lastSentAt(jid) {
            try {
                const db = await getDb();
                const row = await get(db, "SELECT last_sent_at FROM broadcast_ledger WHERE jid=?", [String(jid)]);
                return row ? row.last_sent_at : null;
            } catch (_e) { return null; }
        },

        async stats() {
            const db = await getDb();
            const total = await get(db, "SELECT COUNT(*) n FROM broadcast_ledger", []);
            const blocked = await get(db, "SELECT COUNT(*) n FROM broadcast_ledger WHERE blocked=1", []);
            return { total: total ? total.n : 0, blocked: blocked ? blocked.n : 0 };
        },

        async close() {
            if (dbPromise) { const db = await dbPromise; await new Promise((r) => db.close(() => r())); dbPromise = null; }
        },
    };
}

let _singleton = null;
/** Ledger runtime singleton (lazy). Null bila gagal init — pemanggil harus fail-open. */
function getBroadcastLedger() {
    if (!_singleton) {
        try { _singleton = createBroadcastLedger(); } catch (_e) { _singleton = null; }
    }
    return _singleton;
}

module.exports = { createBroadcastLedger, getBroadcastLedger };
