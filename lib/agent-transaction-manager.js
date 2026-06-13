"use strict";

/**
 * Agent Transaction Manager
 * Manages transactions between customers and agents (topup, payment, voucher)
 */

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const { logger } = require('./logger');
const { generateAgentTransactionId } = require('./id-generator');

// Database paths
const AGENT_TRANSACTIONS_DB = path.join(__dirname, '../database/agent_transactions.json');
const AGENT_CREDENTIALS_DB = path.join(__dirname, '../database/agent_credentials.json');

// Load data
let agentTransactions = [];
let agentCredentials = [];

// Initialize database
function initDatabase() {
    try {
        // Load agent transactions
        if (fs.existsSync(AGENT_TRANSACTIONS_DB)) {
            agentTransactions = JSON.parse(fs.readFileSync(AGENT_TRANSACTIONS_DB, 'utf8'));
        } else {
            fs.writeFileSync(AGENT_TRANSACTIONS_DB, '[]');
        }

        // Load agent credentials
        if (fs.existsSync(AGENT_CREDENTIALS_DB)) {
            agentCredentials = JSON.parse(fs.readFileSync(AGENT_CREDENTIALS_DB, 'utf8'));
        } else {
            fs.writeFileSync(AGENT_CREDENTIALS_DB, '[]');
        }

        logger.info('Agent transaction database initialized', {
            transactions: agentTransactions.length,
            credentials: agentCredentials.length
        });
    } catch (error) {
        logger.error('Error initializing agent transaction database:', error);
    }
}

// Save functions
function saveAgentTransactions() {
    fs.writeFileSync(AGENT_TRANSACTIONS_DB, JSON.stringify(agentTransactions, null, 2));
}

function saveAgentCredentials() {
    fs.writeFileSync(AGENT_CREDENTIALS_DB, JSON.stringify(agentCredentials, null, 2));
}

/**
 * Create a new agent transaction
 */
function createAgentTransaction(data) {
    // Validate required fields
    if (!data.customerId || !data.agentId || !data.amount) {
        logger.error('Missing required fields for agent transaction', {
            customerId: !!data.customerId,
            agentId: !!data.agentId,
            amount: !!data.amount
        });
        throw new Error('Missing required fields: customerId, agentId, and amount are required');
    }
    
    // Validate amount is positive number
    const amount = typeof data.amount === 'number' ? data.amount : parseFloat(data.amount);
    if (isNaN(amount) || amount <= 0) {
        logger.error('Invalid amount for agent transaction', {
            amount: data.amount
        });
        throw new Error('Amount must be a positive number');
    }
    
    // Check if agent exists
    try {
        const agentManager = require('./agent-manager');
        const agent = agentManager.getAgentById(data.agentId);
        if (!agent) {
            logger.error('Agent not found for transaction', {
                agentId: data.agentId
            });
            throw new Error(`Agent with ID ${data.agentId} not found`);
        }
        if (!agent.active) {
            logger.warn('Transaction created for inactive agent', {
                agentId: data.agentId
            });
        }
    } catch (error) {
        // If agent check fails, log but continue (might be race condition)
        logger.warn('Could not verify agent for transaction', {
            agentId: data.agentId,
            error: error.message
        });
    }
    
    const transaction = {
        id: generateAgentTransactionId(),
        topupRequestId: data.topupRequestId || null,
        customerId: data.customerId,
        customerName: data.customerName || 'Customer',
        agentId: data.agentId,
        agentName: data.agentName || 'Agent',
        amount: amount,
        transactionType: data.transactionType || 'topup', // topup, payment, voucher, voucher_purchase, voucher_sale
        status: 'pending', // pending, confirmed, completed, cancelled
        agentPin: null,
        confirmedBy: null,
        confirmedAt: null,
        notes: data.notes || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };

    agentTransactions.push(transaction);
    saveAgentTransactions();

    logger.info('Agent transaction created', {
        id: transaction.id,
        agentId: data.agentId,
        amount: amount
    });

    return transaction;
}

/**
 * Get transaction by ID
 */
function getTransactionById(transactionId) {
    return agentTransactions.find(t => t.id === transactionId);
}

/**
 * Get transactions by agent ID
 */
