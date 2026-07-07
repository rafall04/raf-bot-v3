/**
 * Header Doc
 * Purpose: Persistence probe kualitas jalur upstream (loss/RTT/jitter per path per target) +
 *          snapshot state route default per mark (deteksi failover MNI→SF). Time-series untuk
 *          vonis "lemot dari sisi mana" dan alert degradasi jalur.
 * Caller: `lib/upstream-quality-poller.js` (tulis per siklus) dan
 *         `routes/admin-upstream-quality-routes.js` (baca status/riwayat).
 * Deps: `sqlite3`, `lib/env-config.getDatabasePath` (→ `database/upstream_quality.sqlite`,
 *       auto `*_test.sqlite` saat NODE_ENV=test), `lib/sqlite-pragmas` (opsional, WAL).
 * MainFuncs: `createUpstreamQualityRepository`, `getUpstreamQualityRepository` (singleton),
 *            method repo `insertProbes` / `insertRouteStates` / `getRecentProbes` /
 *            `getSummary` / `getLatestRouteStates` / `pruneOld`.
 * SideEffects: Membuka koneksi SQLite `database/upstream_quality.sqlite` dan menulis baris probe.
 */
"use strict";

function defaultDeps() {
    return {
        sqlite3: require("sqlite3").verbose(),
        getDatabasePath: require("../lib/env-config").getDatabasePath
    };
}

