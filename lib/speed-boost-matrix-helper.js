/**
 * Speed Boost Matrix Helper
 * Helper functions for handling Speed Boost pricing matrix
 */

const fs = require('fs');
const path = require('path');

/**
 * Load Speed Boost configuration
 */
function loadSpeedBoostConfig() {
    try {
        const configPath = path.join(__dirname, '..', 'database', 'speed_boost_matrix.json');
        if (fs.existsSync(configPath)) {
            return JSON.parse(fs.readFileSync(configPath, 'utf8'));
        }
    } catch (error) {
        console.error('[SPEED_BOOST_CONFIG_LOAD_ERROR]', error);
    }
    
    // Return default config if error or not found
    return {
        enabled: true,
        globalSettings: {
            allowMultipleBoosts: false,
            requirePaymentFirst: true,
            autoApproveDoubleBoost: true,
            maxBoostDuration: 30,
            minBoostDuration: 1
        },
        pricingMatrix: [],
        customPackages: [],
        paymentMethods: {
            cash: { enabled: true, autoApprove: false },
            transfer: { enabled: true, requireProof: true },
            double_billing: { enabled: true, maxAmount: 500000 }
        }
    };
}

/**
 * Get available speed boost packages for user based on matrix
 */
function getAvailableSpeedBoostsFromMatrix(user, packages) {
    const config = loadSpeedBoostConfig();
    
    if (!config.enabled) {
        return [];
    }
    
    if (!user || !user.subscription) {
        return [];
    }
    
    // Find current package
    const currentPackage = packages.find(p => p.name === user.subscription);
    if (!currentPackage) {
        return [];
    }
    
    const availableBoosts = [];
    
    // Check pricing matrix
    config.pricingMatrix.forEach(matrix => {
        const fromPackages = Array.isArray(matrix.fromPackages) ? matrix.fromPackages : [matrix.fromPackages];
        
        // Check if user's current package is in the from packages
        const matchingFrom = fromPackages.find(p => 
            p.id == currentPackage.id || 
            p.name === currentPackage.name
        );
        
        if (matchingFrom) {
            // This matrix applies to the user
            const toPackage = packages.find(p => 
                p.id == matrix.toPackage.id || 
                p.name === matrix.toPackage.name
            );
            
            if (toPackage) {
                // Add this as available boost with matrix prices
                availableBoosts.push({
                    ...toPackage,
                    matrixPrices: matrix.prices,
                    isFromMatrix: true
                });
            }
        }
    });
    
    // Add custom packages if applicable
    config.customPackages.forEach(customPkg => {
        // Custom packages are available to all users
        // But must be higher speed than current
        const currentSpeed = parseInt(currentPackage.profile) || 0;
        const customSpeed = parseInt(customPkg.speed) || 0;
        
        if (customSpeed > currentSpeed) {
            availableBoosts.push({
                id: customPkg.id,
                name: customPkg.name,
                profile: `${customPkg.speed}Mbps`,
                price: customPkg.price,
                matrixPrices: customPkg.speedBoostPrices,
                isCustomPackage: true
            });
        }
    });
    
    // Also check packages with old speedBoostPrices field (backward compatibility)
    packages.forEach(pkg => {
        if (pkg.isSpeedBoost && pkg.speedBoostPrices) {
            const pkgPrice = Number(pkg.price) || 0;
            const currentPrice = Number(currentPackage.price) || 0;
            
            if (pkgPrice > currentPrice) {
                // Check if not already added from matrix
                const alreadyAdded = availableBoosts.find(b => b.id == pkg.id);
                if (!alreadyAdded) {
                    availableBoosts.push({
                        ...pkg,
                        matrixPrices: pkg.speedBoostPrices,
                        isLegacy: true
                    });
                }
            }
        }
    });
    
    return availableBoosts;
}

/**
 * Calculate boost price based on matrix
 */
function calculateBoostPriceFromMatrix(currentPackage, targetPackage, durationKey) {
    const config = loadSpeedBoostConfig();
    
    // First check if there's a specific matrix for this combination
    const matrix = config.pricingMatrix.find(m => {
        const fromPackages = Array.isArray(m.fromPackages) ? m.fromPackages : [m.fromPackages];
        const matchingFrom = fromPackages.find(p => 
            p.id == currentPackage.id || 
            p.name === currentPackage.name
        );
        
        return matchingFrom && (
            m.toPackage.id == targetPackage.id || 
            m.toPackage.name === targetPackage.name
        );
    });
    
    if (matrix && matrix.prices) {
        // Normalize duration key
        const normalizedKey = normalizeDurationKey(durationKey);
        const price = matrix.prices[normalizedKey];
        
        if (price !== undefined && price !== null) {
            return Number(price);
        }
    }
    
    // Check if target is custom package
    const customPkg = config.customPackages.find(p => 
        p.id == targetPackage.id || 
        p.name === targetPackage.name
    );
    
    if (customPkg && customPkg.speedBoostPrices) {
        const normalizedKey = normalizeDurationKey(durationKey);
        const price = customPkg.speedBoostPrices[normalizedKey];
        
        if (price !== undefined && price !== null) {
            return Number(price);
        }
    }
    
    // Fallback to legacy speedBoostPrices if available
    if (targetPackage.speedBoostPrices) {
        const normalizedKey = normalizeDurationKey(durationKey);
        const price = targetPackage.speedBoostPrices[normalizedKey];
        
        if (price !== undefined && price !== null) {
            return Number(price);
        }
    }
    
    return null;
}

