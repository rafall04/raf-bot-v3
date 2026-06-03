/**
 * Header Doc
 * Purpose: Menangani business logic speed request/speed boost pelanggan termasuk notifikasi owner.
 * Caller: Route/service speed request customer dan admin.
 * Deps: `./base-service`, `../database`, helper speed request, `../template-service`, `../whatsapp-delivery-service`, dan `../whatsapp-gateway`.
 * MainFuncs: `requestSpeed`, `getActiveRequest`, `getRequestHistory`, `cancelRequest`, `getAvailableSpeedBoosts`, `_sendSpeedRequestNotification`.
 * SideEffects: Menulis request speed dan mengirim notifikasi owner saat request baru dibuat.
 */

const BaseService = require('./base-service');
const { createError, ErrorTypes } = require('../error-handler');
const { saveSpeedRequests } = require('../database');
const speedHelper = require('../speed-request-helper');
const { loadSpeedBoostConfig } = require('../speed-boost-matrix-helper');
const { sendMessageToMany } = require('../whatsapp-delivery-service');
const { hasAuthenticatedSession } = require('../whatsapp-gateway');
const { renderCategoryTemplate } = require('../template-service');

function renderResponseTemplate(key, data = {}) {
    return renderCategoryTemplate('responseTemplates', key, data).text;
}

class SpeedRequestService extends BaseService {
    /**
     * Check if speed boost feature is enabled
     * @returns {boolean} True if enabled
     */
    static isFeatureEnabled() {
        const config = loadSpeedBoostConfig();
        return config.enabled === true;
    }

    /**
     * Request speed boost
     * 
     * @param {Object} user - Customer user object
     * @param {Object} requestData - { targetPackageName, duration, paymentMethod }
     * @returns {Promise<Object>} { requestId, paymentMethod, amount, needsPaymentProof }
     * @throws {Error} Jika validasi gagal atau fitur disabled
     */
    static async requestSpeed(user, requestData, req = null) {
        const { targetPackageName, duration, paymentMethod = 'cash' } = requestData;

        // Audit log: Data access
        this.logDataAccess('SpeedRequestService', 'requestSpeed', user.id, null, true, req);

        // Check if feature is enabled
        if (!this.isFeatureEnabled()) {
            throw createError(
                ErrorTypes.VALIDATION_ERROR,
                "Speed Boost sedang tidak tersedia saat ini",
                503
            );
        }

        // Validation
        this.validateRequired(requestData, ['targetPackageName', 'duration']);

        // Validate payment method
        const validPaymentMethods = ['cash', 'transfer', 'double_billing'];
        if (!validPaymentMethods.includes(paymentMethod)) {
            throw createError(
                ErrorTypes.VALIDATION_ERROR,
                `Metode pembayaran tidak valid. Gunakan: ${validPaymentMethods.join(', ')}`,
                400
            );
        }

        // Step 1: Validate user eligibility
        const validation = speedHelper.validateSpeedRequest(user, global.packages);
        if (!validation.valid) {
            throw createError(
                ErrorTypes.VALIDATION_ERROR,
                validation.errors[0] || "Anda tidak memenuhi syarat untuk request speed boost.",
                400
            );
        }

        // Step 2: Validate requested package
        const requestedPackage = this.findPackageByName(targetPackageName);
        if (!requestedPackage) {
            throw createError(
                ErrorTypes.NOT_FOUND_ERROR,
                `Paket tujuan "${targetPackageName}" tidak ditemukan.`,
                404
            );
        }

        // Check if it's a valid speed boost package
        if (!requestedPackage.isSpeedBoost) {
            throw createError(
                ErrorTypes.VALIDATION_ERROR,
                `Paket "${targetPackageName}" bukan paket speed boost.`,
                400
            );
        }

        // Check if target package is higher than current
        const currentPackage = this.findPackageByName(user.subscription);
        if (currentPackage && Number(requestedPackage.price) <= Number(currentPackage.price)) {
            throw createError(
                ErrorTypes.VALIDATION_ERROR,
                "Paket speed boost harus memiliki kecepatan lebih tinggi dari paket Anda saat ini.",
                400
            );
        }

        // Step 3: Normalize duration and calculate price
        const normalizedDuration = speedHelper.normalizeDurationKey(duration);
        if (!normalizedDuration) {
            throw createError(
                ErrorTypes.VALIDATION_ERROR,
                `Durasi '${duration}' tidak valid. Gunakan: 1_day, 3_days, atau 7_days.`,
                400
            );
        }

        const price = speedHelper.calculateBoostPrice(currentPackage, requestedPackage, normalizedDuration);
        if (!price) {
            throw createError(
                ErrorTypes.VALIDATION_ERROR,
                `Harga untuk durasi '${duration}' pada paket '${targetPackageName}' tidak tersedia.`,
                400
            );
        }

        // Step 4: Create speed request
        const newRequest = speedHelper.createSpeedRequest(user, targetPackageName, normalizedDuration, price, paymentMethod);
        newRequest.paymentAmount = price;

        // For double billing, mark as pending
        if (paymentMethod === 'double_billing') {
            newRequest.paymentStatus = 'pending';
        }

        // Save to database
        global.speed_requests.unshift(newRequest);
        saveSpeedRequests();

        // Send notifications (fire-and-forget)
        this._sendSpeedRequestNotification(newRequest, user, targetPackageName, normalizedDuration, price, paymentMethod).catch(err => {
            this.logError('SpeedRequestService', 'requestSpeed', err, {
                requestId: newRequest.id,
                userId: user.id
            });
        });

        // Prepare response message
        let responseMessage = "Permintaan penambahan kecepatan Anda telah berhasil dikirim.";
        if (paymentMethod === 'cash' || paymentMethod === 'transfer') {
            responseMessage += " Silakan upload bukti pembayaran untuk melanjutkan proses.";
        } else if (paymentMethod === 'double_billing') {
            responseMessage += " Biaya akan ditambahkan ke tagihan bulan depan. Menunggu persetujuan admin.";
        }

        return {
            requestId: newRequest.id,
            paymentMethod: paymentMethod,
            amount: price,
            needsPaymentProof: ['cash', 'transfer'].includes(paymentMethod),
            message: responseMessage
        };
    }

