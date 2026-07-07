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
        await run(`
            CREATE TABLE IF NOT EXISTS wan_link_samples (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sampled_at TEXT NOT NULL,
                path TEXT NOT NULL,
                iface TEXT,
                rx_bps INTEGER,
                tx_bps INTEGER,
                rx_error_d INTEGER,
                tx_error_d INTEGER,
                rx_drop_d INTEGER,
                tx_drop_d INTEGER,
                link_downs INTEGER,
                tunnel_uptime_s INTEGER,
                util_down_pct REAL,
                util_up_pct REAL,
                flap INTEGER NOT NULL DEFAULT 0
            )
        `);
        await run("CREATE INDEX IF NOT EXISTS idx_wan_link_samples_path_time ON wan_link_samples(path, sampled_at)");
        await run(`
            CREATE TABLE IF NOT EXISTS upstream_incidents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                path TEXT NOT NULL,
                kind TEXT NOT NULL,
                detail TEXT
            )
        `);
        await run("CREATE INDEX IF NOT EXISTS idx_upstream_incidents_time ON upstream_incidents(created_at)");
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
     * Ringkasan per (path, target) — HANYA target JAUH (target_key != 'gateway'):
     * statistik jendela pendek + baseline RTT jangka panjang. Baseline hanya dari sampel
     * sehat (ok=1, loss<50) supaya degradasi tidak meracuni acuan.
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
            WHERE probed_at >= ? AND COALESCE(target_key, '') != 'gateway'
            GROUP BY path, target
        `, [windowSinceIso]);
        const baselineRows = await all(`
            SELECT path, target,
                   COUNT(*) AS samples,
                   AVG(rtt_avg_ms) AS rtt_avg,
                   AVG(loss_pct) AS loss_avg
            FROM upstream_probes
            WHERE probed_at >= ? AND ok = 1 AND (loss_pct IS NULL OR loss_pct < 50)
              AND COALESCE(target_key, '') != 'gateway'
            GROUP BY path, target
        `, [baselineSinceIso]);
        const baselineMap = new Map();
        baselineRows.forEach((b) => baselineMap.set(`${b.path}|${b.target}`, b));
        return windowRows.map((w) => ({
            ...w,
            baseline: baselineMap.get(`${w.path}|${w.target}`) || null
        }));
    }

    /** Ringkasan probe GATEWAY per path (segmen last-mile) pada jendela status. */
    async function getGatewaySummary({ windowSinceIso } = {}) {
        await ensureSchema();
        return all(`
            SELECT path, target,
                   COUNT(*) AS samples,
                   AVG(loss_pct) AS loss_avg,
                   AVG(rtt_avg_ms) AS rtt_avg,
                   MAX(probed_at) AS last_probed_at
            FROM upstream_probes
            WHERE probed_at >= ? AND target_key = 'gateway'
            GROUP BY path
        `, [windowSinceIso]);
    }

    /** Simpan sampel link WAN satu siklus (bps/error/drop/flap per path). */
    async function insertWanSamples(sampledAt, rows = []) {
        await ensureSchema();
        for (const r of rows) {
            await run(`
                INSERT INTO wan_link_samples (
                    sampled_at, path, iface, rx_bps, tx_bps,
                    rx_error_d, tx_error_d, rx_drop_d, tx_drop_d,
                    link_downs, tunnel_uptime_s, util_down_pct, util_up_pct, flap
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                sampledAt, r.path, r.iface || null,
                r.rx_bps == null ? null : Math.round(r.rx_bps),
                r.tx_bps == null ? null : Math.round(r.tx_bps),
                r.rx_error_d == null ? null : Number(r.rx_error_d),
                r.tx_error_d == null ? null : Number(r.tx_error_d),
                r.rx_drop_d == null ? null : Number(r.rx_drop_d),
                r.tx_drop_d == null ? null : Number(r.tx_drop_d),
                r.link_downs == null ? null : Number(r.link_downs),
                r.tunnel_uptime_s == null ? null : Number(r.tunnel_uptime_s),
                r.util_down_pct == null ? null : Number(r.util_down_pct),
                r.util_up_pct == null ? null : Number(r.util_up_pct),
                r.flap ? 1 : 0
            ]);
        }
        return rows.length;
    }

    async function getWanHistory({ sinceIso, path = null, limit = 4000 } = {}) {
        await ensureSchema();
        const where = ["sampled_at >= ?"];
        const params = [sinceIso];
        if (path) {
            where.push("path = ?");
            params.push(path);
        }
        params.push(Math.max(1, Math.min(Number(limit) || 4000, 20000)));
        return all(
            `SELECT * FROM wan_link_samples WHERE ${where.join(" AND ")} ORDER BY sampled_at DESC LIMIT ?`,
            params
        );
    }

    /** Ringkasan utilisasi/flap per path pada jendela status (utk laporan status & segmen). */
    async function getWanWindowStats({ windowSinceIso, flapSinceIso } = {}) {
        await ensureSchema();
        const windowRows = await all(`
            SELECT path,
                   AVG(rx_bps) AS rx_bps_avg,
                   AVG(tx_bps) AS tx_bps_avg,
                   MAX(util_down_pct) AS util_down_max,
                   MAX(util_up_pct) AS util_up_max,
                   SUM(COALESCE(rx_error_d,0) + COALESCE(tx_error_d,0)) AS errors,
                   SUM(COALESCE(rx_drop_d,0) + COALESCE(tx_drop_d,0)) AS drops
            FROM wan_link_samples
            WHERE sampled_at >= ?
            GROUP BY path
        `, [windowSinceIso]);
        const flapRows = await all(`
            SELECT path, SUM(flap) AS flaps
            FROM wan_link_samples
            WHERE sampled_at >= ?
            GROUP BY path
        `, [flapSinceIso]);
        const flapMap = new Map();
        flapRows.forEach((f) => flapMap.set(f.path, Number(f.flaps) || 0));
        return windowRows.map((w) => ({ ...w, flaps: flapMap.get(w.path) || 0 }));
    }

    /**
     * Rapor ISP per path selama N hari: availability (siklus non-PUTUS), loss/rtt rata-rata,
     * jumlah siklus sakit, dan flap — bahan objektif menilai/komplain ISP.
     */
    async function getIspReport({ sinceIso, lossWarnPct = 5 } = {}) {
        await ensureSchema();
        const probeRows = await all(`
            SELECT path,
                   COUNT(DISTINCT probed_at) AS cycles,
                   AVG(loss_pct) AS loss_avg,
                   AVG(rtt_avg_ms) AS rtt_avg,
                   SUM(CASE WHEN loss_pct >= 99 THEN 1 ELSE 0 END) AS putus_rows,
                   SUM(CASE WHEN loss_pct >= ? THEN 1 ELSE 0 END) AS sick_rows,
                   COUNT(*) AS rows_total
            FROM upstream_probes
            WHERE probed_at >= ? AND COALESCE(target_key, '') != 'gateway'
            GROUP BY path
        `, [lossWarnPct, sinceIso]);
        const flapRows = await all(`
            SELECT path, SUM(flap) AS flaps
            FROM wan_link_samples
            WHERE sampled_at >= ?
            GROUP BY path
        `, [sinceIso]);
        const flapMap = new Map();
        flapRows.forEach((f) => flapMap.set(f.path, Number(f.flaps) || 0));
        return probeRows.map((r) => ({
            path: r.path,
            cycles: Number(r.cycles) || 0,
            loss_avg: r.loss_avg == null ? null : Math.round(Number(r.loss_avg) * 10) / 10,
            rtt_avg: r.rtt_avg == null ? null : Math.round(Number(r.rtt_avg) * 10) / 10,
            availability_pct: r.rows_total > 0
                ? Math.round((1 - Number(r.putus_rows) / Number(r.rows_total)) * 1000) / 10
                : null,
            sick_pct: r.rows_total > 0
                ? Math.round((Number(r.sick_rows) / Number(r.rows_total)) * 1000) / 10
                : null,
            flaps: flapMap.get(r.path) || 0
        }));
    }

    /** Catat insiden (alert/trace/flap) — bukti kronologis utk komplain ISP. */
    async function addIncident({ createdAt, path, kind, detail }) {
        await ensureSchema();
        await run(
            "INSERT INTO upstream_incidents (created_at, path, kind, detail) VALUES (?, ?, ?, ?)",
            [createdAt || new Date().toISOString(), path, kind, typeof detail === "string" ? detail : JSON.stringify(detail || null)]
        );
    }

    async function getIncidents({ limit = 30 } = {}) {
        await ensureSchema();
        return all(
            "SELECT * FROM upstream_incidents ORDER BY created_at DESC LIMIT ?",
            [Math.max(1, Math.min(Number(limit) || 30, 200))]
        );
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
        const c = await run("DELETE FROM wan_link_samples WHERE sampled_at < ?", [cutoff]);
        const d = await run("DELETE FROM upstream_incidents WHERE created_at < ?", [cutoff]);
        return { probes: a.changes, routeStates: b.changes, wanSamples: c.changes, incidents: d.changes };
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
        getGatewaySummary,
        insertWanSamples,
        getWanHistory,
        getWanWindowStats,
        getIspReport,
        addIncident,
        getIncidents,
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
