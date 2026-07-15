/**
 * Header Doc
 * Purpose: Owner persistence SQLite untuk STATE modem OLT (turunan dari event log) —
 *          tabel `olt_incidents` (log gangguan bersih: down→up, verified, terklasifikasi) &
 *          `olt_modem_state` (status terkini per modem, 1 baris/MAC). Ini "state table"
 *          (cache turunan yang rebuildable dari `olt_events`), BEDA dari `olt_events.sqlite`
 *          (event mentah/audit). Lihat `docs/olt-modem-state-blueprint.md`.
 * Caller: `lib/olt-incident-projector.js` (tulis) & route/analitik state OLT (baca).
 * Deps: `sqlite3`, `lib/env-config.getDatabasePath` (→ `database/olt_state.sqlite`, auto `_test`),
 *        `lib/sqlite-pragmas` (WAL, opsional).
 * MainFuncs: `createOltIncidentRepository`, `getOltIncidentRepository` (singleton); method:
 *            `openIncident` / `closeIncident` / `reclassifyOpenIncident` / `getOpenIncidentByMac` /
 *            `upsertModemState` / `getModemState` / `listModemStates` / `listIncidents` /
 *            `countIncidents` / `countOpenIncidentsByOlt` / `closeStaleIncidents` /
 *            `markStaleOlderThan` / `pruneOldIncidents`.
 * SideEffects: Membuka koneksi SQLite & menulis baris insiden/state. Best-effort dari jalur ingest.
 */
"use strict";

const INCIDENT_TYPES = new Set(["los", "dying_gasp", "reboot", "flapping", "unknown"]);
const MODEM_STATES = new Set(["online", "los", "dying_gasp", "rebooting", "unknown"]);

function defaultDeps() {
    return {
        sqlite3: require("sqlite3").verbose(),
        getDatabasePath: require("../lib/env-config").getDatabasePath,
    };
}

function normMac(m) {
    return String(m || "").replace(/[^0-9a-f]/gi, "").toLowerCase();
}

function toTextOrNull(v) {
    return v === undefined || v === null ? null : String(v);
}

