/**
 * Header Doc
 * Purpose: Menangani flow request Speed Boost via WhatsApp dari validasi awal sampai konfirmasi akhir.
 * Caller: `message/raf.js` dan dispatcher intent/state Speed Boost.
 * Deps: `../../lib/database`, `../../lib/speed-boost-matrix-helper`, `../../lib/template-service`, dan `../../lib/whatsapp-delivery-service`.
 * MainFuncs: `handleSpeedBoostRequest`, `handleSpeedBoostConversation`, `clearSpeedBoostStatus`, `canRequestSpeedBoost`, `getAvailableSpeedBoosts`.
 * SideEffects: Membaca/menulis `global.speed_requests`, mengubah `global.tempStates`, dan mengirim pesan WhatsApp.
 */

const convertRupiah = require('rupiah-format');
const { saveSpeedRequests } = require('../../lib/database');
const { sendMessage } = require('../../lib/whatsapp-delivery-service');
const { renderCategoryTemplate } = require('../../lib/template-service');
const { 
    getAvailableSpeedBoostsFromMatrix,
    calculateBoostPriceFromMatrix,
    getAvailablePaymentMethods,
    validateSpeedBoostRequest: _validateSpeedBoostRequest,
    getMessageTemplate,
    loadSpeedBoostConfig
} = require('../../lib/speed-boost-matrix-helper');

function renderResponseTemplate(key, data = {}) {
    const result = renderCategoryTemplate('responseTemplates', key, data);
    return result.found && result.text.trim() ? result.text : key;
}

function renderResponseTemplateOrFallback(key, fallback, data = {}) {
    const result = renderCategoryTemplate('responseTemplates', key, data);
    return result.found && result.text.trim() ? result.text : fallback;
}

function buildSpeedBoostPackageOptions(availablePackages, currentPackage) {
    return availablePackages.map((pkg, index) => {
        const durations = formatDurationOptions(currentPackage, pkg);
        const durationOptions = durations.map(duration => renderResponseTemplateOrFallback(
            'speed_boost_package_duration_item',
            `${duration.label}: ${convertRupiah.convert(duration.price)}`,
            {
                durationLabel: duration.label,
                price: convertRupiah.convert(duration.price)
            }
        )).join('\n');

        return renderResponseTemplate('speed_boost_package_item', {
            option: index + 1,
            packageName: pkg.name,
            profile: pkg.profile || pkg.speed || '-',
            normalPrice: convertRupiah.convert(pkg.price || 0),
            durationOptions
        });
    }).join('\n\n');
}

function buildSpeedBoostDurationOptions(durations) {
    return durations.map((duration, index) => renderResponseTemplate('speed_boost_duration_item', {
        option: index + 1,
        durationLabel: duration.label,
        price: convertRupiah.convert(duration.price)
    })).join('\n\n');
}

function buildSpeedBoostPaymentOptions(paymentMethods) {
    return paymentMethods.map((method, index) => {
        const icon = renderResponseTemplateOrFallback(`speed_boost_payment_method_${method.id}_icon`, '', {});
        const description = renderResponseTemplateOrFallback(`speed_boost_payment_method_${method.id}_description`, '', {});

        return renderResponseTemplate('speed_boost_payment_method_item', {
            option: index + 1,
            icon,
            methodLabel: method.label,
            methodDescription: description
        });
    }).join('\n\n');
}

function getSpeedBoostPaymentLabel(paymentMethod) {
    return renderResponseTemplateOrFallback(
        `speed_boost_payment_label_${paymentMethod}`,
        paymentMethod,
        {}
    );
}

function getSpeedBoostConfirmationNote(paymentMethod) {
    return renderResponseTemplateOrFallback(`speed_boost_confirmation_note_${paymentMethod}`, '', {});
}

function buildBankAccountOptions(bankAccounts) {
    return bankAccounts.map(account => renderResponseTemplate('speed_boost_bank_account_item', {
        bankName: account.bank,
        accountNumber: account.number,
        accountName: account.name
    })).join('\n\n');
}

async function deliverPayload(recipient, payload, options = {}) {
    return sendMessage(recipient, payload, options);
}

