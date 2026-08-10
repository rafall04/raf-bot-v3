"use strict";

/**
 * Header Doc
 * Purpose: Penyimpanan PEKERJAAN otorisasi massal — header pekerjaan + satu baris per pelanggan
 *   berisi hasil dan alasannya. Tujuannya dua: operator tak perlu menunggu di depan spinner, dan
 *   kegagalan per pelanggan menjadi LOG yang bisa dibaca, bukan pesan yang lewat lalu hilang.
 *
 *   Domain SQLite sendiri (`approval_jobs.sqlite`) mengikuti aturan repo: satu domain satu berkas.
 *   Nama pelanggan sengaja DIDUPLIKASI ke baris item supaya log tetap terbaca walau datanya
 *   berubah atau pelanggannya dihapus belakangan.
 * Caller: `services/bulk-approval-job.service.js`, `routes/requests.js` (baca log).
 * Deps: `sqlite3`, `lib/env-config` (getDatabasePath), `lib/sqlite-pragmas`.
 * MainFuncs: `createJob`, `claimNextJob`, `nextPendingItem`, `markItemProcessing`, `finishItem`,
 *   `finishJob`, `getJob`, `getJobItems`, `getActiveJob`, `markInterruptedItems`, `pruneOldJobs`.
 * SideEffects: Menulis `database/approval_jobs.sqlite`.
 */

const sqlite3 = require("sqlite3");
const path = require("path");

let _db = null;
let _siap = null;
let _pathOverride = null;

function dbPath() {
    if (_pathOverride) return _pathOverride;
    try {
        return require("../lib/env-config").getDatabasePath("approval_jobs.sqlite");
    } catch (_e) {
        return path.join(__dirname, "..", "database", "approval_jobs.sqlite");
    }
}

function getDb() {
    if (_db) return _db;
    _db = new sqlite3.Database(dbPath());
    try {
        require("../lib/sqlite-pragmas").applySqlitePragmas(_db);
    } catch (_e) {
        /* best-effort */
    }
    return _db;
}

function run(sql, params = []) {
    return new Promise((resolve, reject) =>
        getDb().run(sql, params, function onRun(e) {
            if (e) reject(e);
            else resolve({ lastID: this.lastID, changes: this.changes });
        })
    );
}
function all(sql, params = []) {
    return new Promise((resolve, reject) => getDb().all(sql, params, (e, r) => (e ? reject(e) : resolve(r || []))));
}
function get(sql, params = []) {
    return new Promise((resolve, reject) => getDb().get(sql, params, (e, r) => (e ? reject(e) : resolve(r || null))));
}

function ensureTable() {
    if (!_siap) {
        _siap = (async () => {
            await run(`
                CREATE TABLE IF NOT EXISTS approval_jobs (
                    id TEXT PRIMARY KEY,
                    status TEXT NOT NULL,
                    actor_username TEXT,
                    total_items INTEGER NOT NULL DEFAULT 0,
                    done_count INTEGER NOT NULL DEFAULT 0,
                    ok_count INTEGER NOT NULL DEFAULT 0,
                    failed_count INTEGER NOT NULL DEFAULT 0,
                    skipped_count INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    started_at TEXT,
                    finished_at TEXT,
                    heartbeat_at TEXT
                )
            `);
            await run(`
                CREATE TABLE IF NOT EXISTS approval_job_items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_id TEXT NOT NULL,
                    request_id TEXT NOT NULL,
                    user_name TEXT,
                    status TEXT NOT NULL,
                    message TEXT,
                    started_at TEXT,
                    finished_at TEXT,
                    UNIQUE(job_id, request_id)
                )
            `);
            await run("CREATE INDEX IF NOT EXISTS idx_approval_items_job ON approval_job_items(job_id, status)");
            await run("CREATE INDEX IF NOT EXISTS idx_approval_jobs_status ON approval_jobs(status, created_at)");
        })().catch((e) => {
            _siap = null;
            throw e;
        });
    }
    return _siap;
}

/** Pekerjaan yang masih hidup — dipakai mencegah dua pekerjaan berjalan bersamaan. */
async function getActiveJob() {
    await ensureTable();
    return get("SELECT * FROM approval_jobs WHERE status IN ('queued','running') ORDER BY created_at ASC LIMIT 1");
}

async function createJob({ id, actorUsername, items }) {
    await ensureTable();
    const now = new Date().toISOString();
    await run(
        `INSERT INTO approval_jobs (id, status, actor_username, total_items, created_at)
         VALUES (?, 'queued', ?, ?, ?)`,
        [id, String(actorUsername || "admin"), items.length, now]
    );
    for (const item of items) {
        await run(
            `INSERT OR IGNORE INTO approval_job_items (job_id, request_id, user_name, status)
             VALUES (?, ?, ?, ?)`,
            [id, String(item.requestId), item.userName || null, item.status || "pending"]
        );
    }
    // Item yang sejak awal sudah tak layak (mis. status bukan pending) langsung dihitung
    // sebagai dilewati — kalau tidak, kemajuannya tak pernah mencapai 100%.
    const awalDilewati = items.filter((i) => i.status && i.status !== "pending").length;
    if (awalDilewati > 0) {
        await run("UPDATE approval_jobs SET done_count = done_count + ?, skipped_count = skipped_count + ? WHERE id = ?", [awalDilewati, awalDilewati, id]);
    }
    return getJob(id);
}

