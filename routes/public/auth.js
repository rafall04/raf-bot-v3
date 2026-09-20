/**
 * Header Doc
 * Purpose: Sub-router AUTH publik — login staf (`/api/login`), login pelanggan
 *          (`/api/customer/login` + alias `/api/auth/login`), dan OTP
 *          (`/api/otp`, `/api/otpverify`, `/api/auth/otp/*`).
 * Caller: `routes/public.js` (composer) → Express app.
 * Deps: express, jsonwebtoken, `lib/auth-cache`, `lib/password`, `lib/middleware/validation`,
 *       `lib/error-handler`, `lib/response-helper`, `lib/whatsapp-gateway`, `lib/otp`,
 *       `lib/services/public-auth-service`, `./shared` (payload + header helper).
 * MainFuncs: handleOtpRequest, handleOtpVerify, handleCustomerLogin + route registrations.
 * SideEffects: Menulis cookie JWT, mengirim OTP via WhatsApp, mencatat login ke activity log.
 */
const log = require('../../lib/logger').logger.child('AUTH');
const express = require('express');
const jwt = require('jsonwebtoken');
const { authCache } = require('../../lib/auth-cache');
const { comparePassword } = require('../../lib/password');
const {
    loginValidation,
    customerLoginValidation,
    otpRequestValidation,
    otpVerifyValidation
} = require('../../lib/middleware/validation');
const { asyncHandler, createError, ErrorTypes, validateRequired } = require('../../lib/error-handler');
const { sendSuccess, sendError } = require('../../lib/response-helper');
const { hasAuthenticatedSession } = require('../../lib/whatsapp-gateway');
const { generateSecureOTP, checkOTPRequestLimit, checkOTPVerifyLimit, resetOTPAttempts, isOTPValid } = require('../../lib/otp');
const { PublicAuthService } = require('../../lib/services/public-auth-service');
const { getCustomerAuthPayload, setSensitiveResponseHeaders } = require('./shared');

const router = express.Router();

async function handleOtpRequest(req, res) {
    const { phoneNumber } = req.body;

    setSensitiveResponseHeaders(res);

    if (!phoneNumber) {
        return sendError(res, "Nomor telepon diperlukan", 400);
    }

    if (!hasAuthenticatedSession()) {
        return sendError(res, "Bot sedang offline", 503);
    }

    const rateLimitCheck = checkOTPRequestLimit(phoneNumber);
    if (!rateLimitCheck.allowed) {
        return sendError(res, `Terlalu banyak permintaan OTP. Coba lagi dalam ${rateLimitCheck.remainingTime} menit.`, 429);
    }

    const otp = generateSecureOTP(6);
    const userToUpdate = await PublicAuthService.findUserByNormalizedPhone(phoneNumber);
    if (!userToUpdate) {
        return sendError(res, "User tidak ditemukan", 404);
    }

    await PublicAuthService.saveOtp(userToUpdate, otp);
    const delivery = await PublicAuthService.sendOtp(phoneNumber, otp);
    if (!delivery.sent) {
        return sendError(res, "Gagal mengirim OTP. Silakan coba lagi.", delivery.errorCode === 'WHATSAPP_NOT_CONNECTED' ? 503 : 500);
    }

    return sendSuccess(res, null, "OTP berhasil dikirim");
}

async function handleOtpVerify(req, res) {
    const { phoneNumber: otpPhone, otp } = req.body;

    setSensitiveResponseHeaders(res);

    if (!otpPhone || !otp) {
        return sendError(res, "Nomor telepon dan OTP diperlukan", 400);
    }

    const verifyLimitCheck = checkOTPVerifyLimit(otpPhone);
    if (!verifyLimitCheck.allowed) {
        return sendError(res, "Terlalu banyak percobaan verifikasi. Silakan minta OTP baru.", 429);
    }

    const userToVerify = await PublicAuthService.findUserByNormalizedPhone(otpPhone);
    if (!userToVerify) {
        return sendError(res, "Pengguna tidak ditemukan.", 404);
    }

    if (!isOTPValid(userToVerify.otpTimestamp)) {
        await PublicAuthService.clearOtp(userToVerify);
        return sendError(res, "OTP sudah kedaluwarsa. Silakan minta OTP baru.", 400);
    }

    if (userToVerify.otp !== otp) {
        return sendError(res, "OTP tidak valid.", 400);
    }

    await PublicAuthService.clearOtp(userToVerify);
    resetOTPAttempts(otpPhone);
    return sendSuccess(res, {
        ...getCustomerAuthPayload(userToVerify)
    }, "OTP berhasil diverifikasi.");
}

async function handleCustomerLogin(req, res) {
    const { username, password } = req.body;
    setSensitiveResponseHeaders(res);
    const user = await PublicAuthService.findUserByLoginIdentifier(username);

    if (!user) {
        return sendError(res, "Username atau password salah.", 401);
    }

    const isValid = await comparePassword(password, user.password);
    if (!isValid) {
        return sendError(res, "Username atau password salah.", 401);
    }

    return sendSuccess(res, {
        ...getCustomerAuthPayload(user)
    }, "Login berhasil.");
}


