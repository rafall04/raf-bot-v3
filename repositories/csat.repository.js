/**
 * Header Doc
 * Purpose: Persistensi survei kepuasan pelanggan (CSAT) — `database/csat.sqlite`. Menyimpan
 *   siklus survei bulanan per pelanggan (satu baris = satu pelanggan × satu periode 'YYYY-MM')
 *   beserta skor 1–5, komentar bebas, sentimen, dan status daur hidup. Menjadi sumber tunggal
 *   untuk penangkapan balasan yang DURABLE (tahan restart 7–13×/hari — [[reboot-followup-gap]])
 *   dan untuk rekap bulanan ke owner. Satu domain = satu file SQLite (invariant DB Paths).
 * Caller: lib/csat/csat-survey-service.js (tangkap balasan + rekap), lib/cron/jobs/rating-survey.js
 *   (kirim survei + digest).
 * Deps: `sqlite3` (lazy/inject), `../lib/env-config` (getDatabasePath -> csat_test.sqlite saat test).
 * MainFuncs: createCsatRepository -> upsertPending, markStatusByJidBatch, markSent, markUndelivered,
 *   getActiveByUserId, hasSurveyForPeriod, recordRating, recordComment, setOptout, finalizeExpired,
 *   getReport, listComments, listNonResponders, listDetractors, close.
 * SideEffects: Membuat/menulis csat.sqlite (1 tabel: csat_surveys).
 */
"use strict";

function pad2(v) { return String(v).padStart(2, "0"); }

function defaultNowIso() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function defaultDeps() {
    return {
        sqlite3: null,
        dbPath: null,
        now: defaultNowIso, // injectable untuk test deterministik
    };
}

