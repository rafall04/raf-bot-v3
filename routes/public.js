/**
 * Header Doc
 * Purpose: Router publik/customer portal untuk autentikasi, self-service pelanggan, laporan, payment callback, dan notifikasi outbound WA customer/admin.
 * Caller: `routes-registry`/Express app.
 * Deps: Express, auth/token helpers, payment/voucher/saldo helpers, customer/report/speed services, WhatsApp delivery service, template-service.
 * MainFuncs: handleOtpRequest, handleOtpVerify, handleCustomerLogin, customer API routes, payment callback, speed request route.
 * SideEffects: Membaca/menulis runtime data, mengirim OTP/notifikasi WhatsApp, menyimpan laporan/speed request/payment state.
 */
const express = require('express');
const jwt = require('jsonwebtoken');
const convertRupiah = require('rupiah-format');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

// Local dependencies that were used by these routes in index.js
const pay = require("../lib/ipaymu");
// Verifikasi server-to-server status transaksi iPaymu (dipakai di callback).
// Diberi nama lain karena `pay` di-shadow oleh record pembayaran di dalam handler callback.
const verifyIpaymuTransaction = require("../lib/ipaymu").checkTransaction;
// Settlement bayar tagihan bulanan (catat lunas + auto-reaktivasi). Dipakai cabang callback 'tagihan'.
const { createBillPaymentSettlement } = require('../lib/services/bill-payment-settlement');
const billSettlement = createBillPaymentSettlement();
const { getvoucher } = require("../lib/mikrotik");
const { addKoinUser, checkATMuser } = require('../lib/saldo');
const { updateStatusPayment, checkStatusPayment, delPayment: _delPayment, addPayBuy: _addPayBuy, addPayment, updateKetPayment } = require('../lib/payment');
const { checkprofvc, checkdurasivc, checkhargavc } = require('../lib/voucher');
const { saveReports: _saveReports, saveSpeedRequests, savePackageChangeRequests: _savePackageChangeRequests, loadJSON: _loadJSON } = require('../lib/database');
const { authCache } = require('../lib/auth-cache');
const { comparePassword, hashPassword: _hashPassword } = require('../lib/password');
const { apiAuth } = require('../lib/auth');
const { normalizePhoneNumber: _normalizePhoneNumber } = require('../lib/utils');
const { generateSecureOTP, checkOTPRequestLimit, checkOTPVerifyLimit, resetOTPAttempts, isOTPValid } = require('../lib/otp');
const { asyncHandler, createError, ErrorTypes, validateRequired, dbOperation: _dbOperation } = require('../lib/error-handler');
const { renderTemplate } = require('../lib/templating');
const { renderCategoryTemplate } = require('../lib/template-service');
const { sendSuccess, sendError } = require('../lib/response-helper');
const { hasAuthenticatedSession } = require('../lib/whatsapp-gateway');
const { ensureTicketShape } = require('../lib/ticket-workflow');
const { appendCustomerReportPhoto } = require('../lib/report-orchestration-service');
const CustomerService = require('../lib/services/customer-service');
const ReportService = require('../lib/services/report-service');
const SpeedRequestService = require('../lib/services/speed-request-service');
const PublicService = require('../lib/services/public-service');
const WifiService = require('../lib/services/wifi-service');
const CustomerTrafficUsageService = require('../lib/customer-traffic-usage-service');
const { PublicAuthService } = require('../lib/services/public-auth-service');
const { sendMessage, sendMessageToMany } = require('../lib/whatsapp-delivery-service');
// Pengiriman kritis (kode voucher) + alert admin valid + catatan orphan (paid-tanpa-voucher).
const { sendCritical } = require('../lib/whatsapp-critical-delivery');
const { getAdminJids } = require('../lib/admin-recipients');
const { recordVoucherOrphan } = require('../lib/voucher-orphan');

// Alert admin yang ANDAL: kirim ke tiap JID admin valid via sendCritical (retry + dead-letter).
// Dipakai saat voucher gagal / reaktivasi tagihan gagal — wajib sampai ke operator.
async function alertAdmins(text, tag) {
    const jids = getAdminJids();
    if (!jids.length) { console.error(`[ADMIN_ALERT] Tidak ada JID admin valid untuk: ${tag}`); return; }
    for (const jid of jids) {
        try { await sendCritical(jid, { text }, { label: tag || 'admin-alert' }); }
        catch (e) { console.error(`[ADMIN_ALERT] Gagal kirim ke ${jid}:`, e.message); }
    }
}
const {
    loginValidation,
    customerLoginValidation,
    otpRequestValidation,
    otpVerifyValidation,
    updateAccountValidation: _updateAccountValidation,
    submitReportValidation: _submitReportValidation,
    requestSpeedValidation,
    cancelSpeedRequestValidation,
    requestPackageChangeValidation: _requestPackageChangeValidation
} = require('../lib/middleware/validation');

const router = express.Router();

function renderResponseTemplate(key, data = {}) {
    return renderCategoryTemplate("responseTemplates", key, data).text;
}

function getCustomerAuthPayload(user) {
    return PublicAuthService.buildAuthResponse(user);
}

function setSensitiveResponseHeaders(res) {
    res.set({
        'Cache-Control': 'no-store, no-cache, must-revalidate, private',
        'Pragma': 'no-cache',
        'Expires': '0'
    });
}

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

// --- Middleware & Helper Functions (moved from index.js) ---

// This function is now a wrapper around the centralized apiAuth middleware.
function ensureCustomerAuthenticated(req, res, next) {
    apiAuth(req, res, next);
}

// Helper functions moved to service layer:
// - mapReportStatus() -> ReportService.mapReportStatus()
// - generateAdminTicketId() -> ReportService.generateTicketId()

