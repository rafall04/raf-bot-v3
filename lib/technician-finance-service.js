/**
 * Header Doc
 * Purpose: Pembukuan gaji teknisi — draft/finalisasi/pembayaran payroll, komisi penarikan
 *          (collection ledger), komisi marketing PSB, kasbon, dan ringkasannya.
 *          Sumber angka gaji; halaman /gaji-teknisi & struk WA hanya menampilkannya.
 * Caller: `routes/gaji.js`, `routes/technician-settlement.js`, `lib/services/payroll-receipt.js`.
 * Deps: `global.db` (sqlite utama), `./technician-collection-settlement`, `./financial-ledger`,
 *       `./psb-schedule-service` (komisi marketing, di-require malas + defensif).
 * MainFuncs: `createPayrollDraft`, `updatePayrollDraft`, `finalizePayroll`, `markPayrollPaid`,
 *            `getCollectionPayableEntries`, `allocateKasbonRepayment`, `getPayrollSummary`.
 * SideEffects: Menulis `technician_gaji` + `technician_collection_ledger`, mengunci baris komisi
 *              ke payroll, dan menyinkronkan buku besar keuangan.
 */
"use strict";

const { ensureSettlementTable } = require("./technician-collection-settlement");
const { syncFinancialLedgerSources } = require("./financial-ledger");

let initializationPromise = null;

async function ensureMainDbReady() {
    if (global.db) {
        return global.db;
    }
    if (global.__dbInitPromise) {
        await global.__dbInitPromise;
    }
    if (!global.db) {
        throw new Error("Database not initialized");
    }
    return global.db;
}

function dbRun(sql, params = []) {
    return ensureMainDbReady().then((db) => new Promise((resolve, reject) => {
        db.run(sql, params, function onRun(err) {
            if (err) {
                reject(err);
                return;
            }
            resolve({ lastID: this.lastID, changes: this.changes });
        });
    }));
}

function dbGet(sql, params = []) {
    return ensureMainDbReady().then((db) => new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(row || null);
        });
    }));
}

function dbAll(sql, params = []) {
    return ensureMainDbReady().then((db) => new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(rows || []);
        });
    }));
}

