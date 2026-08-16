/**
 * Speed Request Helper Functions
 * Standardisasi format dan validasi untuk speed request
 */

// Standard duration mapping
const DURATION_MAP = {
    '1_day': { label: '1 Hari', hours: 24, days: 1 },
    '3_days': { label: '3 Hari', hours: 72, days: 3 },
    '7_days': { label: '7 Hari', hours: 168, days: 7 },
    // Support alternative formats for backward compatibility
    '1 day': { label: '1 Hari', hours: 24, days: 1 },
    '3 days': { label: '3 Hari', hours: 72, days: 3 },
    '7 days': { label: '7 Hari', hours: 168, days: 7 }
};

/**
 * Normalize duration key to standard format (with underscore)
 */
function normalizeDurationKey(duration) {
    if (!duration) return null;
    
    // If already in standard format
    if (DURATION_MAP[duration]) {
        return duration.includes('_') ? duration : duration.replace(' ', '_');
    }
    
    // Try to convert common formats
    const normalized = duration.toString().toLowerCase().replace(/\s+/g, '_');
    if (DURATION_MAP[normalized]) {
        return normalized;
    }
    
    return null;
}

/**
 * Get duration info from key
 */
function getDurationInfo(durationKey) {
    const normalized = normalizeDurationKey(durationKey);
    if (!normalized) return null;
    
    const baseKey = normalized.includes('_') ? normalized : normalized.replace(' ', '_');
    return {
        key: baseKey,
        ...DURATION_MAP[baseKey]
    };
}

/**
 * Validate if user can request speed boost
 */
function validateSpeedRequest(user, packages) {
    const errors = [];
    
    // Check if user exists
    if (!user) {
        errors.push('User tidak ditemukan');
        return { valid: false, errors };
    }
    
    // Check if user has active subscription
    if (!user.subscription) {
        errors.push('User tidak memiliki paket langganan aktif');
        return { valid: false, errors };
    }
    
    // Check if user is on whitelist package (free users - skip payment check)
    const userPackage = packages?.find(p => p.name === user.subscription);
    const isWhitelistUser = userPackage?.whitelist === true;
    
    // Check payment status (skip for whitelist users - they are free)
    if (!isWhitelistUser && (user.paid === false || user.paid === 0)) {
        errors.push('Harap lunasi pembayaran bulan ini terlebih dahulu');
        return { valid: false, errors };
    }
    
    // Check if user has PPPoE username
    if (!user.pppoe_username) {
        errors.push('User tidak memiliki username PPPoE');
        return { valid: false, errors };
    }
    
    // Check existing active/pending requests
    const existingRequest = global.speed_requests?.find(r => 
        r.userId === user.id && 
        (r.status === 'pending' || r.status === 'active')
    );
    
    if (existingRequest) {
        errors.push(`Sudah ada permintaan speed boost yang ${existingRequest.status === 'pending' ? 'menunggu persetujuan' : 'sedang aktif'}`);
        return { valid: false, errors };
    }
    
    // Check if there's active compensation
    const activeCompensation = global.compensations?.find(c => 
        c.userId === user.id.toString() && 
        c.status === 'active'
    );
    
    if (activeCompensation) {
        errors.push('User sedang mendapatkan kompensasi kecepatan');
        return { valid: false, errors };
    }
    
    return { valid: true, errors: [] };
}

/**
 * Get available speed boost packages for user
 */
function getAvailableSpeedBoosts(user, packages) {
    if (!user || !user.subscription) return [];
    
    // Find current package
    const currentPackage = packages.find(p => p.name === user.subscription);
    if (!currentPackage) return [];
    
    const currentPrice = Number(currentPackage.price) || 0;
    
    // Filter packages that are marked as speed boost and have higher price
    return packages.filter(p => 
        p.isSpeedBoost === true && 
        (Number(p.price) || 0) > currentPrice &&
        p.speedBoostPrices // Must have boost prices defined
    );
}

/**
 * Calculate speed boost price
 */
