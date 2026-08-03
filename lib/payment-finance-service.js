/**
 * Header Doc
 * Purpose: Menjadi source of truth ledger pembayaran periodik, sinkronisasi flag `users.paid`, dan helper read-model billing. Termasuk waiver (GRATIS) di tabel terpisah `payment_waivers` yang menandai periode lunas TANPA masuk pemasukan.
 * Caller: Route payment, approval service, billing service, cron, dan diagnostics pembayaran.
 * Deps: `./database`, `./env-config`, `./sqlite-shared-reader`, `./financial-ledger`, `./technician-collection-settlement`, dan runtime app.
 * MainFuncs: `applyPaymentStatusChange`, `applyFreeMonth`, `getPaymentPositionForPeriod`, `getPaymentStatusReadModel`, `syncUserPaidStatusForCurrentPeriod`, `listPaymentHistoryUserIdsForPeriod`, `getPaymentDiagnostics`, `withPaymentReadContext`.
 * SideEffects: Menulis ledger/payment tables, sinkronisasi cache user runtime, dan membaca reader SQLite terisolasi.
 */
"use strict";

const { randomUUID: _randomUUID } = require("crypto");
const { loadJSON } = require("./database");
const { getDatabasePath } = require("./env-config");
const { getSharedReader, dropSharedReader } = require("./sqlite-shared-reader");
const { syncFinancialLedgerSources } = require("./financial-ledger");
const {
    evaluateCollectionSettlement,
    hasAnyCommissionCreditForUserPeriod,
    getPeriodParts
} = require("./technician-collection-settlement");
const {
    evaluateAgenCollectionSettlement
} = require("./agen-collection-settlement");
const { isInfrastructure } = require("./account-classification");

let initializationPromise = null;

function getRuntime() {
    return global.__appRuntime || null;
}

function getRuntimeRepository(name) {
    const runtime = getRuntime();
    if (!runtime || typeof runtime.getRepository !== "function") {
        return null;
    }

    try {
        return runtime.getRepository(name);
    } catch (__error) {
        return null;
    }
}

