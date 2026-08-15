/**
 * Header Doc
 * Purpose: Ledger keuangan terpadu (`financial_ledger`) — menyerap sumber per-domain
 *   (payment_history, payment_reversal, technician_collection, agen, dll) menjadi satu baris
 *   per peristiwa yang dikunci `event_key` sehingga sinkronisasi bersifat idempoten.
 * Caller: `payment-finance-service.syncPaymentLedgerDomains`, route rekap keuangan, dan cron.
 * Deps: `fs`, `path`, `crypto`, `./env-config`, `./sqlite-shared-reader`, `global.db`.
 * MainFuncs: `syncFinancialLedgerSources`, `ensureFinancialLedgerTable`, `upsertLedgerEntry`.
 * SideEffects: Menulis tabel `financial_ledger` di `users.sqlite` lewat koneksi app persisten.
 */
"use strict";

const path = require("path");
const fs = require("fs");
const { randomUUID } = require("crypto");
const { getDatabasePath } = require("./env-config");
const { getSharedReader, dropSharedReader } = require("./sqlite-shared-reader");

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

function getReaderDbPath() {
    return getDatabasePath("users.sqlite");
}

function getReaderDb() {
    // Koneksi baca BERSAMA & berumur panjang. Versi lama membuka koneksi BARU lalu
    // menutupnya SETIAP query — dan `syncFinancialLedgerSources` memanggilnya 6x per
    // pembayaran. Churn buka-tutup itulah yang me-yatimkan `-wal`/`-shm` users.sqlite
    // sehingga tulis pembayaran gagal `SQLITE_IOERR`. Lihat lib/sqlite-shared-reader.
    return getSharedReader(getReaderDbPath());
}

function readerAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        const db = getReaderDb();
        db.all(sql, params, (err, rows) => {
            if (err) {
                if (typeof err.code === "string" && err.code.startsWith("SQLITE_IOERR")) {
                    console.error(`[FINANCIAL_LEDGER_READER_IOERR] ${err.message} — koneksi baca dibuang.`);
                    dropSharedReader(getReaderDbPath());
                }
                reject(err);
                return;
            }
            resolve(rows || []);
        });
    });
}


function safeJsonStringify(value) {
    try {
        return JSON.stringify(value || {});
    } catch (_error) {
        return JSON.stringify({ error: "metadata_serialize_failed" });
    }
}

function toInteger(value, fallback = 0) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeDirection(direction) {
    return direction === "debit" ? "debit" : "credit";
}

function derivePeriodFromDate(input) {
    const date = input instanceof Date ? input : new Date(input || Date.now());
    return {
        periodMonth: date.getMonth() + 1,
        periodYear: date.getFullYear()
    };
}

function normalizeSource(createdBy) {
    const normalized = String(createdBy || "").toLowerCase();
    if (!normalized) return "system";
    if (normalized.includes("teknisi")) return "teknisi";
    const teknisiAccounts = (global.accounts || []).filter((account) => account.role === "teknisi");
    if (teknisiAccounts.some((account) => String(account.username || "").toLowerCase() === normalized || String(account.id) === String(createdBy))) {
        return "teknisi";
    }
    if (["admin", "owner", "superadmin"].some((role) => normalized.includes(role))) {
        return "admin";
    }
    return "system";
}

function isMissingTableError(error) {
    return String(error?.message || "").includes("no such table");
}

