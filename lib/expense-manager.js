"use strict";

const { recordFinancialLedgerEntry } = require("./financial-ledger");

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

const EXPENSE_CATEGORIES = [
    "operasional",
    "gaji_payroll",
    "kasbon_outflow",
    "transport",
    "maintenance",
    "marketing",
    "internet_utilities",
    "office_supply",
    "other"
];

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

function toInteger(value, fallback = 0) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeDate(input) {
    const date = input ? new Date(input) : new Date();
    if (Number.isNaN(date.getTime())) {
        throw new Error("Tanggal pengeluaran tidak valid");
    }
    return date.toISOString();
}

function derivePeriod(dateInput) {
    const date = new Date(dateInput);
    return {
        periodMonth: date.getMonth() + 1,
        periodYear: date.getFullYear()
    };
}

function normalizePaymentMethod(method) {
    const normalized = String(method || "").trim().toUpperCase();
    if (!normalized) {
        throw new Error("Metode pembayaran wajib diisi");
    }
    return normalized;
}

function validatePayload(payload = {}) {
    const title = String(payload.title || "").trim();
    const category = String(payload.category || "").trim();
    const amount = Math.abs(toInteger(payload.amount));
    const expenseDate = normalizeDate(payload.expense_date || payload.expenseDate || new Date().toISOString());
    const paymentMethod = normalizePaymentMethod(payload.payment_method || payload.paymentMethod);

    if (!title) {
        throw new Error("Judul pengeluaran wajib diisi");
    }
    if (!EXPENSE_CATEGORIES.includes(category)) {
        throw new Error("Kategori pengeluaran tidak valid");
    }
    if (!amount || amount <= 0) {
        throw new Error("Nominal pengeluaran wajib lebih besar dari 0");
    }

    return {
        title,
        category,
        amount,
        expenseDate,
        paymentMethod,
        vendorOrCounterparty: String(payload.vendor_or_counterparty || payload.vendorOrCounterparty || "").trim() || null,
        notes: String(payload.notes || "").trim(),
        receiptPath: String(payload.receipt_path || payload.receiptPath || "").trim() || null
    };
}

async function ensureExpenseTables() {
    if (!initializationPromise) {
        initializationPromise = (async () => {
            await dbRun(`
                CREATE TABLE IF NOT EXISTS expense_entries (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    category TEXT NOT NULL,
                    amount INTEGER NOT NULL,
                    expense_date TEXT NOT NULL,
                    payment_method TEXT NOT NULL,
                    vendor_or_counterparty TEXT,
                    notes TEXT,
                    receipt_path TEXT,
                    status TEXT NOT NULL DEFAULT 'active',
                    revision_count INTEGER NOT NULL DEFAULT 1,
                    replaced_by_id INTEGER,
                    cancelled_at TEXT,
                    cancelled_by TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    created_by TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                )
            `);
            await dbRun("CREATE INDEX IF NOT EXISTS idx_expense_entries_period ON expense_entries(expense_date)");
            await dbRun("CREATE INDEX IF NOT EXISTS idx_expense_entries_category ON expense_entries(category)");
            await dbRun("CREATE INDEX IF NOT EXISTS idx_expense_entries_status ON expense_entries(status)");
        })().catch((error) => {
            initializationPromise = null;
            throw error;
        });
    }
    return initializationPromise;
}

async function getExpenseById(id) {
    await ensureExpenseTables();
    return dbGet("SELECT * FROM expense_entries WHERE id = ?", [toInteger(id)]);
}

async function appendExpenseLedgerEntry(expense, direction, actorName, referenceType, referenceId, status, notes, metadata = {}) {
    const period = derivePeriod(expense.expense_date);
    return recordFinancialLedgerEntry({
        domain: "expense_entry",
        referenceType,
        referenceId,
        amount: expense.amount,
        direction,
        paymentMethod: expense.payment_method,
        periodMonth: period.periodMonth,
        periodYear: period.periodYear,
        status,
        occurredAt: expense.expense_date,
        createdBy: actorName,
        notes,
        source: "admin",
        metadata: {
            expense_id: expense.id,
            title: expense.title,
            category: expense.category,
            vendor_or_counterparty: expense.vendor_or_counterparty,
            receipt_path: expense.receipt_path,
            ...metadata
        },
        eventKey: `${referenceType}:${referenceId}`
    });
}

function mapExpenseRow(row) {
    if (!row) return null;
    return {
        id: row.id,
        title: row.title,
        category: row.category,
        amount: row.amount,
        expense_date: row.expense_date,
        payment_method: row.payment_method,
        vendor_or_counterparty: row.vendor_or_counterparty,
        notes: row.notes,
        receipt_path: row.receipt_path,
        status: row.status,
        revision_count: row.revision_count,
        replaced_by_id: row.replaced_by_id,
        cancelled_at: row.cancelled_at,
        cancelled_by: row.cancelled_by,
        created_at: row.created_at,
        created_by: row.created_by,
        updated_at: row.updated_at
    };
}

