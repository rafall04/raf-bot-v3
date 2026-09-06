const fs = require('fs');
const path = require('path');
const { getvoucher } = require('./mikrotik');
const { syncFinancialLedgerSources } = require('./financial-ledger');
const { recordVoucherOrphan } = require('./voucher-orphan');

// Database paths
const VOUCHER_PROFILES_DB = path.join(__dirname, '../database/voucher.json');
const VOUCHER_PURCHASES_DB = path.join(__dirname, '../database/voucher_purchases.json');

// Load voucher profiles (template/paket yang tersedia)
function getVoucherProfiles() {
    try {
        if (fs.existsSync(VOUCHER_PROFILES_DB)) {
            return JSON.parse(fs.readFileSync(VOUCHER_PROFILES_DB, 'utf8'));
        }
        return [];
    } catch (error) {
        console.error('Error loading voucher profiles:', error);
        return [];
    }
}

// Save voucher profiles
function saveVoucherProfiles(profiles) {
    fs.writeFileSync(VOUCHER_PROFILES_DB, JSON.stringify(profiles, null, 2));
}

// Load purchase history
function getPurchaseHistory() {
    try {
        if (fs.existsSync(VOUCHER_PURCHASES_DB)) {
            return JSON.parse(fs.readFileSync(VOUCHER_PURCHASES_DB, 'utf8'));
        }
        return [];
    } catch (error) {
        console.error('Error loading purchase history:', error);
        return [];
    }
}

// Save purchase history
function savePurchaseHistory(purchases) {
    fs.writeFileSync(VOUCHER_PURCHASES_DB, JSON.stringify(purchases, null, 2));
}

// Generate voucher via MikroTik Hotspot API
async function generateVoucherCode(profile, userId) {
    try {
        // Call MikroTik API to create hotspot user
        const voucherResult = await getvoucher(profile, userId, { caller: 'voucher-manager.generateVoucherCode' });
        if (!voucherResult.ok) {
            throw new Error(voucherResult.message);
        }

        const voucherData = voucherResult.data || {};
        if (!voucherData || !voucherData.username) {
            throw new Error('Failed to generate voucher from MikroTik');
        }
        
        return {
            username: voucherData.username,
            password: voucherData.password || voucherData.username,
            profile: voucherData.profile
        };
    } catch (error) {
        console.error('Error generating voucher:', error);
        throw error;
    }
}

// Purchase voucher with saldo
async function purchaseVoucherWithSaldo(userId, voucherProfileId, saldoManager) {
    try {
        // Get voucher profile
        const profiles = getVoucherProfiles();
        const profile = profiles.find(p => p.prof === voucherProfileId);
        
        if (!profile) {
            return {
                success: false,
                message: 'Profile voucher tidak ditemukan'
            };
        }
        
        // Check user saldo (getUserSaldo async — WAJIB di-await; tanpa await, perbandingan jadi Promise < number = selalu false)
        const userSaldo = await saldoManager.getUserSaldo(userId);
        const price = parseInt(profile.hargavc);
        
        if (userSaldo < price) {
            return {
                success: false,
                message: `Saldo tidak cukup. Saldo: Rp ${userSaldo.toLocaleString('id-ID')}, Harga: Rp ${price.toLocaleString('id-ID')}`
            };
        }
        
        // Generate voucher code via MikroTik
        let voucherCode;
        try {
            voucherCode = await generateVoucherCode(profile.prof, userId);
        } catch (error) {
            return {
                success: false,
                message: 'Gagal generate voucher dari MikroTik: ' + error.message
            };
        }
        
        // Deduct saldo (deductSaldo async & atomik di level DB — WAJIB di-await agar boolean hasilnya valid)
        const deducted = await saldoManager.deductSaldo(userId, price, `Pembelian voucher ${profile.namavc}`);
        if (!deducted) {
            // Voucher sudah terlanjur dibuat di MikroTik tetapi pemotongan saldo gagal (mis. saldo
            // berubah karena pembelian paralel). #b325: CATAT ke worklist orphan (database/
            // voucher_orphans.json) — bukan cuma console.error yang tak pernah dilihat — supaya voucher
            // yatim MASUK rekonsiliasi seperti jalur WA pelanggan (payment-flow.service) & callback.
            recordVoucherOrphan({
                sender: String(userId).split('@')[0],
                voucherCode: voucherCode.username,
                profile: profile.prof,
                price,
                reason: 'admin_purchase_deduct_failed'
            });
            console.error(`[VOUCHER_ORPHAN] Saldo gagal dipotong untuk user ${userId} setelah voucher ${voucherCode.username} dibuat di MikroTik. Dicatat ke worklist orphan.`);
            return {
                success: false,
                message: 'Gagal memotong saldo'
            };
        }
        
        // Save purchase history
        const purchase = {
            id: `VCPURCH${Date.now()}`,
            userId: userId,
            profileId: profile.prof,
            profileName: profile.namavc,
            duration: profile.durasivc,
            price: price,
            voucherUsername: voucherCode.username,
            voucherPassword: voucherCode.password,
            purchasedAt: new Date().toISOString()
        };
        
        const purchases = getPurchaseHistory();
        purchases.push(purchase);
        savePurchaseHistory(purchases);
        try {
            await syncFinancialLedgerSources({ domains: ['voucher'] });
        } catch (ledgerSyncError) {
            console.error('[VOUCHER_LEDGER_SYNC_ERROR]', ledgerSyncError.message);
        }
        
        return {
            success: true,
            message: 'Voucher berhasil dibeli',
            voucher: {
                code: voucherCode.username,
                password: voucherCode.password,
                profile: profile.namavc,
                duration: profile.durasivc,
                price: price
            },
            remainingSaldo: await saldoManager.getUserSaldo(userId)
        };
        
    } catch (error) {
        console.error('Error purchasing voucher:', error);
        return {
            success: false,
            message: 'Terjadi kesalahan: ' + error.message
        };
    }
}