// --- Rate Limiters ---

// Rate limiter untuk WiFi endpoints (resource-intensive operations)
// CATATAN: Endpoint ini memerlukan customer authentication, jadi semua request sudah memiliki req.customer
const wifiRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 menit
    max: 30, // 30 requests per 15 menit per customer
    message: {
        status: 429,
        message: 'Terlalu banyak permintaan WiFi. Silakan coba lagi dalam 15 menit.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Gunakan customer ID sebagai key (semua request sudah authenticated via ensureCustomerAuthenticated)
    keyGenerator: (req) => {
        // Karena endpoint ini memerlukan authentication, req.customer selalu ada
        // Tidak perlu fallback ke IP, sehingga tidak perlu handle IPv6
        return `wifi_customer_${req.customer?.id || 'unknown'}`;
    },
    skip: (req) => {
        // Skip rate limiting untuk static files (tidak perlu)
        return req.path.match(/\.(jpg|jpeg|png|gif|svg|css|js|ico|woff|woff2|ttf|eot)$/i);
    }
});

// Stricter rate limiter untuk WiFi write operations (update name/password)
// CATATAN: Endpoint ini memerlukan customer authentication, jadi semua request sudah memiliki req.customer
const wifiWriteRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 menit
    max: 10, // 10 requests per 15 menit per customer (lebih strict untuk write operations)
    message: {
        status: 429,
        message: 'Terlalu banyak perubahan WiFi. Silakan coba lagi dalam 15 menit.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Gunakan customer ID sebagai key (semua request sudah authenticated via ensureCustomerAuthenticated)
    keyGenerator: (req) => {
        // Karena endpoint ini memerlukan authentication, req.customer selalu ada
        // Tidak perlu fallback ke IP, sehingga tidak perlu handle IPv6
        return `wifi_write_customer_${req.customer?.id || 'unknown'}`;
    },
    skip: (req) => {
        // Skip rate limiting untuk static files (tidak perlu)
        return req.path.match(/\.(jpg|jpeg|png|gif|svg|css|js|ico|woff|woff2|ttf|eot)$/i);
    }
});

// --- Router Setup ---

// Middleware is now applied globally in index.js

