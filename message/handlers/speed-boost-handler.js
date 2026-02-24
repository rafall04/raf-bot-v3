/**
 * Speed Boost Request Handler with Matrix Support
 * Handles complete speed boost request flow via WhatsApp
 * Integrated with Speed Boost Matrix Configuration
 */

const fs = require('fs');
const path = require('path');
const convertRupiah = require('rupiah-format');
const { saveSpeedRequests } = require('../../lib/database');
const { 
    getAvailableSpeedBoostsFromMatrix,
    calculateBoostPriceFromMatrix,
    getAvailablePaymentMethods,
    validateSpeedBoostRequest,
    getMessageTemplate,
    loadSpeedBoostConfig
} = require('../../lib/speed-boost-matrix-helper');

/**
 * Get available speed boost packages for user (using matrix)
 */
function getAvailableSpeedBoosts(user) {
    if (!global.packages || !user) return [];
    
    // Use matrix-based function
    return getAvailableSpeedBoostsFromMatrix(user, global.packages);
}

/**
 * Check if user can request speed boost (integrated with config)
 */
function canRequestSpeedBoost(user) {
    const config = loadSpeedBoostConfig();
    const errors = [];
    
    // Check if Speed Boost is enabled
    if (!config.enabled) {
        errors.push('❌ Speed Boost sedang tidak tersedia saat ini');
        return { valid: false, errors };
    }
    
    // Check if user is on whitelist package (free users - skip payment check)
    const userPackage = global.packages?.find(p => p.name === user.subscription);
    const isWhitelistUser = userPackage?.whitelist === true;
    
    // Check payment status if required (skip for whitelist users - they are free)
    if (config.globalSettings?.requirePaymentFirst && !isWhitelistUser && !user.paid) {
        errors.push('❌ Harap lunasi pembayaran bulan ini terlebih dahulu');
    }
    
    // Check for active speed request (with proper expiration check)
    const now = new Date();
    const activeRequest = global.speed_requests?.find(req => {
        if (req.userId != user.id) return false;
        
        // For active requests, check if not expired
        if (req.status === 'active') {
            if (req.expirationDate) {
                const expDate = new Date(req.expirationDate);
                if (expDate <= now) {
                    // Request is expired, should be reverted
                    req.status = 'expired';
                    saveSpeedRequests(); // Save the status change
                    return false;
                }
            }
            return true; // Still active
        }
        
        // For pending, check if it's been too long (7 days)
        if (req.status === 'pending') {
            const createdDate = new Date(req.createdAt);
            const daysSinceCreated = (now - createdDate) / (1000 * 60 * 60 * 24);
            if (daysSinceCreated > 7) {
                // Old pending request, mark as cancelled
                req.status = 'cancelled';
                saveSpeedRequests();
                return false;
            }
            return true; // Still valid pending
        }
        
        return false;
    });
    
    if (activeRequest && !config.globalSettings?.allowMultipleBoosts) {
        const statusMsg = activeRequest.status === 'pending' ? 
            'pending (menunggu pembayaran/approval)' : 
            'sedang aktif';
        errors.push(`❌ Anda sudah memiliki Speed Boost yang ${statusMsg}`);
    }
    
    // Check for active compensation
    const activeCompensation = global.compensations?.find(comp => 
        comp.userId == user.id && 
        comp.status === 'active' && 
        new Date(comp.expirationDate) > new Date()
    );
    
    if (activeCompensation) {
        errors.push('❌ Anda sedang mendapatkan kompensasi, tidak bisa request Speed Boost');
    }
    
    // Check PPPoE username
    if (!user.pppoe_username) {
        errors.push('❌ Akun PPPoE Anda belum diatur. Hubungi admin.');
    }
    
    return {
        valid: errors.length === 0,
        errors: errors
    };
}

/**
 * Format duration options for display (using matrix prices)
 */