function calculateBoostPrice(currentPackage, targetPackage, durationKey) {
    if (!targetPackage.speedBoostPrices) return null;
    
    // Normalize duration key
    const normalizedKey = normalizeDurationKey(durationKey);
    if (!normalizedKey) return null;
    
    // Try both formats (with underscore and without)
    let price = targetPackage.speedBoostPrices[normalizedKey];
    if (price === undefined || price === null || price === '') {
        // Try alternative format
        const altKey = normalizedKey.replace('_', ' ');
        price = targetPackage.speedBoostPrices[altKey];
    }
    
    // Convert to number and validate
    const numPrice = Number(price);
    if (isNaN(numPrice) || numPrice <= 0) return null;
    
    return numPrice;
}

/**
 * Format speed request for consistent response
 */
function formatSpeedRequest(request, packages) {
    const currentPackage = packages?.find(p => p.name === request.currentPackageName);
    const requestedPackage = packages?.find(p => p.name === request.requestedPackageName);
    const durationInfo = getDurationInfo(request.durationKey);
    
    // STARVASI DATA — `pppoeUsername` dan `profile` SENGAJA tidak dioper.
    //
    // Bentuk ini dipakai rute portal PELANGGAN yang HIDUP hari ini
    // (`/api/customer/speed-requests/active` & `/history`, `routes/public.js`), dan rute itu
    // TIDAK bergerbang matrix Speed on Demand. Yang menahan kebocoran selama ini cuma bentuk
    // data: store masih berisi record uji dengan `pppoeUsername` kosong dan nama paket yang
    // tak cocok `packages.json` sehingga lookup profil gagal. Satu request normal saja sudah
    // cukup membuat username PPPoE + dua nama profil MikroTik terbaca penuh di respons JSON.
    //
    // Nama profil router juga BUKAN angka yang dibeli pelanggan: terukur di `packages.json`,
    // PAKET-110K dijual "Up To 10Mbps" tetapi profilnya `12Mbps` (juga 15→17, 30→32).
    return {
        id: request.id,
        userId: request.userId,
        userName: request.userName,
        currentPackage: currentPackage ? {
            name: currentPackage.name,
            price: currentPackage.price
        } : { name: request.currentPackageName },
        requestedPackage: requestedPackage ? {
            name: requestedPackage.name,
            price: requestedPackage.price
        } : { name: request.requestedPackageName },
        duration: durationInfo || {
            key: request.durationKey,
            label: request.durationKey?.replace('_', ' '),
            hours: request.durationHours
        },
        boostPrice: request.price,
        status: request.status,
        timestamps: {
            created: request.createdAt,
            updated: request.updatedAt,
            expires: request.expirationDate
        },
        notes: request.notes,
        approvedBy: request.approvedBy
    };
}

/**
 * Create new speed request object
 */
function createSpeedRequest(user, targetPackageName, durationKey, price, paymentMethod = 'cash') {
    const timestamp = Date.now();
    const durationInfo = getDurationInfo(durationKey);
    
    return {
        id: `speedreq_${timestamp}_${user.id}`,
        userId: user.id,
        userName: user.name,
        pppoeUsername: user.pppoe_username,
        currentPackageName: user.subscription,
        requestedPackageName: targetPackageName,
        durationKey: durationInfo?.key || durationKey,
        price: price.toString(),
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: null,
        approvedBy: null,
        durationHours: durationInfo?.hours || null,
        expirationDate: null,
        notes: '',
        // Payment fields
        paymentMethod: paymentMethod, // cash, transfer, double_billing, free
        paymentStatus: 'unpaid', // unpaid, pending, paid, verified
        paymentProof: null, // path to payment proof image
        paymentDate: null,
        paymentAmount: null,
        paymentNotes: '',
        paymentVerifiedBy: null,
        paymentVerifiedAt: null,
        addedToInvoice: false, // for double billing
        invoiceId: null // link to invoice if double billing
    };
}

module.exports = {
    DURATION_MAP,
    normalizeDurationKey,
    getDurationInfo,
    validateSpeedRequest,
    getAvailableSpeedBoosts,
    calculateBoostPrice,
    formatSpeedRequest,
    createSpeedRequest
};