function createOltIncidentRepository(overrides = {}) {
    const deps = { ...defaultDeps(), ...overrides };
    const dbPath = deps.getDatabasePath("olt_state.sqlite");
    const db = deps.db || new deps.sqlite3.Database(dbPath);
    const now = deps.now || (() => Date.now());

    if (!deps.db) {
        try {
            const { applySqlitePragmas } = require("../lib/sqlite-pragmas");
            applySqlitePragmas(db).catch((pragmaErr) => {
                console.warn(`[OLT_STATE_PRAGMA_WARN] ${pragmaErr.message}`);
            });
        } catch (_error) {
            // Pragma helper opsional.
        }
    }

    let schemaReady = false;

    function run(sql, params = []) {
        return new Promise((resolve, reject) => {
            db.run(sql, params, function onRun(err) {
                if (err) { reject(err); return; }
                resolve({ lastID: this.lastID, changes: this.changes });
            });
        });
    }
    function all(sql, params = []) {
        return new Promise((resolve, reject) => {
            db.all(sql, params, (err, rows) => {
                if (err) { reject(err); return; }
                resolve(rows || []);
            });
        });
    }
    function get(sql, params = []) {
        return new Promise((resolve, reject) => {
            db.get(sql, params, (err, row) => {
                if (err) { reject(err); return; }
                resolve(row || null);
            });
        });
    }

    async function ensureSchema() {
        if (schemaReady) return;
        await run(`
            CREATE TABLE IF NOT EXISTS olt_incidents (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                mac               TEXT NOT NULL,
                olt_id            TEXT,
                slot              TEXT,
                onu               TEXT,
                customer_id       TEXT,
                customer_name     TEXT,
                pppoe_username    TEXT,
                phone             TEXT,
                address           TEXT,
                incident_type     TEXT NOT NULL,
                started_at_ms     INTEGER NOT NULL,
                ended_at_ms       INTEGER,
                duration_ms       INTEGER,
                olt_reported_ts   TEXT,
                status            TEXT NOT NULL DEFAULT 'open',
                down_source       TEXT,
                up_source         TEXT,
                confidence        REAL,
                verify_method     TEXT,
                identity_verified INTEGER NOT NULL DEFAULT 0,
                is_area_event     INTEGER NOT NULL DEFAULT 0,
                cluster_id        TEXT,
                dedup_key         TEXT UNIQUE,
                created_at_ms     INTEGER NOT NULL,
                updated_at_ms     INTEGER NOT NULL
            )
        `);
        await run("CREATE INDEX IF NOT EXISTS idx_olt_inc_mac ON olt_incidents(mac)");
        await run("CREATE INDEX IF NOT EXISTS idx_olt_inc_pppoe ON olt_incidents(pppoe_username)");
        await run("CREATE INDEX IF NOT EXISTS idx_olt_inc_started ON olt_incidents(started_at_ms)");
        await run("CREATE INDEX IF NOT EXISTS idx_olt_inc_type ON olt_incidents(incident_type)");
        await run("CREATE INDEX IF NOT EXISTS idx_olt_inc_status ON olt_incidents(status)");
        await run("CREATE INDEX IF NOT EXISTS idx_olt_inc_olt ON olt_incidents(olt_id)");

        await run(`
            CREATE TABLE IF NOT EXISTS olt_modem_state (
                mac               TEXT PRIMARY KEY,
                customer_id       TEXT,
                customer_name     TEXT,
                pppoe_username    TEXT,
                olt_id            TEXT,
                slot              TEXT,
                onu               TEXT,
                current_state     TEXT,
                state_since_ms    INTEGER,
                last_event_at_ms  INTEGER,
                last_source       TEXT,
                open_incident_id  INTEGER,
                stale             INTEGER NOT NULL DEFAULT 0,
                inc_30d           INTEGER,
                los_30d           INTEGER,
                dg_30d            INTEGER,
                reboot_30d        INTEGER,
                downtime_ms_30d   INTEGER,
                health            TEXT,
                updated_at_ms     INTEGER NOT NULL
            )
        `);
        await run("CREATE INDEX IF NOT EXISTS idx_olt_state_pppoe ON olt_modem_state(pppoe_username)");
        await run("CREATE INDEX IF NOT EXISTS idx_olt_state_current ON olt_modem_state(current_state)");
        await run("CREATE INDEX IF NOT EXISTS idx_olt_state_olt ON olt_modem_state(olt_id)");
        schemaReady = true;
    }

    // === Incidents ===

    async function getOpenIncidentByMac(mac) {
        await ensureSchema();
        return get(
            "SELECT * FROM olt_incidents WHERE mac = ? AND status = 'open' ORDER BY started_at_ms DESC LIMIT 1",
            [normMac(mac)]
        );
    }

    /**
     * Buka insiden baru (down). Idempoten via `dedup_key` UNIQUE — event kembar (syslog+scrape,
     * reorder UDP) tak menghasilkan insiden ganda. Return {opened, id, duplicate?}.
     */
    async function openIncident(input = {}) {
        await ensureSchema();
        const type = String(input.incident_type || "unknown");
        if (!INCIDENT_TYPES.has(type)) return { opened: false, reason: "invalid_type" };
        const nowMs = Number.isFinite(input.now_ms) ? input.now_ms : now();
        const startedAt = Number.isFinite(input.started_at_ms) ? input.started_at_ms : nowMs;
        const c = input.customer || {};
        const res = await run(`
            INSERT INTO olt_incidents (
                mac, olt_id, slot, onu,
                customer_id, customer_name, pppoe_username, phone, address,
                incident_type, started_at_ms, ended_at_ms, duration_ms, olt_reported_ts,
                status, down_source, up_source, confidence, verify_method, identity_verified,
                is_area_event, cluster_id, dedup_key, created_at_ms, updated_at_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 'open', ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(dedup_key) DO NOTHING
        `, [
            normMac(input.mac), toTextOrNull(input.olt_id), toTextOrNull(input.slot), toTextOrNull(input.onu),
            toTextOrNull(c.id), c.name || null, c.pppoe_username || c.pppoe || null, c.phone || null, c.address || null,
            type, startedAt, toTextOrNull(input.olt_reported_ts),
            input.down_source || null,
            Number.isFinite(input.confidence) ? input.confidence : null,
            input.verify_method || null,
            input.identity_verified ? 1 : 0,
            input.is_area_event ? 1 : 0, input.cluster_id || null,
            toTextOrNull(input.dedup_key), nowMs, nowMs,
        ]);
        if (res.changes > 0) return { opened: true, id: res.lastID };
        const existing = input.dedup_key
            ? await get("SELECT id FROM olt_incidents WHERE dedup_key = ?", [String(input.dedup_key)])
            : null;
        return { opened: false, duplicate: true, id: existing ? existing.id : null };
    }

    /** Naikkan klasifikasi insiden yang MASIH open (mis. LOS → dying_gasp saat DG menyusul). */
    async function reclassifyOpenIncident(id, patch = {}) {
        await ensureSchema();
        const nowMs = Number.isFinite(patch.now_ms) ? patch.now_ms : now();
        const type = String(patch.incident_type || "");
        if (!INCIDENT_TYPES.has(type)) return { updated: false, reason: "invalid_type" };
        const res = await run(
            `UPDATE olt_incidents SET incident_type = ?, confidence = ?, verify_method = COALESCE(?, verify_method), updated_at_ms = ?
             WHERE id = ? AND status = 'open'`,
            [type, Number.isFinite(patch.confidence) ? patch.confidence : null, patch.verify_method || null, nowMs, id]
        );
        return { updated: res.changes > 0 };
    }

    /** Tutup insiden (pulih). Hitung durasi & finalisasi jenis/confidence. */
    async function closeIncident(id, patch = {}) {
        await ensureSchema();
        const inc = await get("SELECT * FROM olt_incidents WHERE id = ?", [id]);
        if (!inc) return { closed: false, reason: "not_found" };
        if (inc.status !== "open") return { closed: false, reason: "not_open", incident: inc };
        const nowMs = Number.isFinite(patch.now_ms) ? patch.now_ms : now();
        const ended = Number.isFinite(patch.ended_at_ms) ? patch.ended_at_ms : nowMs;
        const duration = Math.max(0, ended - inc.started_at_ms);
        const type = patch.incident_type && INCIDENT_TYPES.has(patch.incident_type) ? patch.incident_type : inc.incident_type;
        const confidence = Number.isFinite(patch.confidence) ? patch.confidence : inc.confidence;
        const verify = patch.verify_method || inc.verify_method;
        const status = patch.status || "resolved";
        await run(
            `UPDATE olt_incidents SET ended_at_ms = ?, duration_ms = ?, incident_type = ?, confidence = ?,
             verify_method = ?, up_source = ?, status = ?, updated_at_ms = ? WHERE id = ?`,
            [ended, duration, type, confidence, verify, patch.up_source || null, status, nowMs, id]
        );
        return { closed: true, id, duration_ms: duration, incident_type: type };
    }

    /**
     * Tutup insiden `open` yang menggantung terlalu lama (tak pernah pulih) sebagai
     * `assumed_recovered` — cegah "sedang down" & MTTR jadi ngaco. (Fase 2 reconcile.)
     */
    async function closeStaleIncidents({ maxOpenMs, now_ms } = {}) {
        await ensureSchema();
        const nowMs = Number.isFinite(now_ms) ? now_ms : now();
        const cutoff = nowMs - (Number.isFinite(maxOpenMs) ? maxOpenMs : 24 * 60 * 60 * 1000);
        const stale = await all("SELECT id, started_at_ms FROM olt_incidents WHERE status = 'open' AND started_at_ms < ?", [cutoff]);
        for (const row of stale) {
            await run(
                `UPDATE olt_incidents SET status = 'assumed_recovered', ended_at_ms = ?, duration_ms = ?,
                 confidence = MIN(COALESCE(confidence, 0.3), 0.3), updated_at_ms = ? WHERE id = ? AND status = 'open'`,
                [nowMs, Math.max(0, nowMs - row.started_at_ms), nowMs, row.id]
            );
        }
        return { closed: stale.length };
    }

    async function listIncidents(filters = {}) {
        await ensureSchema();
        const where = [];
        const params = [];
        if (filters.mac) { where.push("mac = ?"); params.push(normMac(filters.mac)); }
        if (filters.pppoe_username) { where.push("pppoe_username = ?"); params.push(String(filters.pppoe_username)); }
        if (filters.olt_id) { where.push("olt_id = ?"); params.push(String(filters.olt_id)); }
        if (filters.status) { where.push("status = ?"); params.push(String(filters.status)); }
        if (filters.incident_type) { where.push("incident_type = ?"); params.push(String(filters.incident_type)); }
        if (Number.isFinite(filters.from)) { where.push("started_at_ms >= ?"); params.push(filters.from); }
        if (Number.isFinite(filters.to)) { where.push("started_at_ms <= ?"); params.push(filters.to); }
        if (filters.excludeArea) { where.push("is_area_event = 0"); }
        const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
        const limit = Math.max(1, Math.min(Number(filters.limit) || 200, 5000));
        const offset = Math.max(0, Number(filters.offset) || 0);
        return all(`SELECT * FROM olt_incidents ${whereSql} ORDER BY started_at_ms DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
    }

    async function countIncidents(filters = {}) {
        const rows = await listIncidents({ ...filters, limit: 5000, offset: 0 });
        return rows.length;
    }

    /** Berapa insiden `open` di 1 OLT sejak `sinceMs` — untuk deteksi gangguan area/cluster. */
    async function countOpenIncidentsByOlt(oltId, sinceMs) {
        await ensureSchema();
        const row = await get(
            "SELECT COUNT(*) AS n FROM olt_incidents WHERE olt_id = ? AND status = 'open' AND started_at_ms >= ?",
            [String(oltId || ""), Number.isFinite(sinceMs) ? sinceMs : 0]
        );
        return (row && row.n) || 0;
    }

    async function markIncidentsAreaEvent(ids, clusterId, now_ms) {
        if (!Array.isArray(ids) || !ids.length) return { updated: 0 };
        await ensureSchema();
        const nowMs = Number.isFinite(now_ms) ? now_ms : now();
        const placeholders = ids.map(() => "?").join(",");
        const res = await run(
            `UPDATE olt_incidents SET is_area_event = 1, cluster_id = ?, updated_at_ms = ? WHERE id IN (${placeholders})`,
            [clusterId || null, nowMs, ...ids]
        );
        return { updated: res.changes };
    }

    async function pruneOldIncidents(retentionDays = 365) {
        try {
            await ensureSchema();
            const days = Number.isFinite(retentionDays) && retentionDays > 0 ? retentionDays : 365;
            const cutoff = now() - days * 24 * 60 * 60 * 1000;
            const res = await run("DELETE FROM olt_incidents WHERE status != 'open' AND started_at_ms < ?", [cutoff]);
            return res.changes;
        } catch (err) {
            console.warn(`[OLT_STATE] prune gagal: ${err.message}`);
            return 0;
        }
    }

    // === Modem state (rollup 1 baris/MAC) ===

    async function upsertModemState(input = {}) {
        await ensureSchema();
        const state = String(input.current_state || "unknown");
        if (!MODEM_STATES.has(state)) return { updated: false, reason: "invalid_state" };
        const nowMs = Number.isFinite(input.now_ms) ? input.now_ms : now();
        const c = input.customer || {};
        await run(`
            INSERT INTO olt_modem_state (
                mac, customer_id, customer_name, pppoe_username, olt_id, slot, onu,
                current_state, state_since_ms, last_event_at_ms, last_source, open_incident_id, stale, updated_at_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
            ON CONFLICT(mac) DO UPDATE SET
                customer_id = COALESCE(excluded.customer_id, olt_modem_state.customer_id),
                customer_name = COALESCE(excluded.customer_name, olt_modem_state.customer_name),
                pppoe_username = COALESCE(excluded.pppoe_username, olt_modem_state.pppoe_username),
                olt_id = COALESCE(excluded.olt_id, olt_modem_state.olt_id),
                slot = COALESCE(excluded.slot, olt_modem_state.slot),
                onu = COALESCE(excluded.onu, olt_modem_state.onu),
                current_state = excluded.current_state,
                state_since_ms = excluded.state_since_ms,
                last_event_at_ms = excluded.last_event_at_ms,
                last_source = excluded.last_source,
                open_incident_id = excluded.open_incident_id,
                stale = 0,
                updated_at_ms = excluded.updated_at_ms
        `, [
            normMac(input.mac), toTextOrNull(c.id), c.name || null, c.pppoe_username || c.pppoe || null,
            toTextOrNull(input.olt_id), toTextOrNull(input.slot), toTextOrNull(input.onu),
            state,
            Number.isFinite(input.state_since_ms) ? input.state_since_ms : nowMs,
            Number.isFinite(input.last_event_at_ms) ? input.last_event_at_ms : nowMs,
            input.last_source || null,
            Number.isFinite(input.open_incident_id) ? input.open_incident_id : null,
            nowMs,
        ]);
        return { updated: true };
    }

    async function getModemState(mac) {
        await ensureSchema();
        return get("SELECT * FROM olt_modem_state WHERE mac = ?", [normMac(mac)]);
    }

    async function getModemStateByPppoe(pppoe) {
        await ensureSchema();
        return get("SELECT * FROM olt_modem_state WHERE pppoe_username = ? ORDER BY updated_at_ms DESC LIMIT 1", [String(pppoe || "")]);
    }

    async function listModemStates(filters = {}) {
        await ensureSchema();
        const where = [];
        const params = [];
        if (filters.current_state) { where.push("current_state = ?"); params.push(String(filters.current_state)); }
        if (filters.olt_id) { where.push("olt_id = ?"); params.push(String(filters.olt_id)); }
        if (filters.stale === true) { where.push("stale = 1"); }
        const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
        const limit = Math.max(1, Math.min(Number(filters.limit) || 500, 5000));
        const offset = Math.max(0, Number(filters.offset) || 0);
        return all(`SELECT * FROM olt_modem_state ${whereSql} ORDER BY updated_at_ms DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
    }

    /** Tandai state basi bila tak ada update lebih lama dari `olderThanMs` (freshness guard). */
    async function markStaleOlderThan({ olderThanMs, now_ms } = {}) {
        await ensureSchema();
        const nowMs = Number.isFinite(now_ms) ? now_ms : now();
        const cutoff = nowMs - (Number.isFinite(olderThanMs) ? olderThanMs : 60 * 60 * 1000);
        const res = await run("UPDATE olt_modem_state SET stale = 1 WHERE stale = 0 AND last_event_at_ms < ?", [cutoff]);
        return { marked: res.changes };
    }

    async function updateModemStateCounters(mac, counters = {}) {
        await ensureSchema();
        await run(
            `UPDATE olt_modem_state SET inc_30d = ?, los_30d = ?, dg_30d = ?, reboot_30d = ?, downtime_ms_30d = ?, health = ?, updated_at_ms = ?
             WHERE mac = ?`,
            [
                counters.inc_30d ?? null, counters.los_30d ?? null, counters.dg_30d ?? null,
                counters.reboot_30d ?? null, counters.downtime_ms_30d ?? null, counters.health || null,
                now(), normMac(mac),
            ]
        );
    }

    function close() {
        return new Promise((resolve, reject) => {
            db.close((err) => { if (err) { reject(err); return; } resolve(); });
        });
    }

    return {
        deps,
        ensureSchema,
        normMac,
        // incidents
        getOpenIncidentByMac,
        openIncident,
        reclassifyOpenIncident,
        closeIncident,
        closeStaleIncidents,
        listIncidents,
        countIncidents,
        countOpenIncidentsByOlt,
        markIncidentsAreaEvent,
        pruneOldIncidents,
        // modem state
        upsertModemState,
        getModemState,
        getModemStateByPppoe,
        listModemStates,
        markStaleOlderThan,
        updateModemStateCounters,
        close,
    };
}

let singleton = null;
function getOltIncidentRepository() {
    if (!singleton) singleton = createOltIncidentRepository();
    return singleton;
}

module.exports = {
    createOltIncidentRepository,
    getOltIncidentRepository,
    INCIDENT_TYPES,
    MODEM_STATES,
};
