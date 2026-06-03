const fs = require('fs');
const path = require('path');
const { withSqliteDatabase } = require('../database');

const DATABASE_DIR = path.join(__dirname, '..', '..', 'database');
const DEFAULT_DB_NAME = 'isolir_audit.sqlite';
const LEGACY_HISTORY_PATH = path.join(DATABASE_DIR, 'isolir_history.json');

let initPromise = null;

function getDbPath() {
    return process.env.ISOLIR_AUDIT_DB_PATH || path.join(DATABASE_DIR, DEFAULT_DB_NAME);
}

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function onRun(error) {
            if (error) {
                reject(error);
                return;
            }
            resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

function get(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (error, row) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(row || null);
        });
    });
}

function all(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (error, rows) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(Array.isArray(rows) ? rows : []);
        });
    });
}

function normalizeBoolean(value) {
    return value === true ? 1 : 0;
}

function mapActionRow(row) {
    if (!row) return null;
    return {
        id: row.id,
        actionType: row.action_type,
        createdAt: row.created_at,
        actor: {
            id: row.actor_id,
            username: row.actor_username,
            role: row.actor_role,
        },
        reason: row.reason,
        targetProfile: row.target_profile,
        disconnectRequested: row.disconnect_requested === 1,
        rebootRequested: row.reboot_requested === 1,
        summary: {
            totalSelected: row.total_selected || 0,
            successCount: row.success_count || 0,
            failedCount: row.failed_count || 0,
            disconnectAppliedCount: row.disconnect_applied_count || 0,
            disconnectSkippedCount: row.disconnect_skipped_count || 0,
            rebootAppliedCount: row.reboot_applied_count || 0,
            rebootSkippedCount: row.reboot_skipped_count || 0,
        },
    };
}

function mapResultRow(row) {
    return {
        userId: row.user_id,
        name: row.name,
        pppoe_username: row.pppoe_username,
        targetProfile: row.target_profile,
        ok: row.ok === 1,
        message: row.message,
        errorCode: row.error_code,
        disconnectRequested: row.disconnect_requested === 1,
        disconnectApplied: row.disconnect_applied === 1,
        disconnectNote: row.disconnect_note,
        rebootRequested: row.reboot_requested === 1,
        rebootApplied: row.reboot_applied === 1,
        rebootSkippedReason: row.reboot_skipped_reason,
        timingMs: row.timing_ms || 0,
    };
}

function ensureDatabaseDirectory() {
    const targetDir = path.dirname(getDbPath());
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }
}

function loadLegacyHistoryEntries() {
    if (!fs.existsSync(LEGACY_HISTORY_PATH)) {
        return [];
    }

    try {
        const raw = fs.readFileSync(LEGACY_HISTORY_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        console.warn('[IsolirAuditRepository] Failed to read legacy history JSON:', error.message);
        return [];
    }
}

async function insertAction(db, entry) {
    const summary = entry.summary || {};
    await run(
        db,
        `INSERT OR IGNORE INTO isolir_actions (
            id,
            action_type,
            created_at,
            actor_id,
            actor_username,
            actor_role,
            reason,
            target_profile,
            disconnect_requested,
            reboot_requested,
            total_selected,
            success_count,
            failed_count,
            disconnect_applied_count,
            disconnect_skipped_count,
            reboot_applied_count,
            reboot_skipped_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            entry.id,
            entry.actionType,
            entry.createdAt,
            entry.actor?.id || null,
            entry.actor?.username || 'system',
            entry.actor?.role || 'system',
            entry.reason || '',
            entry.targetProfile || null,
            normalizeBoolean(entry.disconnectRequested),
            normalizeBoolean(entry.rebootRequested),
            summary.totalSelected || 0,
            summary.successCount || 0,
            summary.failedCount || 0,
            summary.disconnectAppliedCount || 0,
            summary.disconnectSkippedCount || 0,
            summary.rebootAppliedCount || 0,
            summary.rebootSkippedCount || 0,
        ]
    );

    await run(db, 'DELETE FROM isolir_action_results WHERE action_id = ?', [entry.id]);
    for (const result of entry.results || []) {
        await run(
            db,
            `INSERT INTO isolir_action_results (
                action_id,
                user_id,
                name,
                pppoe_username,
                target_profile,
                ok,
                message,
                error_code,
                disconnect_requested,
                disconnect_applied,
                disconnect_note,
                reboot_requested,
                reboot_applied,
                reboot_skipped_reason,
                timing_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                entry.id,
                result.userId || null,
                result.name || null,
                result.pppoe_username || null,
                result.targetProfile || null,
                normalizeBoolean(result.ok),
                result.message || '',
                result.errorCode || null,
                normalizeBoolean(result.disconnectRequested),
                normalizeBoolean(result.disconnectApplied),
                result.disconnectNote || null,
                normalizeBoolean(result.rebootRequested),
                normalizeBoolean(result.rebootApplied),
                result.rebootSkippedReason || null,
                result.timingMs || 0,
            ]
        );
    }
}

