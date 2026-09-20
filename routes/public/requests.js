/**
 * Header Doc
 * Purpose: Sub-router PERMINTAAN pelanggan — `POST /api/request-speed` (Speed On Demand,
 *          terautentikasi) dan `GET /api/speed-boost/packages` (daftar paket publik).
 * Caller: `routes/public.js` (composer) → Express app.
 * Deps: express, `lib/auth` (apiAuth), `lib/middleware/validation`, `lib/error-handler`,
 *       `lib/response-helper`, `lib/database` (saveSpeedRequests), `lib/whatsapp-gateway`,
 *       `lib/whatsapp-delivery-service` (sendMessageToMany), `lib/services/speed-request-service`,
 *       `./shared` (renderResponseTemplate), lazy `lib/speed-request-helper`.
 * MainFuncs: handler request-speed (validasi→hitung harga→simpan→notif owner) + packages read.
 * SideEffects: Menulis global.speed_requests, kirim WA ke owner.
 */
const log = require('../../lib/logger').logger.child('REQUESTS');
const express = require('express');
const { apiAuth } = require('../../lib/auth');
const { requestSpeedValidation } = require('../../lib/middleware/validation');
const { asyncHandler } = require('../../lib/error-handler');
const { sendSuccess, sendError } = require('../../lib/response-helper');
const { saveSpeedRequests } = require('../../lib/database');
const { hasAuthenticatedSession } = require('../../lib/whatsapp-gateway');
const { sendMessageToMany } = require('../../lib/whatsapp-delivery-service');
const SpeedRequestService = require('../../lib/services/speed-request-service');
const { renderResponseTemplate } = require('./shared');

const router = express.Router();

router.post('/api/request-speed', apiAuth, requestSpeedValidation, asyncHandler(async (req, res) => {
    // Import helper functions
    const speedHelper = require('../../lib/speed-request-helper');
    
    // User is identified by token, not by phone number in the body.
    const { targetPackageName, duration, paymentMethod = 'cash' } = req.body;
    const user = req.customer; // Use authenticated user from middleware

    if (!targetPackageName || !duration) {
        return sendError(res, "Parameter tidak lengkap. targetPackageName, dan duration wajib diisi.", 400);
    }
    
    // Validate payment method
    const validPaymentMethods = ['cash', 'transfer', 'double_billing'];
    if (!validPaymentMethods.includes(paymentMethod)) {
        return sendError(res, `Metode pembayaran tidak valid. Gunakan: ${validPaymentMethods.join(', ')}`, 400);
    }
    
    try {
        // Step 1: Validate user eligibility for speed request
        const validation = speedHelper.validateSpeedRequest(user, global.packages);
        if (!validation.valid) {
            return sendError(res, validation.errors[0] || "Anda tidak memenuhi syarat untuk request speed boost.", 400);
        }

        // Step 2: Validate requested package
        const requestedPackage = global.packages.find(p => p.name === targetPackageName);
        if (!requestedPackage) {
            return sendError(res, `Paket tujuan "${targetPackageName}" tidak ditemukan.`, 404);
        }
        
        // Check if it's a valid speed boost package
        if (!requestedPackage.isSpeedBoost) {
            return sendError(res, `Paket "${targetPackageName}" bukan paket speed boost.`, 400);
        }
        
        // Check if target package is higher than current
        const currentPackage = global.packages.find(p => p.name === user.subscription);
        if (currentPackage && Number(requestedPackage.price) <= Number(currentPackage.price)) {
            return sendError(res, "Paket speed boost harus memiliki kecepatan lebih tinggi dari paket Anda saat ini.", 400);
        }

        // Step 3: Normalize duration and calculate price
        const normalizedDuration = speedHelper.normalizeDurationKey(duration);
        if (!normalizedDuration) {
            return sendError(res, `Durasi '${duration}' tidak valid. Gunakan: 1_day, 3_days, atau 7_days.`, 400);
        }
        
        const price = speedHelper.calculateBoostPrice(currentPackage, requestedPackage, normalizedDuration);
        if (!price) {
            return sendError(res, `Harga untuk durasi '${duration}' pada paket '${targetPackageName}' tidak tersedia.`, 400);
        }

        // Step 4: Create standardized speed request with payment method
        const newRequest = speedHelper.createSpeedRequest(user, targetPackageName, normalizedDuration, price, paymentMethod);
        
        // Set payment amount
        newRequest.paymentAmount = price;
        
        // For double billing, mark as pending (will be paid with next invoice)
        if (paymentMethod === 'double_billing') {
            newRequest.paymentStatus = 'pending';
        }
        
        // Save to database
        global.speed_requests.unshift(newRequest);
        saveSpeedRequests();

        if (hasAuthenticatedSession() && global.config.ownerNumber && Array.isArray(global.config.ownerNumber)) {
            const paymentMethodText = {
                'cash': 'Cash',
                'transfer': 'Transfer Bank',
                'double_billing': 'Tagihan Bulan Depan'
            };
            
            const notifMessage = renderResponseTemplate("routes_speed_request_owner_notification", {
                customerName: user.name,
                currentPackage: user.subscription,
                targetPackage: targetPackageName,
                duration: normalizedDuration.replace('_', ' '),
                price: `Rp ${price.toLocaleString('id-ID')}`,
                paymentMethod: paymentMethodText[paymentMethod] || paymentMethod,
                paymentNote: paymentMethod === 'double_billing'
                    ? 'Akan ditagihkan pada invoice bulan depan\n\n'
                    : 'Menunggu bukti pembayaran dari pelanggan\n\n'
            });
            
            await sendMessageToMany(global.config.ownerNumber, { text: notifMessage });
        }
        
        // Prepare response message based on payment method
        let responseMessage = "Permintaan penambahan kecepatan Anda telah berhasil dikirim.";
        
        if (paymentMethod === 'cash' || paymentMethod === 'transfer') {
            responseMessage += " Silakan upload bukti pembayaran untuk melanjutkan proses.";
        } else if (paymentMethod === 'double_billing') {
            responseMessage += " Biaya akan ditambahkan ke tagihan bulan depan. Menunggu persetujuan admin.";
        }
        
        return sendSuccess(res, {
            requestId: newRequest.id,
            paymentMethod: paymentMethod,
            amount: price,
            needsPaymentProof: ['cash', 'transfer'].includes(paymentMethod)
        }, responseMessage, 201);
    } catch (error) {
        log.error('[API_SPEED_REQUEST_FATAL_ERROR]', error);
        return sendError(res, "Terjadi kesalahan pada server.", 500);
    }
}));

router.get('/api/speed-boost/packages', asyncHandler(async (req, res) => {
    const packages = await SpeedRequestService.getSpeedBoostPackages();
    return sendSuccess(res, packages, "Daftar paket speed boost berhasil diambil");
}));

module.exports = router;