function getTransactionsByAgent(agentId, filters = {}) {
    let transactions = agentTransactions.filter(t => t.agentId === agentId);

    // Filter by status
    if (filters.status) {
        transactions = transactions.filter(t => t.status === filters.status);
    }

    // Filter by date range
    if (filters.startDate) {
        transactions = transactions.filter(t => 
            new Date(t.created_at) >= new Date(filters.startDate)
        );
    }

    if (filters.endDate) {
        transactions = transactions.filter(t => 
            new Date(t.created_at) <= new Date(filters.endDate)
        );
    }

    // Sort by date (newest first)
    return transactions.sort((a, b) => 
        new Date(b.created_at) - new Date(a.created_at)
    );
}

/**
 * Get transactions by customer ID
 */
function getTransactionsByCustomer(customerId, filters = {}) {
    let transactions = agentTransactions.filter(t => t.customerId === customerId);

    if (filters.status) {
        transactions = transactions.filter(t => t.status === filters.status);
    }

    return transactions.sort((a, b) => 
        new Date(b.created_at) - new Date(a.created_at)
    );
}

/**
 * Get today's transactions for agent
 */
function getTodayTransactions(agentId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return agentTransactions.filter(t => 
        t.agentId === agentId && 
        new Date(t.created_at) >= today
    );
}

/**
 * Confirm agent transaction with PIN verification (with lock to prevent race condition)
 */
async function confirmTransaction(transactionId, agentPhone, pin) {
    // Use lock mechanism to prevent race condition
    const requestLock = require('./request-lock');
    const lockKey = `agent_transaction_${transactionId}`;
    
    try {
        // Acquire lock with timeout
        const lockAcquired = await requestLock.acquireLock(lockKey, 5000);
        
        if (!lockAcquired) {
            logger.warn('Failed to acquire lock for transaction confirmation', {
                transactionId: transactionId
            });
            return {
                success: false,
                message: 'Transaction sedang diproses. Silakan tunggu sebentar dan coba lagi.'
            };
        }
        
        try {
            // Re-check transaction status after acquiring lock (double-check pattern)
            const transaction = getTransactionById(transactionId);
            
            if (!transaction) {
                return {
                    success: false,
                    message: 'Transaction not found'
                };
            }

            // Check status again after lock (prevent race condition)
            if (transaction.status !== 'pending') {
                return {
                    success: false,
                    message: `Transaction already ${transaction.status}`
                };
            }

            // Verify agent credentials
            const verification = await verifyAgentCredentials(transaction.agentId, agentPhone, pin);
            
            if (!verification.success) {
                return {
                    success: false,
                    message: verification.message
                };
            }

            // Update transaction (atomic operation within lock)
            const index = agentTransactions.findIndex(t => t.id === transactionId);
            
            // Double-check status one more time before update
            if (agentTransactions[index].status !== 'pending') {
                return {
                    success: false,
                    message: `Transaction already ${agentTransactions[index].status}`
                };
            }
            
            agentTransactions[index].status = 'confirmed';
            agentTransactions[index].confirmedBy = agentPhone;
            agentTransactions[index].confirmedAt = new Date().toISOString();
            agentTransactions[index].updated_at = new Date().toISOString();
            
            saveAgentTransactions();
            try {
                const { syncFinancialLedgerSources } = require('./financial-ledger');
                await syncFinancialLedgerSources({ domains: ['agent'] });
            } catch (ledgerSyncError) {
                logger.warn('Failed to sync financial ledger after agent confirmation', {
                    transactionId,
                    error: ledgerSyncError.message
                });
            }

            // Jika transaksi ini pembelian voucher reseller (cash/transfer), stok agent
            // BARU diaktifkan sekarang — stok hanya masuk SETELAH pembayaran diverifikasi.
            // Lazy-require untuk menghindari circular dependency dengan agent-voucher-manager.
            if (agentTransactions[index].transactionType === 'voucher_purchase') {
                try {
                    const agentVoucherManager = require('./agent-voucher-manager');
                    const activation = agentVoucherManager.activatePurchaseByTransaction(transactionId);
                    if (!activation.success) {
                        logger.warn('Aktivasi stok voucher pasca-konfirmasi tidak menemukan purchase pending', {
                            transactionId,
                            reason: activation.message
                        });
                    }
                } catch (activationError) {
                    logger.error('Gagal mengaktifkan stok voucher setelah konfirmasi transaksi', {
                        transactionId,
                        error: activationError.message
                    });
                }
            }

            logger.info('Agent transaction confirmed', {
                id: transactionId,
                agentId: transaction.agentId,
                confirmedBy: agentPhone
            });

            return {
                success: true,
                transaction: agentTransactions[index]
            };
        } finally {
            // Always release lock
            requestLock.releaseLock(lockKey);
        }
    } catch (error) {
        logger.error('Error in confirmTransaction with lock', {
            transactionId: transactionId,
            error: error.message
        });
        
        // Try to release lock even on error
        try {
            requestLock.releaseLock(lockKey);
        } catch (releaseError) {
            logger.warn('Failed to release lock after error', {
                transactionId: transactionId,
                error: releaseError.message
            });
        }
        
        return {
            success: false,
            message: 'Terjadi kesalahan saat mengkonfirmasi transaksi. Silakan coba lagi.'
        };
    }
}

