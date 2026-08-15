/**
 * Header Doc
 * Purpose: JSON store + workflow untuk topup requests (`topup_requests.json`). Mengelola lifecycle topup: create (auto-link agent transaction), verify (admin/agent), cancel, plus query helpers (pending/by-user/by-id). Workflow handler `verifyTopupRequest` dan `processAgentConfirmation` mengeksekusi side-effect penambahan saldo via lazy-require ke `balance-operations` (untuk hindari circular dep). State holder `topupRequests[]` ter-encapsulasi di module ini.
 * Caller: `lib/saldo-manager.js` (composer re-export semua API), tidak ada caller eksternal langsung.
 * Deps: `fs`, `./shared` (TOPUP_REQUESTS_DB), lazy-require `./balance-operations` (addSaldo, getUserSaldo), lazy-require `../agent-transaction-manager` & `../agent-manager` (sama dengan original) di workflow path, `../id-generator` (generateTopupRequestId).
 * MainFuncs: `loadTopupRequests`, `saveTopupRequests`, `reloadTopupRequests`, `createTopupRequest`, `getTopupRequest`, `getUserTopupRequests`, `getPendingTopupRequests`, `verifyTopupRequest`, `cancelTopupRequest`, `processAgentConfirmation`, `getAllTopupRequests`.
 * SideEffects: Sync read/write ke `database/topup_requests.json`. `verifyTopupRequest`+`processAgentConfirmation` memicu mutasi saldo (via `balance-operations.addSaldo`) dan agent ledger update.
 */
"use strict";

const fs = require('fs');

const { TOPUP_REQUESTS_DB } = require('./shared');
const { generateTopupRequestId } = require('../id-generator');

let topupRequests = [];

function loadTopupRequests() {
    try {
        if (fs.existsSync(TOPUP_REQUESTS_DB)) {
            topupRequests = JSON.parse(fs.readFileSync(TOPUP_REQUESTS_DB, 'utf8'));
        } else {
            fs.writeFileSync(TOPUP_REQUESTS_DB, '[]');
            topupRequests = [];
        }
    } catch (error) {
        console.error('[SALDO-MANAGER] Error loading topup requests:', error);
    }
}

function saveTopupRequests() {
    fs.writeFileSync(TOPUP_REQUESTS_DB, JSON.stringify(topupRequests, null, 2));
}

function reloadTopupRequests() {
    try {
        if (fs.existsSync(TOPUP_REQUESTS_DB)) {
            topupRequests = JSON.parse(fs.readFileSync(TOPUP_REQUESTS_DB, 'utf8'));
            console.log(`[SALDO-MANAGER] Reloaded ${topupRequests.length} topup requests from database`);
        }
    } catch (error) {
        console.error('[SALDO-MANAGER] Error reloading topup requests:', error);
    }
}

// Topup request management (masih menggunakan JSON)
function createTopupRequest(userId, amount, paymentMethod, agentId = null, customerName = 'Customer') {
    const request = {
        id: generateTopupRequestId(),
        userId: userId,
        customerName: customerName,
        amount: parseInt(amount),
        paymentMethod: paymentMethod,
        agentId: agentId,
        agentTransactionId: null,
        paymentProof: null,
        status: 'pending',
        verifiedBy: null,
        verifiedAt: null,
        notes: null,
        created_at: new Date().toISOString()
    };

    topupRequests.push(request);
    saveTopupRequests();

    // If agent is specified, create agent transaction
    if (agentId) {
        try {
            const agentTransactionManager = require('../agent-transaction-manager');
            const agentManager = require('../agent-manager');

            const agent = agentManager.getAgentById(agentId);
            if (agent) {
                const agentTransaction = agentTransactionManager.createAgentTransaction({
                    topupRequestId: request.id,
                    customerId: userId,
                    customerName: customerName,
                    agentId: agentId,
                    agentName: agent.name,
                    amount: parseInt(amount),
                    transactionType: 'topup'
                });

                const index = topupRequests.findIndex(r => r.id === request.id);
                if (index !== -1) {
                    topupRequests[index].agentTransactionId = agentTransaction.id;
                    saveTopupRequests();
                }

                console.log('[SALDO-MANAGER] Agent transaction created:', agentTransaction.id);
            }
        } catch (error) {
            console.error('[SALDO-MANAGER] Failed to create agent transaction:', error);
        }
    }

    return request;
}

function getTopupRequest(requestId) {
    return topupRequests.find(r => r.id === requestId);
}

