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
            ensureColumn("assigned_by_id", "TEXT"),
            ensureColumn("assigned_by_name", "TEXT"),
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

// Teks notif grup "PSB BARU" — SATU sumber utk WA (#jadwal) & web, biar seragam. record dari createRequest.
function buildScheduleGroupNotif(record, { requestedByName = "-" } = {}) {
    return [
        `📥 *PSB BARU — belum kepasang* · ${record.ref}`,
        `👤 ${record.name} · Dusun ${record.dusun || "-"}`,
        `📦 ${record.paket || "-"} · 📱 ${record.phone_number || "-"}`,
        `📎 Bukti: KTP ✅ · Rumah ✅ · Lokasi ✅`,
        record.catatan ? `📝 ${record.catatan}` : null,
        ``,
        `👉 Belum kepasang — koordinasikan siapa yang pasang. _(klaim/tugaskan otomatis menyusul)_`,
        `Diminta oleh: ${requestedByName}`
    ].filter((x) => x !== null).join("\n");
}

// Link Google Maps dari koordinat (untuk DM teknisi). null bila tak ada lokasi.
function mapsLink(record) {
    if (record.latitude == null || record.longitude == null) return null;
    return `https://maps.google.com/?q=${record.latitude},${record.longitude}`;
}

// Tugaskan / klaim jadwal ke teknisi. mode: "assign" (admin) | "claim" (teknisi ambil sendiri).
// Guard: terpasang/batal ditolak; claim hanya dari `menunggu` (anti-serobot), assign boleh reassign dari `ditugaskan`.
// Return { ok, reason?, record, mode, reassignedFrom }. Idempoten bila teknisi sama.
async function assignSchedule({ scheduleId, teknisiId, teknisiName, assignedById = null, assignedByName = null, mode = "assign", nowIso = null }) {
    await ensureTable();
    if (!teknisiId) return { ok: false, reason: "no_teknisi" };
    const rec = await getScheduleById(scheduleId);
    if (!rec) return { ok: false, reason: "not_found" };
    if (rec.status === STATUS.TERPASANG) return { ok: false, reason: "already_installed", record: rec };
    if (rec.status === STATUS.BATAL) return { ok: false, reason: "cancelled", record: rec };

    const already = rec.assigned_teknisi_id && String(rec.assigned_teknisi_id) === String(teknisiId);
    if (rec.status === STATUS.DITUGASKAN && !already && mode === "claim") {
        // Sudah dipegang teknisi lain — klaim tak boleh menyerobot (admin boleh via tugaskan).
        return { ok: false, reason: "already_assigned", record: rec };
    }
    if (already && rec.status === STATUS.DITUGASKAN) {
        return { ok: true, record: rec, mode, reassignedFrom: null, idempotent: true };
    }

    const now = nowIso || new Date().toISOString();
    const reassignedFrom = rec.assigned_teknisi_id && !already ? { id: rec.assigned_teknisi_id, name: rec.assigned_teknisi_name } : null;
    await run(
        `UPDATE psb_schedule SET status = 'ditugaskan', assigned_teknisi_id = ?, assigned_teknisi_name = ?, assigned_by_id = ?, assigned_by_name = ?, assigned_at = ?, updated_at = ? WHERE id = ?`,
        [String(teknisiId), teknisiName || null, assignedById != null ? String(assignedById) : null, assignedByName || null, now, now, rec.id]
    );
    const updated = await getScheduleById(rec.id);
    return { ok: true, record: updated, mode, reassignedFrom };
}

// DM ke teknisi yang ditugaskan/klaim — detail lengkap + link lokasi. record = row psb_schedule.
function buildAssignmentDm(record, { assignedByName = null, mode = "assign" } = {}) {
    const link = mapsLink(record);
    const lines = [
        `🔧 *TUGAS PASANG PSB* · ${record.ref}`,
        `👤 ${record.name} · Dusun ${record.dusun || "-"}`,
        `📦 ${record.paket || "-"} · 📱 ${record.phone_number || "-"}`,
        link ? `📍 Lokasi: ${link}` : `📍 Lokasi: (koordinat tak tersedia)`,
        record.catatan ? `📝 ${record.catatan}` : null,
        `📎 Foto KTP & rumah tersedia di papan PSB.`,
        ``,
        mode === "claim" ? `✅ Kamu MENGAMBIL tugas ini.` : `✅ Kamu DITUGASKAN${assignedByName ? ` oleh ${assignedByName}` : ""}.`,
        `Setelah terpasang, jalankan *#PSB* untuk aktivasi & tutup jadwal ini.`
    ];
    return lines.filter((x) => x !== null).join("\n");
}