/**
 * Cancel agent transaction
 */
function cancelTransaction(transactionId, reason = null) {
    const index = agentTransactions.findIndex(t => t.id === transactionId);
    
    if (index === -1) {
        logger.warn('Transaction not found for cancellation', {
            transactionId: transactionId
        });
        return false;
    }
    
    // Only allow cancellation if status is 'pending'
    // Cannot cancel if already confirmed or completed
    if (agentTransactions[index].status !== 'pending') {
        logger.warn('Cannot cancel transaction with status other than pending', {
            transactionId: transactionId,
            currentStatus: agentTransactions[index].status
        });
        return false;
    }

    agentTransactions[index].status = 'cancelled';
    agentTransactions[index].notes = reason || agentTransactions[index].notes;
    agentTransactions[index].updated_at = new Date().toISOString();
    
    saveAgentTransactions();

    logger.info('Agent transaction cancelled', {
        id: transactionId,
        reason: reason
    });

    return true;
}

/**
 * Complete agent transaction (after saldo added)
 */
function completeTransaction(transactionId) {
    const index = agentTransactions.findIndex(t => t.id === transactionId);
    
    if (index === -1) {
        logger.warn('Transaction not found for completion', {
            transactionId: transactionId
        });
        return false;
    }
    
    // Only allow completion if status is 'confirmed'
    if (agentTransactions[index].status !== 'confirmed') {
        logger.warn('Cannot complete transaction with status other than confirmed', {
            transactionId: transactionId,
            currentStatus: agentTransactions[index].status
        });
        return false;
    }

    agentTransactions[index].status = 'completed';
    agentTransactions[index].updated_at = new Date().toISOString();
    
    saveAgentTransactions();
    const { syncFinancialLedgerSources } = require('./financial-ledger');
    syncFinancialLedgerSources({ domains: ['agent'] }).catch((ledgerSyncError) => {
        logger.warn('Failed to sync financial ledger after agent completion', {
            transactionId,
            error: ledgerSyncError.message
        });
    });
    
    logger.info('Agent transaction completed', {
        id: transactionId,
        agentId: agentTransactions[index].agentId
    });

    return true;
}

/**
 * Register agent credentials (WhatsApp + PIN) - with @lid support
 */
async function registerAgentCredentials(agentId, whatsappNumber, pin) {
    // Check if agent ID already registered
    const existing = agentCredentials.find(c => c.agentId === agentId);
    
    if (existing) {
        return {
            success: false,
            message: 'Agent already registered'
        };
    }
    
    // Check if WhatsApp number already registered for another agent
    const existingByPhone = agentCredentials.find(c => 
        c.agentId !== agentId && 
        whatsappNumbersMatch(c.whatsappNumber, whatsappNumber) &&
        c.active
    );
    
    if (existingByPhone) {
        return {
            success: false,
            message: 'Nomor WhatsApp ini sudah terdaftar untuk agent lain'
        };
    }

    // If @lid format, try to get actual phone number from agent data
    let actualPhoneNumber = whatsappNumber;
    if (whatsappNumber.endsWith('@lid')) {
        try {
            const agentManager = require('./agent-manager');
            const agent = agentManager.getAgentById(agentId);
            
            if (agent && agent.phone) {
                // Use agent's phone number as the actual identifier
                // Store both @lid and phone for lookup
                actualPhoneNumber = agent.phone;
            }
        } catch (error) {
            // If can't get agent data, use @lid as-is
            logger.warn('Could not get agent phone for @lid registration', {
                agentId: agentId,
                error: error.message
            });
        }
    }

    // Hash PIN
    const hashedPin = await bcrypt.hash(pin, 10);

    const credentials = {
        agentId: agentId,
        whatsappNumber: whatsappNumber, // Store original (may be @lid)
        actualPhoneNumber: actualPhoneNumber, // Store actual phone for lookup
        pin: hashedPin,
        active: true,
        created_at: new Date().toISOString(),
        lastLogin: null
    };

    agentCredentials.push(credentials);
    saveAgentCredentials();

    logger.info('Agent credentials registered', {
        agentId: agentId,
        whatsappNumber: whatsappNumber,
        actualPhoneNumber: actualPhoneNumber
    });

    return {
        success: true,
        credentials: credentials
    };
}

