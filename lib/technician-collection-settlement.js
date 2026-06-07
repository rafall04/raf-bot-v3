"use strict";

const { loadJSON } = require('./database');
const { syncFinancialLedgerSources } = require('./financial-ledger');

let initializationPromise = null;

async function ensureMainDbReady() {
    if (global.db) {
        return global.db;
    }
    if (global.__dbInitPromise) {
        await global.__dbInitPromise;
    }
    if (!global.db) {
        throw new Error('Database not initialized');
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

async function ensureSettlementTable() {
    if (!initializationPromise) {
        initializationPromise = (async () => {
            await dbRun(`
                CREATE TABLE IF NOT EXISTS technician_collection_ledger (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    teknisi_id TEXT NOT NULL,
                    teknisi_name TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    user_name TEXT NOT NULL,
                    period_month INTEGER NOT NULL,
                    period_year INTEGER NOT NULL,
                    commission_amount INTEGER NOT NULL,
                    direction TEXT NOT NULL CHECK(direction IN ('credit', 'debit')),
                    reason TEXT NOT NULL CHECK(reason IN ('customer_paid_final', 'customer_reverted_unpaid', 'manual_adjustment')),
                    source_request_id TEXT,
                    source_payment_history_id INTEGER,
                    event_key TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    created_by TEXT NOT NULL
                )
            `);
            await dbRun('CREATE UNIQUE INDEX IF NOT EXISTS idx_technician_collection_event_key ON technician_collection_ledger(event_key)');
            await dbRun('CREATE INDEX IF NOT EXISTS idx_technician_collection_period ON technician_collection_ledger(period_year, period_month)');
            await dbRun('CREATE INDEX IF NOT EXISTS idx_technician_collection_user_period ON technician_collection_ledger(user_id, period_year, period_month)');
            await dbRun('CREATE INDEX IF NOT EXISTS idx_technician_collection_teknisi_period ON technician_collection_ledger(teknisi_id, period_year, period_month)');
            const columns = await dbAll("PRAGMA table_info(technician_collection_ledger)");
            const hasPayrollId = columns.some((column) => column.name === 'payroll_id');
            const hasPayrollLockedAt = columns.some((column) => column.name === 'payroll_locked_at');
            if (!hasPayrollId) {
                await dbRun("ALTER TABLE technician_collection_ledger ADD COLUMN payroll_id INTEGER");
            }
            if (!hasPayrollLockedAt) {
                await dbRun("ALTER TABLE technician_collection_ledger ADD COLUMN payroll_locked_at TEXT");
            }
            await dbRun('CREATE INDEX IF NOT EXISTS idx_technician_collection_payroll_id ON technician_collection_ledger(payroll_id)');
        })().catch((error) => {
            initializationPromise = null;
            throw error;
        });
    }
    return initializationPromise;
}

function normalizeBoolean(value, defaultValue = false) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        return value.toLowerCase() === 'true';
    }
    if (typeof value === 'number') {
        return value === 1;
    }
    return defaultValue;
}

function getCommissionConfig() {
    const enabled = normalizeBoolean(global.config?.teknisiCollectionCommissionEnabled, false);
    const amountRaw = parseInt(global.config?.teknisiCollectionCommissionAmount ?? 0, 10);
    return {
        enabled,
        amount: Number.isFinite(amountRaw) && amountRaw > 0 ? amountRaw : 0
    };
}

function getPeriodParts(input = {}) {
    if (Number.isInteger(input.periodMonth) && Number.isInteger(input.periodYear)) {
        return { periodMonth: input.periodMonth, periodYear: input.periodYear };
    }

    const sourceDate = input.date || input.paidDate || input.createdAt || new Date();
    const date = sourceDate instanceof Date ? sourceDate : new Date(sourceDate);
    return {
        periodMonth: date.getMonth() + 1,
        periodYear: date.getFullYear()
    };
}

async function hasAnyCommissionCreditForUserPeriod(userId, periodMonth, periodYear) {
    await ensureSettlementTable();
    const row = await dbGet(
        `SELECT COUNT(*) as total
         FROM technician_collection_ledger
         WHERE user_id = ? AND period_month = ? AND period_year = ? AND direction = 'credit'`,
        [String(userId), periodMonth, periodYear]
    );
    return (row?.total || 0) > 0;
}

