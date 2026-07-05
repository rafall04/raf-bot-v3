/**
 * Header Doc
 * Purpose: Log durable kejadian OLT (LOS / Dying-Gasp / Discovery-pulih) yang di-ENRICH dengan
 *          identitas pelanggan (nama/pppoe/HP/alamat) + durasi down→up. Sumber kebenaran "Log
 *          Gangguan OLT" untuk halaman admin & audit — beda dari `database/olt-events.json`
 *          (state MAC-terkini, tipis) dan `los-incidents.json` (LOS-only, JSON cap 1000).
 * Caller: `lib/olt-event-logger.js` (enricher/funnel, dipanggil dari olt-syslog-receiver.emitEvent
 *          & olt-log-scraper edge-trigger) untuk tulis; `routes/olt.js` untuk baca (halaman/API).
 * Deps: `sqlite3`, `lib/env-config.getDatabasePath` (→ `database/olt_events.sqlite`, auto `_test`
 *        saat NODE_ENV=test), `lib/sqlite-pragmas` (opsional, WAL).
 * MainFuncs: `createOltEventRepository`, `getOltEventRepository` (singleton); method repo
 *            `recordEvent` / `listEvents` / `countEvents` / `getStats` / `pruneOld`.
 * SideEffects: Membuka koneksi SQLite & menulis baris event OLT. TIDAK pernah throw dari jalur
 *              ingest (best-effort) — kegagalan log tak boleh mengganggu deteksi/broadcast LOS.
 */
"use strict";

const VALID_TYPES = new Set(["los", "dying-gasp", "discovery"]);

function defaultDeps() {
    return {
        sqlite3: require("sqlite3").verbose(),
        getDatabasePath: require("../lib/env-config").getDatabasePath,
    };
}

function normMac(m) {
    return String(m || "").replace(/[^0-9a-f]/gi, "").toLowerCase();
}