/**
 * Verify agent credentials (PIN check) - with @lid support
 */
async function verifyAgentCredentials(agentId, whatsappNumber, pin) {
    // Find credentials by agentId and active status first
    const candidateCredentials = agentCredentials.filter(c => 
        c.agentId === agentId && 
        c.active
    );
    
    // Then match WhatsApp number (with @lid support)
    // Try multiple matching strategies to handle different formats
    
    // Strategy 1: Direct match with whatsappNumber
    let credentials = candidateCredentials.find(c => 
        whatsappNumbersMatch(c.whatsappNumber, whatsappNumber)
    );
    
    // Strategy 2: Match with actualPhoneNumber
    if (!credentials) {
        credentials = candidateCredentials.find(c => 
            c.actualPhoneNumber && whatsappNumbersMatch(c.actualPhoneNumber, whatsappNumber)
        );
    }
    
    // Strategy 3: Normalize and compare (for plain numbers vs JID format)
    if (!credentials) {
        const normalizedInput = normalizeWhatsappNumber(whatsappNumber);
        if (normalizedInput) {
            credentials = candidateCredentials.find(c => {
                // Try matching with stored whatsappNumber
                const normalizedStored = normalizeWhatsappNumber(c.whatsappNumber);
                if (normalizedStored === normalizedInput) return true;
                
                // Try matching with actualPhoneNumber
                if (c.actualPhoneNumber) {
                    const normalizedActual = normalizeWhatsappNumber(c.actualPhoneNumber);
                    if (normalizedActual === normalizedInput) return true;
                }
                
                return false;
            });
        }
    }
    
    // Strategy 4: Extract phone from JID and match with plain number
    if (!credentials && whatsappNumber.includes('@s.whatsapp.net')) {
        const phoneFromJid = whatsappNumber.split('@')[0];
        credentials = candidateCredentials.find(c => {
            // Match with whatsappNumber (if it's plain number)
            if (!c.whatsappNumber.includes('@')) {
                return whatsappNumbersMatch(c.whatsappNumber, phoneFromJid);
            }
            // Match with actualPhoneNumber
            if (c.actualPhoneNumber) {
                return whatsappNumbersMatch(c.actualPhoneNumber, phoneFromJid);
            }
            return false;
        });
    }
    
    if (!credentials) {
        logger.warn('Agent credentials not found for PIN verification', {
            agentId: agentId,
            whatsappNumber: whatsappNumber,
            candidateCount: candidateCredentials.length,
            availableCredentials: candidateCredentials.map(c => ({
                whatsappNumber: c.whatsappNumber,
                actualPhoneNumber: c.actualPhoneNumber
            }))
        });
        return {
            success: false,
            message: 'Agent credentials not found or inactive'
        };
    }

    // Verify PIN (trim whitespace from PIN input)
    const trimmedPin = pin ? pin.trim() : '';
    const isValid = await bcrypt.compare(trimmedPin, credentials.pin);

    if (!isValid) {
        logger.warn('Invalid PIN attempt', {
            agentId: agentId,
            whatsappNumber: whatsappNumber,
            credentialsWhatsapp: credentials.whatsappNumber,
            credentialsActualPhone: credentials.actualPhoneNumber
        });

        return {
            success: false,
            message: 'Invalid PIN'
        };
    }

    // Update last login
    const index = agentCredentials.findIndex(c => c.agentId === agentId);
    agentCredentials[index].lastLogin = new Date().toISOString();
    saveAgentCredentials();

    return {
        success: true,
        agentId: agentId
    };
}

/**
 * Update agent PIN
 */
