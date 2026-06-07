/**
 * Header Doc
 * Purpose: Router Speed on Demand untuk request, bukti bayar, approval, cleanup, dan konfigurasi speed boost.
 * Caller: Express route registry/admin/customer portal.
 * Deps: database, templating, template-service, upload-helper, ProfileUpdateService, whatsapp gateway/delivery.
 * MainFuncs: route list/payment-proof/verify-payment/action/cleanup/config speed request.
 * SideEffects: Menulis speed request, upload bukti, sinkronisasi profile, dan mengirim notifikasi WhatsApp.
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { saveSpeedRequests } = require('../lib/database');
const { normalizePhoneNumber: _normalizePhoneNumber } = require('../lib/myfunc');
const { renderTemplate: _renderTemplate, templatesCache } = require('../lib/templating');
const { renderCategoryTemplate } = require('../lib/template-service');
const { getUploadDir, getUploadPath, generateFilename } = require('../lib/upload-helper');
const { hasAuthenticatedSession } = require('../lib/whatsapp-gateway');
const { ProfileUpdateService } = require('../lib/services/profile-update-service');
const { sendMessageToMany } = require('../lib/whatsapp-delivery-service');

function renderResponseTemplate(key, data = {}) {
    return renderCategoryTemplate('responseTemplates', key, data).text;
}

// Configure multer for file uploads (Speed Request proofs)
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = getUploadDir('speed-requests');
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const requestId = req.body.requestId || 'unknown';
        const filename = generateFilename('payment', requestId, file.originalname);
        cb(null, filename);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
    fileFilter: function (req, file, cb) {
        const allowedTypes = /jpeg|jpg|png|gif|pdf/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Hanya file gambar (JPEG, PNG, GIF) atau PDF yang diperbolehkan.'));
        }
    }
});

// Middleware for admin-only routes
function ensureAdmin(req, res, next) {
    if (!req.user || !['admin', 'owner', 'superadmin'].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak. Hanya peran tertentu yang diizinkan." });
    }
    next();
}

// Middleware for authenticated users
function ensureAuthenticated(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ message: "Autentikasi diperlukan." });
    }
    next();
}

// GET /api/speed-requests - Get all speed boost requests
router.get('/speed-requests', ensureAdmin, async (req, res) => {
    try {
        const sortedRequests = [...global.speed_requests].sort((a, b) => 
            new Date(b.createdAt) - new Date(a.createdAt)
        );
        
        return res.json({
            status: 200,
            data: sortedRequests
        });
    } catch (error) {
        console.error('[API_SPEED_REQUESTS_ERROR]', error);
        return res.status(500).json({
            status: 500,
            message: 'Terjadi kesalahan saat mengambil data speed requests'
        });
    }
});

// POST /api/speed-requests/payment-proof - Upload bukti pembayaran speed request
router.post('/speed-requests/payment-proof', ensureAuthenticated, upload.single('paymentProof'), async (req, res) => {
    const { requestId, paymentNotes } = req.body;
    
    if (!requestId) {
        return res.status(400).json({ message: "Request ID wajib diisi." });
    }
    
    const requestIndex = global.speed_requests.findIndex(r => r.id === requestId);
    if (requestIndex === -1) {
        return res.status(404).json({ message: "Permintaan tidak ditemukan." });
    }
    
    const request = global.speed_requests[requestIndex];
    
    // Check if user owns this request or is admin
    const isAdmin = ['admin', 'owner', 'superadmin'].includes(req.user.role);
    const isOwner = request.userId.toString() === req.user.id?.toString();
    
    if (!isAdmin && !isOwner) {
        return res.status(403).json({ message: "Anda tidak memiliki akses untuk request ini." });
    }
    
    // Check if request is in correct status
    if (request.status !== 'pending') {
        return res.status(400).json({ message: `Request dengan status '${request.status}' tidak dapat diupdate bukti pembayarannya.` });
    }
    
    // Check payment method
    if (!['cash', 'transfer'].includes(request.paymentMethod)) {
        return res.status(400).json({ message: "Upload bukti pembayaran hanya untuk metode cash/transfer." });
    }
    
    try {
        // Update payment info
        if (req.file) {
            request.paymentProof = getUploadPath('speed-requests', req.file.filename);
        }
        request.paymentStatus = 'pending'; // Waiting for verification
        request.paymentNotes = paymentNotes || '';
        request.paymentDate = new Date().toISOString();
        request.updatedAt = new Date().toISOString();
        
        global.speed_requests[requestIndex] = request;
        saveSpeedRequests();
        
        // Notify admin about payment proof upload
        if (hasAuthenticatedSession() && global.config.ownerNumber && Array.isArray(global.config.ownerNumber)) {
            const notifMessage = renderResponseTemplate('routes_speed_payment_proof_owner_notification', {
                customerName: request.userName,
                requestedPackage: request.requestedPackageName,
                duration: request.durationKey.replace('_', ' '),
                price: `Rp ${Number(request.price).toLocaleString('id-ID')}`,
                paymentMethod: request.paymentMethod,
                paymentNotes: paymentNotes || '-'
            });
                
            const delivery = await sendMessageToMany(global.config.ownerNumber || [], { text: notifMessage });
            if (!delivery.sent) {
                console.error('[SPEED_PAYMENT_NOTIF_ERROR]', delivery.errorCode || 'SEND_FAILED');
            }
        }
        
        return res.status(200).json({ 
            message: "Bukti pembayaran berhasil diupload. Menunggu verifikasi admin.",
            data: {
                paymentProof: request.paymentProof,
                paymentStatus: request.paymentStatus
            }
        });
    } catch (error) {
        console.error('[SPEED_PAYMENT_UPLOAD_ERROR]', error);
        return res.status(500).json({ message: "Gagal mengupload bukti pembayaran." });
    }
});

// POST /api/speed-requests/verify-payment - Admin verify payment
router.post('/speed-requests/verify-payment', ensureAdmin, async (req, res) => {
    const { requestId, verified, notes } = req.body;
    
    if (!requestId || verified === undefined) {
        return res.status(400).json({ message: "Parameter tidak lengkap. requestId dan verified wajib diisi." });
    }
    
    const requestIndex = global.speed_requests.findIndex(r => r.id === requestId);
    if (requestIndex === -1) {
        return res.status(404).json({ message: "Permintaan tidak ditemukan." });
    }
    
    const request = global.speed_requests[requestIndex];
    
    // Check if payment is pending verification
    if (request.paymentStatus !== 'pending') {
        return res.status(400).json({ message: "Pembayaran tidak dalam status pending verification." });
    }
    
    try {
        if (verified) {
            // Mark payment as verified
            request.paymentStatus = 'verified';
            request.paymentVerifiedBy = req.user.username;
            request.paymentVerifiedAt = new Date().toISOString();
            
            // Auto-approve the speed request if payment is verified
            const user = global.users.find(u => u.id === request.userId);
            if (!user) {
                throw new Error("User untuk permintaan ini tidak ditemukan.");
            }
            
            const requestedPackage = global.packages.find(p => p.name === request.requestedPackageName);
            if (!requestedPackage || !requestedPackage.profile) {
                throw new Error("Paket yang diminta atau profilnya tidak ditemukan.");
            }
            
            const newProfile = requestedPackage.profile;
            console.log(`[SPEED_PAYMENT_VERIFIED] Auto-approving request ${requestId} untuk user ${user.name}. Mengubah profil ke ${newProfile}`);
            
            // Calculate expiration
            let durationInHours = 0;
            if (request.durationKey === '1_day') durationInHours = 24;
            else if (request.durationKey === '3_days') durationInHours = 72;
            else if (request.durationKey === '7_days') durationInHours = 168;
            
            const now = new Date();
            const expirationDate = new Date(now.getTime() + durationInHours * 60 * 60 * 1000);
            
            // Prepare notification data
            const notificationData = {
                enabled: true,
                message: renderResponseTemplate('routes_speed_payment_verified_customer', {
                    customerName: user.name,
                    requestedPackage: request.requestedPackageName,
                    duration: request.durationKey.replace('_', ' '),
                    expiresAt: expirationDate.toLocaleString('id-ID')
                })
            };
            
            // Use ProfileUpdateService untuk apply profile update
            const profileUpdateResult = await ProfileUpdateService.applyProfileUpdate(
                user,
                newProfile,
                {
                    rebootRouter: false, // Speed On Demand biasanya tidak perlu reboot
                    disconnectSession: true,
                    skipOnError: false,
                    notification: notificationData,
                    context: 'SPEED_PAYMENT_VERIFIED'
                }
            );
            
            // Check if profile update berhasil
            if (!profileUpdateResult.success || profileUpdateResult.errors.length > 0) {
                throw new Error(profileUpdateResult.errors.join(', ') || 'Gagal mengubah profil Mikrotik');
            }
            
            // Update request status
            request.status = 'active';
            request.updatedAt = now.toISOString();
            request.approvedBy = req.user.username;
            request.durationHours = durationInHours;
            request.expirationDate = expirationDate.toISOString();
            request.notes = notes || "Pembayaran terverifikasi, speed boost diaktifkan.";
        } else {
            // Reject payment
            request.paymentStatus = 'rejected';
            request.paymentVerifiedBy = req.user.username;
            request.paymentVerifiedAt = new Date().toISOString();
            request.notes = notes || "Pembayaran ditolak.";
            
            // Notify customer about rejection menggunakan ProfileUpdateService
            const user = global.users.find(u => u.id === request.userId);
            if (user && user.phone_number) {
                const notifMessage = renderResponseTemplate('routes_speed_payment_rejected_customer', {
                    customerName: user.name,
                    reason: notes || 'Bukti pembayaran tidak valid'
                });
                
                const notificationData = {
                    enabled: true,
                    message: notifMessage
                };
                
                try {
                    await ProfileUpdateService.applyProfileUpdate(
                        user,
                        null, // No profile change untuk reject, hanya kirim notification
                        {
                            rebootRouter: false,
                            disconnectSession: false,
                            skipOnError: true,
                            notification: notificationData,
                            context: 'SPEED_PAYMENT_REJECT'
                        }
                    );
                } catch (e) {
                    // Notification error tidak critical untuk reject
                    console.warn(`[SPEED_PAYMENT_REJECT_NOTIF] Failed to send notification:`, e.message);
                }
            }
        }
        
        request.updatedAt = new Date().toISOString();
        global.speed_requests[requestIndex] = request;
        saveSpeedRequests();
        
        return res.status(200).json({ 
            message: verified ? "Pembayaran berhasil diverifikasi dan speed boost diaktifkan." : "Pembayaran ditolak.",
            data: request
        });
    } catch (error) {
        console.error('[SPEED_PAYMENT_VERIFY_ERROR]', error);
        return res.status(500).json({ message: error.message || "Gagal memverifikasi pembayaran." });
    }
});

// POST /api/speed-requests/action
router.post('/speed-requests/action', ensureAdmin, async (req, res) => {
    const { requestId, action, notes } = req.body;
    if (!requestId || !action ) {
        return res.status(400).json({ message: "Parameter tidak lengkap. requestId dan action wajib diisi." });
    }
    const requestIndex = global.speed_requests.findIndex(r => r.id === requestId);
    if (requestIndex === -1) {
        return res.status(404).json({ message: "Permintaan tidak ditemukan." });
    }
    const request = global.speed_requests[requestIndex];
    if (request.status !== 'pending') {
        return res.status(400).json({ message: `Permintaan ini sudah dalam status '${request.status}' dan tidak dapat diubah lagi.` });
    }
    const adminUser = req.user;
    let notificationMessage = "";
    try {
        if (action === 'approve') {
            const user = global.users.find(u => u.id === request.userId);
            if (!user) throw new Error("User untuk permintaan ini tidak ditemukan.");
            const requestedPackage = global.packages.find(p => p.name === request.requestedPackageName);
            if (!requestedPackage || !requestedPackage.profile) throw new Error("Paket yang diminta atau profilnya tidak ditemukan.");
            const newProfile = requestedPackage.profile;
            console.log(`[SPEED_APPROVE] Menyetujui request ${requestId} untuk user ${user.name}. Mengubah profil ke ${newProfile}`);
            
            let durationInHours = 0;
            if (request.durationKey === '1_day') durationInHours = 24;
            else if (request.durationKey === '3_days') durationInHours = 72;
            else if (request.durationKey === '7_days') durationInHours = 168;
            if (durationInHours === 0) {
                throw new Error("Kunci durasi tidak valid pada permintaan.");
            }
            
            const now = new Date();
            const expirationDate = new Date(now.getTime() + durationInHours * 60 * 60 * 1000);
            
            // Prepare notification data (akan di-override oleh template jika enabled)
            let notificationData = {
                enabled: true,
                message: renderResponseTemplate('routes_speed_approval_customer_approved', {
                    customerName: user.name,
                    requestedPackage: request.requestedPackageName,
                    duration: request.durationKey.replace('_', ' ')
                })
            };
            
            // Try to use template if enabled
            try {
                const cronConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../database/cron.json'), 'utf8'));
                if (cronConfig.status_message_sod_applied === true && templatesCache.notificationTemplates['speed_on_demand_applied']) {
                    const locale = cronConfig.date_locale_for_notification || 'id-ID';
                    const dateOptions = cronConfig.date_options_for_notification || { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
                    const expirationDateFormatted = expirationDate.toLocaleString(locale, dateOptions);
                    
                    notificationData = {
                        enabled: true,
                        template: 'speed_on_demand_applied',
                        data: {
                            nama_pelanggan: user.name,
                            requestedPackageName: request.requestedPackageName,
                            expirationDate: expirationDateFormatted
                        }
                    };
                }
            } catch (e) {
                console.warn("[SPEED_ACTION_NOTIF] Could not read cron.json or render template, using default message.", e);
            }
            
            // Use ProfileUpdateService untuk apply profile update
            const profileUpdateResult = await ProfileUpdateService.applyProfileUpdate(
                user,
                newProfile,
                {
                    rebootRouter: false, // Speed On Demand biasanya tidak perlu reboot
                    disconnectSession: true,
                    skipOnError: false,
                    notification: notificationData,
                    context: 'SPEED_APPROVE'
                }
            );
            
            // Check if profile update berhasil
            if (!profileUpdateResult.success || profileUpdateResult.errors.length > 0) {
                throw new Error(profileUpdateResult.errors.join(', ') || 'Gagal mengubah profil Mikrotik');
            }
            
            // Update request status
            request.status = 'active';
            request.updatedAt = now.toISOString();
            request.approvedBy = adminUser.username;
            request.durationHours = durationInHours;
            request.expirationDate = expirationDate.toISOString();
            request.notes = notes || "";
            
            // Notification message sudah di-handle oleh service, set untuk fallback jika diperlukan
            notificationMessage = notificationData.message || renderResponseTemplate('routes_speed_approval_customer_approved', {
                customerName: user.name,
                requestedPackage: request.requestedPackageName,
                duration: request.durationKey.replace('_', ' ')
            });
        } else if (action === 'reject') {
            request.status = 'rejected';
            request.updatedAt = new Date().toISOString();
            request.approvedBy = adminUser.username;
            request.notes = notes || "Ditolak oleh admin.";
            const user = global.users.find(u => u.id === request.userId);
            notificationMessage = user ? renderResponseTemplate('routes_speed_approval_customer_rejected', {
                customerName: user.name,
                requestedPackage: request.requestedPackageName
            }) : '';
        } else {
            return res.status(400).json({ message: "Aksi tidak valid. Gunakan 'approve' atau 'reject'." });
        }
        global.speed_requests[requestIndex] = request;
        saveSpeedRequests();
        
        // Notification untuk approve sudah di-handle oleh ProfileUpdateService
        // Hanya perlu handle notification untuk reject
        if (action === 'reject' && notificationMessage) {
            const user = global.users.find(u => u.id === request.userId);
            if (user && user.phone_number) {
                const notificationData = {
                    enabled: true,
                    message: notificationMessage
                };
                
                try {
                    await ProfileUpdateService.applyProfileUpdate(
                        user,
                        null, // No profile change untuk reject, hanya kirim notification
                        {
                            rebootRouter: false,
                            disconnectSession: false,
                            skipOnError: true,
                            notification: notificationData,
                            context: 'SPEED_REJECT'
                        }
                    );
                } catch (e) {
                    // Notification error tidak critical untuk reject
                    console.warn(`[SPEED_REJECT_NOTIF] Failed to send notification:`, e.message);
                }
            }
        }
        return res.status(200).json({ message: `Permintaan berhasil di-${action === 'approve' ? 'setujui' : 'tolak'}.` });
    } catch (error) {
        console.error(`[API_SPEED_ACTION_ERROR] Gagal memproses permintaan ${requestId}:`, error);
        return res.status(500).json({ message: error.message || "Terjadi kesalahan internal server." });
    }
});

// Cleanup expired speed requests
router.post('/speed-requests/cleanup', ensureAdmin, (req, res) => {
    try {
        const { cleanupSpeedBoostRequests } = require('../lib/speed-boost-cleanup');
        const cleanedCount = cleanupSpeedBoostRequests();
        
        res.json({ 
            success: true,
            message: `Berhasil cleanup ${cleanedCount} speed boost request${cleanedCount !== 1 ? 's' : ''}`,
            cleanedCount: cleanedCount
        });
    } catch (error) {
        console.error('[SPEED_REQUESTS_CLEANUP_API_ERROR]', error);
        res.status(500).json({ 
            success: false,
            message: 'Gagal melakukan cleanup: ' + error.message 
        });
    }
});

// Speed Boost Configuration endpoints
router.get('/speed-boost-config', ensureAdmin, (req, res) => {
    try {
        const configPath = path.join(__dirname, '..', 'database', 'speed_boost_matrix.json');
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            res.json(config);
        } else {
            // Return default config if file doesn't exist
            const defaultConfig = {
                enabled: true,
                description: "Speed Boost pricing configuration matrix",
                lastUpdated: new Date().toISOString(),
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
                    cash: {
                        enabled: true,
                        label: "Bayar Tunai",
                        requireProof: false,
                        autoApprove: false
                    },
                    transfer: {
                        enabled: true,
                        label: "Transfer Bank",
                        requireProof: true,
                        autoApprove: false
                    },
                    double_billing: {
                        enabled: true,
                        label: "Double Billing",
                        requireProof: false,
                        autoApprove: true,
                        maxAmount: 500000
                    }
                },
                templates: {
                    welcomeMessage: "🚀 *SPEED BOOST ON DEMAND*\\n\\nTingkatkan kecepatan internet Anda sesuai kebutuhan!",
                    successMessage: "✅ Request Speed Boost berhasil dibuat!\\n\\nID: {requestId}\\nPaket: {packageName}\\nDurasi: {duration}\\nHarga: {price}",
                    rejectionMessage: "❌ Maaf, request Speed Boost Anda ditolak.\\n\\nAlasan: {reason}"
                }
            };
            res.json(defaultConfig);
        }
    } catch (error) {
        console.error('[SPEED_BOOST_CONFIG_ERROR]', error);
        res.status(500).json({ message: 'Gagal memuat konfigurasi' });
    }
});

router.post('/speed-boost-config', ensureAdmin, (req, res) => {
    try {
        const configPath = path.join(__dirname, '..', 'database', 'speed_boost_matrix.json');
        const config = req.body;
        
        // Validate config structure
        if (!config.globalSettings || !config.pricingMatrix || !config.paymentMethods) {
            return res.status(400).json({ message: 'Invalid configuration structure' });
        }
        
        // Save configuration
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        
        // Reload global speed boost config if exists
        if (global.speedBoostConfig) {
            global.speedBoostConfig = config;
        }
        
        res.json({ message: 'Konfigurasi berhasil disimpan', success: true });
    } catch (error) {
        console.error('[SPEED_BOOST_CONFIG_SAVE_ERROR]', error);
        res.status(500).json({ message: 'Gagal menyimpan konfigurasi' });
    }
});

module.exports = router;

