/**
 * Compensation Routes
 * 
 * Routes untuk Compensation (kompensasi gratis untuk pelanggan)
 * 
 * Endpoints:
 * - GET /api/compensations/active - Get all active compensations
 * - POST /api/compensation/apply - Apply compensation to customer(s)
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { saveCompensations } = require('../lib/database');
const { renderTemplate, templatesCache } = require('../lib/templating');
const { ProfileUpdateService } = require('../lib/services/profile-update-service');

// Middleware for admin-only routes
function ensureAdmin(req, res, next) {
    if (!req.user || !['admin', 'owner', 'superadmin'].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak. Hanya peran tertentu yang diizinkan." });
    }
    next();
}

// GET /api/compensations/active
router.get('/compensations/active', ensureAdmin, async (req, res) => {
    try {
        const activeCompensations = global.compensations.filter(comp => comp.status === 'active');
        const detailedActiveCompensations = activeCompensations.map(comp => {
            const user = global.users.find(u => u.id.toString() === comp.userId.toString());
            return {
                compensationId: comp.id,
                userId: comp.userId,
                userName: user ? user.name : 'User Tidak Ditemukan',
                pppoeUsername: user ? user.pppoe_username : comp.pppoeUsername,
                originalProfile: comp.originalProfile,
                compensatedProfile: comp.compensatedProfile,
                startDate: comp.startDate,
                endDate: comp.endDate,
                durationDays: comp.durationDays,
                durationHours: comp.durationHours,
                durationMinutes: comp.durationMinutes || 0,
                notes: comp.notes,
                processedBy: comp.processedBy
            };
        }).sort((a, b) => new Date(b.startDate) - new Date(a.startDate));

        return res.status(200).json({
            message: "Data kompensasi aktif berhasil diambil.",
            data: detailedActiveCompensations
        });

    } catch (error) {
        console.error("[API_COMPENSATIONS_ACTIVE_ERROR] Gagal mengambil daftar kompensasi aktif:", error);
        return res.status(500).json({ message: "Terjadi kesalahan internal server saat mengambil data." });
    }
});

// POST /api/compensation/apply
router.post('/compensation/apply', ensureAdmin, async (req, res) => {
    const { customerIds, speedProfile, durationDays, durationHours, durationMinutes, notes } = req.body;
    if (!customerIds || !Array.isArray(customerIds) || customerIds.length === 0) {
        return res.status(400).json({ message: "Parameter 'customerIds' (array) diperlukan dan tidak boleh kosong." });
    }
    if (!speedProfile) {
        return res.status(400).json({ message: "Parameter 'speedProfile' (profil Mikrotik baru) diperlukan." });
    }
    const parsedDurationDays = parseInt(durationDays || 0);
    const parsedDurationHours = parseInt(durationHours || 0);
    const parsedDurationMinutes = parseInt(durationMinutes || 0);
    if (isNaN(parsedDurationDays) || parsedDurationDays < 0) {
        return res.status(400).json({ message: "Parameter 'durationDays' harus angka non-negatif." });
    }
    if (isNaN(parsedDurationHours) || parsedDurationHours < 0 || parsedDurationHours >= 24) {
        return res.status(400).json({ message: "Parameter 'durationHours' harus angka antara 0 dan 23." });
    }
    if (isNaN(parsedDurationMinutes) || parsedDurationMinutes < 0 || parsedDurationMinutes >= 60) {
        return res.status(400).json({ message: "Parameter 'durationMinutes' harus angka antara 0 dan 59." });
    }
    if (parsedDurationDays === 0 && parsedDurationHours === 0 && parsedDurationMinutes === 0) {
        return res.status(400).json({ message: "Total durasi kompensasi (hari, jam, atau menit) harus lebih dari 0." });
    }
    
    let notificationConfig;
    try {
        notificationConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../database/cron.json'), 'utf8'));
    } catch (e) {
        console.error("[KOMPENSASI_APPLY_ERROR] Gagal membaca konfigurasi (cron.json) untuk notifikasi:", e);
        notificationConfig = { status_message_compensation_applied_user: false, message_compensation_applied_user: "", date_locale_for_notification: "id-ID", date_options_for_notification: { weekday: "long", year: "numeric", month: "long", day: "numeric" } };
    }
    
    const processedBy = req.user.username || req.user.id;
    const overallResults = [];
    let anyOperationFailedCritically = false;
    
    for (const userId of customerIds) {
        const user = global.users.find(u => u.id.toString() === userId.toString());
        let userResult = { userId, pppoeUsername: user ? (user.pppoe_username || 'N/A') : 'N/A', status: 'pending', details: [] };
        
        if (!user) {
            userResult.status = 'error_critical';
            userResult.details.push(`Pelanggan dengan ID ${userId} tidak ditemukan.`);
            anyOperationFailedCritically = true;
            overallResults.push(userResult);
            continue;
        }
        
        userResult.pppoeUsername = user.pppoe_username || 'N/A';
        if (!user.pppoe_username) {
            userResult.status = 'error_critical';
            userResult.details.push(`Pelanggan ${user.name} (ID: ${userId}) tidak memiliki username PPPoE.`);
            anyOperationFailedCritically = true;
            overallResults.push(userResult);
            continue;
        }
        
        const userPackageName = user.subscription;
        if (!userPackageName) {
            userResult.status = 'error_critical';
            userResult.details.push(`Pelanggan ${user.name} tidak memiliki paket langganan (user.subscription) yang terdefinisi.`);
            anyOperationFailedCritically = true;
            console.warn(`[KOMPENSASI_WARN] Pelanggan ${user.name} (ID: ${userId}) tidak memiliki 'subscription'.`);
            overallResults.push(userResult);
            continue;
        }
        
        const subscribedPackage = global.packages.find(pkg => pkg.name === userPackageName);
        if (!subscribedPackage || !subscribedPackage.profile) {
            userResult.status = 'error_critical';
            userResult.details.push(`Paket langganan '${userPackageName}' untuk pelanggan ${user.name} tidak ditemukan di packages.json atau tidak memiliki properti 'profile' (nama profil Mikrotik).`);
            anyOperationFailedCritically = true;
            console.warn(`[KOMPENSASI_WARN] Paket '${userPackageName}' untuk ${user.name} tidak ditemukan atau tidak ada 'profile' di packages.json.`);
            overallResults.push(userResult);
            continue;
        }
        
        const originalProfile = subscribedPackage.profile;
        const existingActiveCompensation = global.compensations.find(comp => comp.userId === userId.toString() && comp.status === 'active');
        if (existingActiveCompensation) {
            userResult.status = 'error_critical';
            userResult.details.push(`Pelanggan ${user.name} sudah memiliki kompensasi aktif. Selesaikan atau tunggu hingga berakhir.`);
            anyOperationFailedCritically = true;
            console.warn(`[KOMPENSASI_WARN] Pelanggan ${user.name} (ID: ${userId}) sudah memiliki kompensasi aktif.`);
            overallResults.push(userResult);
            continue;
        }
        
        const startDate = new Date();
        const endDate = new Date(startDate);
        if (parsedDurationDays > 0) {
            endDate.setDate(startDate.getDate() + parsedDurationDays);
        }
        if (parsedDurationHours > 0) {
            endDate.setHours(startDate.getHours() + parsedDurationHours);
        }
        if (parsedDurationMinutes > 0) {
            endDate.setMinutes(startDate.getMinutes() + parsedDurationMinutes);
        }
        
        const newCompensationId = `comp_${Date.now()}_${userId}`;
        const compensationEntry = {
            id: newCompensationId,
            userId: userId.toString(),
            pppoeUsername: user.pppoe_username,
            originalProfile: originalProfile,
            compensatedProfile: speedProfile,
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
            durationDays: parsedDurationDays,
            durationHours: parsedDurationHours,
            durationMinutes: parsedDurationMinutes,
            notes: notes || "",
            status: "pending_apply",
            processedBy,
            createdAt: new Date().toISOString()
        };
        
        // Prepare notification data jika enabled
        let notificationData = null;
        if (notificationConfig.status_message_compensation_applied === true && templatesCache.notificationTemplates['compensation_applied']) {
            let durasiLengkapStr = "";
            if (parsedDurationDays > 0) {
                durasiLengkapStr += `${parsedDurationDays} hari`;
            }
            if (parsedDurationHours > 0) {
                if (parsedDurationDays > 0) durasiLengkapStr += " ";
                durasiLengkapStr += `${parsedDurationHours} jam`;
            }
            if (parsedDurationMinutes > 0) {
                if (parsedDurationDays > 0 || parsedDurationHours > 0) durasiLengkapStr += " ";
                durasiLengkapStr += `${parsedDurationMinutes} menit`;
            }
            if (durasiLengkapStr === "") durasiLengkapStr = "Durasi tidak valid";
            
            const locale = notificationConfig.date_locale_for_notification || 'id-ID';
            const dateOptions = notificationConfig.date_options_for_notification || { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' };
            
            notificationData = {
                enabled: true,
                template: 'compensation_applied',
                data: {
                    nama_pelanggan: user.name,
                    profileBaru: global.packages.find(p => p.profile === speedProfile)?.name || speedProfile,
                    durasiLengkap: durasiLengkapStr,
                    tanggalAkhir: endDate.toLocaleDateString(locale, dateOptions)
                }
            };
        }
        
        // Use ProfileUpdateService untuk apply profile update
        try {
            const profileUpdateResult = await ProfileUpdateService.applyProfileUpdate(
                user,
                speedProfile,
                {
                    rebootRouter: true,
                    disconnectSession: true,
                    skipOnError: false, // Throw error untuk single user operations
                    notification: notificationData || { enabled: false },
                    context: 'COMPENSATION_APPLY'
                }
            );
            
            // Update userResult dengan result dari service
            userResult.details.push(...profileUpdateResult.details);
            
            // Handle warnings
            if (profileUpdateResult.warnings.length > 0) {
                userResult.details.push(...profileUpdateResult.warnings.map(w => `Warning: ${w}`));
                if (userResult.status !== 'error_critical') {
                    userResult.status = 'warning_partial';
                }
            }
            
            // Handle errors
            if (profileUpdateResult.errors.length > 0) {
                userResult.status = 'error_critical';
                userResult.details.push(...profileUpdateResult.errors);
                anyOperationFailedCritically = true;
            } else if (profileUpdateResult.success) {
                // Profile update berhasil, update compensation entry status
                compensationEntry.status = "active";
                global.compensations.push(compensationEntry);
                
                if (userResult.status === 'pending') {
                    userResult.status = 'success';
                }
            }
        } catch (mikrotikError) {
            const errMsg = `Gagal mengubah profil Mikrotik: ${mikrotikError.message || mikrotikError}`;
            console.error(`[KOMPENSASI_APPLY_ERROR] [User: ${user.name}] ${errMsg}`);
            userResult.status = 'error_critical';
            userResult.details.push(errMsg);
            anyOperationFailedCritically = true;
        }
        overallResults.push(userResult);
    }
    
    saveCompensations();
    const allSucceeded = overallResults.every(r => r.status === 'success' && r.details.every(d => !d.toLowerCase().includes('gagal') && !d.toLowerCase().includes('warning')));
    const someSucceededOrPartial = overallResults.some(r => r.status === 'success' || r.status === 'warning_partial');
    if (allSucceeded && overallResults.length > 0) {
        return res.status(200).json({ message: "Semua kompensasi berhasil diproses sepenuhnya.", details: overallResults });
    } else if (someSucceededOrPartial && overallResults.length > 0) {
        return res.status(207).json({ message: "Beberapa operasi kompensasi mungkin menghasilkan warning atau ada yang gagal.", details: overallResults });
    } else if (overallResults.length > 0) {
        return res.status(400).json({ message: "Semua operasi kompensasi gagal atau ada masalah validasi.", details: overallResults });
    } else {
        return res.status(400).json({ message: "Tidak ada pelanggan yang diproses atau customerIds kosong.", details: overallResults });
    }
});

module.exports = router;