function createOltEventRepository(overrides = {}) {
    const deps = { ...defaultDeps(), ...overrides };
    const dbPath = deps.getDatabasePath("olt_events.sqlite");
    const db = deps.db || new deps.sqlite3.Database(dbPath);
    const now = deps.now || (() => Date.now());

    if (!deps.db) {
        try {
            const { applySqlitePragmas } = require("../lib/sqlite-pragmas");
            applySqlitePragmas(db).catch((pragmaErr) => {
                console.warn(`[OLT_EVENT_LOG_PRAGMA_WARN] ${pragmaErr.message}`);
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
            CREATE TABLE IF NOT EXISTS olt_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT NOT NULL,
                ts_ms INTEGER NOT NULL,
                event_type TEXT NOT NULL,
                mac TEXT,
                slot TEXT,
                onu TEXT,
                olt_id TEXT,
                confidence REAL,
                source TEXT,
                customer_id TEXT,
                customer_name TEXT,
                pppoe_username TEXT,
                phone TEXT,
                address TEXT,
                account_type TEXT,
                down_ts_ms INTEGER,
                duration_ms INTEGER
            )
        `);
        await run("CREATE INDEX IF NOT EXISTS idx_olt_events_ts ON olt_events(ts_ms)");
        await run("CREATE INDEX IF NOT EXISTS idx_olt_events_mac ON olt_events(mac)");
        await run("CREATE INDEX IF NOT EXISTS idx_olt_events_type ON olt_events(event_type)");
        schemaReady = true;
    }

    /**
     * Simpan satu event OLT (enriched). Never-throw → return {saved, reason?, id?, deduped?}.
     * - Dedup: MAC+tipe sama dalam `dedupWindowMs` (syslog & scraper sering emit event kembar).
     * - Pairing durasi: saat 'discovery', cari down (los/dg) terbaru yang belum pulih → isi
     *   down_ts_ms + duration_ms (lama gangguan).
     */
    async function recordEvent(evt = {}) {
        try {
            await ensureSchema();
            const type = String(evt.event_type || "").toLowerCase();
            if (!VALID_TYPES.has(type)) return { saved: false, reason: "invalid_type" };

            const tsMs = Number.isFinite(evt.ts_ms) ? evt.ts_ms : now();
            const ts = evt.ts || new Date(tsMs).toISOString();
            const mac = evt.mac ? String(evt.mac) : null;
            const macNorm = normMac(mac);

            // Dedup berbasis STATE (bukan window waktu): satu baris 'down' per outage, satu
            // 'discovery' per pemulihan — kebal ganda dari syslog + scraper (bisa terpaut menit).
            // Cek event TERAKHIR untuk MAC ini.
            if (macNorm) {
                const latest = await get(
                    "SELECT event_type FROM olt_events WHERE mac = ? ORDER BY ts_ms DESC LIMIT 1",
                    [mac]
                );
                const latestType = latest ? latest.event_type : null;
                if (type === "discovery") {
                    if (!latest || latestType === "discovery") return { saved: false, deduped: true };
                } else if (latestType === "los" || latestType === "dying-gasp") {
                    return { saved: false, deduped: true };
                }
            }

            // Pairing durasi untuk discovery (pulih).
            let downTsMs = null;
            let durationMs = null;
            if (type === "discovery" && macNorm) {
                const lastDown = await get(
                    "SELECT ts_ms FROM olt_events WHERE mac = ? AND event_type IN ('los','dying-gasp') ORDER BY ts_ms DESC LIMIT 1",
                    [mac]
                );
                const lastRecovery = await get(
                    "SELECT ts_ms FROM olt_events WHERE mac = ? AND event_type = 'discovery' ORDER BY ts_ms DESC LIMIT 1",
                    [mac]
                );
                if (lastDown && lastDown.ts_ms <= tsMs && (!lastRecovery || lastDown.ts_ms > lastRecovery.ts_ms)) {
                    downTsMs = lastDown.ts_ms;
                    durationMs = tsMs - lastDown.ts_ms;
                }
            }

            const c = evt.customer || {};
            const res = await run(`
                INSERT INTO olt_events (
                    ts, ts_ms, event_type, mac, slot, onu, olt_id, confidence, source,
                    customer_id, customer_name, pppoe_username, phone, address, account_type,
                    down_ts_ms, duration_ms
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                ts, tsMs, type, mac,
                evt.slot != null ? String(evt.slot) : null,
                evt.onu != null ? String(evt.onu) : null,
                evt.olt_id != null ? String(evt.olt_id) : null,
                Number.isFinite(evt.confidence) ? evt.confidence : null,
                evt.source || null,
                c.id != null ? String(c.id) : null,
                c.name || null,
                c.pppoe_username || c.pppoe || null,
                c.phone || null,
                c.address || null,
                c.account_type || null,
                downTsMs,
                durationMs,
            ]);
            return { saved: true, id: res.lastID };
        } catch (err) {
            console.warn(`[OLT_EVENT_LOG] gagal simpan event: ${err.message}`);
            return { saved: false, reason: err.message };
        }
    }

    function buildFilter({ from, to, type, mac, q, oltId } = {}) {
        const where = [];
        const params = [];
        if (Number.isFinite(from)) { where.push("ts_ms >= ?"); params.push(from); }
        if (Number.isFinite(to)) { where.push("ts_ms <= ?"); params.push(to); }
        if (type && VALID_TYPES.has(String(type).toLowerCase())) {
            where.push("event_type = ?"); params.push(String(type).toLowerCase());
        }
        if (mac) { where.push("mac = ?"); params.push(String(mac)); }
        if (oltId) { where.push("olt_id = ?"); params.push(String(oltId)); }
        if (q && String(q).trim()) {
            const like = `%${String(q).trim()}%`;
            where.push("(customer_name LIKE ? OR pppoe_username LIKE ? OR phone LIKE ? OR mac LIKE ? OR address LIKE ?)");
            params.push(like, like, like, like, like);
        }
        return { whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
    }

    async function listEvents(filters = {}) {
        await ensureSchema();
        const safeLimit = Math.max(1, Math.min(Number(filters.limit) || 200, 5000));
        const safeOffset = Math.max(0, Number(filters.offset) || 0);
        const { whereSql, params } = buildFilter(filters);
        return all(
            `SELECT * FROM olt_events ${whereSql} ORDER BY ts_ms DESC LIMIT ? OFFSET ?`,
            [...params, safeLimit, safeOffset]
        );
    }

    async function countEvents(filters = {}) {
        await ensureSchema();
        const { whereSql, params } = buildFilter(filters);
        const row = await get(`SELECT COUNT(*) AS n FROM olt_events ${whereSql}`, params);
        return (row && row.n) || 0;
    }

    async function getStats(filters = {}) {
        await ensureSchema();
        const { whereSql, params } = buildFilter(filters);
        const byType = await all(
            `SELECT event_type, COUNT(*) AS count FROM olt_events ${whereSql} GROUP BY event_type`,
            params
        );
        const totals = await get(
            `SELECT COUNT(*) AS total, COUNT(DISTINCT mac) AS distinct_onu, COUNT(DISTINCT customer_name) AS distinct_customer FROM olt_events ${whereSql}`,
            params
        );
        return {
            total: (totals && totals.total) || 0,
            distinct_onu: (totals && totals.distinct_onu) || 0,
            distinct_customer: (totals && totals.distinct_customer) || 0,
            by_type: byType,
        };
    }

    async function pruneOld(retentionDays = 90) {
        try {
            await ensureSchema();
            const days = Number.isFinite(retentionDays) && retentionDays > 0 ? retentionDays : 90;
            const cutoff = now() - days * 24 * 60 * 60 * 1000;
            const res = await run("DELETE FROM olt_events WHERE ts_ms < ?", [cutoff]);
            if (res.changes > 0) console.log(`[OLT_EVENT_LOG] Prune ${res.changes} event > ${days} hari.`);
            return res.changes;
        } catch (err) {
            console.warn(`[OLT_EVENT_LOG] prune gagal: ${err.message}`);
            return 0;
        }
    }

    function close() {
        return new Promise((resolve, reject) => {
            db.close((err) => { if (err) { reject(err); return; } resolve(); });
        });
    }

    return { deps, ensureSchema, recordEvent, listEvents, countEvents, getStats, pruneOld, close };
}

let singleton = null;
function getOltEventRepository() {
    if (!singleton) singleton = createOltEventRepository();
    return singleton;
}

module.exports = {
    createOltEventRepository,
    getOltEventRepository,
    VALID_TYPES,
};
