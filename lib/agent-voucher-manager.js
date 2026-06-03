"use strict";

/**
 * Agent Voucher Manager
 * Manages agent voucher inventory, purchases, and sales
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('./logger');
const { generateVoucherCode } = require('./voucher-manager');
const { getVoucherProfiles } = require('./voucher-manager');

// Database paths
const INVENTORY_DB = path.join(__dirname, '../database/agent_voucher_inventory.json');
const PURCHASES_DB = path.join(__dirname, '../database/agent_voucher_purchases.json');
const SALES_DB = path.join(__dirname, '../database/agent_voucher_sales.json');

// Load data
let inventory = [];
let purchases = [];
let sales = [];

// Initialize database
function initDatabase() {
    try {
        // Load inventory
        if (fs.existsSync(INVENTORY_DB)) {
            inventory = JSON.parse(fs.readFileSync(INVENTORY_DB, 'utf8'));
        } else {
            fs.writeFileSync(INVENTORY_DB, '[]');
        }

        // Load purchases
        if (fs.existsSync(PURCHASES_DB)) {
            purchases = JSON.parse(fs.readFileSync(PURCHASES_DB, 'utf8'));
        } else {
            fs.writeFileSync(PURCHASES_DB, '[]');
        }

        // Load sales
        if (fs.existsSync(SALES_DB)) {
            sales = JSON.parse(fs.readFileSync(SALES_DB, 'utf8'));
        } else {
            fs.writeFileSync(SALES_DB, '[]');
        }

        logger.info('Agent voucher database initialized', {
            inventory: inventory.length,
            purchases: purchases.length,
            sales: sales.length
        });
    } catch (error) {
        logger.error('Error initializing agent voucher database:', error);
    }
}

// Save functions
function saveInventory() {
    fs.writeFileSync(INVENTORY_DB, JSON.stringify(inventory, null, 2));
}

function savePurchases() {
    fs.writeFileSync(PURCHASES_DB, JSON.stringify(purchases, null, 2));
}

function saveSales() {
    fs.writeFileSync(SALES_DB, JSON.stringify(sales, null, 2));
}

/**
 * Get or create agent inventory
 */
function getOrCreateAgentInventory(agentId, agentName) {
    let agentInventory = inventory.find(inv => inv.agentId === agentId);
    
    if (!agentInventory) {
        agentInventory = {
            agentId: agentId,
            agentName: agentName,
            inventory: [],
            totalStok: 0,
            totalTerjual: 0,
            totalProfit: 0,
            updated_at: new Date().toISOString()
        };
        inventory.push(agentInventory);
        saveInventory();
    }
    
    return agentInventory;
}

/**
 * Get agent inventory
 */
function getAgentInventory(agentId) {
    const agentInventory = inventory.find(inv => inv.agentId === agentId);
    
    if (!agentInventory) {
        return {
            agentId: agentId,
            agentName: null,
            inventory: [],
            totalStok: 0,
            totalTerjual: 0,
            totalProfit: 0,
            updated_at: null
        };
    }
    
    return agentInventory;
}

/**
 * Update inventory item
 */
function updateInventoryItem(agentId, voucherProfileId, updates) {
    const agentInventory = getOrCreateAgentInventory(agentId, updates.agentName || 'Agent');
    
    let item = agentInventory.inventory.find(item => item.voucherProfileId === voucherProfileId);
    
    if (!item) {
        // Create new inventory item
        const profiles = getVoucherProfiles();
        const profile = profiles.find(p => p.prof === voucherProfileId);
        
        if (!profile) {
            throw new Error(`Voucher profile ${voucherProfileId} not found`);
        }
        
        item = {
            voucherProfileId: voucherProfileId,
            voucherProfileName: profile.namavc,
            duration: profile.durasivc,
            hargaReseller: parseInt(profile.hargaReseller || profile.hargavc),
            hargaJual: parseInt(profile.hargavc),
            stok: 0,
            terjual: 0,
            totalProfit: 0
        };
        agentInventory.inventory.push(item);
    }
    
    // Update item
    Object.assign(item, updates);
    
    // Recalculate totals
    agentInventory.totalStok = agentInventory.inventory.reduce((sum, item) => sum + item.stok, 0);
    agentInventory.totalTerjual = agentInventory.inventory.reduce((sum, item) => sum + item.terjual, 0);
    agentInventory.totalProfit = agentInventory.inventory.reduce((sum, item) => sum + item.totalProfit, 0);
    agentInventory.updated_at = new Date().toISOString();
    
    saveInventory();
    
    return item;
}

