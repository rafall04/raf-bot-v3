/**
 * Header Doc
 * Purpose: Composer/facade saldo-manager — thin index yang menggabungkan 6 sub-modul saldo (`shared`, `saldo-repository`, `balance-operations`, `transfer-operations`, `transactions-store`, `topup-store`). Mempertahankan kontrak module export persis sama dengan versi monolitik (1387 lines) sehingga ke-16 caller eksternal (`lib/saldo.js`, `lib/topup-expiry.js`, `routes/saldo.js`, `repositories/*`, 5 message handler, 7+ test file) tidak perlu diubah. Path file dipertahankan persis di `lib/saldo-manager.js` karena `payment-topup-boundary-baseline.test.js` assert string match terhadap path require ini.
 * Caller: `lib/saldo.js` (backward compat shim), `lib/topup-expiry.js`, `lib/agent-voucher-manager.js`, `repositories/payment.repository.js`, `repositories/saldo.repository.js`, `routes/saldo.js`, `message/handlers/{topup,saldo,balance-management,agent}.js`, `message/handlers/steps/saldo-steps.js`, plus 7+ test file.
 * Deps: `./saldo/shared` (initSaldoDatabase, formatCurrency), `./saldo/balance-operations` (getUserSaldo/createUserSaldo/addSaldo/deductSaldo/updatePushname/getSaldoStatistics/getAllSaldoData), `./saldo/transfer-operations` (transferSaldo), `./saldo/transactions-store` (loadTransactions/getUserTransactions/reloadTransactions/getAllTransactions/getTransactionStatistics), `./saldo/topup-store` (loadTopupRequests/createTopupRequest/getTopupRequest/getUserTopupRequests/getPendingTopupRequests/verifyTopupRequest/saveTopupRequests/cancelTopupRequest/processAgentConfirmation/getAllTopupRequests/reloadTopupRequests).
 * MainFuncs: `initDatabase` (orchestrator: trigger init di shared + load JSON di kedua store); semua public API di-re-export dari sub-modul.
 * SideEffects: Module load memanggil `initDatabase()` (line bottom) — identik dengan original — sehingga import side-effect tetap: open SQLite + load 2 JSON file. NOTE: `purchaseVoucher` deprecated stub tetap di sini (caller mungkin masih panggil walaupun selalu return failure).
 *
 * BOUNDARY MAP:
 *   lib/saldo/shared.js                     : Path constants + JID normalize + formatCurrency + getSaldoDb singleton
 *   lib/saldo/saldo-repository.js           : SQLite read helpers (low-level, tanpa transaction wrapping)
 *   lib/saldo/balance-operations.js         : addSaldo, deductSaldo, getUserSaldo, createUserSaldo, updatePushname, stats, getAll
 *   lib/saldo/transfer-operations.js        : transferSaldo (atomic dual-update transaction)
 *   lib/saldo/transactions-store.js         : JSON ledger store (transactions[] + persistence)
 *   lib/saldo/topup-store.js                : JSON topup store + workflow (verify, processAgentConfirmation)
 *
 * PRESERVED PRE-EXISTING BEHAVIOR (tidak di-fix di refactor ini):
 *   - `getUserSaldoAsync` tidak di-export (tidak ada caller eksternal — verified via grep)
 *   - `getAllSaldoDataFromDb` tidak di-export (caller `balance-management-handler.js:186` di-fix terpisah ke `getAllSaldoData` agar tidak silent-fail)
 *   - `purchaseVoucher` tetap return failure stub (caller harus pakai `voucher-manager.js`)
 */
"use strict";

const { initSaldoDatabase, formatCurrency } = require('./saldo/shared');
const balanceOperations = require('./saldo/balance-operations');
const transferOperations = require('./saldo/transfer-operations');
const transactionsStore = require('./saldo/transactions-store');
const topupStore = require('./saldo/topup-store');

// Initialize databases (orchestrator)
function initDatabase() {
    try {
        // Initialize SQLite untuk saldo
        initSaldoDatabase().catch(err => {
            console.error('[SALDO-MANAGER] Error initializing SQLite:', err);
        });

        // Load transactions dari JSON (masih menggunakan JSON)
        transactionsStore.loadTransactions();

        // Load topup requests dari JSON (masih menggunakan JSON)
        topupStore.loadTopupRequests();
    } catch (error) {
        console.error('[SALDO-MANAGER] Error initializing database:', error);
    }
}

// Deprecated stub - voucher purchases harus pakai voucher-manager.js
function purchaseVoucher(_userId, _voucherProfile) {
    return {
        success: false,
        message: 'Please use voucher-manager.js for voucher purchases'
    };
}

// Initialize on load (preserves original behavior at line 1332 of monolithic version)
initDatabase();

module.exports = {
    // Database initialization
    initSaldoDatabase,

    // User saldo
    getUserSaldo: balanceOperations.getUserSaldo,
    getSaldo: balanceOperations.getUserSaldo, // Alias for compatibility
    createUserSaldo: balanceOperations.createUserSaldo,
    addSaldo: balanceOperations.addSaldo,
    deductSaldo: balanceOperations.deductSaldo,
    transferSaldo: transferOperations.transferSaldo,
    cancelTopupRequest: topupStore.cancelTopupRequest,
    updatePushname: balanceOperations.updatePushname,

    // Transactions
    getUserTransactions: transactionsStore.getUserTransactions,

    // Topup requests
    createTopupRequest: topupStore.createTopupRequest,
    getTopupRequest: topupStore.getTopupRequest,
    getUserTopupRequests: topupStore.getUserTopupRequests,
    getPendingTopupRequests: topupStore.getPendingTopupRequests,
    verifyTopupRequest: topupStore.verifyTopupRequest,
    saveTopupRequests: topupStore.saveTopupRequests,

    // Agent transaction processing
    processAgentConfirmation: topupStore.processAgentConfirmation,

    // Voucher
    purchaseVoucher,

    // Statistics
    getSaldoStatistics: balanceOperations.getSaldoStatistics,
    getTransactionStatistics: transactionsStore.getTransactionStatistics,

    // Helpers
    formatCurrency,

    // Reload functions
    reloadTransactions: transactionsStore.reloadTransactions,
    reloadTopupRequests: topupStore.reloadTopupRequests,

    // Get raw data accessors
    getAllSaldoData: balanceOperations.getAllSaldoData,
    getAllTransactions: transactionsStore.getAllTransactions,
    getAllTopupRequests: topupStore.getAllTopupRequests
};