async function getNetForTechnicianPeriodUser(teknisiId, userId, periodMonth, periodYear) {
    await ensureSettlementTable();
    const rows = await dbAll(
        `SELECT direction, commission_amount
         FROM technician_collection_ledger
         WHERE teknisi_id = ? AND user_id = ? AND period_month = ? AND period_year = ?`,
        [String(teknisiId), String(userId), periodMonth, periodYear]
    );
    return rows.reduce((sum, row) => sum + (row.direction === 'credit' ? row.commission_amount : -row.commission_amount), 0);
}


async function resolveTechnicianForSettlement({ teknisiId, teknisiName, userId, periodMonth, periodYear }) {
    if (teknisiId) {
        const account = (global.accounts || []).find((item) => String(item.id) === String(teknisiId));
        return {
            teknisiId: String(teknisiId),
            teknisiName: teknisiName || account?.name || account?.username || `Teknisi ${teknisiId}`
        };
    }

    let requests = [];
    try {
        requests = loadJSON('database/requests.json');
    } catch (_error) {
        requests = [];
    }

    const candidates = requests
        .filter((request) => String(request.userId) === String(userId))
        .filter((request) => request.status === 'approved' && request.newStatus === true && request.requested_by_teknisi_id)
        .filter((request) => {
            const requestPeriodMonth = parseInt(request.period_month, 10);
            const requestPeriodYear = parseInt(request.period_year, 10);
            if (Number.isInteger(requestPeriodMonth) && Number.isInteger(requestPeriodYear)) {
                return requestPeriodMonth === periodMonth && requestPeriodYear === periodYear;
            }
            const requestDate = new Date(request.updated_at || request.created_at || Date.now());
            return requestDate.getMonth() + 1 === periodMonth && requestDate.getFullYear() === periodYear;
        })
        .sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0));

    if (candidates.length > 0) {
        const latest = candidates[0];
        const account = (global.accounts || []).find((item) => String(item.id) === String(latest.requested_by_teknisi_id));
        return {
            teknisiId: String(latest.requested_by_teknisi_id),
            teknisiName: account?.name || account?.username || latest.requestorName || `Teknisi ${latest.requested_by_teknisi_id}`
        };
    }

    const ledgerRow = await dbGet(
        `SELECT teknisi_id, teknisi_name
         FROM technician_collection_ledger
         WHERE user_id = ? AND period_month = ? AND period_year = ?
         ORDER BY datetime(created_at) DESC, id DESC
         LIMIT 1`,
        [String(userId), periodMonth, periodYear]
    );

    if (ledgerRow) {
        return {
            teknisiId: String(ledgerRow.teknisi_id),
            teknisiName: ledgerRow.teknisi_name
        };
    }

    return null;
}

async function getLatestOutstandingCredit(userId, periodMonth, periodYear) {
    await ensureSettlementTable();
    const rows = await dbAll(
        `SELECT *
         FROM technician_collection_ledger
         WHERE user_id = ? AND period_month = ? AND period_year = ?
         ORDER BY datetime(created_at) ASC, id ASC`,
        [String(userId), periodMonth, periodYear]
    );

    const balances = new Map();
    const latestCredit = new Map();

    for (const row of rows) {
        const key = String(row.teknisi_id);
        const current = balances.get(key) || 0;
        if (row.direction === 'credit') {
            balances.set(key, current + row.commission_amount);
            latestCredit.set(key, row);
        } else {
            balances.set(key, current - row.commission_amount);
        }
    }

    let selected = null;
    for (const [key, balance] of balances.entries()) {
        if (balance > 0) {
            const candidate = latestCredit.get(key);
            if (!selected || new Date(candidate.created_at) > new Date(selected.created_at)) {
                selected = candidate;
            }
        }
    }

    return selected;
}

function buildEventKey({ direction, teknisiId, userId, periodMonth, periodYear, sourceRequestId, sourcePaymentHistoryId, fallbackKey }) {
    return [direction, teknisiId, userId, periodYear, periodMonth, sourceRequestId || 'no-request', sourcePaymentHistoryId || 'no-payment-history', fallbackKey || 'state'].join(':');
}