router.post('/api/login', loginValidation, asyncHandler(async (req, res) => {
    const loginStartTime = Date.now();
    const { username, password } = req.body;
    
    // Validate required fields
    const validateStart = Date.now();
    validateRequired(req.body, ['username', 'password']);
    console.log(`[LOGIN_TIMING] Validation: ${Date.now() - validateStart}ms`);

    // Get client info for logging
    const ipAddress = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    
    // Import activity logger and rate limiter
    const importStart = Date.now();
    const { logLogin } = require('../lib/activity-logger');
    const { checkRateLimit } = require('../lib/security');
    console.log(`[LOGIN_TIMING] Import modules: ${Date.now() - importStart}ms`);
    
    // Rate limiting: max 5 attempts per 15 minutes per IP
    const rateLimitStart = Date.now();
    const rateLimitResult = checkRateLimit('login', 5, 15 * 60 * 1000, ipAddress);
    console.log(`[LOGIN_TIMING] Rate limit check: ${Date.now() - rateLimitStart}ms`);
    
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
    console.log(`[LOGIN_TIMING] Account lookup: ${Date.now() - accountLookupStart}ms`);
    
    // Password verification - ini yang paling mungkin lambat
    const passwordStart = Date.now();
    const isValid = account && await comparePassword(password, account.password);
    console.log(`[LOGIN_TIMING] Password verification: ${Date.now() - passwordStart}ms`);

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
            console.error(`[AUTH_LOG] ❌ Failed to log login: ${username} - ${logErr.message}`);
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
    console.log(`[LOGIN_TIMING] Token generation: ${Date.now() - tokenStart}ms`);

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
    console.log(`[LOGIN_TIMING] Cookie set: ${Date.now() - cookieStart}ms`);

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
        console.error(`[AUTH_LOG] ❌ Failed to log login: ${username} - ${logErr.message}`);
    });

    const totalTime = Date.now() - loginStartTime;
    console.log(`[LOGIN_TIMING] ⏱️ TOTAL LOGIN TIME: ${totalTime}ms`);

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


// --- Customer Authenticated Routes ---

const customerApiRouter = express.Router();
customerApiRouter.use(ensureCustomerAuthenticated);

customerApiRouter.get('/profile', asyncHandler(async (req, res) => {
    const customer = req.customer;
    const profileData = await CustomerService.getProfile(customer, req);
    return sendSuccess(res, profileData, "Profile berhasil diambil");
}));

customerApiRouter.get('/traffic-usage/status', asyncHandler(async (req, res) => {
    const status = CustomerTrafficUsageService.getFeatureStatus();
    return sendSuccess(
        res,
        status,
        status.enabled ? 'Traffic pelanggan tersedia' : 'Traffic pelanggan tidak tersedia'
    );
}));

customerApiRouter.get('/traffic-usage', asyncHandler(async (req, res) => {
    if (!CustomerTrafficUsageService.isFeatureEnabled()) {
        return res.status(503).json({
            status: 503,
            message: 'Traffic usage tidak tersedia saat ini.',
            data: {
                hasPppoe: false,
                pppoeUsername: null,
                today: { downloadBytes: 0, uploadBytes: 0, totalBytes: 0 },
                currentMonth: { downloadBytes: 0, uploadBytes: 0, totalBytes: 0 },
                dailyHistory: [],
                lastCollectedAt: null,
                stale: false
            }
        });
    }

    const usage = await CustomerTrafficUsageService.getCustomerUsage(req.customer);
    return sendSuccess(res, usage, 'Traffic usage berhasil diambil');
}));

customerApiRouter.get('/traffic-live', asyncHandler(async (req, res) => {
    const featureStatus = CustomerTrafficUsageService.getFeatureStatus();
    if (!featureStatus.liveEnabled) {
        return res.status(503).json({
            status: 503,
            message: 'Bandwidth live tidak tersedia saat ini.',
            data: {
                hasPppoe: false,
                pppoeUsername: null,
                online: false,
                downloadBps: 0,
                uploadBps: 0,
                downloadHuman: '0 bps',
                uploadHuman: '0 bps',
                interfaceName: null,
                lastSampleAt: null,
                sampleIntervalMs: null,
                stale: false,
                warmup: false
            }
        });
    }

    const liveTraffic = await CustomerTrafficUsageService.getCustomerLiveUsage(req.customer);
    return sendSuccess(res, liveTraffic, 'Bandwidth live berhasil diambil');
}));

customerApiRouter.get('/reports/history', asyncHandler(async (req, res) => {
    const customer = req.customer;
    const reportHistory = await ReportService.getReportHistory(customer, req);
    return sendSuccess(res, reportHistory, "Riwayat laporan berhasil diambil");
}));

customerApiRouter.post('/request-package-change', asyncHandler(async (req, res) => {
    const { targetPackageName } = req.body;
    const customer = req.customer;
    
    const result = await CustomerService.requestPackageChange(customer, targetPackageName, req);
    
    return sendSuccess(res, null, result.message, 201);
}));

customerApiRouter.get('/package-change-requests/history', asyncHandler(async (req, res) => {
    const customer = req.customer;
    const history = await CustomerService.getPackageChangeHistory(customer, req);
    return sendSuccess(res, history, "Riwayat permintaan perubahan paket berhasil diambil");
}));

customerApiRouter.get('/packages', asyncHandler(async (req, res) => {
    const customer = req.customer;
    const packages = await CustomerService.getAvailablePackages(customer, req);
    return sendSuccess(res, packages, "Daftar paket bulanan berhasil diambil");
}));

customerApiRouter.post('/account/update', asyncHandler(async (req, res) => {
    const { currentPassword, newUsername, newPassword } = req.body;
    const customer = req.customer;
    
    const result = await CustomerService.updateAccount(customer, {
        currentPassword,
        newUsername,
        newPassword
    }, req);
    
    return sendSuccess(res, null, result.message);
}));

// Phone Number Management Endpoints untuk Customer
customerApiRouter.get('/phone-numbers', asyncHandler(async (req, res) => {
    const customer = req.customer;
    const phoneNumbers = await CustomerService.getPhoneNumbers(customer, req);
    return sendSuccess(res, phoneNumbers, "Daftar nomor HP berhasil diambil");
}));

customerApiRouter.post('/phone-numbers/add', asyncHandler(async (req, res) => {
    const customer = req.customer;
    const { phoneNumber } = req.body;
    
    // Validation
    if (!phoneNumber || typeof phoneNumber !== 'string' || phoneNumber.trim() === '') {
        return sendError(res, "Nomor HP tidak boleh kosong.", 400);
    }
    
    const result = await CustomerService.addPhoneNumber(customer, phoneNumber, req);
    return sendSuccess(res, result, result.message);
}));

customerApiRouter.delete('/phone-numbers/:phoneNumber', asyncHandler(async (req, res) => {
    const customer = req.customer;
    const { phoneNumber } = req.params;
    
    // Validation
    if (!phoneNumber || phoneNumber.trim() === '') {
        return sendError(res, "Nomor HP tidak boleh kosong.", 400);
    }
    
    // Decode URL-encoded phone number
    const decodedPhoneNumber = decodeURIComponent(phoneNumber);
    
    const result = await CustomerService.removePhoneNumber(customer, decodedPhoneNumber, req);
    return sendSuccess(res, result, result.message);
}));

// WiFi Management Endpoints untuk Customer
customerApiRouter.get('/wifi/info', wifiRateLimiter, asyncHandler(async (req, res) => {
    const customer = req.customer;
    const skipRefresh = req.query.skipRefresh === 'true'; // Optional: skip refresh untuk performa
    
    const wifiInfo = await WifiService.getCustomerWifiInfo(customer, req, skipRefresh);
    return sendSuccess(res, wifiInfo, "Info WiFi berhasil diambil");
}));

customerApiRouter.get('/wifi/connected-devices', wifiRateLimiter, asyncHandler(async (req, res) => {
    const customer = req.customer;
    const skipRefresh = req.query.skipRefresh === 'true'; // Optional: skip refresh untuk performa
    
    const connectedDevices = await WifiService.getConnectedDevices(customer, req, skipRefresh);
    return sendSuccess(res, connectedDevices, "Data device terkoneksi berhasil diambil");
}));

customerApiRouter.post('/wifi/update-name', wifiWriteRateLimiter, asyncHandler(async (req, res) => {
    const customer = req.customer;
    const { ssidIndex = 1, newName } = req.body;
    
    // Validation
    if (!newName || typeof newName !== 'string' || newName.trim() === '') {
        return sendError(res, "Nama WiFi tidak boleh kosong.", 400);
    }
    
    if (newName.length < 3 || newName.length > 32) {
        return sendError(res, "Nama WiFi harus antara 3-32 karakter.", 400);
    }
    
    // Validasi SSID index (1-8 untuk dual band)
    const parsedIndex = parseInt(ssidIndex);
    if (isNaN(parsedIndex) || parsedIndex < 1 || parsedIndex > 8) {
        return sendError(res, "SSID index harus antara 1-8 (4 untuk 2.4GHz dan 4 untuk 5GHz).", 400);
    }
    
    const result = await WifiService.updateCustomerWifiName(customer, ssidIndex, newName, req);
    return sendSuccess(res, result, "Nama WiFi berhasil diubah");
}));

customerApiRouter.post('/wifi/update-password', wifiWriteRateLimiter, asyncHandler(async (req, res) => {
    const customer = req.customer;
    const { ssidIndex = 1, newPassword } = req.body;
    
    // Validation
    if (!newPassword || typeof newPassword !== 'string' || newPassword.trim() === '') {
        return sendError(res, "Password WiFi harus diisi.", 400);
    }
    
    if (newPassword.length < 8 || newPassword.length > 63) {
        return sendError(res, "Password WiFi harus antara 8-63 karakter.", 400);
    }
    
    // Validasi SSID index (1-8 untuk dual band)
    const parsedIndex = parseInt(ssidIndex);
    if (isNaN(parsedIndex) || parsedIndex < 1 || parsedIndex > 8) {
        return sendError(res, "SSID index harus antara 1-8 (4 untuk 2.4GHz dan 4 untuk 5GHz).", 400);
    }
    
    const result = await WifiService.updateCustomerWifiPassword(customer, ssidIndex, newPassword, req);
    return sendSuccess(res, result, "Password WiFi berhasil diubah");
}));

customerApiRouter.put('/wifi/update', wifiWriteRateLimiter, asyncHandler(async (req, res) => {
    const customer = req.customer;
    const { ssidIndex = 1, newName, newPassword } = req.body;
    
    // Validation
    if (!newName && !newPassword) {
        return sendError(res, "Minimal harus ada nama WiFi atau password yang diubah.", 400);
    }
    
    if (newName && (newName.length < 3 || newName.length > 32)) {
        return sendError(res, "Nama WiFi harus antara 3-32 karakter.", 400);
    }
    
    if (newPassword && (newPassword.length < 8 || newPassword.length > 63)) {
        return sendError(res, "Password WiFi harus antara 8-63 karakter.", 400);
    }
    
    // Validasi SSID index (1-8 untuk dual band)
    const parsedIndex = parseInt(ssidIndex);
    if (isNaN(parsedIndex) || parsedIndex < 1 || parsedIndex > 8) {
        return sendError(res, "SSID index harus antara 1-8 (4 untuk 2.4GHz dan 4 untuk 5GHz).", 400);
    }
    
    const result = await WifiService.updateCustomerWifi(customer, ssidIndex, { newName, newPassword }, req);
    return sendSuccess(res, result, "WiFi berhasil diupdate");
}));

customerApiRouter.post('/wifi/reboot', wifiWriteRateLimiter, asyncHandler(async (req, res) => {
    const customer = req.customer;
    
    const result = await WifiService.rebootCustomerRouter(customer, req);
    return sendSuccess(res, result, result.message || "Perintah reboot berhasil dikirim");
}));

router.post('/api/customer/login', customerLoginValidation, asyncHandler(handleCustomerLogin));

router.use('/api/customer', customerApiRouter);

// Additional customer endpoints for NextJS frontend
router.get('/api/customer/speed-requests/active', ensureCustomerAuthenticated, asyncHandler(async (req, res) => {
    const customer = req.customer;
    
    const activeRequest = await SpeedRequestService.getActiveRequest(customer, req);
    
    if (!activeRequest) {
        return sendSuccess(res, null, "Tidak ada speed boost yang aktif.");
    }
    
    return sendSuccess(res, activeRequest, "Speed boost aktif berhasil diambil");
}));

router.get('/api/customer/speed-requests/history', ensureCustomerAuthenticated, asyncHandler(async (req, res) => {
    const customer = req.customer;
    const requestHistory = await SpeedRequestService.getRequestHistory(customer, req);
    return sendSuccess(res, requestHistory, "Riwayat speed boost berhasil diambil");
}));

router.post('/api/customer/speed-requests/cancel', ensureCustomerAuthenticated, cancelSpeedRequestValidation, asyncHandler(async (req, res) => {
    const customer = req.customer;
    const { requestId } = req.body;
    
    const result = await SpeedRequestService.cancelRequest(customer, requestId, req);
    return sendSuccess(res, null, result.message);
}));

// GET /api/customer/speed-boost/status - Check if Speed On Demand is enabled
router.get('/api/customer/speed-boost/status', ensureCustomerAuthenticated, asyncHandler(async (req, res) => {
    const isEnabled = SpeedRequestService.isFeatureEnabled();
    return sendSuccess(res, { enabled: isEnabled }, isEnabled ? "Speed On Demand tersedia" : "Speed On Demand tidak tersedia");
}));

router.get('/api/customer/speed-boost/available', ensureCustomerAuthenticated, asyncHandler(async (req, res) => {
    const customer = req.customer;
    const availablePackages = await SpeedRequestService.getAvailableSpeedBoosts(customer);
    
    if (availablePackages.length === 0) {
        // Check if feature is disabled
        if (!SpeedRequestService.isFeatureEnabled()) {
            return sendSuccess(res, [], "Speed Boost sedang tidak tersedia saat ini");
        }
        return sendSuccess(res, [], "Tidak ada paket speed boost yang tersedia untuk paket Anda saat ini");
    }
    
    return sendSuccess(res, availablePackages, "Daftar paket speed boost berhasil diambil");
}));

router.get('/api/dashboard-status', ensureCustomerAuthenticated, asyncHandler(async (req, res) => {
    const customer = req.customer;
    const dashboardData = await PublicService.getDashboardStatus(customer);
    setSensitiveResponseHeaders(res);
    return sendSuccess(res, dashboardData, "Status dashboard berhasil diambil");
}));

// --- Public Unauthenticated Routes ---

router.get('/app/:type/:id?', async (req, res) => {
    const { type, id } = req.params;
    try {
        switch(type) {
            case "buy": {
                const { phone, email } = req.query;
                if (!phone || !email) return res.status(400).json({ status: 400, message: "Nomor telepon dan email diperlukan!" });
                const reff = Math.floor(Math.random() * 1677721631342).toString(16);
                let hargavc = checkhargavc(id);
                hargavc = parseInt(hargavc);
                let result = await pay({ amount: hargavc, reffId: reff, comment: `pembelian voucher ${id} sebesar Rp. ${hargavc} melalui web`, name: email?.split('@')?.[0] || "Anonymous", phone: parseInt(phone), email });
                addPayment(reff, result.id, phone, `buynowweb`, hargavc, 'QRIS', ``, { qrStr: result.qrString, priceTotal: result.total, fee: result.fee, subtotal: result.subTotal });
                return res.status(200).json({ status: 200, message: 'Success', data: reff });
            }
            case 'detailtrx': {
                return res.status(200).json({ status: 200, message: 'Success', data: global.payment.find(h => h.reffId == id) || null });
            }
            case 'statustrx': {
                let pay = global.payment.find(d => d.reffId == id);
                if (!pay) return res.status(404).json({ status: 404, message: "" });
                if (!pay.status) return res.status(400).json({ status: 400, message: "menunggu pembayaran!" });
                return res.status(200).json({ status: 200, message: 'Success', data: global.payment.find(h => h.reffId == id) || null });
            }
            default: {
                return res.json({ data: type == 'packages' ? global.packages : type == 'voucher' ? global.voucher : [] });
            }
        }
    } catch(err) {
        if (typeof err === "string") return res.json({ status: 400, message: err });
        console.log(err);
        return res.json({ status: 500, message: "Internal server error" });
    }
});

// Lock per reference_id untuk callback pembayaran — cegah pemrosesan konkuren
// (double credit) untuk transaksi yang sama. In-process; cukup untuk single instance.
const _paymentCallbackLocks = new Map();
function acquirePaymentCallbackLock(key) {
    const previous = _paymentCallbackLocks.get(key) || Promise.resolve();
    let release;
    const slot = new Promise((resolve) => { release = resolve; });
    const chained = previous.then(() => slot);
    _paymentCallbackLocks.set(key, chained);
    return previous.then(() => () => {
        release();
        if (_paymentCallbackLocks.get(key) === chained) {
            _paymentCallbackLocks.delete(key);
        }
    });
}

router.post('/callback/payment', async (req, res) => {
    const { reference_id, status_code } = req.body;
    let releaseCallbackLock = null;
    try {
        const pay = global.payment.find(val => val.reffId == reference_id);
        if (!pay) throw !1;
        if (status_code == '1') {
            // Idempotency cepat: kalau sudah diproses, balas 200 tanpa external call / re-credit.
            if (checkStatusPayment(reference_id)) throw !0;

            // Serialize per reference_id — cegah DUA callback konkuren memproses
            // pembayaran yang sama dua kali (verify + getvoucher/addKoinUser tidak atomik
            // tanpa lock → potensi double voucher / double saldo).
            releaseCallbackLock = await acquirePaymentCallbackLock(reference_id);

            // Re-check setelah memegang lock: callback lain mungkin sudah menyelesaikan
            // pemrosesan saat kita menunggu antrian lock.
            if (checkStatusPayment(reference_id)) throw !0;

            // KEAMANAN: JANGAN percaya body callback mentah — bisa di-forge → free saldo/voucher.
            // Verifikasi langsung ke iPaymu pakai trxId yang KITA simpan saat membuat transaksi.
            // Mode HOSTED (bayar tagihan via halaman iPaymu): TransactionId belum ada saat buat sesi,
            // baru muncul di payload callback → fallback ke req.body.trx_id/sid. Tetap AMAN: tetap
            // diverifikasi server-to-server ke iPaymu + cross-check referenceId & amount vs record kita.
            const effectiveTrxId = pay.trxId || req.body.trx_id || req.body.sid;
            const verify = await verifyIpaymuTransaction(effectiveTrxId, { sandbox: pay.sandbox === true });
            if (!verify || !verify.ok || !verify.paid) {
                console.warn('[PAYMENT_CALLBACK_REJECT] iPaymu belum konfirmasi LUNAS — kredit ditolak.', {
                    reference_id, trxId: effectiveTrxId, ipaymu_status: verify?.status, ipaymu_error: verify?.error
                });
                throw !1; // 500 → minta iPaymu retry callback; jangan kredit.
            }
            // Cegah substitusi trx: referenceId & amount dari iPaymu harus cocok dgn record kita.
            if (verify.referenceId != null && String(verify.referenceId) !== String(reference_id)) {
                console.warn('[PAYMENT_CALLBACK_REJECT] referenceId iPaymu tidak cocok.', {
                    reference_id, ipaymu_referenceId: verify.referenceId
                });
                throw !1;
            }
            if (verify.amount != null && pay.amount != null && parseInt(verify.amount, 10) < parseInt(pay.amount, 10)) {
                console.warn('[PAYMENT_CALLBACK_REJECT] amount iPaymu kurang dari tagihan.', {
                    reference_id, ipaymu_amount: verify.amount, expected: pay.amount
                });
                throw !1;
            }

            if (pay.tag == 'buynow') {
                const prof = checkprofvc(`${pay.amount}`);
                const durasivc = checkdurasivc(prof);
                const hargavc = checkhargavc(prof);
                await getvoucher(prof, pay.sender, { caller: 'public.payment-callback.buynow' }).then(async voucherResult => {
                    if (!voucherResult.ok) {
                        throw new Error(voucherResult.message);
                    }
                    const result = voucherResult.data?.username || voucherResult.message;
                    updateKetPayment(reference_id, `Voucher: ${result}`);
                    updateStatusPayment(reference_id, true);
                    // Kode voucher = kritis → sendCritical (retry + dead-letter) supaya kode
                    // sampai ke pelanggan yang sudah bayar, bukan best-effort sendMessage.
                    if (pay.sender != "buynow") {
                        const message = renderTemplate('voucher_purchase_success', {
                            nama_paket: durasivc,
                            harga: convertRupiah.convert(hargavc),
                            kode_voucher: result
                        });
                        await sendCritical(pay.sender, { text: message }, { label: 'voucher-code' });
                    }
                    throw !0;
                }).catch(async err => {
                    if (typeof err === "string" || err instanceof Error) {
                        const errorMessage = typeof err === "string" ? err : err.message;
                        // Voucher GAGAL dibuat padahal SUDAH BAYAR. getvoucher non-idempotent &
                        // tak di-retry → JANGAN throw !1 (retry → risiko voucher GANDA). Sebagai gantinya:
                        // catat orphan + alert admin (fulfill manual) + pesan ringan ke pelanggan,
                        // lalu tandai paid (stop retry) supaya kegagalan TERLIHAT & bisa ditindaklanjuti.
                        recordVoucherOrphan({ type: 'buynow_callback', reference_id, sender: pay.sender, amount: pay.amount, profile: prof, error: errorMessage });
                        await alertAdmins(renderTemplate('voucher_gagal_admin', {
                            pelanggan: pay.sender, paket: durasivc || prof, harga: convertRupiah.convert(pay.amount), ref: reference_id, error: errorMessage
                        }), 'voucher-gagal');
                        updateKetPayment(reference_id, `GAGAL voucher: ${errorMessage}`);
                        if (pay.sender != "buynow") {
                            try { await sendMessage(pay.sender, { text: renderTemplate('voucher_pending_manual', {}) }, { skipDuplicateCheck: true }); }
                            catch (notifyErr) { console.error('[BUYNOW_FAIL] gagal notif pelanggan:', notifyErr.message); }
                        }
                        updateStatusPayment(reference_id, true);
                        throw !0;
                    } else throw !1;
                });
            } else if (pay.tag == 'buynowweb') {
                const prof = checkprofvc(String(pay.amount));
                await getvoucher(prof, pay.sender, { caller: 'public.payment-callback.buynowweb' }).then(async voucherResult => {
                    if (!voucherResult.ok) {
                        throw new Error(voucherResult.message);
                    }
                    const result = voucherResult.data?.username || voucherResult.message;
                    updateKetPayment(reference_id, `${result}`);
                    updateStatusPayment(reference_id, true);
                    throw !0;
                }).catch(async err => {
                    if (typeof err === "string" || err instanceof Error) {
                        const errorMessage = typeof err === "string" ? err : err.message;
                        // Voucher web gagal padahal sudah bayar → orphan + alert admin (fulfill manual),
                        // mark paid (stop retry; getvoucher non-idempotent). Pelanggan lihat status di halaman web.
                        recordVoucherOrphan({ type: 'buynowweb_callback', reference_id, sender: pay.sender, amount: pay.amount, profile: prof, error: errorMessage });
                        await alertAdmins(renderTemplate('voucher_gagal_admin', {
                            pelanggan: pay.sender, paket: prof, harga: convertRupiah.convert(pay.amount), ref: reference_id, error: errorMessage
                        }), 'voucher-gagal');
                        updateKetPayment(reference_id, `GAGAL voucher: ${errorMessage}`);
                        updateStatusPayment(reference_id, true);
                        throw !0;
                    } else throw !1;
                });
            } else if (pay.tag == 'topup') {
                // Kredit saldo DULU; HANYA tandai paid bila kredit sukses. Bila gagal (mis. JID
                // @lid tak ter-resolve / DB error), JANGAN tandai paid agar topup tidak hilang —
                // throw !1 → HTTP 500 → iPaymu retry callback, dan admin bisa intervensi.
                // (addKoinUser kini fail-closed: return false bila JID tak bisa di-resolve.)
                const credited = await addKoinUser(pay.sender, pay.amount);
                if (!credited) {
                    console.error('[IPAYMU_TOPUP] Kredit saldo GAGAL — payment TIDAK ditandai paid', {
                        reference_id, sender: pay.sender, amount: pay.amount
                    });
                    throw !1;
                }
                updateStatusPayment(reference_id, true);
                // PENTING: Cek connection state dan gunakan error handling sesuai rules
                const currentSaldo = await checkATMuser(pay.sender);
                const message = renderTemplate('topup_saldo_masuk', {
                    harga: convertRupiah.convert(pay.amount),
                    formattedSaldo: convertRupiah.convert(currentSaldo)
                });
                await sendMessage(pay.sender, { text: message });
                throw !0;
            } else if (pay.tag == 'tagihan') {
                // Bayar tagihan bulanan: cari pelanggan dari userId yang KITA simpan saat charge.
                const user = (global.users || []).find(u => String(u.id) === String(pay.userId));
                if (!user) {
                    console.error('[IPAYMU_TAGIHAN] User tidak ditemukan — payment TIDAK ditandai paid', { reference_id, userId: pay.userId });
                    throw !1; // 500 → iPaymu retry
                }

                // Catat lunas (ledger) + reaktivasi bila terisolir. Catat-lunas WAJIB sukses;
                // bila gagal → 500 supaya iPaymu retry & pembayaran tidak hilang (fail-closed).
                let settleResult;
                try {
                    settleResult = await billSettlement.settleTagihanPayment({
                        user,
                        amountPaid: pay.amount,
                        periodMonth: pay.periodMonth,
                        periodYear: pay.periodYear,
                        paymentMethod: pay.method || 'QRIS',
                        reffId: reference_id,
                    });
                } catch (settleErr) {
                    console.error('[IPAYMU_TAGIHAN] Catat lunas GAGAL — payment TIDAK ditandai paid', { reference_id, error: settleErr.message });
                    throw !1; // 500 → iPaymu retry; jangan tandai paid.
                }

                updateStatusPayment(reference_id, true);
                const react = settleResult.reactivation || {};
                updateKetPayment(reference_id, `Tagihan lunas${react.attempted ? (react.ok ? ' + reaktivasi OK' : ' + reaktivasi GAGAL') : ''}`);

                // Struk ke pelanggan (best-effort; kegagalan kirim TIDAK menggagalkan callback).
                try {
                    const periode = (pay.periodMonth && pay.periodYear)
                        ? new Date(pay.periodYear, pay.periodMonth - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })
                        : new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
                    const struk = renderTemplate('tagihan_struk_lunas', {
                        nama_pelanggan: user.name,
                        nama_paket: user.subscription,
                        harga: convertRupiah.convert(pay.amount),
                        metode: pay.method || 'QRIS',
                        periode,
                        waktu: new Date().toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' WIB',
                        no_ref: reference_id,
                        status_layanan: react.ok ? '⚡ Layanan Anda sudah aktif kembali.' : '',
                    });
                    if (pay.sender) await sendMessage(pay.sender, { text: struk });
                } catch (notifyErr) {
                    console.error('[IPAYMU_TAGIHAN] Gagal kirim struk:', notifyErr.message);
                }

                // Alert admin bila reaktivasi DIBUTUHKAN tapi GAGAL (pelanggan bayar tapi masih terisolir).
                if (react.attempted && !react.ok) {
                    await alertAdmins(renderTemplate('tagihan_reaktivasi_gagal_admin', {
                        nama_pelanggan: user.name,
                        pppoe: user.pppoe_username || '-',
                        reference_id,
                    }), 'tagihan-reaktivasi-gagal');
                }
                throw !0; // 200
            }
        }
    } catch(err) {
        res.status(err ? 200 : 500).json({ status: err });
    } finally {
        if (releaseCallbackLock) releaseCallbackLock();
    }
});