async function createExpense(payload, actor = {}) {
    await ensureExpenseTables();
    const normalized = validatePayload(payload);
    const createdBy = actor.name || actor.username || "system";
    const insert = await dbRun(
        `INSERT INTO expense_entries (
            title, category, amount, expense_date, payment_method,
            vendor_or_counterparty, notes, receipt_path, status,
            revision_count, created_at, created_by, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, ?)`,
        [
            normalized.title,
            normalized.category,
            normalized.amount,
            normalized.expenseDate,
            normalized.paymentMethod,
            normalized.vendorOrCounterparty,
            normalized.notes,
            normalized.receiptPath,
            new Date().toISOString(),
            createdBy,
            new Date().toISOString()
        ]
    );
    const created = await getExpenseById(insert.lastID);
    await appendExpenseLedgerEntry(created, "debit", createdBy, "expense_entry", created.id, "active", created.notes || created.title);
    return mapExpenseRow(created);
}

async function updateExpense(id, payload, actor = {}) {
    await ensureExpenseTables();
    const current = await getExpenseById(id);
    if (!current) {
        throw new Error("Pengeluaran tidak ditemukan");
    }
    if (current.status !== "active") {
        throw new Error("Hanya pengeluaran aktif yang dapat direvisi");
    }

    const normalized = validatePayload(payload);
    const actorName = actor.name || actor.username || "system";

    await appendExpenseLedgerEntry(
        current,
        "credit",
        actorName,
        "expense_entry_revision_reversal",
        `${current.id}:v${current.revision_count}`,
        "revised",
        `Reversal revisi pengeluaran #${current.id}`,
        { revision_count: current.revision_count }
    );

    const insert = await dbRun(
        `INSERT INTO expense_entries (
            title, category, amount, expense_date, payment_method,
            vendor_or_counterparty, notes, receipt_path, status,
            revision_count, created_at, created_by, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
        [
            normalized.title,
            normalized.category,
            normalized.amount,
            normalized.expenseDate,
            normalized.paymentMethod,
            normalized.vendorOrCounterparty,
            normalized.notes,
            normalized.receiptPath,
            toInteger(current.revision_count, 1) + 1,
            current.created_at,
            current.created_by,
            new Date().toISOString()
        ]
    );

    await dbRun(
        `UPDATE expense_entries
         SET status = 'revised', replaced_by_id = ?, updated_at = ?
         WHERE id = ?`,
        [insert.lastID, new Date().toISOString(), current.id]
    );

    const updated = await getExpenseById(insert.lastID);
    await appendExpenseLedgerEntry(
        updated,
        "debit",
        actorName,
        "expense_entry_revision",
        `${updated.id}:v${updated.revision_count}`,
        "active",
        updated.notes || updated.title,
        { revised_from_id: current.id }
    );

    return {
        previous: mapExpenseRow(current),
        current: mapExpenseRow(updated)
    };
}

async function cancelExpense(id, actor = {}, notes = "") {
    await ensureExpenseTables();
    const current = await getExpenseById(id);
    if (!current) {
        throw new Error("Pengeluaran tidak ditemukan");
    }
    if (current.status !== "active") {
        throw new Error("Pengeluaran ini sudah tidak aktif");
    }

    const actorName = actor.name || actor.username || "system";
    await appendExpenseLedgerEntry(
        current,
        "credit",
        actorName,
        "expense_entry_cancellation",
        `${current.id}:cancel`,
        "cancelled",
        notes || `Pembatalan pengeluaran #${current.id}`,
        { cancelled: true }
    );

    await dbRun(
        `UPDATE expense_entries
         SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?, notes = ?, updated_at = ?
         WHERE id = ?`,
        [new Date().toISOString(), actorName, notes || current.notes || "", new Date().toISOString(), current.id]
    );

    return mapExpenseRow(await getExpenseById(id));
}

async function listExpenses(filters = {}) {
    await ensureExpenseTables();
    const where = [];
    const params = [];

    if (filters.month && filters.year) {
        where.push("strftime('%m', expense_date) = ? AND strftime('%Y', expense_date) = ?");
        params.push(String(toInteger(filters.month)).padStart(2, "0"), String(toInteger(filters.year)));
    } else if (filters.year) {
        where.push("strftime('%Y', expense_date) = ?");
        params.push(String(toInteger(filters.year)));
    }
    if (filters.category) {
        where.push("category = ?");
        params.push(filters.category);
    }
    if (filters.paymentMethod) {
        where.push("payment_method = ?");
        params.push(filters.paymentMethod);
    }
    if (filters.status) {
        where.push("status = ?");
        params.push(filters.status);
    }
    if (filters.createdBy) {
        where.push("created_by = ?");
        params.push(filters.createdBy);
    }

    const rows = await dbAll(
        `SELECT *
         FROM expense_entries
         ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY datetime(expense_date) DESC, id DESC`,
        params
    );
    return rows.map(mapExpenseRow);
}

async function getExpenseSummary(filters = {}) {
    const entries = await listExpenses({ ...filters, status: "active" });
    const totalExpense = entries.reduce((sum, item) => sum + toInteger(item.amount), 0);
    const byCategory = {};

    for (const item of entries) {
        if (!byCategory[item.category]) {
            byCategory[item.category] = { count: 0, amount: 0 };
        }
        byCategory[item.category].count += 1;
        byCategory[item.category].amount += toInteger(item.amount);
    }

    return {
        total_expense: totalExpense,
        total_records: entries.length,
        by_category: byCategory,
        recent: entries.slice(0, 7),
        largest: [...entries].sort((a, b) => b.amount - a.amount).slice(0, 5)
    };
}

module.exports = {
    EXPENSE_CATEGORIES,
    ensureExpenseTables,
    createExpense,
    updateExpense,
    cancelExpense,
    listExpenses,
    getExpenseById,
    getExpenseSummary
};