async function insertSettlementEntry({ teknisiId, teknisiName, user, periodMonth, periodYear, commissionAmount, direction, reason, sourceRequestId = null, sourcePaymentHistoryId = null, createdBy = 'system', fallbackKey = 'state' }) {
    await ensureSettlementTable();
    const eventKey = buildEventKey({
        direction,
        teknisiId,
        userId: user.id,
        periodMonth,
        periodYear,
        sourceRequestId,
        sourcePaymentHistoryId,
        fallbackKey
    });

    try {
        const result = await dbRun(
            `INSERT INTO technician_collection_ledger (
                teknisi_id, teknisi_name, user_id, user_name, period_month, period_year,
                commission_amount, direction, reason, source_request_id, source_payment_history_id,
                event_key, created_by, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                String(teknisiId),
                teknisiName,
                String(user.id),
                user.name || `User ${user.id}`,
                periodMonth,
                periodYear,
                commissionAmount,
                direction,
                reason,
                sourceRequestId ? String(sourceRequestId) : null,
                sourcePaymentHistoryId || null,
                eventKey,
                createdBy,
                new Date().toISOString()
            ]
        );
        try {
            await syncFinancialLedgerSources({ domains: ['technician_collection'] });
        } catch (ledgerSyncError) {
            console.error('[TECHNICIAN_COLLECTION_LEDGER_SYNC_ERROR]', ledgerSyncError.message);
        }

        return {
            inserted: true,
            id: result.lastID,
            eventKey
        };
    } catch (error) {
        if (String(error.message || '').includes('UNIQUE')) {
            return {
                inserted: false,
                duplicate: true,
                eventKey
            };
        }
        throw error;
    }
}

async function evaluateCollectionSettlement({ user, paid, periodMonth, periodYear, teknisiId = null, teknisiName = null, sourceRequestId = null, sourcePaymentHistoryId = null, createdBy = 'system' }) {
    if (!user || !user.id) {
        return { applied: false, reason: 'missing_user' };
    }

    const config = getCommissionConfig();
    if (!config.enabled || config.amount <= 0) {
        return { applied: false, reason: 'commission_disabled' };
    }

    await ensureSettlementTable();

    if (paid) {
        const resolvedTechnician = await resolveTechnicianForSettlement({ teknisiId, teknisiName, userId: user.id, periodMonth, periodYear });
        if (!resolvedTechnician?.teknisiId) {
            return { applied: false, reason: 'no_technician_context' };
        }

        const net = await getNetForTechnicianPeriodUser(resolvedTechnician.teknisiId, user.id, periodMonth, periodYear);
        if (net > 0) {
            return { applied: false, reason: 'already_credited', teknisiId: resolvedTechnician.teknisiId };
        }

        const inserted = await insertSettlementEntry({
            teknisiId: resolvedTechnician.teknisiId,
            teknisiName: resolvedTechnician.teknisiName,
            user,
            periodMonth,
            periodYear,
            commissionAmount: config.amount,
            direction: 'credit',
            reason: 'customer_paid_final',
            sourceRequestId,
            sourcePaymentHistoryId,
            createdBy,
            fallbackKey: sourceRequestId || sourcePaymentHistoryId || 'paid'
        });

        return {
            applied: inserted.inserted,
            direction: 'credit',
            amount: config.amount,
            teknisiId: resolvedTechnician.teknisiId,
            teknisiName: resolvedTechnician.teknisiName,
            duplicate: inserted.duplicate === true,
            reason: inserted.inserted ? 'credited' : 'duplicate'
        };
    }

    const outstandingCredit = await getLatestOutstandingCredit(user.id, periodMonth, periodYear);
    if (!outstandingCredit) {
        return { applied: false, reason: 'no_credit_to_reverse' };
    }

    const inserted = await insertSettlementEntry({
        teknisiId: String(outstandingCredit.teknisi_id),
        teknisiName: outstandingCredit.teknisi_name,
        user,
        periodMonth,
        periodYear,
        commissionAmount: outstandingCredit.commission_amount,
        direction: 'debit',
        reason: 'customer_reverted_unpaid',
        sourceRequestId,
        sourcePaymentHistoryId,
        createdBy,
        fallbackKey: sourceRequestId || sourcePaymentHistoryId || outstandingCredit.id
    });

    return {
        applied: inserted.inserted,
        direction: 'debit',
        amount: outstandingCredit.commission_amount,
        teknisiId: String(outstandingCredit.teknisi_id),
        teknisiName: outstandingCredit.teknisi_name,
        duplicate: inserted.duplicate === true,
        reason: inserted.inserted ? 'debited' : 'duplicate'
    };
}

async function getSettlementEntries({ month, year, teknisiId = null, dateFrom = null, dateTo = null }) {
    await ensureSettlementTable();

    const where = [];
    const params = [];

    if (month && year) {
        where.push('period_month = ? AND period_year = ?');
        params.push(parseInt(month, 10), parseInt(year, 10));
    }
    if (teknisiId) {
        where.push('teknisi_id = ?');
        params.push(String(teknisiId));
    }
    if (dateFrom) {
        where.push("datetime(created_at) >= datetime(?)");
        params.push(dateFrom);
    }
    if (dateTo) {
        where.push("datetime(created_at) <= datetime(?)");
        params.push(dateTo);
    }

    const sql = `
        SELECT *
        FROM technician_collection_ledger
        ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY datetime(created_at) DESC, id DESC
    `;

    return dbAll(sql, params);
}

function summarizeEntries(entries) {
    const summaryByTechnician = new Map();

    for (const entry of entries) {
        const key = String(entry.teknisi_id);
        if (!summaryByTechnician.has(key)) {
            summaryByTechnician.set(key, {
                teknisi_id: key,
                teknisi_name: entry.teknisi_name,
                total_credit: 0,
                total_debit: 0,
                net_total: 0,
                entry_count: 0,
                latest_entry_at: entry.created_at,
                unique_paid_customers: new Set(),
                positive_customer_periods: new Map()
            });
        }

        const bucket = summaryByTechnician.get(key);
        bucket.entry_count += 1;
        bucket.latest_entry_at = bucket.latest_entry_at > entry.created_at ? bucket.latest_entry_at : entry.created_at;

        const customerPeriodKey = `${entry.user_id}:${entry.period_year}:${entry.period_month}`;
        const currentPeriodNet = bucket.positive_customer_periods.get(customerPeriodKey) || 0;
        const delta = entry.direction === 'credit' ? entry.commission_amount : -entry.commission_amount;
        const nextPeriodNet = currentPeriodNet + delta;
        bucket.positive_customer_periods.set(customerPeriodKey, nextPeriodNet);

        if (entry.direction === 'credit') {
            bucket.total_credit += entry.commission_amount;
        } else {
            bucket.total_debit += entry.commission_amount;
        }
        bucket.net_total = bucket.total_credit - bucket.total_debit;
    }

    return Array.from(summaryByTechnician.values())
        .map((bucket) => {
            let uniquePaidCustomers = 0;
            for (const value of bucket.positive_customer_periods.values()) {
                if (value > 0) {
                    uniquePaidCustomers += 1;
                }
            }
            return {
                teknisi_id: bucket.teknisi_id,
                teknisi_name: bucket.teknisi_name,
                total_credit: bucket.total_credit,
                total_debit: bucket.total_debit,
                net_total: bucket.net_total,
                entry_count: bucket.entry_count,
                latest_entry_at: bucket.latest_entry_at,
                unique_paid_customers: uniquePaidCustomers
            };
        })
        .sort((a, b) => b.net_total - a.net_total || a.teknisi_name.localeCompare(b.teknisi_name));
}

async function getSettlementReport({ month, year, teknisiId = null, dateFrom = null, dateTo = null }) {
    const entries = await getSettlementEntries({ month, year, teknisiId, dateFrom, dateTo });
    const summary = summarizeEntries(entries);
    const config = getCommissionConfig();

    return {
        commission_per_customer: config.amount,
        entries,
        summary,
        totals: {
            total_credit: entries.filter((entry) => entry.direction === 'credit').reduce((sum, entry) => sum + entry.commission_amount, 0),
            total_debit: entries.filter((entry) => entry.direction === 'debit').reduce((sum, entry) => sum + entry.commission_amount, 0),
            net_total: entries.reduce((sum, entry) => sum + (entry.direction === 'credit' ? entry.commission_amount : -entry.commission_amount), 0)
        }
    };
}

module.exports = {
    ensureSettlementTable,
    getCommissionConfig,
    getPeriodParts,
    hasAnyCommissionCreditForUserPeriod,
    evaluateCollectionSettlement,
    getSettlementEntries,
    getSettlementReport
};
