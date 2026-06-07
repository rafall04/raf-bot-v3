/**
 * Header Doc
 * Purpose: Owner persistence SQLite untuk auto outage rules, states, conversations, dan scan logs.
 * Caller: `services/auto-outage-*.service.js` dan `routes/admin-auto-outage-routes.js`.
 * Deps: `sqlite3`, `lib/env-config.getDatabasePath`, runtime DB fallback.
 * MainFuncs: `createAutoOutageRepository`, `ensureSchema`, rule/state/conversation/scan-log CRUD.
 * SideEffects: Membuka koneksi SQLite dan menyiapkan table auto outage saat dipanggil.
 */
"use strict";

function defaultDeps() {
    return {
        sqlite3: require("sqlite3").verbose(),
        getDatabasePath: require("../lib/env-config").getDatabasePath,
        runtime: global.__appRuntime || null
    };
}

function createId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function stringifyJson(value, fallback) {
    return JSON.stringify(value === undefined ? fallback : value);
}

function parseJson(value, fallback) {
    if (value === null || value === undefined || value === "") return fallback;
    if (typeof value !== "string") return value;
    try {
        return JSON.parse(value);
    } catch (__error) {
        return fallback;
    }
}

function toBoolean(value) {
    return value === true || value === 1 || value === "1";
}

function normalizeRuleRow(row) {
    if (!row) return null;
    return {
        ...row,
        enabled: toBoolean(row.enabled),
        target_filter_json: parseJson(row.target_filter_json, {}),
        options_json: parseJson(row.options_json, []),
        require_media_for_categories_json: parseJson(row.require_media_for_categories_json, []),
        auto_ticket_enabled: toBoolean(row.auto_ticket_enabled)
    };
}

function normalizeConversationRow(row) {
    if (!row) return null;
    return {
        ...row,
        ticket_requested: toBoolean(row.ticket_requested),
        media_json: parseJson(row.media_json, [])
    };
}

function normalizeScanLogRow(row) {
    if (!row) return null;
    return {
        ...row,
        summary_json: parseJson(row.summary_json, {})
    };
}