async function updateAgentPin(agentId, whatsappNumber, oldPin, newPin) {
    // Verify old PIN first
    const verification = await verifyAgentCredentials(agentId, whatsappNumber, oldPin);
    
    if (!verification.success) {
        return {
            success: false,
            message: 'Invalid current PIN'
        };
    }

    // Hash new PIN
    const hashedPin = await bcrypt.hash(newPin, 10);

    // Update credentials
    const index = agentCredentials.findIndex(c => c.agentId === agentId);
    agentCredentials[index].pin = hashedPin;
    agentCredentials[index].updated_at = new Date().toISOString();
    
    saveAgentCredentials();

    logger.info('Agent PIN updated', {
        agentId: agentId
    });

    return {
        success: true,
        message: 'PIN updated successfully'
    };
}

/**
 * Reset agent PIN (admin only - no old PIN required)
 */
async function resetAgentPin(agentId, newPin) {
    // Find credentials by agentId
    const index = agentCredentials.findIndex(c => c.agentId === agentId && c.active);
    
    if (index === -1) {
        return {
            success: false,
            message: 'Agent credentials not found or inactive'
        };
    }

    // Hash new PIN
    const hashedPin = await bcrypt.hash(newPin, 10);

    // Update credentials
    agentCredentials[index].pin = hashedPin;
    agentCredentials[index].updated_at = new Date().toISOString();
    
    saveAgentCredentials();

    logger.info('Agent PIN reset by admin', {
        agentId: agentId
    });

    return {
        success: true,
        message: 'PIN reset successfully'
    };
}

/**
 * Get agent PIN status (check if agent has credentials)
 */
function getAgentPinStatus(agentId) {
    const credentials = agentCredentials.find(c => c.agentId === agentId && c.active);
    
    if (!credentials) {
        return {
            success: true,
            hasPin: false,
            message: 'Agent belum memiliki PIN'
        };
    }

    return {
        success: true,
        hasPin: true,
        whatsappNumber: credentials.whatsappNumber,
        actualPhoneNumber: credentials.actualPhoneNumber,
        lastLogin: credentials.lastLogin,
        createdAt: credentials.created_at,
        message: 'Agent sudah memiliki PIN'
    };
}

/**
 * Normalize WhatsApp number for comparison (supports @lid format)
 * Extracts phone number from @lid format or normalizes standard format
 */
function normalizeWhatsappNumber(whatsappNumber) {
    if (!whatsappNumber) return null;
    
    // If it's already a plain number, normalize it
    if (!whatsappNumber.includes('@')) {
        // Remove non-digit characters
        let normalized = whatsappNumber.replace(/\D/g, '');
        // Convert to standard format (62...)
        if (normalized.startsWith('0')) {
            normalized = '62' + normalized.substring(1);
        } else if (normalized.startsWith('+62')) {
            normalized = normalized.substring(1);
        } else if (!normalized.startsWith('62')) {
            normalized = '62' + normalized;
        }
        return normalized;
    }
    
    // If it's @lid format, we can't extract phone directly
    // Return the full JID for exact match
    if (whatsappNumber.endsWith('@lid')) {
        return whatsappNumber;
    }
    
    // Standard @s.whatsapp.net format - extract phone number
    if (whatsappNumber.endsWith('@s.whatsapp.net')) {
        return whatsappNumber.split('@')[0];
    }
    
    // Return as-is if format unknown
    return whatsappNumber;
}

/**
 * Check if two WhatsApp numbers match (with @lid support)
 */
function whatsappNumbersMatch(num1, num2) {
    if (!num1 || !num2) return false;
    
    // Exact match
    if (num1 === num2) return true;
    
    // Normalize both numbers
    const normalized1 = normalizeWhatsappNumber(num1);
    const normalized2 = normalizeWhatsappNumber(num2);
    
    // Compare normalized numbers
    if (normalized1 && normalized2) {
        // If both are @lid, need exact match
        if (num1.endsWith('@lid') && num2.endsWith('@lid')) {
            return num1 === num2;
        }
        
        // Compare normalized phone numbers
        return normalized1 === normalized2;
    }
    
    return false;
}

/**
 * Get agent credentials by WhatsApp number (with @lid support)
 */