// Get user purchase history
function getUserPurchaseHistory(userId, limit = 10) {
    const purchases = getPurchaseHistory();
    return purchases
        .filter(p => p.userId === userId)
        .sort((a, b) => new Date(b.purchasedAt) - new Date(a.purchasedAt))
        .slice(0, limit);
}

// CRUD operations for voucher profiles
function addVoucherProfile(profile) {
    const profiles = getVoucherProfiles();
    
    // Check if profile already exists
    if (profiles.find(p => p.prof === profile.prof)) {
        return {
            success: false,
            message: 'Profile voucher sudah ada'
        };
    }
    
    profiles.push(profile);
    saveVoucherProfiles(profiles);
    
    // Update global variable
    global.voucher = profiles;
    
    return {
        success: true,
        message: 'Profile voucher berhasil ditambahkan'
    };
}

function updateVoucherProfile(profileId, updates) {
    const profiles = getVoucherProfiles();
    const index = profiles.findIndex(p => p.prof === profileId);
    
    if (index === -1) {
        return {
            success: false,
            message: 'Profile voucher tidak ditemukan'
        };
    }
    
    profiles[index] = { ...profiles[index], ...updates };
    saveVoucherProfiles(profiles);
    
    // Update global variable
    global.voucher = profiles;
    
    return {
        success: true,
        message: 'Profile voucher berhasil diupdate'
    };
}

function deleteVoucherProfile(profileId) {
    const profiles = getVoucherProfiles();
    const index = profiles.findIndex(p => p.prof === profileId);
    
    if (index === -1) {
        return {
            success: false,
            message: 'Profile voucher tidak ditemukan'
        };
    }
    
    profiles.splice(index, 1);
    saveVoucherProfiles(profiles);
    
    // Update global variable
    global.voucher = profiles;
    
    return {
        success: true,
        message: 'Profile voucher berhasil dihapus'
    };
}

// Statistics
function getVoucherStatistics() {
    const purchases = getPurchaseHistory();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const todayPurchases = purchases.filter(p => 
        new Date(p.purchasedAt) >= today
    );
    
    const totalRevenue = purchases.reduce((sum, p) => sum + p.price, 0);
    const todayRevenue = todayPurchases.reduce((sum, p) => sum + p.price, 0);
    
    return {
        totalPurchases: purchases.length,
        todayPurchases: todayPurchases.length,
        totalRevenue: totalRevenue,
        todayRevenue: todayRevenue,
        averagePrice: purchases.length > 0 ? Math.floor(totalRevenue / purchases.length) : 0
    };
}

module.exports = {
    // Profile management
    getVoucherProfiles,
    addVoucherProfile,
    updateVoucherProfile,
    deleteVoucherProfile,
    
    // Purchase operations
    purchaseVoucherWithSaldo,
    getUserPurchaseHistory,
    
    // Statistics
    getVoucherStatistics,
    
    // Direct voucher generation (for testing)
    generateVoucherCode
};