function getUserTopupRequests(userId) {
    return topupRequests
        .filter(r => r.userId === userId)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function getPendingTopupRequests() {
    return topupRequests
        .filter(r => r.status === 'pending')
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}

async function verifyTopupRequest(requestId, adminId, approved = true, notes = null) {
    console.log('[VERIFY_TOPUP] Starting verification:', { requestId, adminId, approved });

    const requestIndex = topupRequests.findIndex(r => r.id === requestId);
    if (requestIndex === -1) {
        console.log('[VERIFY_TOPUP] Request not found:', requestId);
        return false;
    }

    const request = topupRequests[requestIndex];
    console.log('[VERIFY_TOPUP] Found request:', { id: request.id, status: request.status, amount: request.amount });

    if (request.status !== 'pending') {
        console.log('[VERIFY_TOPUP] Request status not pending:', request.status);
        return false;
    }

    request.status = approved ? 'verified' : 'rejected';
    request.verifiedBy = adminId;
    request.verifiedAt = new Date().toISOString();
    request.notes = notes;

    saveTopupRequests();
    console.log('[VERIFY_TOPUP] Request updated in database');

    if (approved) {
        console.log('[VERIFY_TOPUP] Calling addSaldo with requestId:', requestId);
        try {
            // Lazy-require untuk hindari circular dep dengan balance-operations
            const { addSaldo } = require('./balance-operations');
            await addSaldo(request.userId, request.amount, `Topup verified - ${request.paymentMethod}`, null, requestId);
            console.log('[VERIFY_TOPUP] addSaldo completed');
        } catch (error) {
            console.error('[VERIFY_TOPUP] Error adding saldo:', error);
            // Tetap return request meskipun addSaldo gagal (sudah di-update status)
        }
    }

    return request;
}

function cancelTopupRequest(requestId) {
    const index = topupRequests.findIndex(r => r.id === requestId);
    if (index === -1) return false;

    topupRequests[index].status = 'cancelled';
    topupRequests[index].cancelled_at = new Date().toISOString();
    saveTopupRequests();
    return true;
}

async function processAgentConfirmation(agentTransactionId) {
    console.log('[SALDO-MANAGER] Processing agent confirmation:', agentTransactionId);

    try {
        const agentTransactionManager = require('../agent-transaction-manager');

        const agentTransaction = agentTransactionManager.getTransactionById(agentTransactionId);

        if (!agentTransaction) {
            return {
                success: false,
                message: 'Agent transaction not found'
            };
        }

        if (agentTransaction.status !== 'confirmed') {
            return {
                success: false,
                message: `Agent transaction status is ${agentTransaction.status}, expected confirmed`
            };
        }

        const topupRequest = topupRequests.find(r =>
            r.id === agentTransaction.topupRequestId
        );

        if (!topupRequest) {
            return {
                success: false,
                message: 'Topup request not found'
            };
        }

        const requestIndex = topupRequests.findIndex(r => r.id === topupRequest.id);
        topupRequests[requestIndex].status = 'verified';
        topupRequests[requestIndex].verifiedBy = `agent_${agentTransaction.agentId}`;
        topupRequests[requestIndex].verifiedAt = new Date().toISOString();
        topupRequests[requestIndex].notes = `Confirmed by agent via WhatsApp`;
        saveTopupRequests();

        console.log('[SALDO-MANAGER] Topup request verified:', topupRequest.id);

        // Lazy-require untuk hindari circular dep dengan balance-operations
        const { addSaldo, getUserSaldo } = require('./balance-operations');

        try {
            const saldoAdded = await addSaldo(
                agentTransaction.customerId,
                agentTransaction.amount,
                `Topup via agent ${agentTransaction.agentName}`
            );

            if (!saldoAdded) {
                return {
                    success: false,
                    message: 'Failed to add saldo to customer'
                };
            }
        } catch (error) {
            console.error('[SALDO-MANAGER] Error adding saldo:', error);
            return {
                success: false,
                message: 'Failed to add saldo to customer',
                error: error.message
            };
        }

        console.log('[SALDO-MANAGER] Saldo added to customer:', agentTransaction.customerId);

        const completed = agentTransactionManager.completeTransaction(agentTransactionId);

        if (!completed) {
            console.warn('[SALDO-MANAGER] Failed to complete agent transaction, but saldo already added');
        }

        // WAJIB di-await. `getUserSaldo` dideklarasikan tanpa `async` dan komentarnya menyebut
        // "synchronous untuk backward compatibility", tapi isinya `initSaldoDatabase().then(...)`
        // — ia MENGEMBALIKAN PROMISE. Tanpa await, pesan "TOPUP BERHASIL" ke pelanggan berbunyi
        // "Saldo baru: Rp [object Promise]": saldonya benar bertambah, tapi pelanggan tak tahu
        // berapa saldonya sekarang. `processAgentConfirmation` memang sudah `async`.
        const newSaldo = await getUserSaldo(agentTransaction.customerId);

        return {
            success: true,
            topupRequest: topupRequests[requestIndex],
            agentTransaction: agentTransaction,
            newSaldo: newSaldo,
            message: 'Agent confirmation processed successfully'
        };

    } catch (error) {
        console.error('[SALDO-MANAGER] Error processing agent confirmation:', error);
        return {
            success: false,
            message: 'Internal error processing confirmation',
            error: error.message
        };
    }
}

function getAllTopupRequests() {
    // Return data dari memory - sudah selalu up-to-date karena langsung di-update saat write operations
    // Tidak perlu reload dari file setiap kali karena ini read operation
    return topupRequests;
}

module.exports = {
    loadTopupRequests,
    saveTopupRequests,
    reloadTopupRequests,
    createTopupRequest,
    getTopupRequest,
    getUserTopupRequests,
    getPendingTopupRequests,
    verifyTopupRequest,
    cancelTopupRequest,
    processAgentConfirmation,
    getAllTopupRequests
};