function createUpstreamQualityRepository(overrides = {}) {
    const deps = { ...defaultDeps(), ...overrides };
    const dbPath = deps.getDatabasePath("upstream_quality.sqlite");
    const db = deps.db || new deps.sqlite3.Database(dbPath);

    if (!deps.db) {
        try {
            const { applySqlitePragmas } = require("../lib/sqlite-pragmas");
            applySqlitePragmas(db).catch((pragmaErr) => {
                console.warn(`[UPQ_PRAGMA_WARN] ${pragmaErr.message}`);
            });
        } catch (_error) {
            // Pragma helper opsional — jangan break repo bila tidak tersedia.
        }
    }

    let schemaReady = false;

    function run(sql, params = []) {
        return new Promise((resolve, reject) => {
            db.run(sql, params, function onRun(err) {
                if (err) return reject(err);
                resolve({ lastID: this.lastID, changes: this.changes });
            });
        });
    }

    function all(sql, params = []) {
        return new Promise((resolve, reject) => {
            db.all(sql, params, (err, rows) => {
                if (err) return reject(err);
                resolve(rows || []);
            });
        });
    }

    async function ensureSchema() {
        if (schemaReady) return;
        await run(`
            CREATE TABLE IF NOT EXISTS upstream_probes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                probed_at TEXT NOT NULL,
                path TEXT NOT NULL,
                routing_table TEXT,
                target TEXT NOT NULL,
                target_key TEXT,
                sent INTEGER NOT NULL DEFAULT 0,
                received INTEGER NOT NULL DEFAULT 0,
                loss_pct REAL,
                rtt_min_ms REAL,
                rtt_avg_ms REAL,
                rtt_max_ms REAL,
                jitter_ms REAL,
                ok INTEGER NOT NULL DEFAULT 0,
                error TEXT
            )
        `);
        await run("CREATE INDEX IF NOT EXISTS idx_upstream_probes_time ON upstream_probes(probed_at)");
        await run("CREATE INDEX IF NOT EXISTS idx_upstream_probes_path_time ON upstream_probes(path, probed_at)");
        await run(`
            CREATE TABLE IF NOT EXISTS upstream_route_state (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                checked_at TEXT NOT NULL,
                mark TEXT NOT NULL,
                gateway TEXT,
                distance INTEGER,
                active INTEGER NOT NULL DEFAULT 0,
                disabled INTEGER NOT NULL DEFAULT 0,
                comment TEXT
            )
        `);
        await run("CREATE INDEX IF NOT EXISTS idx_upstream_route_state_time ON upstream_route_state(checked_at)");
        schemaReady = true;
    }

    /** Simpan hasil probe satu siklus (probedAt sama untuk semua baris siklus itu). */
    async function insertProbes(probedAt, rows = []) {
        await ensureSchema();
        for (const r of rows) {
            await run(`
                INSERT INTO upstream_probes (
                    probed_at, path, routing_table, target, target_key,
                    sent, received, loss_pct, rtt_min_ms, rtt_avg_ms, rtt_max_ms, jitter_ms, ok, error
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                probedAt,
                r.path,
                r.routing_table || null,
                r.target,
                r.target_key || null,
                Number(r.sent) || 0,
                Number(r.received) || 0,
                r.loss_pct == null ? null : Number(r.loss_pct),
                r.rtt_min_ms == null ? null : Number(r.rtt_min_ms),
                r.rtt_avg_ms == null ? null : Number(r.rtt_avg_ms),
                r.rtt_max_ms == null ? null : Number(r.rtt_max_ms),
                r.jitter_ms == null ? null : Number(r.jitter_ms),
                r.error ? 0 : 1,
                r.error || null
            ]);
        }
        return rows.length;
    }

    /** Simpan snapshot route default per mark (satu checked_at per siklus). */
    async function insertRouteStates(checkedAt, rows = []) {
        await ensureSchema();
        for (const r of rows) {
            await run(`
                INSERT INTO upstream_route_state (checked_at, mark, gateway, distance, active, disabled, comment)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [
                checkedAt,
                r.mark || "main",
                r.gateway || null,
                r.distance == null ? null : Number(r.distance),
                r.active ? 1 : 0,
                r.disabled ? 1 : 0,
                r.comment || null
            ]);
        }
        return rows.length;
    }

    async function getRecentProbes({ sinceIso, path = null, limit = 2000 } = {}) {
        await ensureSchema();
        const where = ["probed_at >= ?"];
        const params = [sinceIso];
        if (path) {
            where.push("path = ?");
            params.push(path);
        }
        params.push(Math.max(1, Math.min(Number(limit) || 2000, 10000)));
        return all(
            `SELECT * FROM upstream_probes WHERE ${where.join(" AND ")} ORDER BY probed_at DESC LIMIT ?`,
            params
        );
    }

    /**
     * Ringkasan per (path, target): statistik jendela pendek + baseline RTT jangka panjang.
     * Baseline hanya dari sampel sehat (ok=1, loss<50) supaya degradasi tidak meracuni acuan.
     */
    async function getSummary({ windowSinceIso, baselineSinceIso } = {}) {
        await ensureSchema();
        const windowRows = await all(`
            SELECT path, target, target_key, routing_table,
                   COUNT(*) AS samples,
                   AVG(loss_pct) AS loss_avg,
                   AVG(rtt_avg_ms) AS rtt_avg,
                   AVG(jitter_ms) AS jitter_avg,
                   MAX(probed_at) AS last_probed_at,
                   SUM(ok) AS ok_count
            FROM upstream_probes
            WHERE probed_at >= ?
            GROUP BY path, target
        `, [windowSinceIso]);
        const baselineRows = await all(`
            SELECT path, target,
                   COUNT(*) AS samples,
                   AVG(rtt_avg_ms) AS rtt_avg,
                   AVG(loss_pct) AS loss_avg
            FROM upstream_probes
            WHERE probed_at >= ? AND ok = 1 AND (loss_pct IS NULL OR loss_pct < 50)
            GROUP BY path, target
        `, [baselineSinceIso]);
        const baselineMap = new Map();
        baselineRows.forEach((b) => baselineMap.set(`${b.path}|${b.target}`, b));
        return windowRows.map((w) => ({
            ...w,
            baseline: baselineMap.get(`${w.path}|${w.target}`) || null
        }));
    }

    /** Baris route-state dari snapshot TERAKHIR (untuk deteksi failover terkini). */
    async function getLatestRouteStates() {
        await ensureSchema();
        return all(`
            SELECT * FROM upstream_route_state
            WHERE checked_at = (SELECT MAX(checked_at) FROM upstream_route_state)
            ORDER BY mark, distance
        `);
    }

    async function pruneOld(days = 30) {
        await ensureSchema();
        const cutoff = new Date(Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000).toISOString();
        const a = await run("DELETE FROM upstream_probes WHERE probed_at < ?", [cutoff]);
        const b = await run("DELETE FROM upstream_route_state WHERE checked_at < ?", [cutoff]);
        return { probes: a.changes, routeStates: b.changes };
    }

    function close() {
        return new Promise((resolve, reject) => {
            db.close((err) => (err ? reject(err) : resolve()));
        });
    }

    return {
        deps,
        ensureSchema,
        insertProbes,
        insertRouteStates,
        getRecentProbes,
        getSummary,
        getLatestRouteStates,
        pruneOld,
        close
    };
}

let singleton = null;

function getUpstreamQualityRepository() {
    if (!singleton) {
        singleton = createUpstreamQualityRepository();
    }
    return singleton;
}

module.exports = {
    createUpstreamQualityRepository,
    getUpstreamQualityRepository
};