async function ensureMainDbReady() {
    const runtime = getRuntime();
    if (runtime && typeof runtime.getDb === "function") {
        const runtimeDb = runtime.getDb();
        if (runtimeDb) {
            return runtimeDb;
        }
    }
    if (global.db) {
        return global.db;
    }
    if (global.__dbInitPromise) {
        await global.__dbInitPromise;
    }
    if (runtime && typeof runtime.getDb === "function" && runtime.getDb()) {
        return runtime.getDb();
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

function getReaderDbPath() {
    return getDatabasePath("users.sqlite");
}

function getReaderDb() {
    // Koneksi baca BERSAMA & berumur panjang. Dulu di sini dibuka koneksi BARU tiap
    // pemanggilan lalu ditutup — pola itu membuat `-wal`/`-shm` users.sqlite yatim dan
    // memunculkan `SQLITE_IOERR` acak pada jalur tulis pembayaran. Lihat lib/sqlite-shared-reader.
    return getSharedReader(getReaderDbPath());
}

/**
 * Buang koneksi baca bersama bila query gagal dengan error tingkat-file, supaya
 * panggilan berikutnya memakai koneksi segar alih-alih koneksi yang sudah rusak.
 */
function handleReaderError(error) {
    if (error && typeof error.code === "string" && error.code.startsWith("SQLITE_IOERR")) {
        console.error(`[PAYMENT_FINANCE_READER_IOERR] ${error.message} — koneksi baca dibuang, panggilan berikutnya membuka koneksi segar.`);
        dropSharedReader(getReaderDbPath());
    }
}

function createReaderContext() {
    const db = getReaderDb();
    return {
        db,
        // NO-OP DISENGAJA: koneksi ini dipakai bersama seluruh jalur baca. Menutupnya
        // di akhir tiap operasi adalah persis pola yang me-yatimkan `-wal`/`-shm`.
        close() {
            return Promise.resolve();
        }
    };
}

function readerGet(sql, params = [], context = createReaderContext()) {
    return new Promise((resolve, reject) => {
        const { db } = context;
        db.get(sql, params, (err, row) => {
            if (err) {
                handleReaderError(err);
                reject(err);
                return;
            }
            resolve(row || null);
        });
    });
}

function readerAll(sql, params = [], context = createReaderContext()) {
    return new Promise((resolve, reject) => {
        const { db } = context;
        db.all(sql, params, (err, rows) => {
            if (err) {
                handleReaderError(err);
                reject(err);
                return;
            }
            resolve(rows || []);
        });
    });
}

async function withReaderContext(operation) {
    const context = createReaderContext();
    try {
        return await operation(context);
    } finally {
        await context.close();
    }
}

async function withPaymentReadContext(operation) {
    return withReaderContext(operation);
}

function toInteger(value, fallback = 0) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function buildNowIso() {
    return new Date().toISOString();
}

function getCurrentBillingPeriod(options = {}) {
    const { periodMonth, periodYear } = getPeriodParts({
        date: options.date || new Date()
    });
    return { periodMonth, periodYear };
}

function normalizeUserPaymentMethod(value) {
    if (value === undefined || value === null) {
        return null;
    }

    const normalized = String(value).trim().toUpperCase();
    return ["CASH", "TRANSFER_BANK"].includes(normalized) ? normalized : null;
}

function getPackagePrice(packageName) {
    if (!packageName || typeof packageName !== "string") {
        return 0;
    }

    const packagesRepo = getRuntimeRepository("packages");
    const packagesDb = packagesRepo ? packagesRepo.getAll() : loadJSON("database/packages.json");
    const packageData = packagesDb.find((pkg) => pkg.name === packageName);
    if (packageData && packageData.price) {
        return toInteger(packageData.price);
    }

    const patterns = [
        /([0-9]+)K/i,
        /([0-9]+)000/,
        /([0-9]+)[.,]000/
    ];

    for (const pattern of patterns) {
        const match = packageName.match(pattern);
        if (match) {
            return toInteger(match[1]) * 1000;
        }
    }

    return 0;
}

function getEffectivePrice(user) {
    const basePrice = toInteger(user?.subscription_price) || getPackagePrice(user?.subscription);
    if (!user) {
        return basePrice;
    }

    let isDiscountValid = true;
    const discountMonths = toInteger(user.discount_months);
    const discountMonthsUsed = toInteger(user.discount_months_used);

    if (user.discount_valid_until) {
        isDiscountValid = new Date(user.discount_valid_until) >= new Date();
    }
    if (discountMonths > 0) {
        isDiscountValid = discountMonthsUsed < discountMonths;
    }
    if (!isDiscountValid) {
        return basePrice;
    }

    let discountValue = 0;
    if (toInteger(user.discount_percentage) > 0) {
        discountValue = Math.round(basePrice * toInteger(user.discount_percentage) / 100);
    } else if (toInteger(user.discount_amount) > 0) {
        discountValue = toInteger(user.discount_amount);
    }

    return Math.max(0, basePrice - discountValue);
}

async function syncPaymentHistorySchema() {
    const paymentHistoryColumnSpecs = [
        { name: "user_name", sql: "ALTER TABLE payment_history ADD COLUMN user_name TEXT" },
        { name: "request_id", sql: "ALTER TABLE payment_history ADD COLUMN request_id INTEGER" },
        { name: "amount_remaining", sql: "ALTER TABLE payment_history ADD COLUMN amount_remaining INTEGER NOT NULL DEFAULT 0" },
        { name: "teknisi_id", sql: "ALTER TABLE payment_history ADD COLUMN teknisi_id INTEGER" },
        { name: "teknisi_name", sql: "ALTER TABLE payment_history ADD COLUMN teknisi_name TEXT" },
        { name: "approved_by", sql: "ALTER TABLE payment_history ADD COLUMN approved_by INTEGER" },
        { name: "approved_by_name", sql: "ALTER TABLE payment_history ADD COLUMN approved_by_name TEXT" },
        { name: "updated_at", sql: "ALTER TABLE payment_history ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'))" },
        { name: "created_by", sql: "ALTER TABLE payment_history ADD COLUMN created_by TEXT" }
    ];
    await dbRun(`
        CREATE TABLE IF NOT EXISTS payment_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            user_name TEXT,
            request_id INTEGER,
            amount_due INTEGER NOT NULL,
            amount_paid INTEGER NOT NULL,
            amount_remaining INTEGER NOT NULL DEFAULT 0,
            payment_method TEXT DEFAULT 'CASH',
            is_partial INTEGER DEFAULT 0,
            teknisi_id INTEGER,
            teknisi_name TEXT,
            approved_by INTEGER,
            approved_by_name TEXT,
            period_month INTEGER,
            period_year INTEGER,
            notes TEXT,
            created_by TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    `);
    const paymentHistoryColumns = await dbAll("PRAGMA table_info(payment_history)");
    const paymentHistoryColumnNames = new Set(paymentHistoryColumns.map((column) => column.name));
    for (const columnSpec of paymentHistoryColumnSpecs) {
        if (!paymentHistoryColumnNames.has(columnSpec.name)) {
            await dbRun(columnSpec.sql);
        }
    }
    await dbRun("CREATE INDEX IF NOT EXISTS idx_payment_history_user ON payment_history(user_id)");
    await dbRun("CREATE INDEX IF NOT EXISTS idx_payment_history_period ON payment_history(period_month, period_year)");
    await dbRun("CREATE INDEX IF NOT EXISTS idx_payment_history_teknisi ON payment_history(teknisi_id)");
}

async function ensurePaymentFinanceTables() {
    if (!initializationPromise) {
        initializationPromise = (async () => {
            await dbRun(`
                CREATE TABLE IF NOT EXISTS payment_reversals (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    period_month INTEGER NOT NULL,
                    period_year INTEGER NOT NULL,
                    amount_reversed INTEGER NOT NULL,
                    source_request_id TEXT,
                    source_admin_action TEXT,
                    created_by TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    reason TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'completed',
                    event_key TEXT NOT NULL
                )
            `);
            await dbRun("CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_reversals_event_key ON payment_reversals(event_key)");
            await dbRun("CREATE INDEX IF NOT EXISTS idx_payment_reversals_period ON payment_reversals(period_year, period_month)");
            await dbRun("CREATE INDEX IF NOT EXISTS idx_payment_reversals_user_period ON payment_reversals(user_id, period_year, period_month)");
            // Waiver = pembebasan tagihan (GRATIS/kompensasi). Tabel TERPISAH dari payment_history
            // agar TIDAK pernah ikut dijumlahkan sebagai pemasukan; hanya memengaruhi is_fully_paid.
            await dbRun(`
                CREATE TABLE IF NOT EXISTS payment_waivers (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    period_month INTEGER NOT NULL,
                    period_year INTEGER NOT NULL,
                    amount_waived INTEGER NOT NULL DEFAULT 0,
                    reason TEXT NOT NULL,
                    created_by TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'active',
                    event_key TEXT NOT NULL
                )
            `);
            await dbRun("CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_waivers_event_key ON payment_waivers(event_key)");
            await dbRun("CREATE INDEX IF NOT EXISTS idx_payment_waivers_user_period ON payment_waivers(user_id, period_year, period_month)");
        })().catch((error) => {
            initializationPromise = null;
            throw error;
        });
    }
    await initializationPromise;
    await syncPaymentHistorySchema();
}

async function syncPaymentLedgerDomains() {
    try {
        await syncFinancialLedgerSources({ domains: ["payment_history", "payment_reversal", "technician_collection"] });
    } catch (error) {
        console.error("[PAYMENT_FINANCE_LEDGER_SYNC_ERROR]", error.message);
    }
}

async function setUserPaidStatus(user, isPaid) {
    const paidValue = isPaid ? 1 : 0;
    await dbRun("UPDATE users SET paid = ? WHERE id = ?", [paidValue, user.id]);

    const usersRepo = getRuntimeRepository("users");
    if (usersRepo) {
        usersRepo.update((items) => items.map((item) => (
            String(item.id) === String(user.id)
                ? { ...item, paid: paidValue }
                : item
        )));
    } else {
        const memoryUser = (global.users || []).find((item) => String(item.id) === String(user.id));
        if (memoryUser) {
            memoryUser.paid = paidValue;
        }
    }
    user.paid = paidValue;
}

function normalizePaymentRequestScope(request) {
    const { periodMonth, periodYear } = getPeriodParts({
        periodMonth: parseInt(request?.period_month, 10),
        periodYear: parseInt(request?.period_year, 10),
        date: request?.updated_at || request?.created_at || new Date()
    });
    return {
        ...request,
        period_month: periodMonth,
        period_year: periodYear,
        request_type: request?.request_type || (request?.is_partial_payment ? "partial_payment" : "payment_status_change")
    };
}

function isSamePaymentRequestScope(left, right) {
    const normalizedLeft = normalizePaymentRequestScope(left);
    const normalizedRight = normalizePaymentRequestScope(right);
    return String(normalizedLeft.userId) === String(normalizedRight.userId)
        && String(normalizedLeft.request_type) === String(normalizedRight.request_type)
        && toInteger(normalizedLeft.period_month) === toInteger(normalizedRight.period_month)
        && toInteger(normalizedLeft.period_year) === toInteger(normalizedRight.period_year);
}

async function consumeDiscountForPeriod(user, periodMonth, periodYear) {
    if (!user || !(toInteger(user.discount_months) > 0) || toInteger(user.discount_months_used) >= toInteger(user.discount_months)) {
        return false;
    }

    const alreadyCounted = await hasAnyCommissionCreditForUserPeriod(user.id, periodMonth, periodYear);
    if (alreadyCounted) {
        return false;
    }

    const newDiscountMonthsUsed = toInteger(user.discount_months_used) + 1;
    await dbRun("UPDATE users SET discount_months_used = ? WHERE id = ?", [newDiscountMonthsUsed, user.id]);
    user.discount_months_used = newDiscountMonthsUsed;

    if (newDiscountMonthsUsed >= toInteger(user.discount_months)) {
        await dbRun(`UPDATE users SET
            discount_amount = 0,
            discount_percentage = 0,
            discount_reason = NULL,
            discount_valid_until = NULL,
            discount_created_by = NULL,
            discount_created_at = NULL
            WHERE id = ?`, [user.id]);
        user.discount_amount = 0;
        user.discount_percentage = 0;
        user.discount_reason = null;
        user.discount_valid_until = null;
        user.discount_created_by = null;
        user.discount_created_at = null;
    }

    return true;
}

async function recordPaymentHistoryEntry({
    userId,
    amountPaid,
    amountDue,
    isPartial,
    periodMonth,
    periodYear,
    paymentMethod,
    notes,
    createdBy
}) {
    const result = await dbRun(
        `INSERT INTO payment_history (
            user_id, amount_paid, amount_due, is_partial, period_month, period_year,
            payment_method, notes, created_by, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            userId,
            Math.abs(toInteger(amountPaid)),
            Math.abs(toInteger(amountDue)),
            isPartial ? 1 : 0,
            periodMonth,
            periodYear,
            paymentMethod || null,
            notes || "",
            createdBy || "system",
            buildNowIso()
        ]
    );

    await syncPaymentLedgerDomains();
    return { id: result.lastID };
}

async function recordPaymentReversalEntry({
    userId,
    periodMonth,
    periodYear,
    amountReversed,
    sourceRequestId = null,
    sourceAdminAction = null,
    createdBy,
    reason,
    idempotencyKey = null
}) {
    await ensurePaymentFinanceTables();

    const normalizedAmount = Math.abs(toInteger(amountReversed));
    if (!normalizedAmount) {
        return { created: false, reason: "no_amount" };
    }

    const eventKey = idempotencyKey
        || `payment_reversal:${userId}:${periodYear}:${periodMonth}:${sourceRequestId || "no-request"}:${sourceAdminAction || "no-admin-action"}`;

    try {
        const result = await dbRun(
            `INSERT INTO payment_reversals (
                user_id, period_month, period_year, amount_reversed, source_request_id, source_admin_action,
                created_by, created_at, reason, status, event_key
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)`,
            [
                userId,
                periodMonth,
                periodYear,
                normalizedAmount,
                sourceRequestId ? String(sourceRequestId) : null,
                sourceAdminAction || null,
                createdBy || "system",
                buildNowIso(),
                reason || "payment_reversal",
                eventKey
            ]
        );
        await syncPaymentLedgerDomains();
        return {
            created: true,
            duplicate: false,
            id: result.lastID,
            eventKey
        };
    } catch (error) {
        if (!String(error.message || "").includes("UNIQUE")) {
            throw error;
        }
        const row = await dbGet("SELECT id FROM payment_reversals WHERE event_key = ?", [eventKey]);
        return {
            created: false,
            duplicate: true,
            id: row?.id || null,
            eventKey
        };
    }
}

async function recordPaymentWaiverEntry({
    userId,
    periodMonth,
    periodYear,
    amountWaived = 0,
    reason,
    createdBy,
    idempotencyKey = null
}) {
    await ensurePaymentFinanceTables();

    const eventKey = idempotencyKey || `payment_waiver:${userId}:${periodYear}:${periodMonth}`;

    try {
        const result = await dbRun(
            `INSERT INTO payment_waivers (
                user_id, period_month, period_year, amount_waived, reason, created_by, created_at, status, event_key
             ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
            [
                userId,
                periodMonth,
                periodYear,
                Math.abs(toInteger(amountWaived)),
                reason || "Gratis",
                createdBy || "system",
                buildNowIso(),
                eventKey
            ]
        );
        return { created: true, duplicate: false, id: result.lastID, eventKey };
    } catch (error) {
        if (!String(error.message || "").includes("UNIQUE")) {
            throw error;
        }
        const row = await dbGet("SELECT id FROM payment_waivers WHERE event_key = ?", [eventKey]);
        return { created: false, duplicate: true, id: row?.id || null, eventKey };
    }
}

async function getPaymentPositionForPeriod(user, periodMonth, periodYear, options = {}) {
    await ensurePaymentFinanceTables();
    const userId = typeof user === "object" ? user.id : user;
    const amountDue = Math.abs(toInteger(options.amountDue || (typeof user === "object" ? getEffectivePrice(user) : 0)));

    const { paidRow, reversalRow, waiverRow } = await withReaderContext(async (context) => ({
        paidRow: await readerGet(
            `SELECT COALESCE(SUM(amount_paid), 0) AS gross_paid
             FROM payment_history
             WHERE user_id = ? AND period_month = ? AND period_year = ?`,
            [userId, periodMonth, periodYear],
            context
        ),
        reversalRow: await readerGet(
            `SELECT COALESCE(SUM(amount_reversed), 0) AS total_reversal
             FROM payment_reversals
             WHERE user_id = ? AND period_month = ? AND period_year = ? AND status = 'completed'`,
            [userId, periodMonth, periodYear],
            context
        ),
        // Waiver (GRATIS/kompensasi) — TIDAK masuk gross_paid (bukan pemasukan), hanya menandai
        // periode ini "dibebaskan" sehingga dihitung lunas (aman isolir + sinkron rollover).
        waiverRow: await readerGet(
            `SELECT COUNT(*) AS waiver_count, COALESCE(SUM(amount_waived), 0) AS total_waived
             FROM payment_waivers
             WHERE user_id = ? AND period_month = ? AND period_year = ? AND status = 'active'`,
            [userId, periodMonth, periodYear],
            context
        )
    }));

    const grossPaid = Math.abs(toInteger(paidRow?.gross_paid));
    const totalReversal = Math.abs(toInteger(reversalRow?.total_reversal));
    const netPaid = Math.max(0, grossPaid - totalReversal);
    const isWaived = toInteger(waiverRow?.waiver_count) > 0;
    const totalWaived = Math.abs(toInteger(waiverRow?.total_waived));
    // Tagihan Rp0 (pelanggan gratis / paket whitelist) = tak ada yang harus dibayar → otomatis LUNAS.
    // Dulu cabang `netPaid > 0` menuntut adanya pembayaran, sehingga pelanggan gratis (yang memang tak
    // pernah bayar) selalu ter-vonis "belum bayar" walau outstanding=0. Itu akar badge "Belum Bayar"
    // keliru di halaman Status Pembayaran — read-model men-derive `paid` LANGSUNG dari is_fully_paid ini.
    const paidByPayment = amountDue > 0 ? netPaid >= amountDue : true;
    const outstanding = isWaived ? 0 : Math.max(0, amountDue - netPaid);

    return {
        user_id: String(userId),
        period_month: periodMonth,
        period_year: periodYear,
        amount_due: amountDue,
        gross_paid: grossPaid,
        total_reversal: totalReversal,
        net_paid: netPaid,
        is_waived: isWaived,
        total_waived: totalWaived,
        outstanding,
        is_fully_paid: isWaived || paidByPayment
    };
}

/**
 * Daftar user_id yang punya baris `payment_history` pada satu periode.
 * Dipakai pemanggil yang butuh mengenali baris ledger yang SUDAH ditulis (idempotensi)
 * tanpa bergantung pada cache turunan `users.paid` — flag itu selalu di-derive ulang ke
 * periode berjalan, jadi tidak bisa dipakai menandai periode lain.
 * @param {number} periodMonth
 * @param {number} periodYear
 * @param {{createdBy?: string|null}} [options] Saring per penulis baris, mis. "system-backfill".
 * @returns {Promise<string[]>} user_id sebagai string (aman dibanding-bandingkan lintas tipe).
 */
async function listPaymentHistoryUserIdsForPeriod(periodMonth, periodYear, options = {}) {
    await ensurePaymentFinanceTables();
    const { createdBy = null } = options;

    const params = [periodMonth, periodYear];
    let sql = `SELECT DISTINCT user_id
               FROM payment_history
               WHERE period_month = ? AND period_year = ?`;
    if (createdBy) {
        sql += " AND created_by = ?";
        params.push(createdBy);
    }

    const rows = await withReaderContext((context) => readerAll(sql, params, context));
    return rows.map((row) => String(row.user_id));
}

async function syncUserPaidStatusForPeriod({ user, periodMonth, periodYear, amountDue = null }) {
    const position = await getPaymentPositionForPeriod(user, periodMonth, periodYear, { amountDue });
    await setUserPaidStatus(user, position.is_fully_paid);
    return position;
}

async function syncUserPaidStatusForCurrentPeriod({ user, amountDue = null, date = null } = {}) {
    const { periodMonth, periodYear } = getCurrentBillingPeriod({ date });
    const resolvedAmountDue = amountDue !== null ? amountDue : getEffectivePrice(user);
    const position = await getPaymentPositionForPeriod(user, periodMonth, periodYear, { amountDue: resolvedAmountDue });
    await setUserPaidStatus(user, position.is_fully_paid);
    return position;
}

async function getPaymentTimelineForPeriod(userId, periodMonth = null, periodYear = null) {
    await ensurePaymentFinanceTables();
    const params = [userId];
    const where = ["user_id = ?"];

    if (Number.isInteger(periodMonth) && Number.isInteger(periodYear)) {
        where.push("period_month = ?", "period_year = ?");
        params.push(periodMonth, periodYear);
    }

    const { paymentRows, reversalRows } = await withReaderContext(async (context) => ({
        paymentRows: await readerAll(
            `SELECT
                ph.id,
                ph.user_id,
                ph.amount_paid,
                ph.amount_due,
                ph.is_partial,
                ph.period_month,
                ph.period_year,
                ph.payment_method,
                ph.notes,
                ph.created_by,
                ph.created_at,
                u.name AS user_name,
                u.subscription,
                u.phone_number
             FROM payment_history ph
             LEFT JOIN users u ON ph.user_id = u.id
             WHERE ${where.join(" AND ")}
             ORDER BY datetime(ph.created_at) DESC, ph.id DESC`,
            params,
            context
        ),
        reversalRows: await readerAll(
            `SELECT
                pr.id,
                pr.user_id,
                pr.amount_reversed,
                pr.period_month,
                pr.period_year,
                pr.reason,
                pr.created_by,
                pr.created_at,
                pr.source_request_id,
                pr.source_admin_action,
                u.name AS user_name,
                u.subscription,
                u.phone_number
             FROM payment_reversals pr
             LEFT JOIN users u ON pr.user_id = u.id
             WHERE ${where.join(" AND ")} AND pr.status = 'completed'
             ORDER BY datetime(pr.created_at) DESC, pr.id DESC`,
            params,
            context
        )
    }));

    const entries = [
        ...paymentRows.map((row) => ({
            type: "payment",
            id: row.id,
            user_id: row.user_id,
            user_name: row.user_name || null,
            subscription: row.subscription || null,
            phone_number: row.phone_number || null,
            amount: toInteger(row.amount_paid),
            signed_amount: toInteger(row.amount_paid),
            amount_due: toInteger(row.amount_due),
            is_partial: Boolean(row.is_partial),
            payment_method: row.payment_method || null,
            notes: row.notes || "",
            created_by: row.created_by || "system",
            created_at: row.created_at,
            period_month: toInteger(row.period_month),
            period_year: toInteger(row.period_year)
        })),
        ...reversalRows.map((row) => ({
            type: "reversal",
            id: row.id,
            user_id: row.user_id,
            user_name: row.user_name || null,
            subscription: row.subscription || null,
            phone_number: row.phone_number || null,
            amount: toInteger(row.amount_reversed),
            signed_amount: -Math.abs(toInteger(row.amount_reversed)),
            amount_due: 0,
            is_partial: false,
            payment_method: "REVERSAL",
            notes: row.reason || "",
            created_by: row.created_by || "system",
            created_at: row.created_at,
            period_month: toInteger(row.period_month),
            period_year: toInteger(row.period_year),
            source_request_id: row.source_request_id || null,
            source_admin_action: row.source_admin_action || null
        }))
    ].sort((left, right) => {
        const timeDiff = new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
        if (timeDiff !== 0) {
            return timeDiff;
        }
        return toInteger(right.id) - toInteger(left.id);
    });

    const grossPaid = paymentRows.reduce((sum, row) => sum + toInteger(row.amount_paid), 0);
    const totalReversal = reversalRows.reduce((sum, row) => sum + toInteger(row.amount_reversed), 0);

    return {
        entries,
        summary: {
            payment_transactions: paymentRows.length,
            reversal_transactions: reversalRows.length,
            total_transactions: entries.length,
            gross_paid: grossPaid,
            total_reversal: totalReversal,
            net_paid: Math.max(0, grossPaid - totalReversal)
        }
    };
}

async function getPaymentReportForPeriod(periodMonth, periodYear) {
    await ensurePaymentFinanceTables();

    const { payments, reversals } = await withReaderContext(async (context) => ({
        payments: await readerAll(
            `SELECT
                ph.*,
                u.name AS user_name,
                u.subscription,
                u.phone_number
             FROM payment_history ph
             LEFT JOIN users u ON ph.user_id = u.id
             WHERE ph.period_month = ? AND ph.period_year = ?
             ORDER BY datetime(ph.created_at) DESC, ph.id DESC`,
            [periodMonth, periodYear],
            context
        ),
        reversals: await readerAll(
            `SELECT
                pr.*,
                u.name AS user_name,
                u.subscription,
                u.phone_number
             FROM payment_reversals pr
             LEFT JOIN users u ON pr.user_id = u.id
             WHERE pr.period_month = ? AND pr.period_year = ? AND pr.status = 'completed'
             ORDER BY datetime(pr.created_at) DESC, pr.id DESC`,
            [periodMonth, periodYear],
            context
        )
    }));

    const transactions = [
        ...payments.map((row) => ({
            type: "payment",
            id: row.id,
            user_id: row.user_id,
            user_name: row.user_name || null,
            subscription: row.subscription || null,
            phone_number: row.phone_number || null,
            amount: toInteger(row.amount_paid),
            signed_amount: toInteger(row.amount_paid),
            amount_due: toInteger(row.amount_due),
            is_partial: Boolean(row.is_partial),
            payment_method: row.payment_method || null,
            notes: row.notes || "",
            created_by: row.created_by || "system",
            created_at: row.created_at,
            period_month: toInteger(row.period_month),
            period_year: toInteger(row.period_year)
        })),
        ...reversals.map((row) => ({
            type: "reversal",
            id: row.id,
            user_id: row.user_id,
            user_name: row.user_name || null,
            subscription: row.subscription || null,
            phone_number: row.phone_number || null,
            amount: toInteger(row.amount_reversed),
            signed_amount: -Math.abs(toInteger(row.amount_reversed)),
            amount_due: 0,
            is_partial: false,
            payment_method: "REVERSAL",
            notes: row.reason || "",
            created_by: row.created_by || "system",
            created_at: row.created_at,
            period_month: toInteger(row.period_month),
            period_year: toInteger(row.period_year),
            source_request_id: row.source_request_id || null,
            source_admin_action: row.source_admin_action || null
        }))
    ].sort((left, right) => {
        const timeDiff = new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
        if (timeDiff !== 0) {
            return timeDiff;
        }
        return toInteger(right.id) - toInteger(left.id);
    });

    const grossPaid = payments.reduce((sum, row) => sum + toInteger(row.amount_paid), 0);
    const totalReversal = reversals.reduce((sum, row) => sum + toInteger(row.amount_reversed), 0);

    return {
        period_month: periodMonth,
        period_year: periodYear,
        summary: {
            payment_transactions: payments.length,
            reversal_transactions: reversals.length,
            total_transactions: transactions.length,
            gross_paid: grossPaid,
            total_reversal: totalReversal,
            net_paid: Math.max(0, grossPaid - totalReversal),
            partial_payments: payments.filter((row) => Boolean(row.is_partial)).length,
            full_payments: payments.filter((row) => !Boolean(row.is_partial)).length
        },
        transactions
    };
}

async function applyPaymentStatusChange({
    user,
    paid,
    periodMonth,
    periodYear,
    amountPaid = null,
    amountDue = null,
    isPartial = false,
    paymentMethod = null,
    notes = "",
    createdBy = "system",
    sourceRequestId = null,
    sourceAdminAction = null,
    teknisiId = null,
    teknisiName = null,
    agenId = null,
    agenName = null,
    onFinalPaid = null
}) {
    if (!user || !user.id) {
        throw new Error("user wajib diisi");
    }

    await ensurePaymentFinanceTables();

    const resolvedAmountDue = Math.max(0, toInteger(amountDue) || getEffectivePrice(user));
    const positionBefore = await getPaymentPositionForPeriod(user, periodMonth, periodYear, { amountDue: resolvedAmountDue });

    if (paid) {
        if (positionBefore.is_fully_paid) {
            return {
                action: "no_change",
                reason: "already_fully_paid",
                positionBefore,
                positionAfter: positionBefore
            };
        }

        const resolvedAmountPaid = Math.max(0, toInteger(amountPaid) || resolvedAmountDue);
        if (!resolvedAmountPaid) {
            throw new Error("amountPaid wajib lebih besar dari 0");
        }

        const paymentHistory = await recordPaymentHistoryEntry({
            userId: user.id,
            amountPaid: resolvedAmountPaid,
            amountDue: resolvedAmountDue,
            isPartial,
            periodMonth,
            periodYear,
            paymentMethod,
            notes,
            createdBy
        });

        const positionAfter = await getPaymentPositionForPeriod(user, periodMonth, periodYear, { amountDue: resolvedAmountDue });
        const currentPeriodPosition = await syncUserPaidStatusForCurrentPeriod({ user });

        const becameFullyPaid = !positionBefore.is_fully_paid && positionAfter.is_fully_paid;
        let settlement = { applied: false, reason: "not_final_paid" };
        let agenSettlement = { applied: false, reason: "not_final_paid" };

        if (becameFullyPaid) {
            settlement = await evaluateCollectionSettlement({
                user,
                paid: true,
                periodMonth,
                periodYear,
                teknisiId,
                teknisiName,
                sourceRequestId,
                sourcePaymentHistoryId: paymentHistory.id,
                createdBy
            });
            // Komisi agen: jalur terpisah dari teknisi. Pembayaran ditagih oleh teknisi
            // ATAU agen (tak pernah keduanya), jadi hanya yang punya konteks yang mengkredit.
            agenSettlement = await evaluateAgenCollectionSettlement({
                user,
                paid: true,
                periodMonth,
                periodYear,
                agenId,
                agenName,
                sourceRequestId,
                sourcePaymentHistoryId: paymentHistory.id,
                createdBy
            });
            await consumeDiscountForPeriod(user, periodMonth, periodYear);
            if (typeof onFinalPaid === "function") {
                await onFinalPaid({
                    user,
                    periodMonth,
                    periodYear,
                    positionBefore,
                    positionAfter,
                    paymentHistoryId: paymentHistory.id
                });
            }
        }

        return {
            action: "paid",
            paymentHistoryId: paymentHistory.id,
            settlement,
            agenSettlement,
            becameFullyPaid,
            positionBefore,
            positionAfter,
            currentPeriodPosition
        };
    }

    if (positionBefore.net_paid <= 0) {
        await setUserPaidStatus(user, false);
        return {
            action: "no_change",
            reason: "no_paid_position",
            positionBefore,
            positionAfter: { ...positionBefore, is_fully_paid: false }
        };
    }

    const reversalAmount = Math.max(0, toInteger(amountPaid) || positionBefore.net_paid);
    const reversal = await recordPaymentReversalEntry({
        userId: user.id,
        periodMonth,
        periodYear,
        amountReversed: reversalAmount,
        sourceRequestId,
        sourceAdminAction,
        createdBy,
        reason: notes || "payment_reversal"
    });

    const positionAfter = await getPaymentPositionForPeriod(user, periodMonth, periodYear, { amountDue: resolvedAmountDue });
    const currentPeriodPosition = await syncUserPaidStatusForCurrentPeriod({ user });

    const settlement = await evaluateCollectionSettlement({
        user,
        paid: false,
        periodMonth,
        periodYear,
        teknisiId,
        teknisiName,
        sourceRequestId,
        createdBy
    });

    const agenSettlement = await evaluateAgenCollectionSettlement({
        user,
        paid: false,
        periodMonth,
        periodYear,
        agenId,
        agenName,
        sourceRequestId,
        createdBy
    });

    return {
        action: reversal.created ? "reversed" : "duplicate_retry",
        reversalId: reversal.id || null,
        reversal,
        settlement,
        agenSettlement,
        positionBefore,
        positionAfter,
        currentPeriodPosition
    };
}

/**
 * Tandai sebuah periode sebagai GRATIS (dibebaskan dari tagihan) untuk satu pelanggan.
 * Mencatat waiver di tabel terpisah → periode dihitung lunas (is_fully_paid) sehingga aman dari
 * isolir & ikut tersinkron saat rollover, TANPA menambah pemasukan (waiver tak masuk gross_paid).
 * Idempoten via event_key per (user, periode).
 * @param {{user, periodMonth, periodYear, reason?, createdBy?}} input
 * @returns {Promise<{action, waiverId, positionBefore, positionAfter, currentPeriodPosition}>}
 */
async function applyFreeMonth({
    user,
    periodMonth,
    periodYear,
    reason = "Gratis",
    createdBy = "system"
}) {
    if (!user || !user.id) {
        throw new Error("user wajib diisi");
    }
    await ensurePaymentFinanceTables();

    const amountDue = Math.max(0, getEffectivePrice(user));
    const positionBefore = await getPaymentPositionForPeriod(user, periodMonth, periodYear, { amountDue });

    if (positionBefore.is_waived) {
        return { action: "no_change", reason: "already_waived", positionBefore, positionAfter: positionBefore };
    }

    const waiver = await recordPaymentWaiverEntry({
        userId: user.id,
        periodMonth,
        periodYear,
        amountWaived: amountDue,
        reason,
        createdBy
    });

    const positionAfter = await getPaymentPositionForPeriod(user, periodMonth, periodYear, { amountDue });
    const currentPeriodPosition = await syncUserPaidStatusForCurrentPeriod({ user });

    return {
        action: waiver.created ? "waived" : "duplicate_retry",
        waiverId: waiver.id || null,
        positionBefore,
        positionAfter,
        currentPeriodPosition
    };
}

async function getPaymentDiagnostics({ periodMonth, periodYear } = {}) {
    await ensurePaymentFinanceTables();

    const date = new Date();
    const month = Number.isInteger(periodMonth) ? periodMonth : date.getMonth() + 1;
    const year = Number.isInteger(periodYear) ? periodYear : date.getFullYear();

    const reversalRow = await withReaderContext((context) => readerGet(
        `SELECT COUNT(*) AS total, COALESCE(SUM(amount_reversed), 0) AS amount
         FROM payment_reversals
         WHERE period_month = ? AND period_year = ? AND status = 'completed'`,
        [month, year],
        context
    ));

    const currentBilling = getCurrentBillingPeriod();
    const mismatches = [];
    const usersRepo = getRuntimeRepository("users");
    const users = usersRepo ? usersRepo.getAll() : (global.users || []);
    // Lewati akun infra & paket whitelist (gratis/immun billing) — SAMA dengan filter reconcile
    // (`paid-flag-reconcile.js`). Flag `users.paid` mereka memang tak dipelihara (selalu 0), sedangkan
    // ledger-nya lunas (tagihan Rp0), jadi membandingkannya hanya menghasilkan "mismatch" palsu yang
    // mengaburkan drift nyata.
    const packagesRepo = getRuntimeRepository("packages");
    const packagesDb = packagesRepo ? packagesRepo.getAll() : loadJSON("database/packages.json");
    const whitelistedNames = new Set((packagesDb || []).filter((pkg) => pkg && pkg.whitelist === true).map((pkg) => pkg.name));
    for (const user of users) {
        if (isInfrastructure(user) || whitelistedNames.has(user.subscription)) {
            continue;
        }
        const position = await getPaymentPositionForPeriod(user, currentBilling.periodMonth, currentBilling.periodYear);
        if (Boolean(toInteger(user.paid)) !== Boolean(position.is_fully_paid)) {
            mismatches.push({
                user_id: String(user.id),
                user_name: user.name,
                paid_flag: Boolean(toInteger(user.paid)),
                is_fully_paid: position.is_fully_paid,
                net_paid: position.net_paid,
                outstanding: position.outstanding,
                period_month: currentBilling.periodMonth,
                period_year: currentBilling.periodYear
            });
        }
    }

    return {
        period_month: month,
        period_year: year,
        current_period_month: currentBilling.periodMonth,
        current_period_year: currentBilling.periodYear,
        reversal_count: toInteger(reversalRow?.total),
        reversal_amount: toInteger(reversalRow?.amount),
        mismatched_paid_status: mismatches
    };
}

module.exports = {
    ensurePaymentFinanceTables,
    getCurrentBillingPeriod,
    getPackagePrice,
    getEffectivePrice,
    normalizeUserPaymentMethod,
    normalizePaymentRequestScope,
    isSamePaymentRequestScope,
    getPaymentPositionForPeriod,
    listPaymentHistoryUserIdsForPeriod,
    syncUserPaidStatusForPeriod,
    syncUserPaidStatusForCurrentPeriod,
    getPaymentTimelineForPeriod,
    getPaymentReportForPeriod,
    applyPaymentStatusChange,
    applyFreeMonth,
    getPaymentDiagnostics,
    withPaymentReadContext
};