async function claimNextJob() {
    await ensureTable();
    const job = await get("SELECT * FROM approval_jobs WHERE status IN ('queued','running') ORDER BY created_at ASC LIMIT 1");
    if (!job) return null;
    if (job.status === "queued") {
        const now = new Date().toISOString();
        await run("UPDATE approval_jobs SET status = 'running', started_at = COALESCE(started_at, ?), heartbeat_at = ? WHERE id = ?", [now, now, job.id]);
        return getJob(job.id);
    }
    return job;
}

async function nextPendingItem(jobId) {
    await ensureTable();
    return get("SELECT * FROM approval_job_items WHERE job_id = ? AND status = 'pending' ORDER BY id ASC LIMIT 1", [jobId]);
}

async function markItemProcessing(itemId) {
    await ensureTable();
    await run("UPDATE approval_job_items SET status = 'processing', started_at = ? WHERE id = ?", [new Date().toISOString(), itemId]);
}

async function finishItem({ jobId, itemId, status, message }) {
    await ensureTable();
    await run("UPDATE approval_job_items SET status = ?, message = ?, finished_at = ? WHERE id = ?", [status, String(message || ""), new Date().toISOString(), itemId]);
    const kolom = status === "ok" ? "ok_count" : status === "failed" ? "failed_count" : "skipped_count";
    await run(`UPDATE approval_jobs SET done_count = done_count + 1, ${kolom} = ${kolom} + 1, heartbeat_at = ? WHERE id = ?`, [new Date().toISOString(), jobId]);
}

async function finishJob(jobId, status = "done") {
    await ensureTable();
    await run("UPDATE approval_jobs SET status = ?, finished_at = ? WHERE id = ?", [status, new Date().toISOString(), jobId]);
}

/**
 * Menandai item yang tertinggal berstatus `processing` — proses mati saat item itu sedang
 * dikerjakan.
 *
 * SENGAJA TIDAK diulang otomatis. Item yang terputus di tengah bisa saja SUDAH mencatat uang
 * tapi belum sempat menandai requestnya selesai; mengulangnya otomatis berarti mempertaruhkan
 * pencatatan ganda. Lebih baik satu baris merah yang meminta manusia memeriksa daripada uang
 * yang diam-diam terhitung dua kali.
 */
async function markInterruptedItems() {
    await ensureTable();
    const rows = await all("SELECT * FROM approval_job_items WHERE status = 'processing'");
    for (const row of rows) {
        await finishItem({
            jobId: row.job_id,
            itemId: row.id,
            status: "failed",
            message: "TERPUTUS saat diproses (bot restart). Periksa manual status pembayaran pelanggan ini sebelum menyetujui ulang."
        });
    }
    return rows.length;
}

async function getJob(jobId) {
    await ensureTable();
    return get("SELECT * FROM approval_jobs WHERE id = ?", [jobId]);
}

async function getLatestJob() {
    await ensureTable();
    return get("SELECT * FROM approval_jobs ORDER BY created_at DESC LIMIT 1");
}

async function getJobItems(jobId, { limit = 300 } = {}) {
    await ensureTable();
    return all(
        `SELECT request_id, user_name, status, message, finished_at
           FROM approval_job_items
          WHERE job_id = ?
          ORDER BY CASE status WHEN 'failed' THEN 0 WHEN 'processing' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END, id ASC
          LIMIT ?`,
        [jobId, Number(limit) || 300]
    );
}

async function pruneOldJobs(maxAgeMs = 90 * 24 * 60 * 60 * 1000) {
    await ensureTable();
    const batas = new Date(Date.now() - maxAgeMs).toISOString();
    const lama = await all("SELECT id FROM approval_jobs WHERE finished_at IS NOT NULL AND finished_at < ?", [batas]);
    for (const j of lama) {
        await run("DELETE FROM approval_job_items WHERE job_id = ?", [j.id]);
        await run("DELETE FROM approval_jobs WHERE id = ?", [j.id]);
    }
    return lama.length;
}

function setDbPathForTest(p) {
    _db = null;
    _siap = null;
    _pathOverride = p;
}

module.exports = {
    ensureTable,
    createJob,
    claimNextJob,
    nextPendingItem,
    markItemProcessing,
    finishItem,
    finishJob,
    markInterruptedItems,
    getJob,
    getLatestJob,
    getJobItems,
    getActiveJob,
    pruneOldJobs,
    setDbPathForTest
};