function getAgentByWhatsapp(whatsappNumber) {
    if (!whatsappNumber) return null;
    
    // Try exact match first (supports both @lid and @s.whatsapp.net)
    let credential = agentCredentials.find(c => {
        if (!c.active) return false;
        
        // Match by original whatsappNumber
        if (whatsappNumbersMatch(c.whatsappNumber, whatsappNumber)) {
            return true;
        }
        
        // Match by actualPhoneNumber if available
        if (c.actualPhoneNumber && whatsappNumbersMatch(c.actualPhoneNumber, whatsappNumber)) {
            return true;
        }
        
        return false;
    });
    
    if (credential) return credential;
    
    // If @lid format, try to find by stored mapping or agent phone
    if (whatsappNumber.endsWith('@lid')) {
        try {
            // Try to get phone number from lid-mappings
            const jidUtils = require('./jid-utils');
            const lidId = whatsappNumber.split('@')[0];
            const mappings = jidUtils.loadMappings?.() || { mappings: {} };
            
            if (mappings.mappings && mappings.mappings[lidId]) {
                // We have a user mapping, but we need agent mapping
                // Try to find agent by checking all agents and matching phone
                const agentManager = require('./agent-manager');
                const allAgents = agentManager.getAllAgents(false);
                
                for (const agent of allAgents) {
                    if (agent.phone) {
                        // Check if this agent's phone matches the mapped user
                        const normalizedAgentPhone = normalizeWhatsappNumber(agent.phone);
                        // For now, try to match by checking if agent has credentials
                        // and the actualPhoneNumber matches
                        const agentCred = agentCredentials.find(c => 
                            c.agentId === agent.id && 
                            c.active &&
                            (whatsappNumbersMatch(c.actualPhoneNumber, normalizedAgentPhone) ||
                             whatsappNumbersMatch(c.whatsappNumber, whatsappNumber))
                        );
                        
                        if (agentCred) {
                            return agentCred;
                        }
                    }
                }
            }
        } catch (error) {
            // lid-handler not available or error, continue
            logger.warn('Error in @lid lookup for agent', {
                whatsappNumber: whatsappNumber,
                error: error.message
            });
        }
    }
    
    return null;
}

/**
 * Get all agent credentials (for checking registration status)
 */
function getAllCredentials() {
    return [...agentCredentials]; // Return copy to prevent external modification
}

/**
 * Get agent statistics
 */
function getAgentStatistics(agentId, period = 'all') {
    let transactions = agentTransactions.filter(t => t.agentId === agentId);

    // Filter by period
    if (period === 'today') {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        transactions = transactions.filter(t => new Date(t.created_at) >= today);
    } else if (period === 'week') {
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        transactions = transactions.filter(t => new Date(t.created_at) >= weekAgo);
    } else if (period === 'month') {
        const monthAgo = new Date();
        monthAgo.setMonth(monthAgo.getMonth() - 1);
        transactions = transactions.filter(t => new Date(t.created_at) >= monthAgo);
    }

    const stats = {
        total: transactions.length,
        pending: transactions.filter(t => t.status === 'pending').length,
        confirmed: transactions.filter(t => t.status === 'confirmed').length,
        completed: transactions.filter(t => t.status === 'completed').length,
        cancelled: transactions.filter(t => t.status === 'cancelled').length,
        totalAmount: transactions
            .filter(t => t.status === 'completed')
            .reduce((sum, t) => sum + t.amount, 0),
        pendingAmount: transactions
            .filter(t => t.status === 'pending')
            .reduce((sum, t) => sum + t.amount, 0)
    };

    return stats;
}

/**
 * Get all transactions (admin view)
 */
function getAllTransactions(filters = {}) {
    let transactions = [...agentTransactions];

    if (filters.status) {
        transactions = transactions.filter(t => t.status === filters.status);
    }

    if (filters.agentId) {
        transactions = transactions.filter(t => t.agentId === filters.agentId);
    }

    if (filters.startDate) {
        transactions = transactions.filter(t => 
            new Date(t.created_at) >= new Date(filters.startDate)
        );
    }

    return transactions.sort((a, b) => 
        new Date(b.created_at) - new Date(a.created_at)
    );
}

// Initialize on load
initDatabase();

module.exports = {
    // Transaction management
    createAgentTransaction,
    getTransactionById,
    getTransactionsByAgent,
    getTransactionsByCustomer,
    getTodayTransactions,
    confirmTransaction,
    cancelTransaction,
    completeTransaction,
    getAllTransactions,
    
    // Credentials management
    registerAgentCredentials,
    verifyAgentCredentials,
    updateAgentPin,
    resetAgentPin,
    getAgentPinStatus,
    getAgentByWhatsapp,
    getAllCredentials,
    
    // Statistics
    getAgentStatistics,
    
    // Database access
    saveAgentTransactions,
    saveAgentCredentials
};