// This route is obsolete and insecure. It is replaced by GET /api/customer/profile
// router.get('/api/user/:phoneNumber', apiAuth, async (req, res) => { ... });

router.post('/api/lapor', apiAuth, asyncHandler(async (req, res) => {
    const { category, reportText } = req.body;
    const user = req.customer;
    
    const result = await ReportService.submitReport(user, { category, reportText }, req.ip, req);
    
    return sendSuccess(res, { ticketId: result.ticketId }, "Laporan berhasil dibuat. Tim kami akan segera menghubungi Anda.", 201);
}));

// POST /api/customer/reports/upload-photo - Upload photo untuk report (customer)
const { getReportsUploadsPath } = require('../lib/path-helper');

const reportPhotoStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        const { ticketId } = req.body;
        
        if (!ticketId) {
            return cb(new Error('Ticket ID harus diisi'), null);
        }
        
        // Find report to get creation date
        const report = global.reports.find(r => r.ticketId === ticketId || r.id === ticketId);
        let year, month;
        
        if (report && report.createdAt) {
            const reportDate = new Date(report.createdAt);
            year = reportDate.getFullYear();
            month = String(reportDate.getMonth() + 1).padStart(2, '0');
        } else {
            // Fallback to current date
            const now = new Date();
            year = now.getFullYear();
            month = String(now.getMonth() + 1).padStart(2, '0');
        }
        
        const uploadDir = getReportsUploadsPath(year, month, ticketId, __dirname);
        
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(7);
        const ext = path.extname(file.originalname);
        cb(null, `customer_${req.body.ticketId}_${timestamp}_${random}${ext}`);
    }
});