function formatDurationOptions(currentPkg, targetPkg) {
    const options = [];
    
    // Get prices from matrix or package
    const prices = targetPkg.matrixPrices || targetPkg.speedBoostPrices || {};
    
    // Standard durations
    const durations = [
        { key: '1_day', label: '1 Hari', hours: 24 },
        { key: '3_days', label: '3 Hari', hours: 72 },
        { key: '7_days', label: '7 Hari', hours: 168 }
    ];
    
    // Add custom durations if exist
    Object.keys(prices).forEach(key => {
        if (!durations.find(d => d.key === key)) {
            const match = key.match(/(\d+)_day/);
            if (match) {
                const days = parseInt(match[1]);
                durations.push({
                    key: key,
                    label: `${days} Hari`,
                    hours: days * 24
                });
            }
        }
    });
    
    // Filter and add prices
    durations.forEach(duration => {
        const price = calculateBoostPriceFromMatrix(currentPkg, targetPkg, duration.key);
        if (price && price > 0) {
            options.push({
                ...duration,
                price: price
            });
        }
    });
    
    // Sort by hours
    options.sort((a, b) => a.hours - b.hours);
    
    return options;
}

/**
 * Create speed request
 */
function createSpeedRequest(user, packageName, duration, paymentMethod) {
    const requestedPackage = global.packages.find(p => p.name === packageName);
    if (!requestedPackage) return null;
    
    const currentPackage = global.packages.find(p => p.name === user.subscription);
    const durationOptions = formatDurationOptions(currentPackage, requestedPackage);
    const selectedDuration = durationOptions.find(d => d.key === duration);
    if (!selectedDuration) return null;
    
    const request = {
        id: `speedreq_${Date.now()}_${user.id}`,
        userId: user.id,
        userName: user.name,
        userPhone: user.phone_number,
        currentPackageName: user.subscription,
        currentPackagePrice: currentPackage?.price || 0,
        currentPackageProfile: currentPackage?.profile || '',
        requestedPackageName: packageName,
        requestedPackagePrice: requestedPackage.price,
        requestedPackageProfile: requestedPackage.profile,
        durationKey: duration,
        durationLabel: selectedDuration.label,
        durationHours: selectedDuration.hours,
        price: selectedDuration.price,
        paymentMethod: paymentMethod,
        paymentStatus: paymentMethod === 'double_billing' ? 'pending' : 'unpaid',
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    
    // Add to global speed requests
    if (!global.speed_requests) global.speed_requests = [];
    global.speed_requests.push(request);
    
    // Save to file
    saveSpeedRequests();
    
    return request;
}

/**
 * Main handler for speed boost request
 */
async function handleSpeedBoostRequest(msg, user, sender) {
    try {
        // Check if user can request
        const validation = canRequestSpeedBoost(user);
        if (!validation.valid) {
            const errorMsg = `⚠️ *Tidak Dapat Request Speed Boost*\n\n` +
                validation.errors.join('\n') + '\n\n' +
                `Silakan perbaiki terlebih dahulu atau hubungi admin.`;
            
            await global.conn.sendMessage(msg.key.remoteJid, { text: errorMsg });
            return;
        }
        
        // Get available packages
        const availablePackages = getAvailableSpeedBoosts(user);
        
        if (availablePackages.length === 0) {
            await global.conn.sendMessage(msg.key.remoteJid, {
                text: `❌ Maaf, tidak ada paket Speed Boost yang tersedia untuk paket Anda saat ini.\n\n` +
                      `Paket Anda: *${user.subscription}*\n\n` +
                      `Hubungi admin untuk informasi lebih lanjut.`
            });
            return;
        }
        
        // Start conversation flow
        global.tempStates = global.tempStates || {};
        global.tempStates[sender] = {
            state: 'SPEED_BOOST_SELECT_PACKAGE',
            availablePackages: availablePackages,
            timestamp: Date.now()
        };
        
        // Get welcome message from config
        const config = loadSpeedBoostConfig();
        let packageList = '';
        
        if (config.templates?.welcomeMessage) {
            packageList = getMessageTemplate('welcome', {}) + '\n\n';
        } else {
            packageList = `🚀 *REQUEST SPEED BOOST*\n`;
            packageList += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
        }
        
        packageList += `Paket Anda saat ini: *${user.subscription}*\n\n`;
        packageList += `📦 *Pilih Paket Tujuan:*\n\n`;
        
        const currentPackage = global.packages.find(p => p.name === user.subscription);
        
        availablePackages.forEach((pkg, index) => {
            packageList += `*${index + 1}.* ${pkg.name}\n`;
            packageList += `   📶 Kecepatan: ${pkg.profile}\n`;
            packageList += `   💰 Harga Normal: ${convertRupiah.convert(pkg.price)}/bulan\n`;
            
            const durations = formatDurationOptions(currentPackage, pkg);
            if (durations.length > 0) {
                packageList += `   ⏱️ Durasi & Harga Speed Boost:\n`;
                durations.forEach(d => {
                    packageList += `      • ${d.label}: ${convertRupiah.convert(d.price)}\n`;
                });
            }
            packageList += '\n';
        });
        
        packageList += `📝 *Balas dengan nomor paket* (1-${availablePackages.length})\n`;
        packageList += `❌ Ketik *batal* untuk membatalkan`;
        
        await global.conn.sendMessage(msg.key.remoteJid, { text: packageList });
        
    } catch (error) {
        console.error('[SPEED_BOOST_REQUEST_ERROR]', error);
        await global.conn.sendMessage(msg.key.remoteJid, {
            text: '❌ Terjadi kesalahan saat memproses request Speed Boost. Silakan coba lagi.'
        });
    }
}

/**
 * Handle package selection step
 */
async function handlePackageSelection(msg, user, sender, chats) {
    const state = global.tempStates[sender];
    if (!state || state.state !== 'SPEED_BOOST_SELECT_PACKAGE') return false;
    
    // Check for cancel
    if (chats.toLowerCase() === 'batal') {
        delete global.tempStates[sender];
        await global.conn.sendMessage(msg.key.remoteJid, {
            text: '❌ Request Speed Boost dibatalkan.'
        });
        return true;
    }
    
    const selection = parseInt(chats);
    if (isNaN(selection) || selection < 1 || selection > state.availablePackages.length) {
        await global.conn.sendMessage(msg.key.remoteJid, {
            text: `❌ Pilihan tidak valid. Silakan pilih nomor 1-${state.availablePackages.length} atau ketik *batal*.`
        });
        return true;
    }
    
    const selectedPackage = state.availablePackages[selection - 1];
    const currentPackage = global.packages.find(p => p.name === user.subscription);
    const durations = formatDurationOptions(currentPackage, selectedPackage);
    
    if (durations.length === 0) {
        delete global.tempStates[sender];
        await global.conn.sendMessage(msg.key.remoteJid, {
            text: '❌ Paket ini tidak memiliki opsi Speed Boost. Silakan pilih paket lain.'
        });
        return true;
    }
    
    // Update state
    state.state = 'SPEED_BOOST_SELECT_DURATION';
    state.selectedPackage = selectedPackage;
    state.durations = durations;
    
    // Show duration options
    let durationList = `⏱️ *PILIH DURASI SPEED BOOST*\n`;
    durationList += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
    durationList += `Paket dipilih: *${selectedPackage.name}* (${selectedPackage.profile})\n\n`;
    durationList += `📅 *Pilih Durasi:*\n\n`;
    
    durations.forEach((d, index) => {
        durationList += `*${index + 1}.* ${d.label}\n`;
        durationList += `   💰 Harga: ${convertRupiah.convert(d.price)}\n\n`;
    });
    
    durationList += `📝 *Balas dengan nomor durasi* (1-${durations.length})\n`;
    durationList += `❌ Ketik *batal* untuk membatalkan`;
    
    await global.conn.sendMessage(msg.key.remoteJid, { text: durationList });
    return true;
}

/**
 * Handle duration selection step
 */
async function handleDurationSelection(msg, user, sender, chats) {
    const state = global.tempStates[sender];
    if (!state || state.state !== 'SPEED_BOOST_SELECT_DURATION') return false;
    
    // Check for cancel
    if (chats.toLowerCase() === 'batal') {
        delete global.tempStates[sender];
        await global.conn.sendMessage(msg.key.remoteJid, {
            text: '❌ Request Speed Boost dibatalkan.'
        });
        return true;
    }
    
    const selection = parseInt(chats);
    if (isNaN(selection) || selection < 1 || selection > state.durations.length) {
        await global.conn.sendMessage(msg.key.remoteJid, {
            text: `❌ Pilihan tidak valid. Silakan pilih nomor 1-${state.durations.length} atau ketik *batal*.`
        });
        return true;
    }
    
    const selectedDuration = state.durations[selection - 1];
    
    // Update state
    state.state = 'SPEED_BOOST_SELECT_PAYMENT';
    state.selectedDuration = selectedDuration;
    
    // Get available payment methods from config
    const paymentMethods = getAvailablePaymentMethods();
    
    if (paymentMethods.length === 0) {
        delete global.tempStates[sender];
        await global.conn.sendMessage(msg.key.remoteJid, {
            text: '❌ Tidak ada metode pembayaran yang tersedia. Hubungi admin.'
        });
        return true;
    }
    
    state.paymentMethods = paymentMethods;
    
    // Show payment methods
    let paymentList = `💳 *PILIH METODE PEMBAYARAN*\n`;
    paymentList += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
    paymentList += `Total: *${convertRupiah.convert(state.selectedDuration.price)}*\n\n`;
    paymentList += `💰 *Metode Pembayaran:*\n\n`;
    
    paymentMethods.forEach((method, index) => {
        const icons = {
            'cash': '💵',
            'transfer': '🏦',
            'double_billing': '📋'
        };
        const descriptions = {
            'cash': 'Teknisi akan datang untuk ambil pembayaran',
            'transfer': 'Transfer ke rekening yang diberikan',
            'double_billing': 'Ditambahkan ke invoice bulan depan'
        };
        
        paymentList += `*${index + 1}.* ${icons[method.id] || '💰'} ${method.label}\n`;
        paymentList += `    ${descriptions[method.id] || ''}\n\n`;
    });
    
    paymentList += `📝 *Balas dengan nomor metode* (1-${paymentMethods.length})\n`;
    paymentList += `❌ Ketik *batal* untuk membatalkan`;
    
    await global.conn.sendMessage(msg.key.remoteJid, { text: paymentList });
    return true;
}

/**
 * Handle payment method selection step
 */
async function handlePaymentSelection(msg, user, sender, chats) {
    const state = global.tempStates[sender];
    if (!state || state.state !== 'SPEED_BOOST_SELECT_PAYMENT') return false;
    
    // Check for cancel
    if (chats.toLowerCase() === 'batal') {
        delete global.tempStates[sender];
        await global.conn.sendMessage(msg.key.remoteJid, {
            text: '❌ Request Speed Boost dibatalkan.'
        });
        return true;
    }
    
    const selection = parseInt(chats);
    if (isNaN(selection) || selection < 1 || selection > state.paymentMethods.length) {
        await global.conn.sendMessage(msg.key.remoteJid, {
            text: `❌ Pilihan tidak valid. Silakan pilih nomor 1-${state.paymentMethods.length} atau ketik *batal*.`
        });
        return true;
    }
    
    const selectedMethod = state.paymentMethods[selection - 1];
    const paymentMethod = selectedMethod.id;
    
    // Update state for confirmation
    state.state = 'SPEED_BOOST_CONFIRM';
    state.paymentMethod = paymentMethod;
    
    // Show confirmation
    const paymentLabels = {
        'cash': '💵 Cash (Tunai)',
        'transfer': '🏦 Transfer Bank',
        'double_billing': '📋 Tagihan Bulan Depan'
    };
    
    let confirmMsg = `✅ *KONFIRMASI SPEED BOOST*\n`;
    confirmMsg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
    confirmMsg += `📋 *Detail Order:*\n`;
    confirmMsg += `• Nama: ${user.name}\n`;
    confirmMsg += `• Paket Saat Ini: ${user.subscription}\n`;
    confirmMsg += `• Paket Tujuan: ${state.selectedPackage.name}\n`;
    confirmMsg += `• Kecepatan: ${state.selectedPackage.profile}\n`;
    confirmMsg += `• Durasi: ${state.selectedDuration.label}\n`;
    confirmMsg += `• Harga: ${convertRupiah.convert(state.selectedDuration.price)}\n`;
    confirmMsg += `• Pembayaran: ${paymentLabels[paymentMethod]}\n\n`;
    
    if (paymentMethod === 'cash') {
        confirmMsg += `📌 *Catatan:*\n`;
        confirmMsg += `Teknisi akan menghubungi Anda untuk pengambilan pembayaran.\n\n`;
    } else if (paymentMethod === 'transfer') {
        confirmMsg += `📌 *Catatan:*\n`;
        confirmMsg += `Setelah konfirmasi, Anda akan mendapat detail rekening untuk transfer.\n\n`;
    } else if (paymentMethod === 'double_billing') {
        confirmMsg += `📌 *Catatan:*\n`;
        confirmMsg += `Biaya akan ditambahkan ke tagihan bulan depan.\n\n`;
    }
    
    confirmMsg += `Apakah data sudah benar?\n\n`;
    confirmMsg += `✅ Ketik *ya* untuk konfirmasi\n`;
    confirmMsg += `❌ Ketik *tidak* untuk membatalkan`;
    
    await global.conn.sendMessage(msg.key.remoteJid, { text: confirmMsg });
    return true;
}

/**
 * Handle final confirmation step
 */
async function handleConfirmation(msg, user, sender, chats) {
    const state = global.tempStates[sender];
    if (!state || state.state !== 'SPEED_BOOST_CONFIRM') return false;
    
    const response = chats.toLowerCase();
    
    if (response === 'tidak' || response === 'no' || response === 'batal') {
        delete global.tempStates[sender];
        await global.conn.sendMessage(msg.key.remoteJid, {
            text: '❌ Request Speed Boost dibatalkan.'
        });
        return true;
    }
    
    if (response !== 'ya' && response !== 'yes' && response !== 'y') {
        await global.conn.sendMessage(msg.key.remoteJid, {
            text: '❌ Jawaban tidak valid. Ketik *ya* untuk konfirmasi atau *tidak* untuk membatalkan.'
        });
        return true;
    }
    
    // Create the speed request
    const request = createSpeedRequest(
        user,
        state.selectedPackage.name,
        state.selectedDuration.key,
        state.paymentMethod
    );
    
    if (!request) {
        delete global.tempStates[sender];
        await global.conn.sendMessage(msg.key.remoteJid, {
            text: '❌ Gagal membuat request Speed Boost. Silakan coba lagi.'
        });
        return true;
    }
    
    // Clear state
    delete global.tempStates[sender];
    
    // Get success message template from config
    const config = loadSpeedBoostConfig();
    let successMsg = '';
    
    // Use template if available
    if (config.templates?.successMessage) {
        successMsg = getMessageTemplate('success', {
            requestId: request.id,
            packageName: request.requestedPackageName,
            duration: request.durationLabel,
            price: convertRupiah.convert(request.price)
        });
        successMsg += '\n\n';
    } else {
        // Default message
        successMsg = `✅ *REQUEST SPEED BOOST BERHASIL!*\n`;
        successMsg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
        successMsg += `📋 *Detail Request:*\n`;
        successMsg += `• ID Request: ${request.id}\n`;
        successMsg += `• Paket: ${request.requestedPackageName}\n`;
        successMsg += `• Durasi: ${request.durationLabel}\n`;
        successMsg += `• Harga: ${convertRupiah.convert(request.price)}\n\n`;
    }
    
    if (state.paymentMethod === 'cash') {
        successMsg += `💵 *PEMBAYARAN CASH*\n`;
        successMsg += `━━━━━━━━━━━━━━━━━━━━━\n`;
        successMsg += `Teknisi akan menghubungi Anda dalam 1-2 jam untuk:\n`;
        successMsg += `• Mengambil pembayaran tunai\n`;
        successMsg += `• Konfirmasi aktivasi Speed Boost\n\n`;
        successMsg += `⚠️ Speed Boost akan diaktifkan setelah pembayaran diterima.\n\n`;
        successMsg += `Jika ada pertanyaan, hubungi admin.`;
        
    } else if (state.paymentMethod === 'transfer') {
        successMsg += `🏦 *PEMBAYARAN TRANSFER*\n`;
        successMsg += `━━━━━━━━━━━━━━━━━━━━━\n`;
        successMsg += `Silakan transfer ke rekening berikut:\n\n`;
        
        // Get bank accounts from config.json
        const bankAccounts = global.config?.bankAccounts || [];
        
        if (bankAccounts.length === 0) {
            successMsg += `⚠️ *Info rekening belum tersedia*\n`;
            successMsg += `Silakan hubungi admin untuk informasi rekening.\n\n`;
        } else {
            bankAccounts.forEach(acc => {
                successMsg += `🏦 *${acc.bank}*\n`;
                successMsg += `   No. Rek: ${acc.number}\n`;
                successMsg += `   A.n: ${acc.name}\n\n`;
            });
        }
        
        successMsg += `💰 *Jumlah Transfer:* ${convertRupiah.convert(request.price)}\n\n`;
        successMsg += `📸 *PENTING:*\n`;
        successMsg += `Setelah transfer, *WAJIB kirim bukti pembayaran* (foto/screenshot) ke WhatsApp ini.\n\n`;
        successMsg += `⚠️ Speed Boost akan diaktifkan setelah pembayaran diverifikasi admin.`;
        
    } else if (state.paymentMethod === 'double_billing') {
        successMsg += `📋 *TAGIHAN BULAN DEPAN*\n`;
        successMsg += `━━━━━━━━━━━━━━━━━━━━━\n`;
        successMsg += `Request Anda telah diterima dan akan diproses.\n\n`;
        successMsg += `• Biaya akan ditambahkan ke invoice bulan depan\n`;
        successMsg += `• Admin akan review dan approve request Anda\n`;
        successMsg += `• Speed Boost akan aktif setelah disetujui\n\n`;
        successMsg += `⏱️ Estimasi proses: 1-2 jam kerja\n\n`;
        successMsg += `Anda akan menerima notifikasi saat Speed Boost aktif.`;
    }
    
    await global.conn.sendMessage(msg.key.remoteJid, { text: successMsg });
    
    // Notify admin
    if (global.config.ownerNumber && Array.isArray(global.config.ownerNumber)) {
        const paymentLabels = {
            'cash': '💵 Cash',
            'transfer': '🏦 Transfer',
            'double_billing': '📋 Tagihan Bulan Depan'
        };
        
        const adminMsg = `🚀 *SPEED BOOST REQUEST BARU*\n` +
            `━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `👤 *Pelanggan:* ${user.name}\n` +
            `📱 *No. HP:* ${user.phone_number}\n` +
            `📦 *Paket Saat Ini:* ${user.subscription}\n` +
            `🎯 *Paket Tujuan:* ${request.requestedPackageName}\n` +
            `⏱️ *Durasi:* ${request.durationLabel}\n` +
            `💰 *Harga:* ${convertRupiah.convert(request.price)}\n` +
            `💳 *Metode:* ${paymentLabels[state.paymentMethod]}\n\n` +
            `📌 ID Request: ${request.id}\n\n` +
            `Silakan review di panel admin.`;
        
        for (const ownerNum of global.config.ownerNumber) {
            const ownerJid = ownerNum.endsWith('@s.whatsapp.net') ? ownerNum : `${ownerNum}@s.whatsapp.net`;
            try {
                await global.conn.sendMessage(ownerJid, { text: adminMsg });
            } catch (e) {
                console.error('Failed to notify admin:', e);
            }
        }
    }
    
    return true;
}

/**
 * Handle conversation steps
 */
async function handleSpeedBoostConversation(msg, user, sender, chats) {
    const state = global.tempStates?.[sender];
    if (!state) return false;
    
    // Check timeout (15 minutes)
    if (Date.now() - state.timestamp > 15 * 60 * 1000) {
        delete global.tempStates[sender];
        return false;
    }
    
    // Update timestamp
    state.timestamp = Date.now();
    
    switch (state.state) {
        case 'SPEED_BOOST_SELECT_PACKAGE':
            return await handlePackageSelection(msg, user, sender, chats);
        
        case 'SPEED_BOOST_SELECT_DURATION':
            return await handleDurationSelection(msg, user, sender, chats);
        
        case 'SPEED_BOOST_SELECT_PAYMENT':
            return await handlePaymentSelection(msg, user, sender, chats);
        
        case 'SPEED_BOOST_CONFIRM':
            return await handleConfirmation(msg, user, sender, chats);
        
        default:
            return false;
    }
}

/**
 * Clear/reset speed boost status for a user (admin only)
 */
async function clearSpeedBoostStatus(msg, user, sender, targetUserId) {
    try {
        if (!global.speed_requests) return false;
        
        let cleared = 0;
        global.speed_requests.forEach(req => {
            if (req.userId == targetUserId) {
                if (['pending', 'active'].includes(req.status)) {
                    req.status = 'cancelled_admin';
                    req.cancelledBy = sender;
                    req.cancelledAt = new Date().toISOString();
                    cleared++;
                }
            }
        });
        
        if (cleared > 0) {
            saveSpeedRequests();
            await global.conn.sendMessage(msg.key.remoteJid, {
                text: `✅ Berhasil clear ${cleared} speed boost request untuk user ID ${targetUserId}`
            });
            return true;
        } else {
            await global.conn.sendMessage(msg.key.remoteJid, {
                text: `ℹ️ Tidak ada speed boost aktif/pending untuk user ID ${targetUserId}`
            });
            return true;
        }
    } catch (error) {
        console.error('[CLEAR_SPEED_BOOST_ERROR]', error);
        return false;
    }
}

module.exports = {
    handleSpeedBoostRequest,
    handleSpeedBoostConversation,
    clearSpeedBoostStatus,
    canRequestSpeedBoost,
    getAvailableSpeedBoosts
};
