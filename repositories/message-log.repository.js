/**
 * Header Doc
 * Purpose: Logger pesan MASUK WhatsApp (read-only) — menyimpan korpus bahasa pelanggan untuk
 *          evaluasi fitur AI. Tidak mengubah saldo/state/kirim pesan, dan TIDAK boleh menjatuhkan
 *          jalur pesan (fire-and-forget; semua error ditelan & dilog).
 * Caller: `message/raf.js` (hook ingest, via `logInboundMessageSafe`) dan `scripts/export-message-logs.js`.
 * Deps: `sqlite3`, `lib/env-config.getDatabasePath` (→ `database/message_logs.sqlite`, auto `_test` saat NODE_ENV=test),
 *       `lib/sqlite-pragmas` (opsional, WAL).
 * MainFuncs: `createMessageLogRepository`, `getMessageLogRepository` (singleton), `logInboundMessageSafe`,
 *            serta method repo `logInbound` / `getRecent` / `getStats`.
 * SideEffects: Membuka koneksi SQLite ke `database/message_logs.sqlite` dan menulis baris pesan masuk.
 */
"use strict";

function defaultDeps() {
    return {
        sqlite3: require("sqlite3").verbose(),
        getDatabasePath: require("../lib/env-config").getDatabasePath
    };
}

function toBit(value) {
    return value ? 1 : 0;
}

function createMessageLogRepository(overrides = {}) {
    const deps = { ...defaultDeps(), ...overrides };
    const dbPath = deps.getDatabasePath("message_logs.sqlite");
    const db = deps.db || new deps.sqlite3.Database(dbPath);

    if (!deps.db) {
        try {
            const { applySqlitePragmas } = require("../lib/sqlite-pragmas");
            applySqlitePragmas(db).catch((pragmaErr) => {
                console.warn(`[MSG_LOG_PRAGMA_WARN] ${pragmaErr.message}`);
            });
        } catch (_error) {
            // Pragma helper opsional — jangan break repo bila tidak tersedia.
        }
    }

    let schemaReady = false;

    function run(sql, params = []) {
        return new Promise((resolve, reject) => {
            db.run(sql, params, function onRun(err) {
                if (err) {
                    reject(err);
                    return;
                }
                resolve({ lastID: this.lastID, changes: this.changes });
            });
        });
    }

    function all(sql, params = []) {
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

    function get(sql, params = []) {
        return new Promise((resolve, reject) => {
            db.get(sql, params, (err, row) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(row || null);
            });
        });
    }

    async function ensureSchema() {
        if (schemaReady) return;
        await run(`
            CREATE TABLE IF NOT EXISTS inbound_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                received_at TEXT NOT NULL,
                raw_sender TEXT,
                is_lid INTEGER NOT NULL DEFAULT 0,
                canonical_jid TEXT,
                phone_number TEXT,
                pushname TEXT,
                role TEXT,
                is_customer INTEGER NOT NULL DEFAULT 0,
                message_type TEXT,
                body TEXT,
                body_length INTEGER NOT NULL DEFAULT 0,
                resolution_source TEXT
            )
        `);
        await run("CREATE INDEX IF NOT EXISTS idx_inbound_messages_received ON inbound_messages(received_at)");
        await run("CREATE INDEX IF NOT EXISTS idx_inbound_messages_role ON inbound_messages(role)");
        schemaReady = true;
    }

    /**
     * Simpan satu pesan masuk. Tidak pernah throw — kembalikan true/false.
     */
    async function logInbound(record = {}) {
        try {
            await ensureSchema();
            const body = typeof record.body === "string"
                ? record.body
                : (record.body == null ? null : String(record.body));
            await run(`
                INSERT INTO inbound_messages (
                    received_at, raw_sender, is_lid, canonical_jid, phone_number,
                    pushname, role, is_customer, message_type, body, body_length, resolution_source
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                record.received_at || new Date().toISOString(),
                record.raw_sender || null,
                toBit(record.is_lid),
                record.canonical_jid || null,
                record.phone_number || null,
                record.pushname || null,
                record.role || "unknown",
                toBit(record.is_customer),
                record.message_type || null,
                body,
                body ? body.length : 0,
                record.resolution_source || null
            ]);
            return true;
        } catch (err) {
            console.warn(`[MSG_LOG] gagal menyimpan pesan masuk: ${err.message}`);
            return false;
        }
    }

    async function getRecent({ limit = 200, offset = 0, role = null, customerOnly = false } = {}) {
        await ensureSchema();
        const safeLimit = Math.max(1, Math.min(Number(limit) || 200, 5000));
        const safeOffset = Math.max(0, Number(offset) || 0);
        const where = [];
        const params = [];
        if (role) {
            where.push("role = ?");
            params.push(role);
        }
        if (customerOnly) {
            where.push("is_customer = 1");
        }
        const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
        params.push(safeLimit, safeOffset);
        return all(
            `SELECT * FROM inbound_messages ${whereSql} ORDER BY received_at DESC LIMIT ? OFFSET ?`,
            params
        );
    }

    async function getStats() {
        await ensureSchema();
        const totals = await get(
            "SELECT COUNT(*) AS total, COUNT(DISTINCT phone_number) AS distinct_senders, MIN(received_at) AS first_at, MAX(received_at) AS last_at FROM inbound_messages"
        );
        const byRole = await all("SELECT role, COUNT(*) AS count FROM inbound_messages GROUP BY role ORDER BY count DESC");
        const byType = await all("SELECT message_type, COUNT(*) AS count FROM inbound_messages GROUP BY message_type ORDER BY count DESC");
        return {
            total: (totals && totals.total) || 0,
            distinct_senders: (totals && totals.distinct_senders) || 0,
            first_at: (totals && totals.first_at) || null,
            last_at: (totals && totals.last_at) || null,
            by_role: byRole,
            by_type: byType
        };
    }

    function close() {
        return new Promise((resolve, reject) => {
            db.close((err) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve();
            });
        });
    }

    return { deps, ensureSchema, logInbound, getRecent, getStats, close };
}

let singleton = null;

function getMessageLogRepository() {
    if (!singleton) {
        singleton = createMessageLogRepository();
    }
    return singleton;
}

function isLoggingEnabled() {
    try {
        const cfg = global.config && global.config.messageLogging;
        // Default AKTIF; hanya mati bila eksplisit { enabled: false } di config.
        return !cfg || cfg.enabled !== false;
    } catch (_error) {
        return true;
    }
}

/**
 * Fire-and-forget. TIDAK boleh throw / blokir jalur pesan — semua error ditelan di sini.
 * @param {object} record - field pesan masuk (lihat skema inbound_messages).
 */
function logInboundMessageSafe(record) {
    try {
        if (!isLoggingEnabled()) return;
        const repo = getMessageLogRepository();
        Promise.resolve()
            .then(() => repo.logInbound(record))
            .catch(() => {});
    } catch (_error) {
        // Jangan pernah throw dari hot path pemrosesan pesan.
    }
}

module.exports = {
    createMessageLogRepository,
    getMessageLogRepository,
    logInboundMessageSafe
};