const reportPhotoUpload = multer({
    storage: reportPhotoStorage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    },
    fileFilter: function (req, file, cb) {
        if (!file.mimetype.startsWith('image/')) {
            return cb(new Error('Hanya file gambar yang diperbolehkan'), false);
        }
        cb(null, true);
    }
});

function handleReportPhotoUpload(req, res, next) {
    reportPhotoUpload.single('photo')(req, res, (error) => {
        if (!error) {
            return next();
        }

        return sendError(res, error.message || 'File foto tidak valid', 400);
    });
}

router.post('/api/customer/reports/upload-photo', apiAuth, handleReportPhotoUpload, asyncHandler(async (req, res) => {
    const customer = req.customer;
    const { ticketId } = req.body;
    
    if (!ticketId) {
        return sendError(res, "Ticket ID harus diisi", 400);
    }
    
    if (!req.file) {
        return sendError(res, "File foto harus diupload", 400);
    }
    
    // Get all customer JIDs (customer bisa punya multiple phone numbers)
    const BaseService = require('../lib/services/base-service');
    const customerJids = BaseService.getCustomerJids(customer.phone_number);
    
    // Find report - check by ticketId and customer JIDs
    const reportIndex = global.reports.findIndex(r => 
        (r.ticketId === ticketId || r.id === ticketId) &&
        customerJids.includes(r.pelangganId)
    );
    
    if (reportIndex === -1) {
        // Clean up uploaded file
        if (req.file && req.file.path) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (err) {
                console.error('[REPORT_UPLOAD_PHOTO] Failed to delete file:', err);
            }
        }
        return sendError(res, "Tiket tidak ditemukan atau tidak memiliki akses", 404);
    }
    
    let report = global.reports[reportIndex];
    
    ensureTicketShape(report);

    if (!ReportService.isCustomerActiveStatus(report.status)) {
        // Clean up uploaded file
        if (req.file && req.file.path) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (err) {
                console.error('[REPORT_UPLOAD_PHOTO] Failed to delete file:', err);
            }
        }
        return sendError(res, `Tidak bisa upload foto. Status tiket: ${report.status}`, 400);
    }
    
    const photoInfo = {
        fileName: req.file.filename,
        path: req.file.path,
        uploadedAt: new Date().toISOString(),
        size: req.file.size,
        uploadedBy: 'customer',
        uploadedVia: 'customer_panel'
    };

    try {
        ({ ticket: report } = await appendCustomerReportPhoto({
            ticketId: report.ticketId || report.id,
            actor: {
                id: req.customer?.id || req.customer?.user_id || 'customer',
                username: req.customer?.name || req.customer?.username || 'customer',
                source: 'customer_panel'
            },
            photo: photoInfo,
            maxPhotos: 3,
            allowedStatuses: ReportService.getCustomerPhotoUploadStatuses()
        }));
    } catch (error) {
        if (req.file && req.file.path) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (err) {
                console.error('[REPORT_UPLOAD_PHOTO] Failed to delete file:', err);
            }
        }
        return sendError(res, error.message, error.code === 'MAX_CUSTOMER_PHOTOS' ? 400 : 500);
    }
    
    return sendSuccess(res, {
        ticketId: report.ticketId || report.id,
        photoCount: report.customerPhotos.length,
        totalPhotos: report.customerPhotos.length,
        maxPhotos: 3,
        photo: {
            fileName: photoInfo.fileName,
            uploadedAt: photoInfo.uploadedAt,
            size: photoInfo.size
        }
    }, `Foto berhasil diupload (${report.customerPhotos.length}/3)`, 200);
}));

