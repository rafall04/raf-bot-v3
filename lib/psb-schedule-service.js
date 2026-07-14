/**
 * Header Doc
 * Purpose: Papan PSB terjadwal — lifecycle menunggu → ditugaskan → terpasang (+ batal). Sumber tunggal
 *          "belum kepasang" & "terpasang bulan ini". Tabel sendiri `psb_schedule` (TIDAK menyentuh
 *          psb_records legacy web, anti-breaking). Fase A: create (request) + list + summary.
 *          MARKETING (Fase 1 komisi PSB): tiap install boleh punya "pemberi lead" (peran KE-3, beda dari
 *          pendaftar `requested_by` & pemasang `assigned_teknisi`) + nominal komisi manual. type
 *          teknisi|luar|none; teknisi→payroll & luar→kas dibayar di Fase 2 (di sini HANYA catat & rangkum,
 *          belum ada uang bergerak). Komisi "diakui" saat terpasang; status pending→paid (paid = Fase 2).
 * Caller: `message/handlers/state-domains/psb-schedule.state.js` (WA #jadwal) + `routes/psb-schedule-routes.js` (web) + wizard #PSB.
 * Deps: `sqlite3`, `path`, lazy `./env-config` (getDatabasePath), `./sqlite-pragmas`.
 * MainFuncs: `ensureTable`, `createRequest`, `listSchedules`, `getScheduleById`, `getScheduleSummary`, `setMarketing`, `payMarketingExternal`, `STATUS`.
 * Note Fase 2a: `payMarketingExternal` bayar komisi LUAR via KAS (createExpense DI-INJECT) — luar→kas; teknisi→payroll Fase 2b.
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
            // Marketing / komisi PSB (Fase 1): pemberi lead (peran ke-3) + nominal manual + status bayar.
            ensureColumn("marketing_type", "TEXT"),        // teknisi | luar | none | NULL(belum diklasifikasi)
            ensureColumn("marketing_ref_id", "TEXT"),      // id akun teknisi (hanya bila type=teknisi)
            ensureColumn("marketing_ref_name", "TEXT"),    // nama teknisi / makelar (bebas)
            ensureColumn("marketing_ref_phone", "TEXT"),   // HP makelar (kontak bayar; type=luar)
            ensureColumn("marketing_fee", "INTEGER"),      // nominal komisi (rupiah); NULL/0 = tak ada
            ensureColumn("marketing_status", "TEXT"),      // NULL(tak ada) | pending(terutang) | paid(kas—Fase 2a) | settled(payroll—Fase 2b)
            ensureColumn("marketing_paid_at", "TEXT"),     // diisi saat dibayar/di-settle (Fase 2)
            ensureColumn("marketing_expense_id", "TEXT"),  // id expense_entries saat luar dibayar kas (Fase 2a)
            ensureColumn("marketing_payroll_id", "TEXT")   // id technician_gaji saat teknisi di-settle ke payroll (Fase 2b)
        // Index DIBUAT SETELAH kolom ada — idx marketing_status merujuk kolom hasil ALTER di atas; kalau
        // digabung ke Promise.all yang sama, CREATE INDEX bisa jalan sebelum ALTER (race) → no such column.
        ])).then(() => Promise.all([
            run("CREATE INDEX IF NOT EXISTS idx_psb_schedule_status ON psb_schedule(status)"),
            run("CREATE INDEX IF NOT EXISTS idx_psb_schedule_teknisi ON psb_schedule(assigned_teknisi_id)"),
            run("CREATE INDEX IF NOT EXISTS idx_psb_schedule_mkt_status ON psb_schedule(marketing_status)")
        ])).catch((e) => { _initPromise = null; throw e; });
    }
    return _initPromise;
}

// Normalisasi payload marketing → { type, refId, refName, refPhone, fee } bersih. type hanya
// teknisi|luar|none (selain itu NULL = belum diklasifikasi, mis. nama bebas dari #jadwal). fee ≥ 0 integer.
function normalizeMarketing(m = {}) {
    const rawType = String(m.type || "").toLowerCase().trim();
    const type = ["teknisi", "luar", "none"].includes(rawType) ? rawType : null;
    const feeInt = parseInt(m.fee, 10);
    const fee = Number.isFinite(feeInt) && feeInt > 0 ? feeInt : 0;
    const trim = (v) => (v != null && String(v).trim() ? String(v).trim() : null);
    return { type, fee, refId: trim(m.refId), refName: trim(m.refName), refPhone: trim(m.refPhone) };
}

// Ada isi marketing yang layak disimpan? (dipakai createRequest — jangan menimpa dgn null bila kosong)
function hasMarketingPayload(m) {
    if (!m) return false;
    const n = normalizeMarketing(m);
    return !!(n.type || n.refName || n.refPhone || n.fee);
}

// Buat request PSB baru (status menunggu). Return record ringkas + ref `PSB-<id>`.
// `marketing` OPSIONAL (pemberi lead dari #jadwal/web) → disimpan lewat setMarketing (satu jalur tulis).
async function createRequest({ nama, hp, dusun, paket, latitude = null, longitude = null, catatan = "", ktpPhotoPath = null, housePhotoPath = null, requestedById = null, requestedByName = null, area = null, marketing = null, nowIso = null }) {
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
    if (hasMarketingPayload(marketing)) {
        try { await setMarketing(id, marketing); } catch (_e) { /* marketing opsional — jangan gagalkan daftar */ }
    }
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

    // Komisi marketing bulan ini (dari install terpasang bln ini) + total komisi yang masih terutang (pending).
    const komisiMonthRows = await all(
        `SELECT COALESCE(marketing_type, 'lainnya') t, COUNT(*) c, COALESCE(SUM(marketing_fee), 0) amt
         FROM psb_schedule
         WHERE status = 'terpasang' AND COALESCE(marketing_fee, 0) > 0
           AND substr(COALESCE(installed_at, updated_at, created_at), 1, 7) = ?${area ? " AND area = ?" : ""}
         GROUP BY COALESCE(marketing_type, 'lainnya')`,
        area ? [monthPrefix, area] : [monthPrefix]
    );
    let komisiBulanIni = 0; let komisiTeknisi = 0; let komisiLuar = 0; let komisiCount = 0;
    komisiMonthRows.forEach((r) => {
        komisiBulanIni += r.amt || 0;
        komisiCount += r.c || 0;
        if (r.t === "teknisi") komisiTeknisi += r.amt || 0;
        else komisiLuar += r.amt || 0; // luar + belum-diklasifikasi dianggap non-payroll (kas)
    });
    const pendingRow = await get(
        `SELECT COUNT(*) c, COALESCE(SUM(marketing_fee), 0) amt FROM psb_schedule WHERE marketing_status = 'pending'${area ? " AND area = ?" : ""}`,
        area ? [area] : []
    );

    return {
        menunggu,
        ditugaskan,
        belum_kepasang: menunggu + ditugaskan,
        terpasang_total: byStatus[STATUS.TERPASANG] || 0,
        terpasang_bulan_ini: (monthRow && monthRow.c) || 0,
        komisi_bulan_ini: komisiBulanIni,
        komisi_teknisi_bulan_ini: komisiTeknisi,
        komisi_luar_bulan_ini: komisiLuar,
        komisi_count_bulan_ini: komisiCount,
        komisi_pending_total: (pendingRow && pendingRow.amt) || 0,
        komisi_pending_count: (pendingRow && pendingRow.c) || 0
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

// Set/koreksi pemberi lead (marketing) + nominal komisi pada sebuah jadwal. Sumber tulis TUNGGAL utk
// marketing (dipakai createRequest #jadwal/web + endpoint koreksi web). Guard: batal ditolak; row yang
// komisinya SUDAH `paid` (Fase 2) dikunci (tak boleh diubah). Fee>0 → status `pending`; fee 0 → status
// dibersihkan (NULL). type=none/teknisi membersihkan field yang tak relevan. Return {ok,reason?,record}.
async function setMarketing(scheduleId, marketing = {}) {
    await ensureTable();
    const rec = await getScheduleById(scheduleId);
    if (!rec) return { ok: false, reason: "not_found" };
    if (rec.status === STATUS.BATAL) return { ok: false, reason: "cancelled", record: rec };
    // Komisi yang sudah dibayar (kas) / di-settle (payroll) DIKUNCI — jangan ubah pemberi lead/nominal.
    if (rec.marketing_status === "paid" || rec.marketing_status === "settled") return { ok: false, reason: "already_paid", record: rec };

    const n = normalizeMarketing(marketing);
    let { type, fee, refId, refName, refPhone } = n;
    if (type === "none") { refId = null; refName = null; refPhone = null; fee = 0; }
    if (type !== "teknisi") refId = null;            // refId hanya bermakna utk teknisi (akun)
    const status = fee > 0 ? "pending" : null;        // fee 0 / tak ada → tak ada tagihan komisi
    const now = new Date().toISOString();
    await run(
        `UPDATE psb_schedule SET marketing_type = ?, marketing_ref_id = ?, marketing_ref_name = ?, marketing_ref_phone = ?, marketing_fee = ?, marketing_status = ?, updated_at = ? WHERE id = ?`,
        [type, refId, refName, refPhone, fee > 0 ? fee : null, status, now, rec.id]
    );
    return { ok: true, record: await getScheduleById(rec.id) };
}

// Bayar komisi pemberi lead LUAR (makelar) lewat KAS → catat pengeluaran (expense-manager) + kunci row.
// Fase 2a. `createExpense` DI-INJECT oleh pemanggil (route pass require('./expense-manager').createExpense;
// test pass fake) — biar service ini tak hard-depend expense-manager (anti circular + testable tanpa global.db).
// ANTI DOUBLE-EXPENSE: rebut status pending→paid dulu (optimistic lock, WHERE marketing_status='pending');
// hanya pemenang yang bikin expense. Bila createExpense gagal → rollback status ke pending (jangan tinggalkan
// 'paid' tanpa bukti pengeluaran). Idempoten: panggil ulang pada row 'paid' → already_paid (tak dobel).
async function payMarketingExternal(scheduleId, { actor = {}, paymentMethod = "CASH", createExpense = null } = {}) {
    await ensureTable();
    const rec = await getScheduleById(scheduleId);
    if (!rec) return { ok: false, reason: "not_found" };
    if (rec.status === STATUS.BATAL) return { ok: false, reason: "cancelled", record: rec };
    if (rec.marketing_type !== "luar") return { ok: false, reason: "not_external", record: rec };
    if (rec.marketing_status === "paid") return { ok: false, reason: "already_paid", record: rec };
    const fee = parseInt(rec.marketing_fee, 10);
    // Cek fee SEBELUM status: luar fee 0 punya status NULL (bukan pending) → beri "no_fee" yang lebih jelas.
    if (!(Number.isFinite(fee) && fee > 0)) return { ok: false, reason: "no_fee", record: rec };
    if (rec.marketing_status !== "pending") return { ok: false, reason: "no_pending", record: rec };
    if (typeof createExpense !== "function") return { ok: false, reason: "no_expense_fn", record: rec };

    const now = new Date().toISOString();
    const lock = await run("UPDATE psb_schedule SET marketing_status = 'paid', marketing_paid_at = ?, updated_at = ? WHERE id = ? AND marketing_status = 'pending'", [now, now, rec.id]);
    if (!lock.changes) return { ok: false, reason: "race", record: await getScheduleById(rec.id) }; // sudah direbut proses lain

    let expenseId = null;
    try {
        const exp = await createExpense({
            title: `Komisi marketing PSB — ${rec.marketing_ref_name || "makelar"} (${rec.ref})`,
            category: "marketing",
            amount: fee,
            payment_method: paymentMethod,
            vendor_or_counterparty: [rec.marketing_ref_name, rec.marketing_ref_phone].filter(Boolean).join(" · ") || null,
            notes: `Pemberi lead PSB ${rec.ref}${rec.name ? ` — ${rec.name}` : ""}`,
            expense_date: now
        }, actor);
        expenseId = exp && (exp.id != null) ? String(exp.id) : null;
        await run("UPDATE psb_schedule SET marketing_expense_id = ?, updated_at = ? WHERE id = ?", [expenseId, now, rec.id]);
    } catch (e) {
        // Rollback: kembalikan ke pending supaya bisa diulang (hanya bila belum tertaut expense).
        await run("UPDATE psb_schedule SET marketing_status = 'pending', marketing_paid_at = NULL, updated_at = ? WHERE id = ? AND marketing_status = 'paid' AND marketing_expense_id IS NULL", [now, rec.id]);
        return { ok: false, reason: "expense_failed", error: e.message, record: await getScheduleById(rec.id) };
    }
    return { ok: true, expenseId, record: await getScheduleById(rec.id) };
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
    setMarketing,
    normalizeMarketing,
    payMarketingExternal,
    setDbPathForTest
};