router.post('/api/login', loginValidation, asyncHandler(async (req, res) => {
    const loginStartTime = Date.now();
    const { username, password } = req.body;
    
    // Validate required fields
    const validateStart = Date.now();
    validateRequired(req.body, ['username', 'password']);
    log.info(`[LOGIN_TIMING] Validation: ${Date.now() - validateStart}ms`);

    // Get client info for logging
    const ipAddress = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    
    // Import activity logger and rate limiter
    const importStart = Date.now();
    const { logLogin } = require('../../lib/activity-logger');
    const { checkRateLimit } = require('../../lib/security');
    log.info(`[LOGIN_TIMING] Import modules: ${Date.now() - importStart}ms`);
    
    // Rate limiting: max 5 attempts per 15 minutes per IP
    const rateLimitStart = Date.now();
    const rateLimitResult = checkRateLimit('login', 5, 15 * 60 * 1000, ipAddress);
    log.info(`[LOGIN_TIMING] Rate limit check: ${Date.now() - rateLimitStart}ms`);
    
    // Check rate limit
    if (!rateLimitResult.allowed) {
        // Log failed attempt due to rate limit (fire-and-forget, tidak blocking)
        logLogin({
            userId: null,
            username: username || 'unknown',
            role: 'unknown',
            ipAddress,
            userAgent,
            success: false,
            failureReason: 'Rate limit exceeded'
        }).catch(_logErr => {
            // Ignore logging errors
        });
        
        throw createError(
            ErrorTypes.RATE_LIMIT_ERROR || 'RATE_LIMIT_ERROR',
            'Terlalu banyak percobaan login. Silakan coba lagi dalam 15 menit.',
            429
        );
    }

    // Gunakan cache untuk account lookup
    const accountLookupStart = Date.now();
    const account = authCache.getAccountByUsername(username, () => {
        return global.accounts.find(acc => acc.username === username);
    });
    log.info(`[LOGIN_TIMING] Account lookup: ${Date.now() - accountLookupStart}ms`);
    
    // Password verification - ini yang paling mungkin lambat
    const passwordStart = Date.now();
    const isValid = account && await comparePassword(password, account.password);
    log.info(`[LOGIN_TIMING] Password verification: ${Date.now() - passwordStart}ms`);

    if (!isValid) {
        // Log failed login attempt (fire-and-forget, tidak blocking)
        logLogin({
            userId: account ? account.id : null,
            username: username,
            role: account ? account.role : 'unknown',
            ipAddress,
            userAgent,
            success: false,
            failureReason: 'Invalid username or password',
            actionType: 'login'
        }).catch(logErr => {
            log.error(`[AUTH_LOG] ❌ Failed to log login: ${username} - ${logErr.message}`);
        });
        
        throw createError(
            ErrorTypes.AUTHENTICATION_ERROR,
            'Username atau password salah.',
            401
        );
    }

    const payload = {
        id: account.id,
        username: account.username,
        name: account.name || account.username,
        photo: account.photo || null,
        role: account.role
    };

    // Shorten token expiry for production: 8 hours instead of 1 day
    const tokenStart = Date.now();
    const tokenExpiry = process.env.NODE_ENV === 'production' ? '8h' : '1d';
    // SECURITY: Sign token dengan explicit algorithm untuk prevent algorithm confusion attacks
    const token = jwt.sign(payload, global.config.jwt, { 
        expiresIn: tokenExpiry,
        algorithm: 'HS256'
    });
    log.info(`[LOGIN_TIMING] Token generation: ${Date.now() - tokenStart}ms`);

    const cookieStart = Date.now();
    const useSecureCookie =
        process.env.COOKIE_SECURE === 'true' ||
        process.env.NODE_ENV === 'production' && process.env.TRUST_REVERSE_PROXY === 'true';
    res.cookie("token", token, {
        httpOnly: true,
        secure: useSecureCookie,
        sameSite: 'Lax', // Allow cookies untuk same-site requests (termasuk akses via IP)
        maxAge: process.env.NODE_ENV === 'production' ? 8 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000,
        path: '/'
    });
    log.info(`[LOGIN_TIMING] Cookie set: ${Date.now() - cookieStart}ms`);

    // Log successful login attempt (fire-and-forget, tidak blocking response)
    logLogin({
        userId: account.id,
        username: username,
        role: account.role,
        ipAddress,
        userAgent,
        success: true,
        failureReason: null,
        actionType: 'login'
    }).catch(logErr => {
        log.error(`[AUTH_LOG] ❌ Failed to log login: ${username} - ${logErr.message}`);
    });

    const totalTime = Date.now() - loginStartTime;
    log.info(`[LOGIN_TIMING] ⏱️ TOTAL LOGIN TIME: ${totalTime}ms`);

    // Check if request wants JSON response (API call)
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return sendSuccess(res, {
            token: token,
            user: {
                id: account.id,
                username: account.username,
                name: account.name || account.username,
                photo: account.photo || null,
                role: account.role
            }
        }, 'Login berhasil');
    }

    // Redirect based on role
    if (account.role === 'teknisi') {
        return res.redirect('/pembayaran/teknisi');
    } else if (account.role === 'agen') {
        return res.redirect('/agen-pembayaran');
    } else {
        return res.redirect('/');
    }
}));

router.post('/api/customer/login', customerLoginValidation, asyncHandler(handleCustomerLogin));

// Validasi disamakan dengan alias `/api/auth/otp/*` di bawah. Dua rute lama ini dulu
// TANPA validasi sama sekali, padahal memanggil handler yang sama — jadi pintu longgarnya
// tinggal dipilih. Beda perlakuan antar-alias adalah cara gerbang mati diam-diam.
router.post('/api/otp', otpRequestValidation, asyncHandler(handleOtpRequest));

router.post('/api/otpverify', otpVerifyValidation, asyncHandler(handleOtpVerify));

// --- ALIASES FOR FRONTEND ---

// Alias for /api/customer/login
router.post('/api/auth/login', customerLoginValidation, asyncHandler(handleCustomerLogin));

// Alias for /api/otp
router.post('/api/auth/otp/request', otpRequestValidation, asyncHandler(handleOtpRequest));

// Alias for /api/otpverify
router.post('/api/auth/otp/verify', otpVerifyValidation, asyncHandler(handleOtpVerify));

module.exports = router;