function createCsatRepository(overrides = {}) {
    const deps = { ...defaultDeps(), ...overrides };
    const sqlite3 = deps.sqlite3 || require("sqlite3");
    const dbPath = deps.dbPath || require("../lib/env-config").getDatabasePath("csat.sqlite");
    const now = typeof deps.now === "function" ? deps.now : defaultNowIso;

    let dbPromise = null;

    function run(db, sql, params = []) {
        return new Promise((resolve, reject) => {
            db.run(sql, params, function onRun(err) { if (err) reject(err); else resolve({ lastID: this.lastID, changes: this.changes }); });
        });
    }
    function get(db, sql, params = []) {
        return new Promise((resolve, reject) => { db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null))); });
    }
    function all(db, sql, params = []) {
        return new Promise((resolve, reject) => { db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(Array.isArray(rows) ? rows : []))); });
    }

    async function ensureSchema(db) {
        await run(db, "PRAGMA journal_mode=WAL");
        await run(db, "PRAGMA busy_timeout=8000");
        await run(db, `CREATE TABLE IF NOT EXISTS csat_surveys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            canonical_jid TEXT,
            phone TEXT,
            name TEXT,
            package TEXT,
            period TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            score INTEGER,
            sentiment TEXT,
            comment TEXT,
            sent_at TEXT,
            expires_at TEXT,
            rated_at TEXT,
            commented_at TEXT,
            reminded_at TEXT,
            created_at TEXT,
            updated_at TEXT,
            UNIQUE(user_id, period))`);
        await run(db, "CREATE INDEX IF NOT EXISTS idx_csat_active ON csat_surveys(user_id, status)");
        await run(db, "CREATE INDEX IF NOT EXISTS idx_csat_period ON csat_surveys(period)");
        // Opt-out survei PERMANEN (pelanggan balas STOP). HANYA survei — tagihan/isolir tak tersentuh.
        await run(db, `CREATE TABLE IF NOT EXISTS csat_optout (
            user_id TEXT PRIMARY KEY,
            canonical_jid TEXT,
            reason TEXT,
            opted_out_at TEXT)`);
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
         * Buat baris survei 'pending' untuk 1 pelanggan × periode (idempoten via UNIQUE(user_id,period)).
         * @returns {Promise<{id:number|null, created:boolean}>}
         */
        async upsertPending({ user_id, canonical_jid = null, phone = null, name = null, pkg = null, period }) {
            const db = await getDb();
            const ts = now();
            const res = await run(db,
                `INSERT OR IGNORE INTO csat_surveys
                 (user_id, canonical_jid, phone, name, package, period, status, created_at, updated_at)
                 VALUES (?,?,?,?,?,?, 'pending', ?, ?)`,
                [String(user_id), canonical_jid, phone, name, pkg, period, ts, ts]
            );
            if (res.changes > 0) return { id: res.lastID, created: true };
            const existing = await get(db, "SELECT id FROM csat_surveys WHERE user_id=? AND period=?", [String(user_id), period]);
            return { id: existing ? existing.id : null, created: false };
        },

        /** True bila pelanggan sudah punya baris survei untuk periode ini (apa pun statusnya). */
        async hasSurveyForPeriod(user_id, period) {
            const db = await getDb();
            const row = await get(db, "SELECT 1 AS ada FROM csat_surveys WHERE user_id=? AND period=? LIMIT 1", [String(user_id), period]);
            return Boolean(row);
        },

        /** Tandai TERKIRIM (status 'sent') + set jendela balasan. */
        async markSent(id, { sent_at, expires_at }) {
            const db = await getDb();
            await run(db, "UPDATE csat_surveys SET status='sent', sent_at=?, expires_at=?, updated_at=? WHERE id=? AND status IN ('pending','undelivered')",
                [sent_at, expires_at, now(), id]);
        },

        /** Tandai GAGAL KIRIM (status 'undelivered') supaya tak masuk denominator response-rate. */
        async markUndelivered(id) {
            const db = await getDb();
            await run(db, "UPDATE csat_surveys SET status='undelivered', updated_at=? WHERE id=? AND status='pending'", [now(), id]);
        },

        /**
         * Ambil survei AKTIF (menunggu jawaban) milik user tertentu. Cocok dipakai di jalur inbound.
         * Aktif = status 'sent' (menunggu rating) atau 'rated' (menunggu komentar) & belum kedaluwarsa.
         * @returns {Promise<object|null>}
         */
        async getActiveByUserId(user_id, nowIso) {
            const db = await getDb();
            return get(db,
                `SELECT * FROM csat_surveys
                 WHERE user_id=? AND status IN ('sent','rated') AND (expires_at IS NULL OR expires_at > ?)
                 ORDER BY id DESC LIMIT 1`,
                [String(user_id), nowIso]);
        },

        /** Simpan skor (tahap-1) → status 'rated'. */
        async recordRating(id, { score, sentiment, rated_at }) {
            const db = await getDb();
            await run(db, "UPDATE csat_surveys SET score=?, sentiment=?, rated_at=?, status='rated', updated_at=? WHERE id=?",
                [score, sentiment, rated_at, now(), id]);
        },

        /** Simpan komentar (tahap-2) → status 'done'. */
        async recordComment(id, { comment, commented_at }) {
            const db = await getDb();
            await run(db, "UPDATE csat_surveys SET comment=?, commented_at=?, status='done', updated_at=? WHERE id=?",
                [comment, commented_at, now(), id]);
        },

        /** Tandai selesai tanpa komentar (pelanggan skip / jendela komentar habis). */
        async finalizeDone(id) {
            const db = await getDb();
            await run(db, "UPDATE csat_surveys SET status='done', updated_at=? WHERE id=? AND status='rated'", [now(), id]);
        },

        /** Tandai optout — pelanggan minta berhenti disurvei. */
        async setOptout(id, at) {
            const db = await getDb();
            await run(db, "UPDATE csat_surveys SET status='optout', updated_at=? WHERE id=?", [at || now(), id]);
        },

        /** Pemeliharaan: baris 'sent'/'rated' yang lewat kedaluwarsa → 'done' (non-responder tetap tersimpan). */
        async finalizeExpired(nowIso) {
            const db = await getDb();
            const res = await run(db,
                "UPDATE csat_surveys SET status='done', updated_at=? WHERE status IN ('sent','rated') AND expires_at IS NOT NULL AND expires_at <= ?",
                [now(), nowIso]);
            return res.changes;
        },

        /** Rekap agregat 1 periode. delivered = benar-benar terkirim; responded = punya skor. */
        async getReport(period) {
            const db = await getDb();
            const delivered = await get(db, "SELECT COUNT(*) AS n FROM csat_surveys WHERE period=? AND status IN ('sent','rated','done','optout')", [period]);
            const responded = await get(db, "SELECT COUNT(*) AS n, AVG(score) AS avg FROM csat_surveys WHERE period=? AND score IS NOT NULL", [period]);
            const undelivered = await get(db, "SELECT COUNT(*) AS n FROM csat_surveys WHERE period=? AND status='undelivered'", [period]);
            const optout = await get(db, "SELECT COUNT(*) AS n FROM csat_surveys WHERE period=? AND status='optout'", [period]);
            const distRows = await all(db, "SELECT score, COUNT(*) AS n FROM csat_surveys WHERE period=? AND score IS NOT NULL GROUP BY score", [period]);
            const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
            distRows.forEach((r) => { if (r.score >= 1 && r.score <= 5) distribution[r.score] = r.n; });
            const deliveredN = delivered ? delivered.n : 0;
            const respondedN = responded ? responded.n : 0;
            return {
                period,
                delivered: deliveredN,
                responded: respondedN,
                undelivered: undelivered ? undelivered.n : 0,
                optout: optout ? optout.n : 0,
                avg: responded && responded.avg !== null ? Math.round(responded.avg * 100) / 100 : null,
                distribution,
                responseRate: deliveredN > 0 ? Math.round((respondedN / deliveredN) * 1000) / 10 : 0,
            };
        },

        /** Tren beberapa periode terakhir (untuk selektor periode + grafik ringkas di halaman admin). */
        async getTrend({ limit = 12 } = {}) {
            const db = await getDb();
            const rows = await all(db,
                `SELECT period,
                    SUM(CASE WHEN status IN ('sent','rated','done','optout') THEN 1 ELSE 0 END) AS delivered,
                    SUM(CASE WHEN score IS NOT NULL THEN 1 ELSE 0 END) AS responded,
                    AVG(score) AS avg
                 FROM csat_surveys GROUP BY period ORDER BY period DESC LIMIT ?`,
                [Math.max(1, Math.min(60, parseInt(limit, 10) || 12))]);
            return rows.map((r) => ({
                period: r.period,
                delivered: r.delivered,
                responded: r.responded,
                avg: r.avg !== null ? Math.round(r.avg * 100) / 100 : null,
                responseRate: r.delivered > 0 ? Math.round((r.responded / r.delivered) * 1000) / 10 : 0,
            }));
        },

        /** Daftar komentar (untuk rekap/analisa tema). Terurut skor menaik supaya keluhan di atas. */
        async listComments(period, { limit = 200 } = {}) {
            const db = await getDb();
            return all(db,
                `SELECT name, phone, score, sentiment, comment FROM csat_surveys
                 WHERE period=? AND comment IS NOT NULL AND TRIM(comment) <> ''
                 ORDER BY score ASC, id ASC LIMIT ?`,
                [period, Math.max(1, Math.min(1000, parseInt(limit, 10) || 200))]);
        },

        /** Detractor = skor ≤ 2 (perlu perhatian owner). */
        async listDetractors(period) {
            const db = await getDb();
            return all(db,
                "SELECT name, phone, score, comment FROM csat_surveys WHERE period=? AND score IS NOT NULL AND score <= 2 ORDER BY score ASC, id ASC",
                [period]);
        },

        /** Terkirim tapi belum menjawab (bisa jadi diam-diam tak puas). */
        async listNonResponders(period) {
            const db = await getDb();
            return all(db,
                "SELECT name, phone FROM csat_surveys WHERE period=? AND status IN ('sent','rated','done') AND score IS NULL ORDER BY id ASC",
                [period]);
        },

        // ── Opt-out survei PERMANEN (survey-scoped; tagihan/isolir TAK terpengaruh) ──
        async setSurveyOptout({ user_id, canonical_jid = null, reason = "balas STOP" }) {
            const db = await getDb();
            await run(db,
                `INSERT INTO csat_optout (user_id, canonical_jid, reason, opted_out_at)
                 VALUES (?,?,?,?)
                 ON CONFLICT(user_id) DO UPDATE SET canonical_jid=excluded.canonical_jid, reason=excluded.reason, opted_out_at=excluded.opted_out_at`,
                [String(user_id), canonical_jid, reason, now()]);
        },

        async isSurveyOptedOut(user_id) {
            if (user_id === undefined || user_id === null) return false;
            const db = await getDb();
            const row = await get(db, "SELECT 1 AS ada FROM csat_optout WHERE user_id=? LIMIT 1", [String(user_id)]);
            return Boolean(row);
        },

        async listOptouts() {
            const db = await getDb();
            return all(db, "SELECT user_id, canonical_jid, reason, opted_out_at FROM csat_optout ORDER BY opted_out_at DESC", []);
        },

        async clearOptout(user_id) {
            const db = await getDb();
            const res = await run(db, "DELETE FROM csat_optout WHERE user_id=?", [String(user_id)]);
            return res.changes;
        },

        async close() {
            if (dbPromise) { const db = await dbPromise; await new Promise((r) => db.close(() => r())); dbPromise = null; }
        },
    };
}

module.exports = { createCsatRepository };