async function importLegacyHistoryIfNeeded(db) {
    const existing = await get(db, 'SELECT COUNT(1) AS total FROM isolir_actions');
    if ((existing?.total || 0) > 0) {
        return;
    }

    const legacyEntries = loadLegacyHistoryEntries();
    if (!legacyEntries.length) {
        return;
    }

    await run(db, 'BEGIN TRANSACTION');
    try {
        for (const entry of legacyEntries) {
            await insertAction(db, {
                id: entry.id,
                actionType: entry.actionType,
                createdAt: entry.createdAt,
                actor: entry.actor || null,
                reason: entry.reason || '',
                targetProfile: entry.targetProfile || null,
                disconnectRequested: entry.disconnect === true,
                rebootRequested: entry.reboot === true,
                summary: entry.summary || buildSummaryFromResults(entry.results || []),
                results: entry.results || [],
            });
        }
        await run(db, 'COMMIT');
    } catch (error) {
        await run(db, 'ROLLBACK').catch(() => undefined);
        throw error;
    }
}

function buildSummaryFromResults(results) {
    return (Array.isArray(results) ? results : []).reduce((summary, item) => {
        summary.totalSelected += 1;
        if (item.ok) summary.successCount += 1;
        if (!item.ok) summary.failedCount += 1;
        if (item.disconnectApplied) summary.disconnectAppliedCount += 1;
        if (item.disconnectRequested && !item.disconnectApplied) summary.disconnectSkippedCount += 1;
        if (item.rebootApplied) summary.rebootAppliedCount += 1;
        if (item.rebootRequested && !item.rebootApplied) summary.rebootSkippedCount += 1;
        return summary;
    }, {
        totalSelected: 0,
        successCount: 0,
        failedCount: 0,
        disconnectAppliedCount: 0,
        disconnectSkippedCount: 0,
        rebootAppliedCount: 0,
        rebootSkippedCount: 0,
    });
}