router.post('/api/request-speed', apiAuth, requestSpeedValidation, asyncHandler(async (req, res) => {
    // Import helper functions
    const speedHelper = require('../lib/speed-request-helper');
    
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
        console.error('[API_SPEED_REQUEST_FATAL_ERROR]', error);
        return sendError(res, "Terjadi kesalahan pada server.", 500);
    }
}));

router.get('/api/speed-boost/packages', asyncHandler(async (req, res) => {
    const packages = await SpeedRequestService.getSpeedBoostPackages();
    return sendSuccess(res, packages, "Daftar paket speed boost berhasil diambil");
}));

router.post('/api/otp', asyncHandler(handleOtpRequest));

router.post('/api/otpverify', asyncHandler(handleOtpVerify));

// --- ALIASES FOR FRONTEND ---

// Alias for /api/customer/login
router.post('/api/auth/login', customerLoginValidation, asyncHandler(handleCustomerLogin));

// Alias for /api/otp
router.post('/api/auth/otp/request', otpRequestValidation, asyncHandler(handleOtpRequest));

// Alias for /api/otpverify
router.post('/api/auth/otp/verify', otpVerifyValidation, asyncHandler(handleOtpVerify));


router.get('/api/wifi-name', asyncHandler(async (req, res) => {
    const wifiData = await PublicService.getWifiName();
    return sendSuccess(res, wifiData, "Nama WiFi berhasil diambil");
}));