/**
 * Normalize duration key
 */
function normalizeDurationKey(duration) {
    if (!duration) return null;
    
    // Convert to standard format with underscore
    const normalized = duration.toString().toLowerCase().replace(/\s+/g, '_');
    
    // Handle common formats
    if (normalized === '1' || normalized === '1_hari') return '1_day';
    if (normalized === '3' || normalized === '3_hari') return '3_days';
    if (normalized === '7' || normalized === '7_hari') return '7_days';
    
    // Return as-is if already in correct format
    if (normalized.endsWith('_day') || normalized.endsWith('_days')) {
        return normalized;
    }
    
    // Try to extract number and format properly
    const match = normalized.match(/(\d+)/);
    if (match) {
        const num = parseInt(match[1]);
        return num === 1 ? '1_day' : `${num}_days`;
    }
    
    return normalized;
}

/**
 * Get available payment methods
 */
function getAvailablePaymentMethods() {
    const config = loadSpeedBoostConfig();
    const methods = [];
    
    if (config.paymentMethods.cash?.enabled) {
        methods.push({
            id: 'cash',
            label: config.paymentMethods.cash.label || 'Bayar Tunai',
            requireProof: false,
            autoApprove: config.paymentMethods.cash.autoApprove || false
        });
    }
    
    if (config.paymentMethods.transfer?.enabled) {
        methods.push({
            id: 'transfer',
            label: config.paymentMethods.transfer.label || 'Transfer Bank',
            requireProof: config.paymentMethods.transfer.requireProof !== false,
            autoApprove: false
        });
    }
    
    if (config.paymentMethods.double_billing?.enabled) {
        methods.push({
            id: 'double_billing',
            label: config.paymentMethods.double_billing.label || 'Double Billing',
            requireProof: false,
            autoApprove: true,
            maxAmount: config.paymentMethods.double_billing.maxAmount || 500000
        });
    }
    
    return methods;
}

/**
 * Validate speed boost request based on config
 */
function validateSpeedBoostRequest(user, targetPackage, duration, amount) {
    const config = loadSpeedBoostConfig();
    const errors = [];
    
    if (!config.enabled) {
        errors.push('Speed Boost sedang tidak tersedia');
        return { valid: false, errors };
    }
    
    // Check if user is on whitelist package (free users - skip payment check)
    const userPackage = global.packages?.find(p => p.name === user.subscription);
    const isWhitelistUser = userPackage?.whitelist === true;
    
    // Check payment requirement (skip for whitelist users - they are free)
    if (config.globalSettings.requirePaymentFirst && !isWhitelistUser && !user.paid) {
        errors.push('Harap lunasi pembayaran bulan ini terlebih dahulu');
    }
    
    // Check multiple boosts
    if (!config.globalSettings.allowMultipleBoosts) {
        const activeBoost = global.speed_requests?.find(r => 
            r.userId == user.id && 
            ['pending', 'active'].includes(r.status)
        );
        
        if (activeBoost) {
            errors.push('Anda sudah memiliki Speed Boost yang sedang aktif atau pending');
        }
    }
    
    // Check duration limits
    const durationDays = parseInt(duration) || 0;
    if (durationDays < config.globalSettings.minBoostDuration) {
        errors.push(`Durasi minimal ${config.globalSettings.minBoostDuration} hari`);
    }
    if (durationDays > config.globalSettings.maxBoostDuration) {
        errors.push(`Durasi maksimal ${config.globalSettings.maxBoostDuration} hari`);
    }
    
    // Check double billing max amount
    if (amount && config.paymentMethods.double_billing?.maxAmount) {
        if (amount > config.paymentMethods.double_billing.maxAmount) {
            errors.push(`Maksimal double billing adalah Rp ${config.paymentMethods.double_billing.maxAmount.toLocaleString('id-ID')}`);
        }
    }
    
    return {
        valid: errors.length === 0,
        errors: errors
    };
}

/**
 * Get message template
 */
function getMessageTemplate(type, variables = {}) {
    const config = loadSpeedBoostConfig();
    let template = '';
    
    switch(type) {
        case 'welcome':
            template = config.templates?.welcomeMessage || '🚀 *SPEED BOOST ON DEMAND*\n\nTingkatkan kecepatan internet Anda sesuai kebutuhan!';
            break;
        case 'success':
            template = config.templates?.successMessage || '✅ Request Speed Boost berhasil dibuat!\n\nID: {requestId}\nPaket: {packageName}\nDurasi: {duration}\nHarga: {price}';
            break;
        case 'rejection':
            template = config.templates?.rejectionMessage || '❌ Maaf, request Speed Boost Anda ditolak.\n\nAlasan: {reason}';
            break;
    }
    
    // Replace variables
    Object.keys(variables).forEach(key => {
        template = template.replace(new RegExp(`{${key}}`, 'g'), variables[key]);
    });
    
    // Fix escaped newlines
    template = template.replace(/\\n/g, '\n');
    
    return template;
}

module.exports = {
    loadSpeedBoostConfig,
    getAvailableSpeedBoostsFromMatrix,
    calculateBoostPriceFromMatrix,
    normalizeDurationKey,
    getAvailablePaymentMethods,
    validateSpeedBoostRequest,
    getMessageTemplate
};