async function deliverText(recipient, text, options = {}) {
    return sendMessage(recipient, { text }, options);
}

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
        errors.push(renderResponseTemplate('speed_boost_validation_disabled'));
        return { valid: false, errors };
    }
    
    // Check if user is on whitelist package (free users - skip payment check)
    const userPackage = global.packages?.find(p => p.name === user.subscription);
    const isWhitelistUser = userPackage?.whitelist === true;
    
    // Check payment status if required (skip for whitelist users - they are free)
    if (config.globalSettings?.requirePaymentFirst && !isWhitelistUser && !user.paid) {
        errors.push(renderResponseTemplate('speed_boost_validation_unpaid'));
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
        const statusMsg = activeRequest.status === 'pending'
            ? renderResponseTemplate('speed_boost_status_pending_label')
            : renderResponseTemplate('speed_boost_status_active_label');
        errors.push(renderResponseTemplate('speed_boost_validation_existing_request', { status: statusMsg }));
    }
    
    // Check for active compensation
    const activeCompensation = global.compensations?.find(comp => 
        comp.userId == user.id && 
        comp.status === 'active' && 
        new Date(comp.expirationDate) > new Date()
    );
    
    if (activeCompensation) {
        errors.push(renderResponseTemplate('speed_boost_validation_active_compensation'));
    }
    
    // Check PPPoE username
    if (!user.pppoe_username) {
        errors.push(renderResponseTemplate('speed_boost_validation_missing_pppoe'));
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
            await deliverText(msg.key.remoteJid, renderResponseTemplate('speed_boost_validation_failed', {
                errors: validation.errors.join('\n')
            }));
            return;
        }
        
        // Get available packages
        const availablePackages = getAvailableSpeedBoosts(user);
        
        if (availablePackages.length === 0) {
            await deliverText(msg.key.remoteJid, renderResponseTemplate('speed_boost_no_packages', {
                currentPackage: user.subscription
            }));
            return;
        }
        
        // Start conversation flow
        global.tempStates = global.tempStates || {};
        global.tempStates[sender] = {
            state: 'SPEED_BOOST_SELECT_PACKAGE',
            availablePackages: availablePackages,
            timestamp: Date.now()
        };
        
        // Build dynamic options first; outer copy remains editable from admin template.
        const config = loadSpeedBoostConfig();
        const currentPackage = global.packages.find(p => p.name === user.subscription);

        let packageIntro = '';
        if (config.templates?.welcomeMessage) {
            packageIntro = getMessageTemplate('welcome', {});
        }

        const packageList = renderResponseTemplate('speed_boost_package_list', {
            intro: packageIntro,
            currentPackage: user.subscription,
            packageOptions: buildSpeedBoostPackageOptions(availablePackages, currentPackage),
            maxOption: availablePackages.length
        });
        
        await deliverText(msg.key.remoteJid, packageList);
        
    } catch (error) {
        console.error('[SPEED_BOOST_REQUEST_ERROR]', error);
        await deliverText(msg.key.remoteJid, renderResponseTemplate('speed_boost_request_process_error'));
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
        await deliverText(msg.key.remoteJid, renderResponseTemplate('speed_boost_cancelled'));
        return true;
    }
    
    const selection = parseInt(chats);
    if (isNaN(selection) || selection < 1 || selection > state.availablePackages.length) {
        await deliverText(msg.key.remoteJid, renderResponseTemplate('speed_boost_invalid_choice', {
            maxOption: state.availablePackages.length
        }));
        return true;
    }
    
    const selectedPackage = state.availablePackages[selection - 1];
    const currentPackage = global.packages.find(p => p.name === user.subscription);
    const durations = formatDurationOptions(currentPackage, selectedPackage);
    
    if (durations.length === 0) {
        delete global.tempStates[sender];
        await deliverText(msg.key.remoteJid, renderResponseTemplate('speed_boost_no_duration_options'));
        return true;
    }
    
    // Update state
    state.state = 'SPEED_BOOST_SELECT_DURATION';
    state.selectedPackage = selectedPackage;
    state.durations = durations;
    
    // Show duration options
    const durationList = renderResponseTemplate('speed_boost_duration_list', {
        packageName: selectedPackage.name,
        profile: selectedPackage.profile || selectedPackage.speed || '-',
        durationOptions: buildSpeedBoostDurationOptions(durations),
        maxOption: durations.length
    });
    
    await deliverText(msg.key.remoteJid, durationList);
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
        await deliverText(msg.key.remoteJid, renderResponseTemplate('speed_boost_cancelled'));
        return true;
    }
    
    const selection = parseInt(chats);
    if (isNaN(selection) || selection < 1 || selection > state.durations.length) {
        await deliverText(msg.key.remoteJid, renderResponseTemplate('speed_boost_invalid_choice', {
            maxOption: state.durations.length
        }));
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
        await deliverText(msg.key.remoteJid, renderResponseTemplate('speed_boost_no_payment_methods'));
        return true;
    }
    
    state.paymentMethods = paymentMethods;
    
    // Show payment methods
    const paymentList = renderResponseTemplate('speed_boost_payment_method_list', {
        totalPrice: convertRupiah.convert(state.selectedDuration.price),
        paymentOptions: buildSpeedBoostPaymentOptions(paymentMethods),
        maxOption: paymentMethods.length
    });
    
    await deliverText(msg.key.remoteJid, paymentList);
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
        await deliverText(msg.key.remoteJid, renderResponseTemplate('speed_boost_cancelled'));
        return true;
    }
    
    const selection = parseInt(chats);
    if (isNaN(selection) || selection < 1 || selection > state.paymentMethods.length) {
        await deliverText(msg.key.remoteJid, renderResponseTemplate('speed_boost_invalid_choice', {
            maxOption: state.paymentMethods.length
        }));
        return true;
    }
    
    const selectedMethod = state.paymentMethods[selection - 1];
    const paymentMethod = selectedMethod.id;
    
    // Update state for confirmation
    state.state = 'SPEED_BOOST_CONFIRM';
    state.paymentMethod = paymentMethod;
    
    // Show confirmation
    const confirmMsg = renderResponseTemplate('speed_boost_confirmation', {
        customerName: user.name,
        currentPackage: user.subscription,
        targetPackage: state.selectedPackage.name,
        profile: state.selectedPackage.profile || state.selectedPackage.speed || '-',
        duration: state.selectedDuration.label,
        price: convertRupiah.convert(state.selectedDuration.price),
        paymentMethod: getSpeedBoostPaymentLabel(paymentMethod),
        paymentNote: getSpeedBoostConfirmationNote(paymentMethod)
    });
    
    await deliverText(msg.key.remoteJid, confirmMsg);
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
        await deliverText(msg.key.remoteJid, renderResponseTemplate('speed_boost_cancelled'));
        return true;
    }
    
    if (response !== 'ya' && response !== 'yes' && response !== 'y') {
        await deliverText(msg.key.remoteJid, renderResponseTemplate('speed_boost_confirmation_invalid'));
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
        await deliverText(msg.key.remoteJid, renderResponseTemplate('speed_boost_create_failed'));
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
        successMsg = renderResponseTemplate('speed_boost_success_base', {
            requestId: request.id,
            packageName: request.requestedPackageName,
            duration: request.durationLabel,
            price: convertRupiah.convert(request.price)
        });
        successMsg += '\n\n';
    }
    
    if (state.paymentMethod === 'cash') {
        successMsg += renderResponseTemplate('speed_boost_success_cash_section');
        
    } else if (state.paymentMethod === 'transfer') {
        // Get bank accounts from config.json
        const bankAccounts = global.config?.bankAccounts || [];
        const bankAccountsText = bankAccounts.length > 0
            ? buildBankAccountOptions(bankAccounts)
            : renderResponseTemplate('speed_boost_transfer_no_accounts');

        successMsg += renderResponseTemplate('speed_boost_success_transfer_section', {
            bankAccounts: bankAccountsText,
            transferAmount: convertRupiah.convert(request.price)
        });
        
    } else if (state.paymentMethod === 'double_billing') {
        successMsg += renderResponseTemplate('speed_boost_success_double_billing_section');
    }
    
    await deliverText(msg.key.remoteJid, successMsg);
    
    // Notify admin
    if (global.config.ownerNumber && Array.isArray(global.config.ownerNumber)) {
        const adminMsg = renderResponseTemplate('speed_boost_admin_new_request', {
            requestId: request.id,
            customerName: user.name,
            customerPhone: user.phone_number,
            currentPackage: user.subscription,
            targetPackage: request.requestedPackageName,
            duration: request.durationLabel,
            price: convertRupiah.convert(request.price),
            paymentMethod: getSpeedBoostPaymentLabel(state.paymentMethod)
        });
        
        for (const ownerNum of global.config.ownerNumber) {
            const ownerJid = ownerNum.endsWith('@s.whatsapp.net') ? ownerNum : `${ownerNum}@s.whatsapp.net`;
            try {
                await deliverText(ownerJid, adminMsg);
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
            await deliverPayload(msg.key.remoteJid, {
                text: renderResponseTemplate('speed_boost_admin_clear_success', { cleared, targetUserId })
            });
            return true;
        } else {
            await deliverPayload(msg.key.remoteJid, {
                text: renderResponseTemplate('speed_boost_admin_clear_empty', { targetUserId })
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
