/**
 * Header Doc
 * Purpose: Owner persistence SQLite untuk riwayat broadcast admin (GAMAS dan broadcast manual lainnya).
 * Caller: `services/admin-broadcast.service.js` dan route history broadcast.
 * Deps: `sqlite3`, `lib/env-config.getDatabasePath`, `lib/sqlite-pragmas` (opsional).
 * MainFuncs: `createBroadcastRepository`, `ensureSchema`, `insertHistory`, `listHistory`.
 * SideEffects: Membuka koneksi SQLite ke `database/broadcast.sqlite` dan menyiapkan tabel saat dipanggil.
 */
"use strict";

function defaultDeps() {
    return {
        sqlite3: require("sqlite3").verbose(),
        getDatabasePath: require("../lib/env-config").getDatabasePath
    };
}

function createId() {
    return `bcast_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function stringifyJson(value, fallback) {
    try {
        return JSON.stringify(value === undefined ? fallback : value);
    } catch (_error) {
        return JSON.stringify(fallback);
    }
}

function parseJson(value, fallback) {
    if (value === null || value === undefined || value === "") return fallback;
    try {
        return JSON.parse(value);
    } catch (_error) {
        return fallback;
    }
}

function normalizeRow(row) {
    if (!row) return null;
    return {
        ...row,
        force_include_opt_out: row.force_include_opt_out === 1,
        failed_user_ids: parseJson(row.failed_user_ids_json, [])
    };
}

function createBroadcastRepository(overrides = {}) {
    const deps = { ...defaultDeps(), ...overrides };
    const dbPath = deps.getDatabasePath("broadcast.sqlite");
    const db = deps.db || new deps.sqlite3.Database(dbPath);

    if (!deps.db) {
        try {
            const { applySqlitePragmas } = require("../lib/sqlite-pragmas");
            applySqlitePragmas(db).catch((pragmaErr) => {
                console.warn(`[BROADCAST_REPO_PRAGMA_WARN] ${pragmaErr.message}`);
            });
        } catch (_error) {
            // Pragma helper opsional — jangan break repo bila helper tidak tersedia.
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

    async function ensureSchema() {
        if (schemaReady) return;
        await run(`
            CREATE TABLE IF NOT EXISTS broadcast_history (
                id TEXT PRIMARY KEY,
                started_at TEXT NOT NULL,
                finished_at TEXT,
                mode TEXT NOT NULL,
                filter TEXT,
                template_key TEXT,
                message_preview TEXT,
                total_targets INTEGER NOT NULL DEFAULT 0,
                total_sent INTEGER NOT NULL DEFAULT 0,
                total_failed INTEGER NOT NULL DEFAULT 0,
                force_include_opt_out INTEGER NOT NULL DEFAULT 0,
                operator TEXT,
                failed_user_ids_json TEXT NOT NULL DEFAULT '[]'
            )
        `);
        await run("CREATE INDEX IF NOT EXISTS idx_broadcast_history_started ON broadcast_history(started_at)");
        await run("CREATE INDEX IF NOT EXISTS idx_broadcast_history_mode ON broadcast_history(mode)");
        schemaReady = true;
    }

    async function insertHistory(entry = {}) {
        await ensureSchema();
        const id = entry.id || createId();
        await run(`
            INSERT INTO broadcast_history (
                id, started_at, finished_at, mode, filter, template_key,
                message_preview, total_targets, total_sent, total_failed,
                force_include_opt_out, operator, failed_user_ids_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            id,
            entry.started_at || new Date().toISOString(),
            entry.finished_at || null,
            entry.mode || "manual",
            entry.filter || null,
            entry.template_key || null,
            entry.message_preview || null,
            Number(entry.total_targets) || 0,
            Number(entry.total_sent) || 0,
            Number(entry.total_failed) || 0,
            entry.force_include_opt_out ? 1 : 0,
            entry.operator || null,
            stringifyJson(entry.failed_user_ids_json, [])
        ]);
        return id;
    }

    async function listHistory({ limit = 50, offset = 0 } = {}) {
        await ensureSchema();
        const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 500));
        const safeOffset = Math.max(0, Number(offset) || 0);
        const rows = await all(
            "SELECT * FROM broadcast_history ORDER BY started_at DESC LIMIT ? OFFSET ?",
            [safeLimit, safeOffset]
        );
        return { items: rows.map(normalizeRow) };
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
        insertHistory,
        listHistory,
        close
    };
}

module.exports = { createBroadcastRepository };