function createAutoOutageRepository(overrides = {}) {
    const deps = { ...defaultDeps(), ...overrides };
    const dbPath = deps.getDatabasePath("users.sqlite");
    const db = deps.db || new deps.sqlite3.Database(dbPath);
    // Apply WAL + busy_timeout (idempotent, journal_mode persisten di file header).
    if (!deps.db) {
        try {
            const { applySqlitePragmas } = require("../lib/sqlite-pragmas");
            applySqlitePragmas(db).catch((pragmaErr) => {
                console.warn(`[AUTO_OUTAGE_REPO_PRAGMA_WARN] ${pragmaErr.message}`);
            });
        } catch (__e) {
            // Ignore — pragma helper opsional, jangan break repository instantiation.
        }
    }

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
        await run(`
            CREATE TABLE IF NOT EXISTS auto_outage_rules (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 0,
                router_id TEXT,
                target_scope TEXT NOT NULL DEFAULT 'all',
                target_filter_json TEXT NOT NULL DEFAULT '{}',
                offline_threshold_minutes INTEGER NOT NULL DEFAULT 180,
                scan_interval_minutes INTEGER NOT NULL DEFAULT 30,
                broadcast_cooldown_minutes INTEGER NOT NULL DEFAULT 720,
                max_broadcast_per_incident INTEGER NOT NULL DEFAULT 1,
                template_initial TEXT,
                template_followup TEXT,
                template_ticket_confirmation TEXT,
                options_json TEXT NOT NULL DEFAULT '[]',
                require_media_for_categories_json TEXT NOT NULL DEFAULT '[]',
                auto_ticket_enabled INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        `);

        await run(`
            CREATE TABLE IF NOT EXISTS auto_outage_states (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL UNIQUE,
                pppoe_username TEXT NOT NULL,
                router_id TEXT,
                status TEXT NOT NULL,
                offline_since TEXT,
                last_logged_out TEXT,
                last_checked_at TEXT,
                recovered_at TEXT,
                broadcast_count INTEGER NOT NULL DEFAULT 0,
                last_broadcast_at TEXT,
                conversation_id TEXT,
                last_detection_reason TEXT,
                skip_reason TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        `);

        await run(`
            CREATE TABLE IF NOT EXISTS auto_outage_conversations (
                id TEXT PRIMARY KEY,
                state_id TEXT,
                user_id TEXT NOT NULL,
                pppoe_username TEXT,
                status TEXT NOT NULL,
                initial_answer_raw TEXT,
                triage_category TEXT,
                description TEXT,
                media_json TEXT NOT NULL DEFAULT '[]',
                ticket_requested INTEGER NOT NULL DEFAULT 0,
                ticket_id TEXT,
                closed_reason TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        `);

        await run(`
            CREATE TABLE IF NOT EXISTS auto_outage_scan_logs (
                id TEXT PRIMARY KEY,
                rule_id TEXT,
                router_id TEXT,
                started_at TEXT NOT NULL,
                finished_at TEXT,
                total_db_users INTEGER NOT NULL DEFAULT 0,
                total_with_pppoe INTEGER NOT NULL DEFAULT 0,
                total_active_ppp INTEGER NOT NULL DEFAULT 0,
                total_online INTEGER NOT NULL DEFAULT 0,
                total_offline_candidates INTEGER NOT NULL DEFAULT 0,
                total_eligible INTEGER NOT NULL DEFAULT 0,
                total_skipped INTEGER NOT NULL DEFAULT 0,
                error_message TEXT,
                summary_json TEXT NOT NULL DEFAULT '{}'
            )
        `);

        await run("CREATE INDEX IF NOT EXISTS idx_auto_outage_states_pppoe ON auto_outage_states(pppoe_username)");
        await run("CREATE INDEX IF NOT EXISTS idx_auto_outage_states_user ON auto_outage_states(user_id)");
        await run("CREATE INDEX IF NOT EXISTS idx_auto_outage_states_router ON auto_outage_states(router_id)");
        await run("CREATE INDEX IF NOT EXISTS idx_auto_outage_states_status ON auto_outage_states(status)");
        await run("CREATE INDEX IF NOT EXISTS idx_auto_outage_states_offline_since ON auto_outage_states(offline_since)");
        await run("CREATE INDEX IF NOT EXISTS idx_auto_outage_scan_logs_started ON auto_outage_scan_logs(started_at)");
    }

    async function upsertRule(input = {}) {
        const now = new Date().toISOString();
        const id = input.id || createId("aorule");
        await run(`
            INSERT INTO auto_outage_rules (
                id, name, enabled, router_id, target_scope, target_filter_json,
                offline_threshold_minutes, scan_interval_minutes, broadcast_cooldown_minutes,
                max_broadcast_per_incident, template_initial, template_followup,
                template_ticket_confirmation, options_json, require_media_for_categories_json,
                auto_ticket_enabled, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                enabled = excluded.enabled,
                router_id = excluded.router_id,
                target_scope = excluded.target_scope,
                target_filter_json = excluded.target_filter_json,
                offline_threshold_minutes = excluded.offline_threshold_minutes,
                scan_interval_minutes = excluded.scan_interval_minutes,
                broadcast_cooldown_minutes = excluded.broadcast_cooldown_minutes,
                max_broadcast_per_incident = excluded.max_broadcast_per_incident,
                template_initial = excluded.template_initial,
                template_followup = excluded.template_followup,
                template_ticket_confirmation = excluded.template_ticket_confirmation,
                options_json = excluded.options_json,
                require_media_for_categories_json = excluded.require_media_for_categories_json,
                auto_ticket_enabled = excluded.auto_ticket_enabled,
                updated_at = excluded.updated_at
        `, [
            id,
            input.name || "Auto Outage Rule",
            input.enabled ? 1 : 0,
            input.router_id || null,
            input.target_scope || "all",
            stringifyJson(input.target_filter_json, {}),
            input.offline_threshold_minutes || 180,
            input.scan_interval_minutes || 30,
            input.broadcast_cooldown_minutes || 720,
            input.max_broadcast_per_incident || 1,
            input.template_initial || "",
            input.template_followup || "",
            input.template_ticket_confirmation || "",
            stringifyJson(input.options_json, []),
            stringifyJson(input.require_media_for_categories_json, []),
            input.auto_ticket_enabled === false ? 0 : 1,
            input.created_at || now,
            now
        ]);

        return getRuleById(id);
    }

    async function listRules() {
        const rows = await all("SELECT * FROM auto_outage_rules ORDER BY created_at DESC");
        return rows.map(normalizeRuleRow);
    }

    async function getRuleById(id) {
        return normalizeRuleRow(await get("SELECT * FROM auto_outage_rules WHERE id = ?", [id]));
    }

    async function getEnabledRules() {
        const rows = await all("SELECT * FROM auto_outage_rules WHERE enabled = 1 ORDER BY created_at DESC");
        return rows.map(normalizeRuleRow);
    }

    async function upsertStates(states = []) {
        if (!Array.isArray(states) || states.length === 0) return [];
        const now = new Date().toISOString();
        const saved = [];

        await run("BEGIN TRANSACTION");
        try {
            for (const state of states) {
                const existing = state.id
                    ? await get("SELECT * FROM auto_outage_states WHERE id = ?", [state.id])
                    : await get("SELECT * FROM auto_outage_states WHERE user_id = ?", [state.user_id]);
                const id = existing?.id || state.id || createId("aostate");
                await run(`
                    INSERT INTO auto_outage_states (
                        id, user_id, pppoe_username, router_id, status, offline_since,
                        last_logged_out, last_checked_at, recovered_at, broadcast_count,
                        last_broadcast_at, conversation_id, last_detection_reason, skip_reason,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(user_id) DO UPDATE SET
                        pppoe_username = excluded.pppoe_username,
                        router_id = excluded.router_id,
                        status = excluded.status,
                        offline_since = excluded.offline_since,
                        last_logged_out = excluded.last_logged_out,
                        last_checked_at = excluded.last_checked_at,
                        recovered_at = excluded.recovered_at,
                        broadcast_count = CASE
                            WHEN excluded.status = 'offline' AND auto_outage_states.status IN ('offline', 'pending_confirmation') THEN auto_outage_states.broadcast_count
                            ELSE excluded.broadcast_count
                        END,
                        last_broadcast_at = CASE
                            WHEN excluded.status = 'offline' AND auto_outage_states.status IN ('offline', 'pending_confirmation') THEN auto_outage_states.last_broadcast_at
                            ELSE excluded.last_broadcast_at
                        END,
                        conversation_id = CASE
                            WHEN excluded.status = 'offline' AND auto_outage_states.status IN ('offline', 'pending_confirmation') THEN auto_outage_states.conversation_id
                            ELSE excluded.conversation_id
                        END,
                        last_detection_reason = excluded.last_detection_reason,
                        skip_reason = excluded.skip_reason,
                        updated_at = excluded.updated_at
                `, [
                    id,
                    state.user_id,
                    state.pppoe_username,
                    state.router_id || null,
                    state.status,
                    state.offline_since || null,
                    state.last_logged_out || null,
                    state.last_checked_at || null,
                    state.recovered_at || null,
                    Number.isFinite(Number(state.broadcast_count)) ? Number(state.broadcast_count) : 0,
                    state.last_broadcast_at || null,
                    state.conversation_id || null,
                    state.last_detection_reason || null,
                    state.skip_reason || null,
                    existing?.created_at || state.created_at || now,
                    now
                ]);
                saved.push(await getStateByUserId(state.user_id));
            }
            await run("COMMIT");
        } catch (error) {
            await run("ROLLBACK").catch(() => {});
            throw error;
        }

        return saved;
    }

    async function listStates({ status, limit = 100, offset = 0 } = {}) {
        const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
        const safeOffset = Math.max(0, Number(offset) || 0);
        const params = [];
        let sql = "SELECT * FROM auto_outage_states";
        if (status) {
            sql += " WHERE status = ?";
            params.push(status);
        }
        sql += " ORDER BY updated_at DESC LIMIT ? OFFSET ?";
        params.push(safeLimit, safeOffset);
        return { items: await all(sql, params) };
    }

    async function getStateByUserId(userId) {
        return get("SELECT * FROM auto_outage_states WHERE user_id = ?", [userId]);
    }

    async function createConversation(input = {}) {
        const now = new Date().toISOString();
        const id = input.id || createId("aoconv");
        await run(`
            INSERT INTO auto_outage_conversations (
                id, state_id, user_id, pppoe_username, status, initial_answer_raw,
                triage_category, description, media_json, ticket_requested, ticket_id,
                closed_reason, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            id,
            input.state_id || null,
            input.user_id,
            input.pppoe_username || null,
            input.status || "waiting_initial",
            input.initial_answer_raw || null,
            input.triage_category || null,
            input.description || null,
            stringifyJson(input.media_json, []),
            input.ticket_requested ? 1 : 0,
            input.ticket_id || null,
            input.closed_reason || null,
            input.created_at || now,
            now
        ]);
        return normalizeConversationRow(await get("SELECT * FROM auto_outage_conversations WHERE id = ?", [id]));
    }

    async function updateConversation(id, patch = {}) {
        const allowed = [
            "status",
            "initial_answer_raw",
            "triage_category",
            "description",
            "media_json",
            "ticket_requested",
            "ticket_id",
            "closed_reason"
        ];
        const sets = [];
        const params = [];
        for (const key of allowed) {
            if (Object.prototype.hasOwnProperty.call(patch, key)) {
                sets.push(`${key} = ?`);
                if (key === "media_json") params.push(stringifyJson(patch[key], []));
                else if (key === "ticket_requested") params.push(patch[key] ? 1 : 0);
                else params.push(patch[key]);
            }
        }
        sets.push("updated_at = ?");
        params.push(new Date().toISOString(), id);

        await run(`UPDATE auto_outage_conversations SET ${sets.join(", ")} WHERE id = ?`, params);
        return normalizeConversationRow(await get("SELECT * FROM auto_outage_conversations WHERE id = ?", [id]));
    }

    async function getOpenConversationByUserId(userId) {
        return normalizeConversationRow(await get(`
            SELECT * FROM auto_outage_conversations
            WHERE user_id = ? AND status != 'closed'
            ORDER BY created_at DESC
            LIMIT 1
        `, [userId]));
    }

    async function insertScanLog(input = {}) {
        const id = input.id || createId("aoscan");
        await run(`
            INSERT INTO auto_outage_scan_logs (
                id, rule_id, router_id, started_at, finished_at, total_db_users,
                total_with_pppoe, total_active_ppp, total_online,
                total_offline_candidates, total_eligible, total_skipped,
                error_message, summary_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            id,
            input.rule_id || null,
            input.router_id || null,
            input.started_at || new Date().toISOString(),
            input.finished_at || null,
            Number(input.total_db_users) || 0,
            Number(input.total_with_pppoe) || 0,
            Number(input.total_active_ppp) || 0,
            Number(input.total_online) || 0,
            Number(input.total_offline_candidates) || 0,
            Number(input.total_eligible) || 0,
            Number(input.total_skipped) || 0,
            input.error_message || null,
            stringifyJson(input.summary_json, {})
        ]);
        return normalizeScanLogRow(await get("SELECT * FROM auto_outage_scan_logs WHERE id = ?", [id]));
    }

    async function listScanLogs({ limit = 50, offset = 0 } = {}) {
        const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 500));
        const safeOffset = Math.max(0, Number(offset) || 0);
        const rows = await all(
            "SELECT * FROM auto_outage_scan_logs ORDER BY started_at DESC LIMIT ? OFFSET ?",
            [safeLimit, safeOffset]
        );
        return { items: rows.map(normalizeScanLogRow) };
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
        upsertRule,
        listRules,
        getRuleById,
        getEnabledRules,
        upsertStates,
        listStates,
        getStateByUserId,
        createConversation,
        updateConversation,
        getOpenConversationByUserId,
        insertScanLog,
        listScanLogs,
        close
    };
}

module.exports = { createAutoOutageRepository };