// Announce ke grup saat jadwal di-klaim/ditugaskan. record = row psb_schedule.
function buildAssignmentGroupNotif(record, { mode = "assign", assignedByName = null } = {}) {
    const who = record.assigned_teknisi_name || "teknisi";
    if (mode === "claim") {
        return `🙋 *${who}* mengambil ${record.ref} — ${record.name}, Dusun ${record.dusun || "-"}. Status: *ditugaskan*.`;
    }
    return `📌 ${record.ref} DITUGASKAN ke *${who}* — ${record.name}, Dusun ${record.dusun || "-"}.${assignedByName ? ` _(oleh ${assignedByName})_` : ""}`;
}

// Tandai jadwal TERPASANG (dipanggil saat #PSB provisioning sukses). Idempoten. Return {ok,reason?,record}.
async function markScheduleInstalled(scheduleId, userId, { nowIso = null } = {}) {
    await ensureTable();
    const rec = await getScheduleById(scheduleId);
    if (!rec) return { ok: false, reason: "not_found" };
    if (rec.status === STATUS.TERPASANG) return { ok: true, record: rec, idempotent: true };
    const now = nowIso || new Date().toISOString();
    await run(
        "UPDATE psb_schedule SET status = 'terpasang', installed_user_id = ?, installed_at = ?, updated_at = ? WHERE id = ?",
        [userId != null ? String(userId) : null, now, now, rec.id]
    );
    return { ok: true, record: await getScheduleById(rec.id) };
}

// Normalisasi inti nomor: buang non-digit + prefix negara/0 (62812…/0812…/812… → 812…) agar
// #jadwal & #PSB yang beda format tetap cocok. Kembalikan "" bila terlalu pendek (anti false-match).
function normalizePhoneCore(n) {
    let d = String(n || "").replace(/\D/g, "");
    if (d.startsWith("62")) d = d.slice(2);
    else if (d.startsWith("0")) d = d.slice(1);
    return d.length >= 7 ? d : "";
}
function phoneCoreList(s) { return String(s || "").split("|").map(normalizePhoneCore).filter(Boolean); }

// Cari jadwal TERBUKA (menunggu/ditugaskan) yang cocok dgn install — by nomor HP (inti dinormalisasi,
// tahan beda prefix 0/62), utamakan yang ditugaskan ke teknisi ini. Untuk AUTO-CLOSE saat #PSB selesai.
// Return record atau null (0/ambigu).
async function findOpenScheduleForInstall({ teknisiId = null, phone = null } = {}) {
    await ensureTable();
    const wantNums = phoneCoreList(phone);
    if (!wantNums.length) return null;
    const open = await all("SELECT * FROM psb_schedule WHERE status IN ('menunggu','ditugaskan') ORDER BY datetime(created_at) DESC, id DESC");
    const matches = open.filter((r) => {
        const nums = phoneCoreList(r.phone_number);
        return nums.some((n) => wantNums.includes(n));
    });
    if (matches.length === 0) return null;
    if (matches.length === 1) return matches[0];
    const mine = teknisiId != null ? matches.filter((r) => String(r.assigned_teknisi_id) === String(teknisiId)) : [];
    return mine.length === 1 ? mine[0] : null; // masih ambigu → jangan tebak (biar jadi walk-in)
}

// Catat install "walk-in" (tanpa jadwal sebelumnya) sebagai record TERPASANG → getScheduleSummary
// menghitung SEMUA install (terjadwal + langsung), bukan cuma yang lewat papan. Best-effort.
async function recordWalkInInstall({ nama, hp, dusun, paket, installedUserId = null, area = null, nowIso = null }) {
    await ensureTable();
    const now = nowIso || new Date().toISOString();
    const res = await run(
        `INSERT INTO psb_schedule (name, phone_number, dusun, paket, status, area, installed_user_id, created_at, assigned_at, installed_at, updated_at)
         VALUES (?, ?, ?, ?, 'terpasang', ?, ?, ?, ?, ?, ?)`,
        [nama, hp || null, dusun || null, paket || null, area, installedUserId != null ? String(installedUserId) : null, now, now, now, now]
    );
    const id = res.lastID;
    await run("UPDATE psb_schedule SET ref = ? WHERE id = ?", [`PSB-${id}`, id]);
    return { id, ref: `PSB-${id}` };
}

function setDbPathForTest(p) { _db = null; _initPromise = null; _dbPathOverride = p; }

module.exports = {
    STATUS,
    ensureTable,
    createRequest,
    getScheduleById,
    listSchedules,
    getScheduleSummary,
    buildScheduleGroupNotif,
    assignSchedule,
    buildAssignmentDm,
    buildAssignmentGroupNotif,
    mapsLink,
    markScheduleInstalled,
    findOpenScheduleForInstall,
    recordWalkInInstall,
    setDbPathForTest
};
