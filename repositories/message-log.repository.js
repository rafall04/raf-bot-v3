/**
 * Header Doc
 * Purpose: Owner file `database/message_logs.sqlite` — dua isi, satu domain (lalu lintas chat WA):
 *          (1) korpus pesan MASUK pelanggan (`inbound_messages`) untuk evaluasi fitur AI, dan
 *          (2) JEJAK AKTIVITAS CHAT DURABEL (`chat_activity`) — kapan admin terakhir balas manual &
 *          kapan pelanggan terakhir mengeluh, per chat. Yang kedua adalah tulang punggung gerbang
 *          pengaman intake bukti pembayaran: sebelum ada tabel ini jejaknya cuma Map in-memory, dan
 *          prod restart 7–13×/hari membuat gerbang itu amnesia (insiden 14-07: foto koordinasi CCTV
 *          jadi "bukti bayar" 19 detik sesudah restart).
 *          Tidak mengubah saldo/state/kirim pesan, dan TIDAK boleh menjatuhkan jalur pesan
 *          (fire-and-forget; semua error ditelan & dilog).
 * Caller: `message/raf.js` (hook ingest, via `logInboundMessageSafe`), `index.js` (memasang adapter
 *         `createChatActivityPersistence()` ke `lib/chat-activity-tracker` saat boot), dan
 *         `scripts/export-message-logs.js`.
 * Deps: `sqlite3`, `lib/env-config.getDatabasePath` (→ `database/message_logs.sqlite`, auto `_test` saat NODE_ENV=test),
 *       `lib/sqlite-pragmas` (opsional, WAL).
 * MainFuncs: `createMessageLogRepository`, `getMessageLogRepository` (singleton), `logInboundMessageSafe`,
 *            `createChatActivityPersistence`, serta method repo `logInbound` / `getRecent` / `getStats` /
 *            `saveAdminOutbound` / `saveComplaint` / `loadRecentChatActivity`.
 * SideEffects: Membuka koneksi SQLite ke `database/message_logs.sqlite`, menulis baris pesan masuk,
 *              dan meng-upsert jejak aktivitas chat.
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

        // Jejak aktivitas chat DURABEL (satu baris per chat, di-upsert). Stempel disimpan sebagai
        // epoch ms INTEGER supaya bisa dibandingkan langsung dengan Date.now() tanpa parsing.
        await run(`
            CREATE TABLE IF NOT EXISTS chat_activity (
                chat_jid TEXT PRIMARY KEY,
                last_admin_outbound_at INTEGER,
                last_complaint_at INTEGER
            )
        `);
        await run("CREATE INDEX IF NOT EXISTS idx_chat_activity_admin ON chat_activity(last_admin_outbound_at)");

        // Batasi pertumbuhan: jejak lebih tua dari 7 hari tak berguna (jendela gerbang paling lama
        // hitungan menit). Sekali per proses saja — bukan cron.
        const staleCutoff = Date.now() - (7 * 24 * 60 * 60 * 1000);
        await run(
            `DELETE FROM chat_activity
              WHERE COALESCE(last_admin_outbound_at, 0) < ?
                AND COALESCE(last_complaint_at, 0) < ?`,
            [staleCutoff, staleCutoff]
        );

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

    // ── Jejak aktivitas chat (durabel) ──
    // ON CONFLICT DO UPDATE, BUKAN INSERT OR REPLACE: replace akan menulis NULL ke kolom yang tidak
    // ikut disebut, jadi mencatat balasan admin akan MENGHAPUS jejak komplain di baris yang sama.

    async function saveAdminOutbound(chatJid, timestampMs) {
        if (!chatJid) return false;
        try {
            await ensureSchema();
            await run(
                `INSERT INTO chat_activity (chat_jid, last_admin_outbound_at)
                 VALUES (?, ?)
                 ON CONFLICT(chat_jid) DO UPDATE SET last_admin_outbound_at = excluded.last_admin_outbound_at`,
                [String(chatJid), Number(timestampMs) || Date.now()]
            );
            return true;
        } catch (err) {
            console.warn(`[CHAT_ACTIVITY] gagal menyimpan jejak admin: ${err.message}`);
            return false;
        }
    }

    async function saveComplaint(chatJid, timestampMs) {
        if (!chatJid) return false;
        try {
            await ensureSchema();
            await run(
                `INSERT INTO chat_activity (chat_jid, last_complaint_at)
                 VALUES (?, ?)
                 ON CONFLICT(chat_jid) DO UPDATE SET last_complaint_at = excluded.last_complaint_at`,
                [String(chatJid), Number(timestampMs) || Date.now()]
            );
            return true;
        } catch (err) {
            console.warn(`[CHAT_ACTIVITY] gagal menyimpan jejak komplain: ${err.message}`);
            return false;
        }
    }

    async function loadRecentChatActivity(maxAgeMs = 60 * 60 * 1000) {
        await ensureSchema();
        const cutoff = Date.now() - (Number(maxAgeMs) || 0);
        return all(
            `SELECT chat_jid, last_admin_outbound_at, last_complaint_at
               FROM chat_activity
              WHERE COALESCE(last_admin_outbound_at, 0) >= ?
                 OR COALESCE(last_complaint_at, 0) >= ?`,
            [cutoff, cutoff]
        );
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

    return {
        deps,
        ensureSchema,
        logInbound,
        getRecent,
        getStats,
        saveAdminOutbound,
        saveComplaint,
        loadRecentChatActivity,
        close
    };
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

/**
 * Adapter persistensi untuk `lib/chat-activity-tracker` (dipasang di index.js saat boot).
 *
 * SENGAJA TIDAK digerbangi `config.messageLogging.enabled`: itu flag KORPUS (fitur AI). Jejak
 * aktivitas chat adalah SINYAL PENGAMAN — mematikannya lewat flag yang tak ada hubungannya akan
 * diam-diam menghidupkan lagi bug "foto keluhan jadi bukti bayar". (CLAUDE.md: gate on evidence,
 * not on a config flag.)
 *
 * Tulis bersifat fire-and-forget: tracker in-memory adalah sumber baca di runtime; disk hanya untuk
 * bertahan lintas restart. Kegagalan tulis TIDAK boleh menjatuhkan jalur pesan.
 */
function createChatActivityPersistence() {
    return {
        saveAdminOutbound(chatJid, timestampMs) {
            try {
                Promise.resolve()
                    .then(() => getMessageLogRepository().saveAdminOutbound(chatJid, timestampMs))
                    .catch(() => {});
            } catch (_error) {
                // Jangan pernah throw dari hot path pemrosesan pesan.
            }
        },
        saveComplaint(chatJid, timestampMs) {
            try {
                Promise.resolve()
                    .then(() => getMessageLogRepository().saveComplaint(chatJid, timestampMs))
                    .catch(() => {});
            } catch (_error) {
                // idem
            }
        },
        loadRecent(maxAgeMs) {
            return getMessageLogRepository().loadRecentChatActivity(maxAgeMs);
        }
    };
}

module.exports = {
    createMessageLogRepository,
    getMessageLogRepository,
    logInboundMessageSafe,
    createChatActivityPersistence
};