// GET /api/announcements - Get all announcements
router.get('/api/announcements', asyncHandler(async (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit) : null;
    const announcements = await PublicService.getAnnouncements({ limit });
    
    // Set cache-control headers untuk mencegah browser caching (real-time updates)
    res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
    });
    
    // Response format dengan compatibility: tambahkan success field untuk admin panel
    return res.status(200).json({
        status: 200,
        success: true, // Compatibility field untuk admin panel
        message: "Daftar pengumuman berhasil diambil",
        data: announcements
    });
}));

// GET /api/announcements/recent - Get recent announcements (alias untuk compatibility)
router.get('/api/announcements/recent', asyncHandler(async (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit) : 5;
    const announcements = await PublicService.getAnnouncements({ limit });
    
    // Set cache-control headers untuk mencegah browser caching (real-time updates)
    res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
    });
    
    // Response format dengan compatibility: tambahkan success field untuk admin panel
    return res.status(200).json({
        status: 200,
        success: true, // Compatibility field untuk admin panel
        message: "Daftar pengumuman terbaru berhasil diambil",
        data: announcements
    });
}));

// GET /api/news - Get all news
router.get('/api/news', asyncHandler(async (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit) : null;
    const news = await PublicService.getNews({ limit });
    
    // Set cache-control headers untuk mencegah browser caching (real-time updates)
    res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
    });
    
    // Response format dengan compatibility: tambahkan success field untuk admin panel
    return res.status(200).json({
        status: 200,
        success: true, // Compatibility field untuk admin panel
        message: "Daftar berita berhasil diambil",
        data: news
    });
}));

// GET /api/news/recent - Get recent news (alias untuk compatibility)
router.get('/api/news/recent', asyncHandler(async (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit) : 5;
    const news = await PublicService.getNews({ limit });
    
    // Set cache-control headers untuk mencegah browser caching (real-time updates)
    res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
    });
    
    // Response format dengan compatibility: tambahkan success field untuk admin panel
    return res.status(200).json({
        status: 200,
        success: true, // Compatibility field untuk admin panel
        message: "Daftar berita terbaru berhasil diambil",
        data: news
    });
}));

module.exports = router;