async function ensureFinancialLedgerTable() {
    if (!initializationPromise) {
        initializationPromise = (async () => {
            await dbRun(`
                CREATE TABLE IF NOT EXISTS financial_ledger (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    domain TEXT NOT NULL,
                    reference_type TEXT NOT NULL,
                    reference_id TEXT NOT NULL,
                    user_id TEXT,
                    counterparty_id TEXT,
                    amount INTEGER NOT NULL,
                    direction TEXT NOT NULL CHECK(direction IN ('credit', 'debit')),
                    payment_method TEXT,
                    period_month INTEGER NOT NULL,
                    period_year INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    occurred_at TEXT NOT NULL,
                    created_by TEXT NOT NULL,
                    notes TEXT,
                    source TEXT NOT NULL DEFAULT 'system',
                    metadata_json TEXT,
                    event_key TEXT NOT NULL,
                    last_synced_at TEXT
                )
            `);
            await dbRun("CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_ledger_event_key ON financial_ledger(event_key)");
            await dbRun("CREATE INDEX IF NOT EXISTS idx_financial_ledger_period ON financial_ledger(period_year, period_month)");
            await dbRun("CREATE INDEX IF NOT EXISTS idx_financial_ledger_domain ON financial_ledger(domain)");
            await dbRun("CREATE INDEX IF NOT EXISTS idx_financial_ledger_reference ON financial_ledger(reference_type, reference_id)");
            await dbRun("CREATE INDEX IF NOT EXISTS idx_financial_ledger_source ON financial_ledger(source)");
            const columns = await dbAll("PRAGMA table_info(financial_ledger)");
            if (!columns.some((column) => column.name === "last_synced_at")) {
                await dbRun("ALTER TABLE financial_ledger ADD COLUMN last_synced_at TEXT");
            }
        })().catch((error) => {
            initializationPromise = null;
            throw error;
        });
    }
    return initializationPromise;
}

function buildLedgerEntryPayload(entry) {
    const direction = normalizeDirection(entry.direction);
    const amount = Math.abs(toInteger(entry.amount));
    const occurredAt = entry.occurredAt || new Date().toISOString();
    const period = (Number.isInteger(entry.periodMonth) && Number.isInteger(entry.periodYear))
        ? { periodMonth: entry.periodMonth, periodYear: entry.periodYear }
        : derivePeriodFromDate(occurredAt);

    return {
        domain: entry.domain,
        referenceType: entry.referenceType,
        referenceId: String(entry.referenceId),
        userId: entry.userId !== undefined && entry.userId !== null ? String(entry.userId) : null,
        counterpartyId: entry.counterpartyId !== undefined && entry.counterpartyId !== null ? String(entry.counterpartyId) : null,
        amount,
        direction,
        paymentMethod: entry.paymentMethod || null,
        periodMonth: period.periodMonth,
        periodYear: period.periodYear,
        status: entry.status || "completed",
        occurredAt,
        createdBy: entry.createdBy || "system",
        notes: entry.notes || "",
        source: entry.source || normalizeSource(entry.createdBy),
        metadataJson: safeJsonStringify(entry.metadata),
        eventKey: entry.eventKey,
        lastSyncedAt: new Date().toISOString()
    };
}

function isSameLedgerProjection(existing, next) {
    return String(existing.domain) === String(next.domain)
        && String(existing.reference_type) === String(next.referenceType)
        && String(existing.reference_id) === String(next.referenceId)
        && String(existing.user_id || "") === String(next.userId || "")
        && String(existing.counterparty_id || "") === String(next.counterpartyId || "")
        && toInteger(existing.amount) === toInteger(next.amount)
        && String(existing.direction) === String(next.direction)
        && String(existing.payment_method || "") === String(next.paymentMethod || "")
        && toInteger(existing.period_month) === toInteger(next.periodMonth)
        && toInteger(existing.period_year) === toInteger(next.periodYear)
        && String(existing.status || "") === String(next.status || "")
        && String(existing.occurred_at || "") === String(next.occurredAt || "")
        && String(existing.created_by || "") === String(next.createdBy || "")
        && String(existing.notes || "") === String(next.notes || "")
        && String(existing.source || "") === String(next.source || "")
        && String(existing.metadata_json || "{}") === String(next.metadataJson || "{}");
}