/**
 * Purchase voucher as reseller
 */
async function purchaseVoucherAsReseller(agentId, voucherProfileId, quantity, paymentMethod = 'saldo', agentName = null) {
    try {
        // Validate inputs
        if (!agentId || !voucherProfileId || !quantity) {
            return {
                success: false,
                message: 'Missing required fields: agentId, voucherProfileId, and quantity are required'
            };
        }
        
        const qty = parseInt(quantity);
        if (isNaN(qty) || qty <= 0 || qty > 100) {
            return {
                success: false,
                message: 'Quantity must be between 1 and 100'
            };
        }
        
        // Get voucher profile
        const profiles = getVoucherProfiles();
        const profile = profiles.find(p => p.prof === voucherProfileId);
        
        if (!profile) {
            return {
                success: false,
                message: 'Voucher profile tidak ditemukan'
            };
        }
        
        // Get agent info
        const agentManager = require('./agent-manager');
        const agent = agentManager.getAgentById(agentId);
        
        if (!agent) {
            return {
                success: false,
                message: 'Agent tidak ditemukan'
            };
        }
        
        const finalAgentName = agentName || agent.name;
        if (profile.hargaReseller === undefined || profile.hargaReseller === null || String(profile.hargaReseller).trim() === '') {
            return {
                success: false,
                message: 'Voucher profile belum memiliki harga reseller'
            };
        }

        const hargaReseller = parseInt(profile.hargaReseller);
        const totalHarga = hargaReseller * qty;
        
        // Handle payment based on method
        let agentTransactionId = null;
        
        if (paymentMethod === 'saldo') {
            // Check and deduct agent saldo
            const saldoManager = require('./saldo-manager');
            
            // Get agent phone and format to JID
            let agentUserId = agent.phone;
            if (agentUserId) {
                if (!agentUserId.includes('@')) {
                    agentUserId = agentUserId.startsWith('0') ? '62' + agentUserId.substring(1) : agentUserId;
                    agentUserId = agentUserId.startsWith('62') ? agentUserId : '62' + agentUserId;
                    agentUserId = agentUserId + '@s.whatsapp.net';
                }
            } else {
                return {
                    success: false,
                    message: 'Nomor WhatsApp agent tidak ditemukan. Hubungi admin untuk setup.'
                };
            }
            
            // Check agent saldo
            const agentSaldo = saldoManager.getUserSaldo(agentUserId);
            
            if (agentSaldo < totalHarga) {
                return {
                    success: false,
                    message: `Saldo tidak cukup. Saldo: ${saldoManager.formatCurrency(agentSaldo)}, Dibutuhkan: ${saldoManager.formatCurrency(totalHarga)}`
                };
            }
            
            // Deduct saldo
            const deducted = saldoManager.deductSaldo(
                agentUserId,
                totalHarga,
                `Pembelian voucher reseller ${profile.namavc} x${qty}`
            );
            
            if (!deducted) {
                return {
                    success: false,
                    message: 'Gagal memotong saldo agent'
                };
            }
            
            logger.info('Agent saldo deducted for voucher purchase', {
                agentId: agentId,
                agentUserId: agentUserId,
                amount: totalHarga,
                remainingSaldo: saldoManager.getUserSaldo(agentUserId)
            });
        } else if (paymentMethod === 'cash' || paymentMethod === 'transfer') {
            // Create agent transaction for cash/transfer payment
            const agentTransactionManager = require('./agent-transaction-manager');
            
            try {
                const transaction = agentTransactionManager.createAgentTransaction({
                    customerId: agentId, // Agent is the customer in this case
                    customerName: finalAgentName,
                    agentId: agentId,
                    agentName: finalAgentName,
                    amount: totalHarga,
                    transactionType: 'voucher_purchase',
                    notes: `Pembelian voucher ${profile.namavc} x${qty}`
                });
                
                agentTransactionId = transaction.id;
            } catch (error) {
                logger.error('Error creating agent transaction for voucher purchase:', error);
                return {
                    success: false,
                    message: 'Gagal membuat transaksi: ' + error.message
                };
            }
        }
        
        // Generate voucher codes
        const voucherCodes = [];
        const generatePromises = [];
        
        for (let i = 0; i < qty; i++) {
            generatePromises.push(
                generateVoucherCode(profile.prof, `${agentId}_${Date.now()}_${i}`)
                    .then(code => ({
                        username: code.username,
                        password: code.password,
                        status: 'available'
                    }))
                    .catch(error => {
                        logger.error(`Error generating voucher code ${i + 1}:`, error);
                        return null;
                    })
            );
        }
        
        const generatedCodes = await Promise.all(generatePromises);
        
        // Filter out failed generations
        const validCodes = generatedCodes.filter(code => code !== null);
        
        if (validCodes.length !== qty) {
            return {
                success: false,
                message: `Gagal generate ${qty - validCodes.length} voucher code. Silakan coba lagi.`
            };
        }
        
        voucherCodes.push(...validCodes);
        
        // Create purchase record
        const purchaseId = `AGV_PURCH_${Date.now()}`;
        const purchase = {
            id: purchaseId,
            agentId: agentId,
            agentName: finalAgentName,
            voucherProfileId: voucherProfileId,
            voucherProfileName: profile.namavc,
            duration: profile.durasivc,
            quantity: qty,
            hargaReseller: hargaReseller,
            totalHarga: totalHarga,
            paymentMethod: paymentMethod,
            agentTransactionId: agentTransactionId,
            status: paymentMethod === 'saldo' ? 'completed' : 'pending',
            voucherCodes: voucherCodes,
            created_at: new Date().toISOString(),
            completed_at: paymentMethod === 'saldo' ? new Date().toISOString() : null
        };
        
        purchases.push(purchase);
        savePurchases();
        
        // Update inventory
        const currentInventory = getAgentInventory(agentId);
        const currentStok = currentInventory.inventory.find(item => item.voucherProfileId === voucherProfileId)?.stok || 0;
        
        updateInventoryItem(agentId, voucherProfileId, {
            agentName: finalAgentName,
            stok: currentStok + qty
        });
        
        logger.info('Agent voucher purchase created', {
            purchaseId: purchaseId,
            agentId: agentId,
            voucherProfileId: voucherProfileId,
            quantity: qty
        });
        
        return {
            success: true,
            message: `Berhasil membeli ${qty} voucher ${profile.namavc}`,
            purchase: purchase,
            inventory: getAgentInventory(agentId)
        };
        
    } catch (error) {
        logger.error('Error purchasing voucher as reseller:', error);
        return {
            success: false,
            message: 'Terjadi kesalahan: ' + error.message
        };
    }
}

