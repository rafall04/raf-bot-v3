/**
 * Header Doc
 * Purpose: Papan PSB terjadwal — lifecycle menunggu → ditugaskan → terpasang (+ batal). Sumber tunggal
 *          "belum kepasang" & "terpasang bulan ini". Tabel sendiri `psb_schedule` (TIDAK menyentuh
 *          psb_records legacy web, anti-breaking). Fase A: create (request) + list + summary.
 * Caller: `message/handlers/state-domains/psb-schedule.state.js` (WA #jadwal), nanti route web + wizard #PSB.
 * Deps: `sqlite3`, `path`, lazy `./env-config` (getDatabasePath), `./sqlite-pragmas`.
 * MainFuncs: `ensureTable`, `createRequest`, `listSchedules`, `getScheduleById`, `getScheduleSummary`, `STATUS`.
 * SideEffects: Tulis `database/psb_schedule.sqlite` (test: `_schedule_test`). setDbPathForTest override (bukan env).
 */
"use strict";

const sqlite3 = require("sqlite3");
const path = require("path");

const STATUS = { MENUNGGU: "menunggu", DITUGASKAN: "ditugaskan", TERPASANG: "terpasang", BATAL: "batal" };

let _db = null;
let _dbPathOverride = null;
let _initPromise = null;

function dbPath() {
    if (_dbPathOverride) return _dbPathOverride;
    try {
        return require("./env-config").getDatabasePath("psb_schedule.sqlite");
    } catch (_e) {
        return path.join(__dirname, "..", "database", "psb_schedule.sqlite");
    }
}

function getDb() {
    if (_db) return _db;
    _db = new sqlite3.Database(dbPath());
    try { require("./sqlite-pragmas").applySqlitePragmas(_db); } catch (_e) { /* best-effort */ }
    return _db;
}

function run(sql, params = []) {
    return new Promise((resolve, reject) => getDb().run(sql, params, function onRun(e) { e ? reject(e) : resolve({ lastID: this.lastID, changes: this.changes }); }));
}
function all(sql, params = []) {
    return new Promise((resolve, reject) => getDb().all(sql, params, (e, r) => (e ? reject(e) : resolve(r || []))));
}
function get(sql, params = []) {
    return new Promise((resolve, reject) => getDb().get(sql, params, (e, r) => (e ? reject(e) : resolve(r || null))));
}

// Tambah kolom bila belum ada (idempoten — utk tabel prod yang sudah dibuat Fase A/1).
async function ensureColumn(column, def) {
    const cols = await all("PRAGMA table_info(psb_schedule)");
    if (!cols.some((c) => c.name === column)) {
        await run(`ALTER TABLE psb_schedule ADD COLUMN ${column} ${def}`);
    }
}

function ensureTable() {
    if (!_initPromise) {
        _initPromise = run(`
            CREATE TABLE IF NOT EXISTS psb_schedule (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ref TEXT,
                name TEXT NOT NULL,
                phone_number TEXT,
                dusun TEXT,
                paket TEXT,
                latitude REAL,
                longitude REAL,
                catatan TEXT,
                status TEXT NOT NULL DEFAULT 'menunggu',
                area TEXT,
                ktp_photo_path TEXT,
                house_photo_path TEXT,
                requested_by_id TEXT,
                requested_by_name TEXT,
                assigned_teknisi_id TEXT,
                assigned_teknisi_name TEXT,
                installed_user_id TEXT,
                created_at TEXT,
                assigned_at TEXT,
                installed_at TEXT,
                updated_at TEXT
            )
        `).then(() => Promise.all([
            ensureColumn("ktp_photo_path", "TEXT"),
            ensureColumn("house_photo_path", "TEXT"),
            run("CREATE INDEX IF NOT EXISTS idx_psb_schedule_status ON psb_schedule(status)"),
            run("CREATE INDEX IF NOT EXISTS idx_psb_schedule_teknisi ON psb_schedule(assigned_teknisi_id)")
        ])).catch((e) => { _initPromise = null; throw e; });
    }
    return _initPromise;
}

// Buat request PSB baru (status menunggu). Return record ringkas + ref `PSB-<id>`.
async function createRequest({ nama, hp, dusun, paket, latitude = null, longitude = null, catatan = "", ktpPhotoPath = null, housePhotoPath = null, requestedById = null, requestedByName = null, area = null, nowIso = null }) {
    await ensureTable();
    const now = nowIso || new Date().toISOString();
    const res = await run(
        `INSERT INTO psb_schedule (name, phone_number, dusun, paket, latitude, longitude, catatan, ktp_photo_path, house_photo_path, status, area, requested_by_id, requested_by_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'menunggu', ?, ?, ?, ?, ?)`,
        [nama, hp || null, dusun || null, paket || null, latitude, longitude, catatan || "", ktpPhotoPath || null, housePhotoPath || null, area, requestedById ? String(requestedById) : null, requestedByName || null, now, now]
    );
    const id = res.lastID;
    const ref = `PSB-${id}`;
    await run("UPDATE psb_schedule SET ref = ? WHERE id = ?", [ref, id]);
    return { id, ref, name: nama, phone_number: hp, dusun, paket, status: STATUS.MENUNGGU, area, catatan, latitude, longitude, ktp_photo_path: ktpPhotoPath, house_photo_path: housePhotoPath };
}

async function getScheduleById(id) {
    await ensureTable();
    return get("SELECT * FROM psb_schedule WHERE id = ?", [parseInt(id, 10)]);
}

async function listSchedules({ status = null, area = null, assignedTeknisiId = null } = {}) {
    await ensureTable();
    const where = [];
    const params = [];
    if (status) { where.push("status = ?"); params.push(status); }
    if (area) { where.push("area = ?"); params.push(area); }
    if (assignedTeknisiId) { where.push("assigned_teknisi_id = ?"); params.push(String(assignedTeknisiId)); }
    return all(`SELECT * FROM psb_schedule ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY datetime(created_at) DESC, id DESC`, params);
}

// Rangkuman papan: belum kepasang (menunggu+ditugaskan) + terpasang bulan ini.
async function getScheduleSummary({ nowMs = Date.now(), area = null } = {}) {
    await ensureTable();
    const d = new Date(nowMs);
    const monthPrefix = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const areaClause = area ? " WHERE area = ?" : "";
    const areaParam = area ? [area] : [];
    const rows = await all(`SELECT status, COUNT(*) c FROM psb_schedule${areaClause} GROUP BY status`, areaParam);
    const byStatus = {};
    rows.forEach((r) => { byStatus[r.status] = r.c; });
    const monthRow = await get(
        `SELECT COUNT(*) c FROM psb_schedule WHERE status = 'terpasang' AND substr(COALESCE(installed_at, updated_at, created_at), 1, 7) = ?${area ? " AND area = ?" : ""}`,
        area ? [monthPrefix, area] : [monthPrefix]
    );
    const menunggu = byStatus[STATUS.MENUNGGU] || 0;
    const ditugaskan = byStatus[STATUS.DITUGASKAN] || 0;
    return {
        menunggu,
        ditugaskan,
        belum_kepasang: menunggu + ditugaskan,
        terpasang_total: byStatus[STATUS.TERPASANG] || 0,
        terpasang_bulan_ini: (monthRow && monthRow.c) || 0
    };
}

function setDbPathForTest(p) { _db = null; _initPromise = null; _dbPathOverride = p; }

module.exports = {
    STATUS,
    ensureTable,
    createRequest,
    getScheduleById,
    listSchedules,
    getScheduleSummary,
    setDbPathForTest
};