async function ensureInitialized() {
    if (!initPromise) {
        initPromise = (async () => {
            ensureDatabaseDirectory();
            await withSqliteDatabase(getDbPath(), async (db) => {
                await run(
                    db,
                    `CREATE TABLE IF NOT EXISTS isolir_actions (
                        id TEXT PRIMARY KEY,
                        action_type TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        actor_id TEXT,
                        actor_username TEXT,
                        actor_role TEXT,
                        reason TEXT,
                        target_profile TEXT,
                        disconnect_requested INTEGER NOT NULL DEFAULT 0,
                        reboot_requested INTEGER NOT NULL DEFAULT 0,
                        total_selected INTEGER NOT NULL DEFAULT 0,
                        success_count INTEGER NOT NULL DEFAULT 0,
                        failed_count INTEGER NOT NULL DEFAULT 0,
                        disconnect_applied_count INTEGER NOT NULL DEFAULT 0,
                        disconnect_skipped_count INTEGER NOT NULL DEFAULT 0,
                        reboot_applied_count INTEGER NOT NULL DEFAULT 0,
                        reboot_skipped_count INTEGER NOT NULL DEFAULT 0
                    )`
                );
                await run(
                    db,
                    `CREATE TABLE IF NOT EXISTS isolir_action_results (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        action_id TEXT NOT NULL,
                        user_id INTEGER,
                        name TEXT,
                        pppoe_username TEXT,
                        target_profile TEXT,
                        ok INTEGER NOT NULL DEFAULT 0,
                        message TEXT,
                        error_code TEXT,
                        disconnect_requested INTEGER NOT NULL DEFAULT 0,
                        disconnect_applied INTEGER NOT NULL DEFAULT 0,
                        disconnect_note TEXT,
                        reboot_requested INTEGER NOT NULL DEFAULT 0,
                        reboot_applied INTEGER NOT NULL DEFAULT 0,
                        reboot_skipped_reason TEXT,
                        timing_ms INTEGER NOT NULL DEFAULT 0,
                        FOREIGN KEY(action_id) REFERENCES isolir_actions(id) ON DELETE CASCADE
                    )`
                );
                await run(db, 'CREATE INDEX IF NOT EXISTS idx_isolir_actions_created_at ON isolir_actions(created_at DESC)');
                await run(db, 'CREATE INDEX IF NOT EXISTS idx_isolir_actions_action_type ON isolir_actions(action_type)');
                await run(db, 'CREATE INDEX IF NOT EXISTS idx_isolir_action_results_action_id ON isolir_action_results(action_id)');
                await importLegacyHistoryIfNeeded(db);
            });
        })();
    }
    return initPromise;
}

class IsolirAuditRepository {
    static async saveAction(entry) {
        await ensureInitialized();
        await withSqliteDatabase(getDbPath(), async (db) => {
            await run(db, 'BEGIN TRANSACTION');
            try {
                await insertAction(db, entry);
                await run(db, 'COMMIT');
            } catch (error) {
                await run(db, 'ROLLBACK').catch(() => undefined);
                throw error;
            }
        });
        return { id: entry.id };
    }

    static async getHistory(options = {}) {
        await ensureInitialized();
        const page = Math.max(1, parseInt(options.page || 1, 10) || 1);
        const limit = Math.max(1, Math.min(parseInt(options.limit || 15, 10) || 15, 100));
        const offset = (page - 1) * limit;
        const includeResults = options.includeResults === true;
        const where = [];
        const params = [];

        if (options.actionType) {
            where.push('action_type = ?');
            params.push(options.actionType);
        }

        const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
        return withSqliteDatabase(getDbPath(), async (db) => {
            const totalRow = await get(db, `SELECT COUNT(1) AS total FROM isolir_actions ${whereClause}`, params);
            const actionRows = await all(
                db,
                `SELECT * FROM isolir_actions ${whereClause} ORDER BY datetime(created_at) DESC, id DESC LIMIT ? OFFSET ?`,
                [...params, limit, offset]
            );
            const items = [];
            for (const row of actionRows) {
                const item = mapActionRow(row);
                if (includeResults) {
                    const resultRows = await all(
                        db,
                        'SELECT * FROM isolir_action_results WHERE action_id = ? ORDER BY id ASC',
                        [row.id]
                    );
                    item.results = resultRows.map(mapResultRow);
                }
                items.push(item);
            }
            return {
                items,
                pagination: {
                    page,
                    limit,
                    totalItems: totalRow?.total || 0,
                    totalPages: Math.max(1, Math.ceil((totalRow?.total || 0) / limit)),
                },
            };
        });
    }

    static async getHistoryById(actionId) {
        await ensureInitialized();
        return withSqliteDatabase(getDbPath(), async (db) => {
            const actionRow = await get(db, 'SELECT * FROM isolir_actions WHERE id = ?', [actionId]);
            if (!actionRow) {
                return null;
            }
            const resultRows = await all(db, 'SELECT * FROM isolir_action_results WHERE action_id = ? ORDER BY id ASC', [actionId]);
            return {
                ...mapActionRow(actionRow),
                results: resultRows.map(mapResultRow),
            };
        });
    }
}

module.exports = IsolirAuditRepository;