/**
 * Sell voucher to customer
 */
async function sellVoucherToCustomer(agentId, customerId, voucherProfileId, paymentMethod = 'cash', customerName = 'Customer', agentName = null, quantity = 1) {
    try {
        // Validate inputs
        if (!agentId || !customerId || !voucherProfileId) {
            return {
                success: false,
                message: 'Missing required fields: agentId, customerId, and voucherProfileId are required'
            };
        }
        
        // Get agent inventory
        const agentInventory = getAgentInventory(agentId);
        
        if (!agentInventory || agentInventory.agentId !== agentId) {
            return {
                success: false,
                message: 'Agent inventory tidak ditemukan'
            };
        }
        
        // Find voucher in inventory
        const inventoryItem = agentInventory.inventory.find(item => item.voucherProfileId === voucherProfileId);
        
        if (!inventoryItem || inventoryItem.stok <= 0) {
            return {
                success: false,
                message: 'Stok voucher tidak tersedia'
            };
        }
        
        // Get voucher profile for harga jual
        const profiles = getVoucherProfiles();
        const profile = profiles.find(p => p.prof === voucherProfileId);
        
        if (!profile) {
            return {
                success: false,
                message: 'Voucher profile tidak ditemukan'
            };
        }
        
        // Get agent info
        const agentManager = require('./agent-manager');
        const agent = agentManager.getAgentById(agentId);
        
        if (!agent) {
            return {
                success: false,
                message: 'Agent tidak ditemukan'
            };
        }
        
        const finalAgentName = agentName || agent.name;
        const hargaJual = parseInt(profile.hargavc);
        const hargaReseller = inventoryItem.hargaReseller;
        const profit = hargaJual - hargaReseller;
        const qty = parseInt(quantity) || 1;
        
        // Validate quantity
        if (qty < 1 || qty > inventoryItem.stok) {
            return {
                success: false,
                message: `Jumlah tidak valid. Stok tersedia: ${inventoryItem.stok} voucher`
            };
        }
        
        // Get available voucher codes from purchase history
        // Find the oldest available voucher codes for this profile
        const voucherCodes = [];
        const purchaseRecords = [];
        
        for (const purchase of purchases) {
            if (purchase.agentId === agentId && 
                purchase.voucherProfileId === voucherProfileId && 
                purchase.status === 'completed') {
                
                const availableCodes = purchase.voucherCodes.filter(code => code.status === 'available');
                
                for (const code of availableCodes) {
                    if (voucherCodes.length < qty) {
                        voucherCodes.push({
                            username: code.username,
                            password: code.password
                        });
                        if (!purchaseRecords.find(p => p.id === purchase.id)) {
                            purchaseRecords.push(purchase);
                        }
                    }
                }
                
                if (voucherCodes.length >= qty) {
                    break;
                }
            }
        }
        
        if (voucherCodes.length < qty) {
            return {
                success: false,
                message: `Tidak ada cukup voucher code tersedia. Tersedia: ${voucherCodes.length}, Dibutuhkan: ${qty}`
            };
        }
        
        // Create agent transaction
        const agentTransactionManager = require('./agent-transaction-manager');
        let agentTransactionId = null;
        const totalAmount = hargaJual * qty;
        
        try {
            const transaction = agentTransactionManager.createAgentTransaction({
                customerId: customerId,
                customerName: customerName,
                agentId: agentId,
                agentName: finalAgentName,
                amount: totalAmount,
                transactionType: 'voucher_sale',
                notes: `Penjualan ${qty} voucher ${profile.namavc}`
            });
            
            agentTransactionId = transaction.id;
        } catch (error) {
            logger.error('Error creating agent transaction for voucher sale:', error);
            return {
                success: false,
                message: 'Gagal membuat transaksi: ' + error.message
            };
        }
        
        // Create sale records for each voucher
        const salesCreated = [];
        const saleId = `AGV_SALE_${Date.now()}`;
        
        for (let i = 0; i < qty; i++) {
            const voucherCode = voucherCodes[i];
            const sale = {
                id: `${saleId}_${i + 1}`,
                agentId: agentId,
                agentName: finalAgentName,
                customerId: customerId,
                customerName: customerName,
                voucherProfileId: voucherProfileId,
                voucherProfileName: profile.namavc,
                duration: profile.durasivc,
                voucherCode: voucherCode,
                hargaReseller: hargaReseller,
                hargaJual: hargaJual,
                profit: profit,
                paymentMethod: paymentMethod,
                agentTransactionId: agentTransactionId,
                status: 'completed',
                sold_at: new Date().toISOString(),
                created_at: new Date().toISOString()
            };
            
            sales.push(sale);
            salesCreated.push(sale);
            
            // Mark voucher code as sold in purchase record
            for (const purchaseRecord of purchaseRecords) {
                const codeIndex = purchaseRecord.voucherCodes.findIndex(
                    code => code.username === voucherCode.username && code.status === 'available'
                );
                if (codeIndex !== -1) {
                    purchaseRecord.voucherCodes[codeIndex].status = 'sold';
                    break; // Only mark one code per purchase record
                }
            }
        }
        
        saveSales();
        savePurchases();
        
        // Update inventory
        updateInventoryItem(agentId, voucherProfileId, {
            agentName: finalAgentName,
            stok: inventoryItem.stok - qty,
            terjual: inventoryItem.terjual + qty,
            totalProfit: inventoryItem.totalProfit + (profit * qty)
        });
        
        logger.info('Agent voucher sale created', {
            saleId: saleId,
            agentId: agentId,
            customerId: customerId,
            voucherProfileId: voucherProfileId,
            quantity: qty
        });
        
        return {
            success: true,
            message: `Berhasil menjual ${qty} voucher ${profile.namavc}`,
            sale: salesCreated[0], // Return first sale for compatibility
            sales: salesCreated, // Return all sales
            voucherCodes: voucherCodes, // Return all voucher codes
            voucherCode: voucherCodes[0], // Return first for backward compatibility
            quantity: qty,
            totalAmount: totalAmount,
            totalProfit: profit * qty,
            inventory: getAgentInventory(agentId)
        };
        
    } catch (error) {
        logger.error('Error selling voucher to customer:', error);
        logger.error('Error details:', {
            message: error.message,
            stack: error.stack,
            agentId: agentId,
            customerId: customerId,
            voucherProfileId: voucherProfileId,
            quantity: quantity
        });
        return {
            success: false,
            message: 'Terjadi kesalahan: ' + (error.message || 'Unknown error')
        };
    }
}