    /**
     * Get active speed request untuk customer
     * 
     * @param {Object} user - Customer user object
     * @returns {Promise<Object|null>} Active speed request atau null
     */
    static async getActiveRequest(user, req = null) {
        if (!user || !user.id) {
            return null;
        }

        // Audit log: Data access
        this.logDataAccess('SpeedRequestService', 'getActiveRequest', user.id, null, true, req);

        // CRITICAL: Strict ownership check
        const activeRequest = global.speed_requests?.find(
            r => String(r.userId) === String(user.id) && r.status === 'active'
        );

        if (!activeRequest) {
            return null;
        }

        // Double-check ownership (defense in depth)
        if (String(activeRequest.userId) !== String(user.id)) {
            this.logError('SpeedRequestService', 'getActiveRequest', new Error('Ownership mismatch'), {
                requestUserId: activeRequest.userId,
                userUserId: user.id
            });
            return null;
        }

        // Format response using helper
        return speedHelper.formatSpeedRequest(activeRequest, global.packages);
    }

    /**
     * Get speed request history untuk customer
     * 
     * @param {Object} user - Customer user object
     * @returns {Promise<Array>} Array of speed requests
     */
    static async getRequestHistory(user, req = null) {
        if (!user || !user.id) {
            return [];
        }

        // Audit log: Data access
        this.logDataAccess('SpeedRequestService', 'getRequestHistory', user.id, null, true, req);

        // CRITICAL: Strict ownership check - only return requests owned by this user
        const customerRequests = global.speed_requests?.filter(
            r => String(r.userId) === String(user.id)
        ) || [];

        // Sort by created date (newest first)
        const sortedRequests = customerRequests.sort(
            (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
        );

        // Format all requests
        return sortedRequests.map(request =>
            speedHelper.formatSpeedRequest(request, global.packages)
        );
    }

    /**
     * Cancel speed request
     * 
     * @param {Object} user - Customer user object
     * @param {string} requestId - Request ID to cancel
     * @returns {Promise<Object>} Cancel result
     * @throws {Error} Jika validasi gagal atau request tidak ditemukan
     */
    static async cancelRequest(user, requestId, req = null) {
        this.validateField(requestId, 'requestId');

        // Audit log: Data access attempt
        this.logDataAccess('SpeedRequestService', 'cancelRequest', user.id, requestId, true, req);

        // Find the request - CRITICAL: Must verify ownership
        const request = global.speed_requests?.find(
            r => r.id === requestId && String(r.userId) === String(user.id)
        );

        // CRITICAL: Don't reveal if request exists but not owned by user
        // Return 404 instead of 403 to prevent information disclosure
        if (!request) {
            // Audit log: Failed access attempt (potential IDOR)
            this.logDataAccess('SpeedRequestService', 'cancelRequest', user.id, requestId, false, req);
            throw createError(
                ErrorTypes.NOT_FOUND_ERROR,
                "Permintaan tidak ditemukan.",
                404
            );
        }

        // Double-check ownership (defense in depth)
        if (String(request.userId) !== String(user.id)) {
            // This should never happen if find() works correctly, but log it
            // Audit log: Authorization violation (potential IDOR attack)
            this.logDataAccess('SpeedRequestService', 'cancelRequest', user.id, requestId, false, req);
            this.logError('SpeedRequestService', 'cancelRequest', new Error('Ownership mismatch'), {
                requestId,
                requestUserId: request.userId,
                userUserId: user.id
            });
            throw createError(
                ErrorTypes.AUTHORIZATION_ERROR,
                "Anda tidak memiliki izin untuk membatalkan permintaan ini.",
                403
            );
        }

        const requestIndex = global.speed_requests?.findIndex(r => r.id === requestId) ?? -1;

        // Only allow cancellation of pending requests
        if (request.status !== 'pending') {
            throw createError(
                ErrorTypes.VALIDATION_ERROR,
                `Permintaan dengan status '${request.status}' tidak dapat dibatalkan.`,
                400
            );
        }

        // Update status
        request.status = 'cancelled';
        request.updatedAt = new Date().toISOString();
        request.notes = 'Dibatalkan oleh pelanggan';

        // Save changes
        saveSpeedRequests();

        return { message: "Permintaan speed boost berhasil dibatalkan." };
    }

    /**
     * Get available speed boosts untuk customer
     * 
     * @param {Object} user - Customer user object
     * @returns {Promise<Array>} Array of available speed boost packages
     */
    static async getAvailableSpeedBoosts(user) {
        // Check if feature is enabled
        if (!this.isFeatureEnabled()) {
            return [];
        }

        // Validate customer eligibility
        const validation = speedHelper.validateSpeedRequest(user, global.packages);
        if (!validation.valid) {
            // Return empty array if validation fails (graceful degradation)
            return [];
        }

        // Get available speed boost packages
        const availablePackages = speedHelper.getAvailableSpeedBoosts(user, global.packages);

        // Format response with pricing for each duration
        return availablePackages.map(pkg => {
            const durations = {};

            // Calculate price for each available duration
            Object.keys(speedHelper.DURATION_MAP).forEach(durationKey => {
                if (durationKey.includes('_')) { // Use standard format only
                    const currentPackage = this.findPackageByName(user.subscription);
                    const price = speedHelper.calculateBoostPrice(
                        currentPackage,
                        pkg,
                        durationKey
                    );
                    if (price) {
                        const durationInfo = speedHelper.getDurationInfo(durationKey);
                        durations[durationKey] = {
                            label: durationInfo.label,
                            hours: durationInfo.hours,
                            price: price
                        };
                    }
                }
            });

            return {
                name: pkg.name,
                profile: pkg.profile,
                basePrice: pkg.price,
                durations: durations
            };
        });
    }

    /**
     * Get speed boost packages (public endpoint)
     * 
     * @returns {Promise<Array>} Array of speed boost packages with durations
     */
    static async getSpeedBoostPackages() {
        // Check if feature is enabled
        if (!this.isFeatureEnabled()) {
            return [];
        }

        const availableBoosts = global.packages?.filter(
            p => p.isSpeedBoost === true
        ) || [];

        // Format packages with durations
        return availableBoosts.map(pkg => {
            const durations = {};

            // Normalize speed boost prices to use standard duration keys
            if (pkg.speedBoostPrices) {
                Object.keys(pkg.speedBoostPrices).forEach(key => {
                    const normalizedKey = speedHelper.normalizeDurationKey(key);
                    if (normalizedKey && pkg.speedBoostPrices[key]) {
                        const durationInfo = speedHelper.getDurationInfo(normalizedKey);
                        durations[normalizedKey] = {
                            label: durationInfo.label,
                            hours: durationInfo.hours,
                            price: Number(pkg.speedBoostPrices[key]) || 0
                        };
                    }
                });
            }

            // Add default durations if not present
            ['1_day', '3_days', '7_days'].forEach(key => {
                if (!durations[key]) {
                    const durationInfo = speedHelper.getDurationInfo(key);
                    durations[key] = {
                        label: durationInfo.label,
                        hours: durationInfo.hours,
                        price: 0
                    };
                }
            });

            return {
                name: pkg.name,
                price: pkg.price,
                profile: pkg.profile,
                speedBoostPrices: durations
            };
        });
    }

    /**
     * Send notification to owners about speed request
     * @private
     * @param {Object} request - Speed request object
     * @param {Object} user - User object
     * @param {string} targetPackageName - Target package name
     * @param {string} normalizedDuration - Normalized duration key
     * @param {number} price - Price
     * @param {string} paymentMethod - Payment method
     */
    static async _sendSpeedRequestNotification(request, user, targetPackageName, normalizedDuration, price, paymentMethod) {
        if (!hasAuthenticatedSession() || !global.config.ownerNumber || !Array.isArray(global.config.ownerNumber)) {
            return;
        }

        const paymentMethodText = {
            'cash': 'Cash',
            'transfer': 'Transfer Bank',
            'double_billing': 'Tagihan Bulan Depan'
        };

        const paymentNote = paymentMethod === 'double_billing'
            ? renderResponseTemplate('speed_request_service_payment_note_double_billing')
            : renderResponseTemplate('speed_request_service_payment_note_waiting_proof');
        const notifMessage = renderResponseTemplate('routes_speed_request_owner_notification', {
            customerName: user.name,
            currentPackage: user.subscription,
            targetPackage: targetPackageName,
            duration: normalizedDuration.replace('_', ' '),
            price: `Rp ${price.toLocaleString('id-ID')}`,
            paymentMethod: paymentMethodText[paymentMethod] || paymentMethod,
            paymentNote
        });

        await sendMessageToMany(global.config.ownerNumber, { text: notifMessage });
    }
}

module.exports = SpeedRequestService;

