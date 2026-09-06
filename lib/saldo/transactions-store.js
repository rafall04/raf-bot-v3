/**
 * Header Doc
 * Purpose: JSON store untuk transaction ledger (`saldo_transactions.json`). Menyimpan riwayat semua mutasi saldo (credit/debit) untuk audit + reporting. State holder `transactions[]` ter-encapsulasi di module ini, dipersist via `saveTransactions()` (synchronous fs.writeFileSync). Read accessor di-expose via `getTransactions()`/`getAllTransactions()`. Write API via `addTransaction()` (untuk mutasi tunggal credit/debit) dan `pushTransactionRecord()` (untuk transfer dual-record case).
 * Caller: `lib/saldo/balance-operations.js` (`addTransaction` setelah addSaldo/deductSaldo COMMIT), `lib/saldo/transfer-operations.js` (`pushTransactionRecord` x2 + `saveTransactions` setelah transfer COMMIT), `lib/saldo-manager.js` (composer re-export `getUserTransactions`/`getTransactionStatistics`/`reloadTransactions`).
 * Deps: `fs`, `./shared` (TRANSACTIONS_DB).
 * MainFuncs: `loadTransactions`, `saveTransactions`, `reloadTransactions`, `addTransaction`, `pushTransactionRecord`, `getUserTransactions`, `getAllTransactions`, `getTransactionStatistics`.
 * SideEffects: Sync read/write ke `database/saldo_transactions.json`. NOTE: untuk single instance aman; multi-instance perlu file locking.
 */
"use strict";

const fs = require('fs');

const { TRANSACTIONS_DB } = require('./shared');

let transactions = [];

function loadTransactions() {
    try {
        if (fs.existsSync(TRANSACTIONS_DB)) {
            const raw = fs.readFileSync(TRANSACTIONS_DB, 'utf8');
            transactions = raw.trim() === '' ? [] : JSON.parse(raw);
        } else {
            transactions = [];
            saveTransactions();
        }
    } catch (error) {
        // #b321: sibling topup-store — ledger transaksi rusak JANGAN diam-diam jadi [] lalu tertimpa
        // (audit trail saldo lenyap). Karantina dulu (bisa dipulihkan), lanjut kosong supaya bot hidup.
        console.error('[SALDO-MANAGER] Error loading transactions (berkas mungkin rusak):', error);
        try {
            if (fs.existsSync(TRANSACTIONS_DB)) {
                const cap = new Date().toISOString().replace(/[:.]/g, '-');
                const karantina = `${TRANSACTIONS_DB}.rusak-${cap}`;
                fs.renameSync(TRANSACTIONS_DB, karantina);
                console.error(`[SALDO-MANAGER] saldo_transactions.json rusak DIKARANTINA ke ${karantina} — jangan hapus sebelum diperiksa.`);
            }
        } catch (errK) {
            console.error('[SALDO-MANAGER] Gagal karantina saldo_transactions.json:', errK.message);
        }
        transactions = [];
    }
}

function saveTransactions() {
    try {
        // TULIS ATOMIK (tmp + rename) — SIGKILL saat restart tak boleh meninggalkan ledger terpotong.
        const sementara = `${TRANSACTIONS_DB}.tmp-${process.pid}`;
        fs.writeFileSync(sementara, JSON.stringify(transactions, null, 2));
        fs.renameSync(sementara, TRANSACTIONS_DB);
    } catch (error) {
        console.error('[SALDO-MANAGER] Gagal menyimpan saldo_transactions.json:', error);
        try { const t = `${TRANSACTIONS_DB}.tmp-${process.pid}`; if (fs.existsSync(t)) fs.unlinkSync(t); } catch (_e) { /* abaikan */ }
    }
}

// Reload functions - hanya dipanggil saat diperlukan (misalnya setelah perubahan manual dari luar)
// Data di memory sudah selalu up-to-date karena langsung di-update saat write operations
function reloadTransactions() {
    try {
        if (fs.existsSync(TRANSACTIONS_DB)) {
            transactions = JSON.parse(fs.readFileSync(TRANSACTIONS_DB, 'utf8'));
            console.log(`[SALDO-MANAGER] Reloaded ${transactions.length} transactions from database`);
        }
    } catch (error) {
        console.error('[SALDO-MANAGER] Error reloading transactions:', error);
    }
}

// Transaction management (masih menggunakan JSON)
function addTransaction(userId, type, amount, description, balance, topupRequestId = null) {
    const transaction = {
        id: `TRX${Date.now()}${Math.random().toString(36).substr(2, 5)}`.toUpperCase(),
        userId: userId,
        type: type,
        amount: parseInt(amount),
        description: description,
        balance_after: balance,
        topupRequestId: topupRequestId,
        status: 'completed',
        created_at: new Date().toISOString()
    };

    // Log sederhana: hanya informasi penting
    const shortUserId = userId.replace('@s.whatsapp.net', '');
    const amountFormatted = `Rp ${parseInt(amount).toLocaleString('id-ID')}`;
    const balanceFormatted = `Rp ${parseInt(balance).toLocaleString('id-ID')}`;
    console.log(`[TRANSACTION] ${type.toUpperCase()} ${amountFormatted} → ${shortUserId} | Saldo: ${balanceFormatted}`);

    transactions.push(transaction);
    saveTransactions();

    return transaction;
}

/**
 * Push raw transaction record langsung tanpa generate ID/timestamp baru. Dipakai
 * khusus oleh `transfer-operations.transferSaldo` yang perlu menulis dua record
 * (debit di sender + credit di receiver) dengan timestamp identik untuk audit.
 * Caller bertanggung jawab memanggil `saveTransactions()` setelah push semua record.
 */
function pushTransactionRecord(record) {
    transactions.push(record);
}

function getUserTransactions(userId, limit = 10) {
    return transactions
        .filter(t => t.userId === userId)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, limit);
}

function getAllTransactions() {
    return transactions;
}

function getTransactionStatistics(startDate = null, endDate = null) {
    let filteredTransactions = transactions;

    if (startDate) {
        filteredTransactions = filteredTransactions.filter(t =>
            new Date(t.created_at) >= new Date(startDate)
        );
    }

    if (endDate) {
        filteredTransactions = filteredTransactions.filter(t =>
            new Date(t.created_at) <= new Date(endDate)
        );
    }

    const totalTransactions = filteredTransactions.length;
    const totalCredit = filteredTransactions
        .filter(t => t.type === 'credit')
        .reduce((sum, t) => sum + t.amount, 0);
    const totalDebit = filteredTransactions
        .filter(t => t.type === 'debit')
        .reduce((sum, t) => sum + t.amount, 0);

    return {
        totalTransactions,
        totalCredit,
        totalDebit,
        netFlow: totalCredit - totalDebit
    };
}

module.exports = {
    loadTransactions,
    saveTransactions,
    reloadTransactions,
    addTransaction,
    pushTransactionRecord,
    getUserTransactions,
    getAllTransactions,
    getTransactionStatistics
};