/**
 * Get agent voucher statistics
 */
function getAgentVoucherStats(agentId) {
    const agentInventory = getAgentInventory(agentId);
    
    const agentPurchases = purchases.filter(p => p.agentId === agentId);
    const agentSales = sales.filter(s => s.agentId === agentId);
    
    const totalPurchases = agentPurchases.length;
    const totalSales = agentSales.length;
    const totalPurchaseAmount = agentPurchases
        .filter(p => p.status === 'completed')
        .reduce((sum, p) => sum + p.totalHarga, 0);
    const totalSalesAmount = agentSales
        .filter(s => s.status === 'completed')
        .reduce((sum, s) => sum + s.hargaJual, 0);
    const totalProfit = agentSales
        .filter(s => s.status === 'completed')
        .reduce((sum, s) => sum + s.profit, 0);
    
    // Today's stats
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const todayPurchases = agentPurchases.filter(p => 
        new Date(p.created_at) >= today && p.status === 'completed'
    );
    const todaySales = agentSales.filter(s => 
        new Date(s.created_at) >= today && s.status === 'completed'
    );
    
    return {
        agentId: agentId,
        agentName: agentInventory.agentName,
        inventory: {
            totalStok: agentInventory.totalStok,
            totalTerjual: agentInventory.totalTerjual,
            totalProfit: agentInventory.totalProfit,
            items: agentInventory.inventory
        },
        purchases: {
            total: totalPurchases,
            today: todayPurchases.length,
            totalAmount: totalPurchaseAmount,
            todayAmount: todayPurchases.reduce((sum, p) => sum + p.totalHarga, 0)
        },
        sales: {
            total: totalSales,
            today: todaySales.length,
            totalAmount: totalSalesAmount,
            todayAmount: todaySales.reduce((sum, s) => sum + s.hargaJual, 0),
            totalProfit: totalProfit,
            todayProfit: todaySales.reduce((sum, s) => sum + s.profit, 0)
        }
    };
}

/**
 * Get purchase history
 */
function getPurchaseHistory(agentId, limit = 50) {
    let agentPurchases = purchases.filter(p => p.agentId === agentId);
    
    // Sort by date (newest first)
    agentPurchases.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    
    // Limit results
    if (limit > 0) {
        agentPurchases = agentPurchases.slice(0, limit);
    }
    
    return agentPurchases;
}

/**
 * Get sales history
 */
function getSalesHistory(agentId, limit = 50) {
    let agentSales = sales.filter(s => s.agentId === agentId);
    
    // Sort by date (newest first)
    agentSales.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    
    // Limit results
    if (limit > 0) {
        agentSales = agentSales.slice(0, limit);
    }
    
    return agentSales;
}

// Initialize on load
initDatabase();

module.exports = {
    // Inventory
    getAgentInventory,
    
    // Purchase
    purchaseVoucherAsReseller,
    getPurchaseHistory,
    
    // Sales
    sellVoucherToCustomer,
    getSalesHistory,
    
    // Statistics
    getAgentVoucherStats,
    
    // Internal (for testing)
    updateInventoryItem
};