async function upsertFinancialLedgerEntry(entry) {
    await ensureFinancialLedgerTable();
    const payload = buildLedgerEntryPayload(entry);
    const existing = await dbGet("SELECT * FROM financial_ledger WHERE event_key = ?", [payload.eventKey]);

    if (!existing) {
        const result = await dbRun(
            `INSERT INTO financial_ledger (
                domain, reference_type, reference_id, user_id, counterparty_id, amount, direction,
                payment_method, period_month, period_year, status, occurred_at, created_by, notes,
                source, metadata_json, event_key, last_synced_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                payload.domain,
                payload.referenceType,
                payload.referenceId,
                payload.userId,
                payload.counterpartyId,
                payload.amount,
                payload.direction,
                payload.paymentMethod,
                payload.periodMonth,
                payload.periodYear,
                payload.status,
                payload.occurredAt,
                payload.createdBy,
                payload.notes,
                payload.source,
                payload.metadataJson,
                payload.eventKey,
                payload.lastSyncedAt
            ]
        );
        return { inserted: 1, updated: 0, unchanged: 0, id: result.lastID, status: "inserted" };
    }

    if (isSameLedgerProjection(existing, payload)) {
        await dbRun("UPDATE financial_ledger SET last_synced_at = ? WHERE event_key = ?", [payload.lastSyncedAt, payload.eventKey]);
        return { inserted: 0, updated: 0, unchanged: 1, id: existing.id, status: "unchanged" };
    }

    await dbRun(
        `UPDATE financial_ledger SET
            domain = ?,
            reference_type = ?,
            reference_id = ?,
            user_id = ?,
            counterparty_id = ?,
            amount = ?,
            direction = ?,
            payment_method = ?,
            period_month = ?,
            period_year = ?,
            status = ?,
            occurred_at = ?,
            created_by = ?,
            notes = ?,
            source = ?,
            metadata_json = ?,
            last_synced_at = ?
         WHERE event_key = ?`,
        [
            payload.domain,
            payload.referenceType,
            payload.referenceId,
            payload.userId,
            payload.counterpartyId,
            payload.amount,
            payload.direction,
            payload.paymentMethod,
            payload.periodMonth,
            payload.periodYear,
            payload.status,
            payload.occurredAt,
            payload.createdBy,
            payload.notes,
            payload.source,
            payload.metadataJson,
            payload.lastSyncedAt,
            payload.eventKey
        ]
    );
    return { inserted: 0, updated: 1, unchanged: 0, id: existing.id, status: "updated" };
}

async function recordFinancialLedgerEntry(entry) {
    return upsertFinancialLedgerEntry(entry);
}

async function syncPaymentHistoryEntries() {
    const stats = { inserted: 0, updated: 0, unchanged: 0 };
    let rows = [];
    try {
        rows = await readerAll(`
            SELECT *
            FROM payment_history
            ORDER BY id ASC
        `);
    } catch (error) {
        if (isMissingTableError(error)) return stats;
        throw error;
    }

    for (const row of rows) {
        const result = await upsertFinancialLedgerEntry({
            domain: row.is_partial ? "partial_payment" : "customer_payment",
            referenceType: "payment_history",
            referenceId: row.id,
            userId: row.user_id,
            amount: row.amount_paid,
            direction: "credit",
            paymentMethod: row.payment_method || null,
            periodMonth: toInteger(row.period_month),
            periodYear: toInteger(row.period_year),
            status: "completed",
            occurredAt: row.created_at || new Date().toISOString(),
            createdBy: row.created_by || "system",
            notes: row.notes || "",
            source: normalizeSource(row.created_by),
            metadata: {
                amount_due: row.amount_due,
                is_partial: !!row.is_partial
            },
            eventKey: `payment_history:${row.id}`
        });
        stats.inserted += result.inserted;
        stats.updated += result.updated;
        stats.unchanged += result.unchanged;
    }
    return stats;
}

async function syncPaymentReversalEntries() {
    const stats = { inserted: 0, updated: 0, unchanged: 0 };
    let rows = [];
    try {
        rows = await readerAll(`
            SELECT *
            FROM payment_reversals
            ORDER BY id ASC
        `);
    } catch (error) {
        if (isMissingTableError(error)) return stats;
        throw error;
    }

    for (const row of rows) {
        const result = await upsertFinancialLedgerEntry({
            domain: "customer_payment_reversal",
            referenceType: "payment_reversal",
            referenceId: row.id,
            userId: row.user_id,
            amount: row.amount_reversed,
            direction: "debit",
            paymentMethod: "REVERSAL",
            periodMonth: toInteger(row.period_month),
            periodYear: toInteger(row.period_year),
            status: row.status || "completed",
            occurredAt: row.created_at || new Date().toISOString(),
            createdBy: row.created_by || "system",
            notes: row.reason || "",
            source: normalizeSource(row.created_by),
            metadata: {
                source_request_id: row.source_request_id || null,
                source_admin_action: row.source_admin_action || null
            },
            eventKey: `payment_reversal:${row.id}`
        });
        stats.inserted += result.inserted;
        stats.updated += result.updated;
        stats.unchanged += result.unchanged;
    }

    return stats;
}

async function syncTechnicianCollectionEntries() {
    const stats = { inserted: 0, updated: 0, unchanged: 0 };
    let rows = [];
    try {
        rows = await readerAll(`
            SELECT *
            FROM technician_collection_ledger
            ORDER BY id ASC
        `);
    } catch (error) {
        if (isMissingTableError(error)) return stats;
        throw error;
    }
    for (const row of rows) {
        const result = await upsertFinancialLedgerEntry({
            domain: "technician_collection_commission",
            referenceType: "technician_collection_ledger",
            referenceId: row.id,
            userId: row.user_id,
            counterpartyId: row.teknisi_id,
            amount: row.commission_amount,
            direction: row.direction,
            paymentMethod: null,
            periodMonth: toInteger(row.period_month),
            periodYear: toInteger(row.period_year),
            status: row.payroll_id ? "settled_to_payroll" : "completed",
            occurredAt: row.created_at,
            createdBy: row.created_by || "system",
            notes: row.reason || "",
            source: "teknisi",
            metadata: {
                teknisi_name: row.teknisi_name,
                payroll_id: row.payroll_id || null,
                reason: row.reason
            },
            eventKey: `technician_collection:${row.id}`
        });
        stats.inserted += result.inserted;
        stats.updated += result.updated;
        stats.unchanged += result.unchanged;
    }
    return stats;
}

async function syncAgenCollectionEntries() {
    const stats = { inserted: 0, updated: 0, unchanged: 0 };
    let rows = [];
    try {
        rows = await readerAll(`
            SELECT *
            FROM agen_collection_ledger
            ORDER BY id ASC
        `);
    } catch (error) {
        if (isMissingTableError(error)) return stats;
        throw error;
    }
    for (const row of rows) {
        const result = await upsertFinancialLedgerEntry({
            domain: "agen_collection_commission",
            referenceType: "agen_collection_ledger",
            referenceId: row.id,
            userId: row.user_id,
            counterpartyId: row.agen_id,
            amount: row.commission_amount,
            direction: row.direction,
            paymentMethod: null,
            periodMonth: toInteger(row.period_month),
            periodYear: toInteger(row.period_year),
            status: row.payroll_id ? "settled_to_payroll" : "completed",
            occurredAt: row.created_at,
            createdBy: row.created_by || "system",
            notes: row.reason || "",
            source: "agen",
            metadata: {
                agen_name: row.agen_name,
                payroll_id: row.payroll_id || null,
                reason: row.reason
            },
            eventKey: `agen_collection:${row.id}`
        });
        stats.inserted += result.inserted;
        stats.updated += result.updated;
        stats.unchanged += result.unchanged;
    }
    return stats;
}

async function syncTechnicianKasbonLedger() {
    const stats = { inserted: 0, updated: 0, unchanged: 0 };
    let rows = [];
    try {
        rows = await readerAll(`
            SELECT *
            FROM technician_kasbon_ledger
            ORDER BY id ASC
        `);
    } catch (error) {
        if (isMissingTableError(error)) return stats;
        throw error;
    }
    for (const row of rows) {
        const result = await upsertFinancialLedgerEntry({
            domain: row.direction === "debit" ? "technician_kasbon_debit" : "technician_kasbon_credit",
            referenceType: "technician_kasbon_ledger",
            referenceId: row.id,
            counterpartyId: row.teknisi_id,
            amount: row.amount,
            direction: row.direction === "debit" ? "debit" : "credit",
            periodMonth: derivePeriodFromDate(row.created_at).periodMonth,
            periodYear: derivePeriodFromDate(row.created_at).periodYear,
            status: "completed",
            occurredAt: row.created_at,
            createdBy: row.created_by || "system",
            notes: row.notes || row.reason || "",
            source: "teknisi",
            metadata: {
                kasbon_id: row.kasbon_id,
                teknisi_name: row.teknisi_name,
                payroll_id: row.payroll_id || null,
                reason: row.reason
            },
            eventKey: `technician_kasbon:${row.id}`
        });
        stats.inserted += result.inserted;
        stats.updated += result.updated;
        stats.unchanged += result.unchanged;
    }
    return stats;
}

async function syncTechnicianPayrollPaid() {
    const stats = { inserted: 0, updated: 0, unchanged: 0 };
    let rows = [];
    try {
        rows = await readerAll(`
            SELECT *
            FROM technician_gaji
            WHERE status = 'paid'
            ORDER BY id ASC
        `);
    } catch (error) {
        if (isMissingTableError(error)) return stats;
        throw error;
    }
    for (const row of rows) {
        const result = await upsertFinancialLedgerEntry({
            domain: "technician_payroll_paid",
            referenceType: "technician_gaji",
            referenceId: row.id,
            counterpartyId: row.teknisi_id,
            amount: row.net_amount || row.total_gaji,
            direction: "debit",
            paymentMethod: "INTERNAL_PAYROLL",
            periodMonth: toInteger(row.period_month),
            periodYear: toInteger(row.period_year),
            status: "paid",
            occurredAt: row.paid_at || row.updated_at || row.created_at,
            createdBy: row.paid_by_name || row.created_by_name || "system",
            notes: row.notes || "",
            source: "admin",
            metadata: {
                teknisi_name: row.teknisi_name,
                gross_amount: row.gross_amount || 0,
                komisi_collection: row.komisi_collection || 0,
                komisi_marketing: row.komisi_marketing || 0,
                potongan_kasbon: row.potongan_kasbon || 0,
                potongan_lain: row.potongan_lain || 0
            },
            eventKey: `technician_payroll:${row.id}`
        });
        stats.inserted += result.inserted;
        stats.updated += result.updated;
        stats.unchanged += result.unchanged;
    }
    return stats;
}

function readVoucherPurchases() {
    const purchasePath = path.join(__dirname, "../database/voucher_purchases.json");
    if (!fs.existsSync(purchasePath)) return [];
    return JSON.parse(fs.readFileSync(purchasePath, "utf8"));
}

function readAgentTransactions() {
    const transactionPath = path.join(__dirname, "../database/agent_transactions.json");
    if (!fs.existsSync(transactionPath)) return [];
    return JSON.parse(fs.readFileSync(transactionPath, "utf8"));
}

function readSaldoTransactions() {
    const transactionPath = path.join(__dirname, "../database/saldo_transactions.json");
    if (!fs.existsSync(transactionPath)) return [];
    return JSON.parse(fs.readFileSync(transactionPath, "utf8"));
}

function readTopupRequests() {
    const requestPath = path.join(__dirname, "../database/topup_requests.json");
    if (!fs.existsSync(requestPath)) return [];
    return JSON.parse(fs.readFileSync(requestPath, "utf8"));
}

async function syncTopupApprovedEntries() {
    const stats = { inserted: 0, updated: 0, unchanged: 0 };
    const topupRequests = readTopupRequests();
    const saldoTransactions = readSaldoTransactions();
    const requestIndex = new Map(topupRequests.map((request) => [String(request.id), request]));

    for (const transaction of saldoTransactions) {
        if (transaction.type !== "credit" || !transaction.topupRequestId) {
            continue;
        }
        const request = requestIndex.get(String(transaction.topupRequestId));
        const result = await upsertFinancialLedgerEntry({
            domain: "topup_request_approved",
            referenceType: "topup_request",
            referenceId: transaction.topupRequestId,
            userId: transaction.userId,
            amount: transaction.amount,
            direction: "credit",
            paymentMethod: request?.paymentMethod || "TOPUP",
            periodMonth: derivePeriodFromDate(transaction.created_at).periodMonth,
            periodYear: derivePeriodFromDate(transaction.created_at).periodYear,
            status: request?.status || "verified",
            occurredAt: transaction.created_at,
            createdBy: request?.verifiedBy || "system",
            notes: transaction.description || request?.verificationNotes || "",
            source: normalizeSource(request?.verifiedBy),
            metadata: {
                transaction_id: transaction.id,
                request_status: request?.status || null,
                customer_name: request?.customerName || null
            },
            eventKey: `topup_request:${transaction.topupRequestId}`
        });
        stats.inserted += result.inserted;
        stats.updated += result.updated;
        stats.unchanged += result.unchanged;
    }
    return stats;
}

async function syncVoucherPurchases() {
    const stats = { inserted: 0, updated: 0, unchanged: 0 };
    const purchases = readVoucherPurchases();
    for (const purchase of purchases) {
        const result = await upsertFinancialLedgerEntry({
            domain: "voucher_purchase",
            referenceType: "voucher_purchase",
            referenceId: purchase.id,
            userId: purchase.userId,
            amount: purchase.price,
            direction: "credit",
            paymentMethod: "SALDO",
            periodMonth: derivePeriodFromDate(purchase.purchasedAt).periodMonth,
            periodYear: derivePeriodFromDate(purchase.purchasedAt).periodYear,
            status: "completed",
            occurredAt: purchase.purchasedAt,
            createdBy: purchase.userId || "system",
            source: "system",
            notes: `Pembelian voucher ${purchase.profile || ""}`.trim(),
            metadata: {
                profile: purchase.profile,
                voucher_username: purchase.voucherUsername || null
            },
            eventKey: `voucher_purchase:${purchase.id}`
        });
        stats.inserted += result.inserted;
        stats.updated += result.updated;
        stats.unchanged += result.unchanged;
    }
    return stats;
}

async function syncAgentTransactions() {
    const stats = { inserted: 0, updated: 0, unchanged: 0 };
    const transactions = readAgentTransactions();
    for (const transaction of transactions) {
        if (!["confirmed", "completed"].includes(transaction.status)) {
            continue;
        }
        if (transaction.transactionType === "topup" && transaction.topupRequestId) {
            continue;
        }
        const result = await upsertFinancialLedgerEntry({
            domain: "agent_transaction_confirmed",
            referenceType: "agent_transaction",
            referenceId: transaction.id,
            userId: transaction.customerId || null,
            counterpartyId: transaction.agentId || null,
            amount: transaction.amount,
            direction: "credit",
            paymentMethod: "AGENT",
            periodMonth: derivePeriodFromDate(transaction.confirmedAt || transaction.completedAt || transaction.created_at).periodMonth,
            periodYear: derivePeriodFromDate(transaction.confirmedAt || transaction.completedAt || transaction.created_at).periodYear,
            status: transaction.status,
            occurredAt: transaction.confirmedAt || transaction.completedAt || transaction.created_at,
            createdBy: transaction.confirmedBy || transaction.agentName || "system",
            source: "system",
            notes: transaction.notes || transaction.transactionType || "",
            metadata: {
                agent_name: transaction.agentName || null,
                transaction_type: transaction.transactionType || null,
                topup_request_id: transaction.topupRequestId || null
            },
            eventKey: `agent_transaction:${transaction.id}`
        });
        stats.inserted += result.inserted;
        stats.updated += result.updated;
        stats.unchanged += result.unchanged;
    }
    return stats;
}

async function syncFinancialLedgerSources({ domains = null } = {}) {
    await ensureFinancialLedgerTable();
    const enabled = domains ? new Set(domains) : null;
    const shouldRun = (name) => !enabled || enabled.has(name);
    const stats = {};

    if (shouldRun("payment_history")) stats.payment_history = await syncPaymentHistoryEntries();
    if (shouldRun("payment_reversal")) stats.payment_reversal = await syncPaymentReversalEntries();
    if (shouldRun("technician_collection")) stats.technician_collection = await syncTechnicianCollectionEntries();
    if (shouldRun("agen_collection")) stats.agen_collection = await syncAgenCollectionEntries();
    if (shouldRun("technician_kasbon")) stats.technician_kasbon = await syncTechnicianKasbonLedger();
    if (shouldRun("technician_payroll")) stats.technician_payroll = await syncTechnicianPayrollPaid();
    if (shouldRun("topup")) stats.topup = await syncTopupApprovedEntries();
    if (shouldRun("voucher")) stats.voucher = await syncVoucherPurchases();
    if (shouldRun("agent")) stats.agent = await syncAgentTransactions();

    return stats;
}

async function createManualAdjustment({
    direction,
    amount,
    reason,
    domainTarget,
    periodMonth,
    periodYear,
    notes,
    requestActionId = null
}, actor = {}) {
    const normalizedAmount = Math.abs(toInteger(amount));
    if (!normalizedAmount || !reason || !domainTarget || !periodMonth || !periodYear) {
        throw new Error("direction, amount, reason, domain_target, period_month, dan period_year wajib diisi");
    }

    const actionId = requestActionId || randomUUID();
    const fingerprint = `${direction}:${domainTarget}:${periodYear}:${periodMonth}:${normalizedAmount}:${String(reason).trim()}:${String(notes || "").trim()}`;
    const eventKey = `manual_adjustment:${actionId}`;
    const existing = await dbGet("SELECT id FROM financial_ledger WHERE event_key = ?", [eventKey]);
    if (existing) {
        return {
            inserted: 0,
            updated: 0,
            unchanged: 1,
            id: existing.id,
            status: "duplicate_retry",
            requestActionId: actionId,
            fingerprint
        };
    }
    const result = await upsertFinancialLedgerEntry({
        domain: "manual_adjustment",
        referenceType: "manual_adjustment",
        referenceId: eventKey,
        amount: normalizedAmount,
        direction: normalizeDirection(direction),
        periodMonth: toInteger(periodMonth),
        periodYear: toInteger(periodYear),
        status: "completed",
        occurredAt: new Date().toISOString(),
        createdBy: actor.name || actor.username || "system",
        notes: notes || reason,
        source: "admin",
        metadata: {
            reason,
            domain_target: domainTarget,
            actor_id: actor.id || null,
            fingerprint,
            request_action_id: actionId
        },
        eventKey
    });
    return {
        ...result,
        status: "created",
        requestActionId: actionId,
        fingerprint
    };
}

async function getFinancialLedgerEntries(filters = {}) {
    await ensureFinancialLedgerTable();
    const where = [];
    const params = [];

    if (filters.month && filters.year) {
        where.push("period_month = ? AND period_year = ?");
        params.push(toInteger(filters.month), toInteger(filters.year));
    } else if (filters.year) {
        where.push("period_year = ?");
        params.push(toInteger(filters.year));
    }
    if (filters.domain) {
        where.push("domain = ?");
        params.push(filters.domain);
    }
    if (filters.direction) {
        where.push("direction = ?");
        params.push(filters.direction);
    }
    if (filters.paymentMethod) {
        // Menerima satu ejaan ATAU daftar ejaan. Kolom ini memuat kosakata beragam
        // (CASH/cash/TUNAI, TRANSFER_BANK/transfer/TRANSFER), jadi penyaring per-ember
        // harus mencocokkan semua ejaannya sekaligus — lihat lib/payment-method-vocab.js.
        // Perbandingan di-lower-case supaya ejaan baru berbeda kapital ikut tertangkap.
        const daftar = Array.isArray(filters.paymentMethod)
            ? filters.paymentMethod
            : [filters.paymentMethod];
        const bersih = daftar
            .map((m) => String(m || "").trim().toLowerCase())
            .filter((m) => m !== "");
        if (bersih.length > 0) {
            where.push(`LOWER(payment_method) IN (${bersih.map(() => "?").join(", ")})`);
            params.push(...bersih);
        }
    }
    if (filters.source) {
        where.push("source = ?");
        params.push(filters.source);
    }

    return dbAll(
        `SELECT *
         FROM financial_ledger
         ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY datetime(occurred_at) DESC, id DESC`,
        params
    );
}

function summarizeBy(entries, keyField, amountField = "amount") {
    const bucket = {};
    for (const entry of entries) {
        const key = entry[keyField] || "unknown";
        if (!bucket[key]) {
            bucket[key] = { count: 0, amount: 0 };
        }
        bucket[key].count += 1;
        bucket[key].amount += toInteger(entry[amountField]);
    }
    return bucket;
}

async function getFinancialLedgerReport(filters = {}) {
    const entries = await getFinancialLedgerEntries(filters);
    const totalIncome = entries.filter((entry) => entry.direction === "credit").reduce((sum, entry) => sum + toInteger(entry.amount), 0);
    const totalExpense = entries.filter((entry) => entry.direction === "debit").reduce((sum, entry) => sum + toInteger(entry.amount), 0);
    const methodRaw = summarizeBy(entries.filter((entry) => entry.payment_method), "payment_method");
    const sourceRaw = summarizeBy(entries, "source");
    const domainSummary = {};

    for (const entry of entries) {
        const domain = entry.domain || "unknown";
        if (!domainSummary[domain]) {
            domainSummary[domain] = {
                count: 0,
                credit: 0,
                debit: 0,
                net: 0
            };
        }
        const amount = toInteger(entry.amount);
        domainSummary[domain].count += 1;
        if (entry.direction === "debit") {
            domainSummary[domain].debit += amount;
            domainSummary[domain].net -= amount;
        } else {
            domainSummary[domain].credit += amount;
            domainSummary[domain].net += amount;
        }
    }

    return {
        entries,
        summary: {
            totalIncome,
            totalExpense,
            netTotal: totalIncome - totalExpense,
            totalTransactions: entries.length
        },
        domainSummary,
        methodSummary: methodRaw,
        sourceSummary: sourceRaw
    };
}

function classifyLedgerCashflow(entry) {
    const amount = Math.abs(toInteger(entry.amount));
    const direction = normalizeDirection(entry.direction);

    switch (entry.domain) {
    case "customer_payment":
    case "partial_payment":
    case "topup_request_approved":
    case "voucher_purchase":
    case "agent_transaction_confirmed":
        return { incomeDelta: amount, expenseDelta: 0, classification: "cash_in" };
    case "customer_payment_reversal":
    case "technician_payroll_paid":
    case "technician_kasbon_credit":
        return { incomeDelta: 0, expenseDelta: amount, classification: "cash_out" };
    case "expense_entry":
        return {
            incomeDelta: 0,
            expenseDelta: direction === "debit" ? amount : -amount,
            classification: "cash_out"
        };
    case "manual_adjustment":
        return direction === "credit"
            ? { incomeDelta: amount, expenseDelta: 0, classification: "cash_in" }
            : { incomeDelta: 0, expenseDelta: amount, classification: "cash_out" };
    case "technician_collection_commission":
    case "agen_collection_commission":
    case "technician_kasbon_debit":
        return { incomeDelta: 0, expenseDelta: 0, classification: "internal" };
    default:
        return direction === "credit"
            ? { incomeDelta: amount, expenseDelta: 0, classification: "cash_in" }
            : { incomeDelta: 0, expenseDelta: amount, classification: "cash_out" };
    }
}

function buildCashflowSummary(entries = []) {
    const summary = {
        totalIncome: 0,
        totalExpense: 0,
        netTotal: 0,
        totalTransactions: entries.length
    };

    for (const entry of entries) {
        const classification = classifyLedgerCashflow(entry);
        summary.totalIncome += classification.incomeDelta;
        summary.totalExpense += classification.expenseDelta;
    }

    summary.netTotal = summary.totalIncome - summary.totalExpense;
    return summary;
}

module.exports = {
    ensureFinancialLedgerTable,
    upsertFinancialLedgerEntry,
    recordFinancialLedgerEntry,
    syncFinancialLedgerSources,
    createManualAdjustment,
    getFinancialLedgerEntries,
    getFinancialLedgerReport,
    classifyLedgerCashflow,
    buildCashflowSummary
};