async function ensureColumn(tableName, columnName, definition) {
    const columns = await dbAll(`PRAGMA table_info(${tableName})`);
    if (!columns.some((column) => column.name === columnName)) {
        await dbRun(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }
}

function toInteger(value, fallback = 0) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function nowIso() {
    return new Date().toISOString();
}

function mapPayrollStatus(status) {
    if (status === "pending") {
        return "draft";
    }
    return status || "draft";
}

function getAccountName(teknisiId) {
    const account = (global.accounts || []).find((item) => String(item.id) === String(teknisiId));
    return account?.name || account?.username || `Teknisi ${teknisiId}`;
}

function buildKasbonEventKey({ kasbonId, direction, reason, payrollId = null }) {
    return [String(kasbonId), direction, reason, payrollId || "none"].join(":");
}

async function insertKasbonLedgerEntry({
    kasbonId,
    teknisiId,
    teknisiName,
    amount,
    direction,
    reason,
    payrollId = null,
    createdBy = "system",
    notes = ""
}) {
    const eventKey = buildKasbonEventKey({ kasbonId, direction, reason, payrollId });
    try {
        const result = await dbRun(
            `INSERT INTO technician_kasbon_ledger (
                kasbon_id, teknisi_id, teknisi_name, amount, direction, reason,
                payroll_id, event_key, created_at, created_by, notes
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                kasbonId,
                String(teknisiId),
                teknisiName || getAccountName(teknisiId),
                amount,
                direction,
                reason,
                payrollId,
                eventKey,
                nowIso(),
                createdBy,
                notes || ""
            ]
        );
        try {
            await syncFinancialLedgerSources({ domains: ['technician_kasbon'] });
        } catch (ledgerSyncError) {
            console.error('[TECHNICIAN_KASBON_LEDGER_SYNC_ERROR]', ledgerSyncError.message);
        }
        return { inserted: true, id: result.lastID, eventKey };
    } catch (error) {
        if (String(error.message || "").includes("UNIQUE")) {
            return { inserted: false, duplicate: true, eventKey };
        }
        throw error;
    }
}

async function ensureFinanceTables() {
    if (!initializationPromise) {
        initializationPromise = (async () => {
            await ensureSettlementTable();

            await dbRun(`
                CREATE TABLE IF NOT EXISTS technician_kasbon (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    teknisi_id INTEGER NOT NULL,
                    teknisi_name TEXT NOT NULL,
                    amount INTEGER NOT NULL,
                    description TEXT,
                    status TEXT,
                    notes TEXT,
                    created_at TEXT,
                    approved_at TEXT,
                    approved_by INTEGER,
                    approved_by_name TEXT,
                    paid_at TEXT,
                    paid_by INTEGER,
                    paid_by_name TEXT,
                    updated_at TEXT
                )
            `);
            await dbRun("CREATE INDEX IF NOT EXISTS idx_technician_kasbon_teknisi ON technician_kasbon(teknisi_id)");
            await dbRun("CREATE INDEX IF NOT EXISTS idx_technician_kasbon_status ON technician_kasbon(status)");

            await dbRun(`
                CREATE TABLE IF NOT EXISTS technician_kasbon_ledger (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    kasbon_id INTEGER NOT NULL,
                    teknisi_id TEXT NOT NULL,
                    teknisi_name TEXT NOT NULL,
                    amount INTEGER NOT NULL,
                    direction TEXT NOT NULL,
                    reason TEXT NOT NULL,
                    payroll_id INTEGER,
                    event_key TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    created_by TEXT NOT NULL,
                    notes TEXT
                )
            `);
            await dbRun("CREATE UNIQUE INDEX IF NOT EXISTS idx_technician_kasbon_ledger_event_key ON technician_kasbon_ledger(event_key)");
            await dbRun("CREATE INDEX IF NOT EXISTS idx_technician_kasbon_ledger_kasbon ON technician_kasbon_ledger(kasbon_id)");
            await dbRun("CREATE INDEX IF NOT EXISTS idx_technician_kasbon_ledger_teknisi ON technician_kasbon_ledger(teknisi_id)");

            await dbRun(`
                CREATE TABLE IF NOT EXISTS technician_gaji (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    teknisi_id INTEGER NOT NULL,
                    teknisi_name TEXT NOT NULL,
                    period_month INTEGER NOT NULL,
                    period_year INTEGER NOT NULL,
                    gaji_pokok INTEGER DEFAULT 0,
                    bonus INTEGER DEFAULT 0,
                    bonus_manual INTEGER DEFAULT 0,
                    komisi_collection INTEGER DEFAULT 0,
                    potongan_kasbon INTEGER DEFAULT 0,
                    potongan_lain INTEGER DEFAULT 0,
                    potongan_lain_keterangan TEXT,
                    gross_amount INTEGER DEFAULT 0,
                    total_potongan INTEGER DEFAULT 0,
                    total_gaji INTEGER DEFAULT 0,
                    net_amount INTEGER DEFAULT 0,
                    status TEXT DEFAULT 'draft',
                    notes TEXT,
                    created_by INTEGER,
                    created_by_name TEXT,
                    created_at TEXT,
                    finalized_at TEXT,
                    finalized_by INTEGER,
                    finalized_by_name TEXT,
                    paid_at TEXT,
                    paid_by INTEGER,
                    paid_by_name TEXT,
                    updated_at TEXT,
                    UNIQUE(teknisi_id, period_month, period_year)
                )
            `);

            await ensureColumn("technician_gaji", "bonus_manual", "INTEGER DEFAULT 0");
            await ensureColumn("technician_gaji", "komisi_collection", "INTEGER DEFAULT 0");
            await ensureColumn("technician_gaji", "komisi_marketing", "INTEGER DEFAULT 0"); // komisi pemberi lead PSB (Fase 2b)
            await ensureColumn("technician_gaji", "gross_amount", "INTEGER DEFAULT 0");
            await ensureColumn("technician_gaji", "total_potongan", "INTEGER DEFAULT 0");
            await ensureColumn("technician_gaji", "net_amount", "INTEGER DEFAULT 0");
            await ensureColumn("technician_gaji", "finalized_at", "TEXT");
            await ensureColumn("technician_gaji", "finalized_by", "INTEGER");
            await ensureColumn("technician_gaji", "finalized_by_name", "TEXT");

            await ensureColumn("technician_collection_ledger", "payroll_id", "INTEGER");
            await ensureColumn("technician_collection_ledger", "payroll_locked_at", "TEXT");

            await dbRun("CREATE INDEX IF NOT EXISTS idx_technician_collection_payroll_id ON technician_collection_ledger(payroll_id)");
        })().catch((error) => {
            initializationPromise = null;
            throw error;
        });
    }
    return initializationPromise;
}

async function getKasbonHeaders({ teknisiId = null, kasbonId = null } = {}) {
    await ensureFinanceTables();
    const where = [];
    const params = [];
    if (teknisiId !== null && teknisiId !== undefined) {
        where.push("teknisi_id = ?");
        params.push(toInteger(teknisiId));
    }
    if (kasbonId !== null && kasbonId !== undefined) {
        where.push("id = ?");
        params.push(toInteger(kasbonId));
    }
    const sql = `
        SELECT *
        FROM technician_kasbon
        ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY datetime(created_at) DESC, id DESC
    `;
    return dbAll(sql, params);
}

async function getKasbonLedgerRows({ teknisiId = null, kasbonId = null } = {}) {
    await ensureFinanceTables();
    const where = [];
    const params = [];
    if (teknisiId !== null && teknisiId !== undefined) {
        where.push("teknisi_id = ?");
        params.push(String(teknisiId));
    }
    if (kasbonId !== null && kasbonId !== undefined) {
        where.push("kasbon_id = ?");
        params.push(toInteger(kasbonId));
    }
    const sql = `
        SELECT *
        FROM technician_kasbon_ledger
        ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY datetime(created_at) ASC, id ASC
    `;
    return dbAll(sql, params);
}

function buildKasbonRows(headers, ledgerRows) {
    const grouped = new Map();
    for (const row of ledgerRows) {
        const key = toInteger(row.kasbon_id);
        if (!grouped.has(key)) {
            grouped.set(key, []);
        }
        grouped.get(key).push(row);
    }

    return headers.map((header) => {
        const entries = grouped.get(toInteger(header.id)) || [];
        let creditAmount = entries
            .filter((entry) => entry.direction === "credit" || entry.direction === "adjustment_credit")
            .reduce((sum, entry) => sum + toInteger(entry.amount), 0);
        let debitAmount = entries
            .filter((entry) => entry.direction === "debit" || entry.direction === "adjustment_debit")
            .reduce((sum, entry) => sum + toInteger(entry.amount), 0);

        if (creditAmount === 0 && ["approved", "paid"].includes(header.status)) {
            creditAmount = toInteger(header.amount);
            if (header.status === "paid" && debitAmount === 0) {
                debitAmount = toInteger(header.amount);
            }
        }

        const remainingAmount = Math.max(0, creditAmount - debitAmount);
        let effectiveStatus = header.status;
        if (header.status === "approved" || header.status === "paid") {
            effectiveStatus = remainingAmount > 0 ? "approved" : "paid";
        }

        return {
            ...header,
            approved_amount: creditAmount,
            paid_amount: debitAmount,
            remaining_amount: remainingAmount,
            repayment_count: entries.filter((entry) => entry.direction === "debit" || entry.direction === "adjustment_debit").length,
            financial_status: effectiveStatus,
            ledger_entries: entries
        };
    });
}

async function getKasbonList({ teknisiId = null, kasbonId = null } = {}) {
    const [headers, ledgerRows] = await Promise.all([
        getKasbonHeaders({ teknisiId, kasbonId }),
        getKasbonLedgerRows({ teknisiId, kasbonId })
    ]);
    return buildKasbonRows(headers, ledgerRows);
}

async function getKasbonById(kasbonId) {
    const rows = await getKasbonList({ kasbonId });
    return rows[0] || null;
}

async function getKasbonLedgerDetail(kasbonId) {
    const [header] = await getKasbonHeaders({ kasbonId });
    if (!header) {
        return null;
    }
    const rows = buildKasbonRows([header], await getKasbonLedgerRows({ kasbonId }));
    return rows[0] || null;
}

async function syncKasbonHeaderStatus(kasbonId) {
    const detail = await getKasbonLedgerDetail(kasbonId);
    if (!detail) {
        return null;
    }
    if (!["approved", "paid"].includes(detail.status)) {
        return detail;
    }
    const nextStatus = detail.remaining_amount > 0 ? "approved" : "paid";
    if (detail.status !== nextStatus) {
        await dbRun(
            `UPDATE technician_kasbon
             SET status = ?, updated_at = ?, paid_at = CASE WHEN ? = 'paid' THEN COALESCE(paid_at, ?) ELSE paid_at END
             WHERE id = ?`,
            [nextStatus, nowIso(), nextStatus, nowIso(), kasbonId]
        );
        detail.status = nextStatus;
        detail.financial_status = nextStatus;
    }
    return detail;
}

async function createKasbonApprovalEntry(kasbon, { approved, createdBy = "system", notes = "" }) {
    if (!approved) {
        return { applied: false, reason: "rejected" };
    }
    const inserted = await insertKasbonLedgerEntry({
        kasbonId: kasbon.id,
        teknisiId: kasbon.teknisi_id,
        teknisiName: kasbon.teknisi_name,
        amount: toInteger(kasbon.amount),
        direction: "credit",
        reason: "kasbon_approved",
        createdBy,
        notes
    });
    await syncKasbonHeaderStatus(kasbon.id);
    return {
        applied: inserted.inserted,
        duplicate: inserted.duplicate === true,
        amount: toInteger(kasbon.amount)
    };
}

async function getKasbonSummary({ teknisiId }) {
    const rows = await getKasbonList({ teknisiId });
    return rows.reduce((acc, row) => {
        acc.total_kasbon += 1;
        acc.pending_amount += row.status === "pending" ? toInteger(row.amount) : 0;
        acc.pending_count += row.status === "pending" ? 1 : 0;
        acc.total_outstanding += row.remaining_amount > 0 ? row.remaining_amount : 0;
        acc.total_paid += row.paid_amount || 0;
        acc.active_count += row.remaining_amount > 0 ? 1 : 0;
        if (row.financial_status === "paid") {
            acc.paid_count += 1;
        }
        return acc;
    }, {
        total_kasbon: 0,
        pending_amount: 0,
        pending_count: 0,
        total_outstanding: 0,
        total_paid: 0,
        active_count: 0,
        paid_count: 0
    });
}

async function getCollectionPayableEntries({ teknisiId, periodMonth, periodYear, includePayrollId = null }) {
    await ensureFinanceTables();
    // Filter berdasarkan kolom period_month/period_year (periode bisnis komisi),
    // BUKAN created_at. created_at adalah waktu insert aktual; payroll periode lalu
    // sering baru di-draft setelah periode tutup sehingga window created_at meleset
    // dan komisi terhitung 0.
    //
    // `includePayrollId` IKUT menghitung entri yang sudah terkunci ke payroll ITU SENDIRI.
    // Tanpa ini, menghitung ulang payroll yang sudah pernah dikunci memulangkan nol dan
    // menimpa komisi jadi 0 — angka hilang, bukan sekadar meleset. Pemanggil "lihat saja"
    // (draft/ringkasan) tak mengirimnya, jadi perilakunya tak berubah untuk mereka.
    const syarat = ["teknisi_id = ?", "period_month = ?", "period_year = ?"];
    const params = [String(teknisiId), parseInt(periodMonth, 10), parseInt(periodYear, 10)];
    if (includePayrollId != null) {
        syarat.push("(payroll_id IS NULL OR payroll_id = ?)");
        params.push(toInteger(includePayrollId));
    } else {
        syarat.push("payroll_id IS NULL");
    }
    // Komisi yang sudah ditutup (diserahkan ke teknisi di luar sistem) tak boleh jadi kandidat
    // payroll lagi. Menyaringnya DI SINI membuat jaminannya struktural: barisnya tak pernah
    // terlihat oleh perhitungan gaji, bukan sekadar netnya kebetulan nol.
    syarat.push("closed_out_at IS NULL");

    return dbAll(
        `SELECT *
         FROM technician_collection_ledger
         WHERE ${syarat.join(" AND ")}
         ORDER BY datetime(created_at) ASC, id ASC`,
        params
    );
}

/**
 * Komisi penarikan yang BELUM terkunci ke payroll mana pun, dikelompokkan per periode.
 *
 * Kenapa perlu: komisi hanya ikut terbayar kalau ADA payroll untuk periode yang sama.
 * Kalau bulan tertentu tak pernah dibuatkan payroll, komisinya menggantung selamanya dan
 * tak muncul di layar mana pun — terukur di produksi 2026-08-10: satu teknisi punya
 * Rp1.575.000 tersebar di 7 periode sementara payroll hanya ada untuk 1 periode.
 * Uang yang terutang tapi tak terlihat tak akan pernah dibayar.
 */
async function getUnsettledCollectionByPeriod({ teknisiId }) {
    await ensureFinanceTables();
    // `has_payroll` memisahkan dua hal yang tampak sama di ledger tapi jauh berbeda bagi
    // operator: komisi periode yang payroll-nya SUDAH ada (draft — terlihat di tabel, tinggal
    // difinalisasi) versus periode yang tak punya baris payroll sama sekali. Hanya yang kedua
    // yang benar-benar tak terlihat di layar mana pun; menandai keduanya membuat peringatan
    // ini ikut menyala untuk hal yang sudah kelihatan, dan peringatan begitu cepat diabaikan.
    return dbAll(
        `SELECT l.period_month, l.period_year,
                COUNT(*) AS entries,
                SUM(CASE WHEN l.direction = 'credit' THEN l.commission_amount ELSE -l.commission_amount END) AS net_total,
                EXISTS(
                    SELECT 1 FROM technician_gaji g
                     WHERE CAST(g.teknisi_id AS TEXT) = CAST(l.teknisi_id AS TEXT)
                       AND g.period_month = l.period_month
                       AND g.period_year = l.period_year
                ) AS has_payroll
           FROM technician_collection_ledger l
          WHERE CAST(l.teknisi_id AS TEXT) = CAST(? AS TEXT)
            AND l.payroll_id IS NULL
            AND l.closed_out_at IS NULL
          GROUP BY l.period_year, l.period_month
          ORDER BY l.period_year ASC, l.period_month ASC`,
        [String(teknisiId)]
    );
}

async function getCollectionPayableSummary({ teknisiId, periodMonth, periodYear }) {
    const entries = await getCollectionPayableEntries({ teknisiId, periodMonth, periodYear });
    const total = entries.reduce((sum, entry) => sum + (entry.direction === "credit" ? toInteger(entry.commission_amount) : -toInteger(entry.commission_amount)), 0);
    return {
        entries,
        net_total: total,
        total_credit: entries.filter((entry) => entry.direction === "credit").reduce((sum, entry) => sum + toInteger(entry.commission_amount), 0),
        total_debit: entries.filter((entry) => entry.direction === "debit").reduce((sum, entry) => sum + toInteger(entry.commission_amount), 0)
    };
}

// ── Komisi MARKETING PSB (Fase 2b): teknisi pemberi lead → payroll. Sumber = psb-schedule-service (DB lain),
// DI-INJECT (default require) supaya bisa di-fake di test & tak bikin coupling keras/circular. Baca/settle
// SELALU defensif: gagal baca marketing TAK BOLEH menjatuhkan payroll (default 0). ──
let _marketingSource = null;
function marketingSource() { return _marketingSource || require("./psb-schedule-service"); }
function __setMarketingSourceForTest(src) { _marketingSource = src; }

async function getMarketingPayableSummary({ teknisiId }) {
    try {
        const mk = await marketingSource().getUnsettledMarketingForTeknisi(teknisiId);
        return { entries: (mk && mk.entries) || [], net_total: toInteger(mk && mk.net_total) };
    } catch (error) {
        console.error("[TECHNICIAN_MARKETING_READ_ERROR]", error.message);
        return { entries: [], net_total: 0 };
    }
}

async function lockMarketingToPayroll({ payrollId, teknisiId }) {
    try {
        const r = await marketingSource().settleMarketingToPayroll({ teknisiId, payrollId });
        return { entries: (r && r.entries) || [], netTotal: toInteger(r && r.netTotal) };
    } catch (error) {
        console.error("[TECHNICIAN_MARKETING_SETTLE_ERROR]", error.message);
        return { entries: [], netTotal: 0 };
    }
}

/**
 * Potongan kasbon yang sudah "dipesan" oleh payroll lain yang BELUM dibayar.
 *
 * Cicilan hutang (`allocateKasbonRepayment`) baru ditulis saat payroll ditandai DIBAYAR, jadi
 * di antara finalisasi dan pembayaran, sisa hutang di database masih tampak utuh. Dua payroll
 * yang menggantung bersamaan karena itu bisa sama-sama memotong hutang yang sama.
 */
async function getReservedKasbonDeduction({ teknisiId, excludePayrollId = null }) {
    await ensureFinanceTables();
    const params = [toInteger(teknisiId)];
    let sql = `SELECT COALESCE(SUM(potongan_kasbon), 0) AS total
                 FROM technician_gaji
                WHERE teknisi_id = ?
                  AND status IN ('draft', 'finalized')`;
    if (excludePayrollId != null) {
        sql += " AND id != ?";
        params.push(toInteger(excludePayrollId));
    }
    const row = await dbGet(sql, params);
    return toInteger(row && row.total);
}

async function buildPayrollPayload({
    teknisiId,
    teknisiName,
    periodMonth,
    periodYear,
    gajiPokok,
    bonusManual,
    potonganKasbon,
    potonganLain,
    potonganLainKeterangan,
    notes,
    excludePayrollId = null
}) {
    const summary = await getKasbonSummary({ teknisiId });
    const collection = await getCollectionPayableSummary({ teknisiId, periodMonth, periodYear });
    const marketing = await getMarketingPayableSummary({ teknisiId });

    // Sisa hutang EFEKTIF: dikurangi potongan yang sudah TERKUNCI di payroll lain yang belum
    // dibayar. Cicilan baru lahir saat payroll DIBAYAR, jadi tanpa pengurangan ini dua payroll
    // yang sama-sama menggantung akan sama-sama melihat hutang PENUH dan sama-sama lolos —
    // teknisi kehilangan uangnya dua kali sementara hutangnya hanya berkurang sekali.
    const sudahDicadangkan = await getReservedKasbonDeduction({ teknisiId, excludePayrollId });
    const sisaEfektif = Math.max(0, toInteger(summary.total_outstanding) - sudahDicadangkan);

    const normalizedPotonganKasbon = Math.max(0, Math.min(toInteger(potonganKasbon), sisaEfektif));
    const normalizedPotonganLain = Math.max(0, toInteger(potonganLain));
    const normalizedBonusManual = Math.max(0, toInteger(bonusManual));
    const normalizedGajiPokok = Math.max(0, toInteger(gajiPokok));
    const komisiCollection = collection.net_total;
    const komisiMarketing = marketing.net_total;
    const grossAmount = normalizedGajiPokok + normalizedBonusManual + komisiCollection + komisiMarketing;
    const totalPotongan = normalizedPotonganKasbon + normalizedPotonganLain;
    const netAmount = grossAmount - totalPotongan;

    return {
        teknisi_id: toInteger(teknisiId),
        teknisi_name: teknisiName || getAccountName(teknisiId),
        period_month: toInteger(periodMonth),
        period_year: toInteger(periodYear),
        gaji_pokok: normalizedGajiPokok,
        bonus_manual: normalizedBonusManual,
        bonus: normalizedBonusManual,
        komisi_collection: komisiCollection,
        komisi_marketing: komisiMarketing,
        potongan_kasbon: normalizedPotonganKasbon,
        potongan_lain: normalizedPotonganLain,
        potongan_lain_keterangan: potonganLainKeterangan || "",
        gross_amount: grossAmount,
        total_potongan: totalPotongan,
        net_amount: netAmount,
        total_gaji: netAmount,
        notes: notes || "",
        kasbon_outstanding: summary.total_outstanding,
        collection_entries: collection.entries,
        collection_net_total: collection.net_total,
        marketing_entries: marketing.entries,
        marketing_net_total: marketing.net_total
    };
}

async function createPayrollDraft(payload, actor = {}) {
    await ensureFinanceTables();
    const existing = await dbGet(
        "SELECT * FROM technician_gaji WHERE teknisi_id = ? AND period_month = ? AND period_year = ?",
        [toInteger(payload.teknisiId), toInteger(payload.periodMonth), toInteger(payload.periodYear)]
    );
    if (existing) {
        return { created: false, conflict: true, row: existing };
    }

    const draft = await buildPayrollPayload(payload);
    const now = nowIso();
    const result = await dbRun(
        `INSERT INTO technician_gaji (
            teknisi_id, teknisi_name, period_month, period_year,
            gaji_pokok, bonus, bonus_manual, komisi_collection, komisi_marketing,
            potongan_kasbon, potongan_lain, potongan_lain_keterangan,
            gross_amount, total_potongan, total_gaji, net_amount,
            status, notes, created_by, created_by_name, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`,
        [
            draft.teknisi_id,
            draft.teknisi_name,
            draft.period_month,
            draft.period_year,
            draft.gaji_pokok,
            draft.bonus,
            draft.bonus_manual,
            draft.komisi_collection,
            draft.komisi_marketing,
            draft.potongan_kasbon,
            draft.potongan_lain,
            draft.potongan_lain_keterangan,
            draft.gross_amount,
            draft.total_potongan,
            draft.total_gaji,
            draft.net_amount,
            draft.notes,
            actor.id || null,
            actor.name || actor.username || null,
            now,
            now
        ]
    );
    return { created: true, id: result.lastID, draft };
}

async function getPayrollRecord(id) {
    await ensureFinanceTables();
    const row = await dbGet("SELECT * FROM technician_gaji WHERE id = ?", [toInteger(id)]);
    return row ? formatPayrollRow(row) : null;
}

function formatPayrollRow(row) {
    const status = mapPayrollStatus(row.status);
    return {
        ...row,
        status,
        bonus_manual: toInteger(row.bonus_manual || row.bonus),
        bonus: toInteger(row.bonus_manual || row.bonus),
        komisi_collection: toInteger(row.komisi_collection),
        komisi_marketing: toInteger(row.komisi_marketing),
        gross_amount: toInteger(row.gross_amount || (toInteger(row.gaji_pokok) + toInteger(row.bonus_manual || row.bonus) + toInteger(row.komisi_collection) + toInteger(row.komisi_marketing))),
        total_potongan: toInteger(row.total_potongan || (toInteger(row.potongan_kasbon) + toInteger(row.potongan_lain))),
        net_amount: toInteger(row.net_amount || row.total_gaji),
        total_gaji: toInteger(row.net_amount || row.total_gaji)
    };
}

async function updatePayrollDraft(id, payload) {
    const existing = await getPayrollRecord(id);
    if (!existing) {
        return { updated: false, reason: "not_found" };
    }
    if (existing.status !== "draft") {
        return { updated: false, reason: "locked" };
    }
    const draft = await buildPayrollPayload({
        teknisiId: existing.teknisi_id,
        teknisiName: existing.teknisi_name,
        periodMonth: existing.period_month,
        periodYear: existing.period_year,
        gajiPokok: payload.gaji_pokok,
        bonusManual: payload.bonus_manual,
        potonganKasbon: payload.potongan_kasbon,
        potonganLain: payload.potongan_lain,
        potonganLainKeterangan: payload.potongan_lain_keterangan,
        notes: payload.notes,
        // Payroll ini sendiri tak boleh dihitung sebagai pesanan hutang atas dirinya.
        excludePayrollId: existing.id
    });
    await dbRun(
        `UPDATE technician_gaji
         SET gaji_pokok = ?, bonus = ?, bonus_manual = ?, komisi_collection = ?, komisi_marketing = ?,
             potongan_kasbon = ?, potongan_lain = ?, potongan_lain_keterangan = ?,
             gross_amount = ?, total_potongan = ?, total_gaji = ?, net_amount = ?,
             notes = ?, updated_at = ?
         WHERE id = ?`,
        [
            draft.gaji_pokok,
            draft.bonus,
            draft.bonus_manual,
            draft.komisi_collection,
            draft.komisi_marketing,
            draft.potongan_kasbon,
            draft.potongan_lain,
            draft.potongan_lain_keterangan,
            draft.gross_amount,
            draft.total_potongan,
            draft.total_gaji,
            draft.net_amount,
            draft.notes,
            nowIso(),
            toInteger(id)
        ]
    );
    return { updated: true, draft };
}

async function lockCollectionEntriesToPayroll({ payrollId, teknisiId, periodMonth, periodYear }) {
    const entries = await getCollectionPayableEntries({ teknisiId, periodMonth, periodYear, includePayrollId: payrollId });
    if (entries.length === 0) {
        return { entries: [], netTotal: 0 };
    }
    const ids = entries.map((entry) => entry.id);
    const placeholders = ids.map(() => "?").join(", ");
    const lockedAt = nowIso();
    await dbRun(
        `UPDATE technician_collection_ledger
         SET payroll_id = ?, payroll_locked_at = ?
         WHERE id IN (${placeholders}) AND payroll_id IS NULL`,
        [toInteger(payrollId), lockedAt, ...ids]
    );
    const netTotal = entries.reduce((sum, entry) => sum + (entry.direction === "credit" ? toInteger(entry.commission_amount) : -toInteger(entry.commission_amount)), 0);
    return { entries, netTotal, lockedAt };
}

async function finalizePayroll(id, actor = {}) {
    const existing = await getPayrollRecord(id);
    if (!existing) {
        return { finalized: false, reason: "not_found" };
    }
    if (existing.status === "paid") {
        return { finalized: false, reason: "paid" };
    }
    // Finalisasi ULANG bersifat MERUSAK, bukan sekadar mubazir: komisi dihitung dari entri yang
    // BELUM terkunci, dan finalisasi pertama sudah mengunci semuanya. Jalan kedua menemukan nol
    // lalu MENIMPA komisi collection & marketing jadi 0 — uang teknisi hilang dari perhitungan
    // dan tak bisa dikembalikan dengan finalisasi lagi. Tak ada gunanya juga: payroll berstatus
    // `finalized` sudah tak boleh diubah (routes/gaji.js), jadi tak ada yang perlu dihitung ulang.
    if (existing.status === "finalized") {
        return { finalized: false, reason: "already_finalized" };
    }

    const refreshed = await buildPayrollPayload({
        teknisiId: existing.teknisi_id,
        teknisiName: existing.teknisi_name,
        periodMonth: existing.period_month,
        periodYear: existing.period_year,
        gajiPokok: existing.gaji_pokok,
        bonusManual: existing.bonus_manual,
        potonganKasbon: existing.potongan_kasbon,
        potonganLain: existing.potongan_lain,
        potonganLainKeterangan: existing.potongan_lain_keterangan,
        notes: existing.notes,
        excludePayrollId: existing.id
    });

    const lockResult = await lockCollectionEntriesToPayroll({
        payrollId: existing.id,
        teknisiId: existing.teknisi_id,
        periodMonth: existing.period_month,
        periodYear: existing.period_year
    });
    // Settle komisi marketing teknisi (Fase 2b) — kunci row jadi `settled` + tempel payroll_id. netTotal
    // hasil settle = otoritatif (mirror lockCollection). Defensif: gagal → 0 (jangan jatuhkan finalize).
    const lockMarketing = await lockMarketingToPayroll({ payrollId: existing.id, teknisiId: existing.teknisi_id });

    const komisiCollection = lockResult.netTotal;
    const komisiMarketing = lockMarketing.netTotal;
    const grossAmount = refreshed.gaji_pokok + refreshed.bonus_manual + komisiCollection + komisiMarketing;
    const totalPotongan = refreshed.potongan_kasbon + refreshed.potongan_lain;
    const netAmount = grossAmount - totalPotongan;

    await dbRun(
        `UPDATE technician_gaji
         SET bonus = ?, bonus_manual = ?, komisi_collection = ?, komisi_marketing = ?, gross_amount = ?, total_potongan = ?,
             total_gaji = ?, net_amount = ?, status = 'finalized', finalized_at = ?, finalized_by = ?,
             finalized_by_name = ?, updated_at = ?
         WHERE id = ?`,
        [
            refreshed.bonus_manual,
            refreshed.bonus_manual,
            komisiCollection,
            komisiMarketing,
            grossAmount,
            totalPotongan,
            netAmount,
            netAmount,
            nowIso(),
            actor.id || null,
            actor.name || actor.username || null,
            nowIso(),
            existing.id
        ]
    );

    return { finalized: true, collectionEntries: lockResult.entries, marketingEntries: lockMarketing.entries, netAmount, komisiCollection, komisiMarketing };
}

async function allocateKasbonRepayment({ teknisiId, payrollId, amount, createdBy, notes = "" }) {
    let remaining = Math.max(0, toInteger(amount));
    if (remaining === 0) {
        return { allocations: [], appliedAmount: 0 };
    }

    const rows = (await getKasbonList({ teknisiId }))
        .filter((row) => row.financial_status === "approved" && row.remaining_amount > 0)
        .sort((a, b) => new Date(a.approved_at || a.created_at || 0) - new Date(b.approved_at || b.created_at || 0));

    const allocations = [];
    for (const row of rows) {
        if (remaining <= 0) {
            break;
        }
        const payAmount = Math.min(remaining, row.remaining_amount);
        const inserted = await insertKasbonLedgerEntry({
            kasbonId: row.id,
            teknisiId: row.teknisi_id,
            teknisiName: row.teknisi_name,
            amount: payAmount,
            direction: "debit",
            reason: "payroll_deduction",
            payrollId,
            createdBy,
            notes
        });
        if (inserted.inserted) {
            allocations.push({ kasbon_id: row.id, amount: payAmount });
            remaining -= payAmount;
        }
        await syncKasbonHeaderStatus(row.id);
    }

    return {
        allocations,
        appliedAmount: allocations.reduce((sum, item) => sum + item.amount, 0)
    };
}

async function payPayroll(id, actor = {}, notes = "") {
    let existing = await getPayrollRecord(id);
    if (!existing) {
        return { paid: false, reason: "not_found" };
    }
    if (existing.status === "paid") {
        return { paid: false, reason: "already_paid" };
    }
    if (existing.status === "draft") {
        const finalized = await finalizePayroll(id, actor);
        if (!finalized.finalized) {
            return { paid: false, reason: finalized.reason || "finalize_failed" };
        }
        existing = await getPayrollRecord(id);
    }

    const allocation = await allocateKasbonRepayment({
        teknisiId: existing.teknisi_id,
        payrollId: existing.id,
        amount: existing.potongan_kasbon,
        createdBy: actor.name || actor.username || "system",
        notes
    });

    await dbRun(
        `UPDATE technician_gaji
         SET status = 'paid', paid_at = ?, paid_by = ?, paid_by_name = ?, notes = ?, updated_at = ?
         WHERE id = ?`,
        [
            nowIso(),
            actor.id || null,
            actor.name || actor.username || null,
            notes || existing.notes || "",
            nowIso(),
            existing.id
        ]
    );
    try {
        await syncFinancialLedgerSources({ domains: ['technician_payroll', 'technician_kasbon'] });
    } catch (ledgerSyncError) {
        console.error('[TECHNICIAN_PAYROLL_LEDGER_SYNC_ERROR]', ledgerSyncError.message);
    }

    return {
        paid: true,
        allocations: allocation.allocations,
        appliedKasbonAmount: allocation.appliedAmount
    };
}

async function settleKasbonManually({ kasbonId, actor = {}, notes = "" }) {
    const detail = await getKasbonLedgerDetail(kasbonId);
    if (!detail) {
        return { settled: false, reason: "not_found" };
    }
    if (detail.financial_status !== "approved" || detail.remaining_amount <= 0) {
        return { settled: false, reason: "not_active" };
    }
    const inserted = await insertKasbonLedgerEntry({
        kasbonId: detail.id,
        teknisiId: detail.teknisi_id,
        teknisiName: detail.teknisi_name,
        amount: detail.remaining_amount,
        direction: "debit",
        reason: "manual_settlement",
        createdBy: actor.name || actor.username || "system",
        notes
    });
    await syncKasbonHeaderStatus(detail.id);
    return {
        settled: inserted.inserted || inserted.duplicate,
        duplicate: inserted.duplicate === true,
        amount: detail.remaining_amount
    };
}

async function getPayrollList({ month = null, year = null, teknisiId = null, status = null, id = null } = {}) {
    await ensureFinanceTables();
    const where = [];
    const params = [];
    if (id !== null && id !== undefined) {
        where.push("id = ?");
        params.push(toInteger(id));
    }
    if (month) {
        where.push("period_month = ?");
        params.push(toInteger(month));
    }
    if (year) {
        where.push("period_year = ?");
        params.push(toInteger(year));
    }
    if (teknisiId) {
        where.push("teknisi_id = ?");
        params.push(toInteger(teknisiId));
    }
    if (status) {
        const requested = status === "pending" ? "draft" : status;
        where.push("(status = ? OR (status = 'pending' AND ? = 'draft'))");
        params.push(requested, requested);
    }
    const rows = await dbAll(
        `SELECT *
         FROM technician_gaji
         ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY period_year DESC, period_month DESC, datetime(created_at) DESC, id DESC`,
        params
    );
    return rows.map(formatPayrollRow);
}

async function getPayrollSummary({ month, year }) {
    const rows = await getPayrollList({ month, year });
    return rows.reduce((acc, row) => {
        acc.total_records += 1;
        acc.total_gaji_pokok += row.gaji_pokok;
        acc.total_bonus += row.bonus_manual;
        acc.total_komisi_collection += row.komisi_collection;
        acc.total_komisi_marketing += toInteger(row.komisi_marketing);
        acc.total_gross += row.gross_amount;
        acc.total_potongan_kasbon += row.potongan_kasbon;
        acc.total_potongan_lain += row.potongan_lain;
        acc.total_potongan += row.total_potongan;
        acc.total_gaji += row.net_amount;
        acc.total_net += row.net_amount;
        acc[`${row.status}_count`] = (acc[`${row.status}_count`] || 0) + 1;
        acc[`${row.status}_amount`] = (acc[`${row.status}_amount`] || 0) + row.net_amount;
        return acc;
    }, {
        period: `${month}/${year}`,
        total_records: 0,
        total_gaji_pokok: 0,
        total_bonus: 0,
        total_komisi_collection: 0,
        total_komisi_marketing: 0,
        total_gross: 0,
        total_potongan_kasbon: 0,
        total_potongan_lain: 0,
        total_potongan: 0,
        total_gaji: 0,
        total_net: 0,
        draft_count: 0,
        finalized_count: 0,
        paid_count: 0,
        draft_amount: 0,
        finalized_amount: 0,
        paid_amount: 0
    });
}

module.exports = {
    ensureFinanceTables,
    getKasbonList,
    getKasbonById,
    getKasbonLedgerDetail,
    getKasbonSummary,
    createKasbonApprovalEntry,
    settleKasbonManually,
    getCollectionPayableEntries,
    getCollectionPayableSummary,
    getUnsettledCollectionByPeriod,
    buildPayrollPayload,
    createPayrollDraft,
    getPayrollRecord,
    getPayrollList,
    getPayrollSummary,
    updatePayrollDraft,
    finalizePayroll,
    payPayroll,
    getMarketingPayableSummary,
    __setMarketingSourceForTest
};
