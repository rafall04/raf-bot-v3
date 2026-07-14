/**
 * Header Doc
 * Purpose: Factory route API pengguna untuk CRUD pelanggan, billing, paket, welcome flow, sinkronisasi operasional, dan import/export Excel pelanggan dengan preview validasi.
 * Caller: `routes/api.js` melalui dependency injection.
 * Deps: `express`, `multer`, dependency manager domain users, `../lib/error-handler`, `../lib/whatsapp-delivery-service`, `../lib/whatsapp-gateway`, dan `../lib/whatsapp-bootstrap`.
 * MainFuncs: `createApiUsersRouter`.
 * SideEffects: Membaca/menulis data pelanggan, memanggil integrasi jaringan, membentuk file Excel di memory, memproses upload workbook, dan mengirim welcome message pelanggan.
 */
const express = require('express');
const multer = require('multer');
const { sendMessage } = require('../lib/whatsapp-delivery-service');
const { getStatusSnapshot, hasAuthenticatedSession } = require('../lib/whatsapp-gateway');
const { triggerWhatsAppReconnect } = require('../lib/whatsapp-bootstrap');
const { asyncHandler, createError, ErrorTypes } = require('../lib/error-handler');
const { createApiUsersRepository } = require('../repositories/api-users.repository');
const { createApiUsersService } = require('../services/api-users.service');
const { logWifiChange } = require('../lib/wifi-logger');

function createApiUsersRouter(deps) {
    const {
        hashPassword,
        comparePassword,
        updatePPPoEProfile,
        deleteActivePPPoEUser,
        removePPPoESecret,
        addPPPoEUser,
        checkPPPoEUserExists: _checkPPPoEUserExists,
        assertMikrotikResult,
        isMikrotikSyncEnabled,
        getProfileBySubscription,
        handlePaidStatusChange,
        getPeriodParts,
        applyPaymentStatusChange,
        getEffectivePrice,
        normalizeUserPaymentMethod,
        getNextAvailableUserId,
        validatePhoneNumbers,
        normalizePhone: _normalizePhone,
        getSupportedCountries,
        renderTemplate,
        templatesCache: _templatesCache,
        savePackage,
        saveAccounts: _saveAccounts,
        loadJSON: _loadJSON,
        saveJSON: _saveJSON,
        updateOdpPortUsage: _updateOdpPortUsage,
        updateOdcPortUsage: _updateOdcPortUsage,
        saveNetworkAssets,
        logActivity,
        ensureAuthenticated,
        ensureAdmin,
        buildMikrotikSyncResult,
    } = deps;

    const router = express.Router();

    function getRuntime() {
        return deps.runtime || global.__appRuntime || null;
    }

    function getRuntimeStateValue(key, fallbackValue) {
        const runtime = getRuntime();
        if (runtime?.state?.has?.(key)) {
            return runtime.state.get(key);
        }
        if (typeof global[key] !== 'undefined') {
            return global[key];
        }
        return fallbackValue;
    }

    function getUsersRepo() {
        return getRuntime()?.repositories?.users || null;
    }

    function getPackagesRepo() {
        return getRuntime()?.repositories?.packages || null;
    }

    function getAccountsRepo() {
        return getRuntime()?.repositories?.accounts || null;
    }

    function getNetworkAssetsRepo() {
        return getRuntime()?.repositories?.networkAssets || null;
    }

    function getUsers() {
        return getUsersRepo()?.getAll() || getRuntimeStateValue('users', []);
    }



    function getPackages() {
        return getPackagesRepo()?.getAll() || getRuntimeStateValue('packages', []);
    }

    function updatePackages(updater) {
        const packagesRepo = getPackagesRepo();
        if (packagesRepo) {
            return packagesRepo.update(updater);
        }
        const nextPackages = typeof updater === 'function' ? updater(getPackages()) : updater;
        global['packages'] = nextPackages;
        return nextPackages;
    }




    function getConfig() {
        return getRuntime()?.getConfig?.() || getRuntimeStateValue('config', {}) || {};
    }

    function getDb() {
        return getRuntime()?.getDb?.() || getRuntimeStateValue('db', null);
    }

    const apiUsersRepository = createApiUsersRepository({
        runtime: getRuntime()
    });
    const apiUsersService = createApiUsersService({
        repository: apiUsersRepository,
        applyPaymentStatusChange,
        handlePaidStatusChange,
        getPeriodParts,
        getEffectivePrice,
        normalizeUserPaymentMethod,
        deleteActivePPPoEUser,
        removePPPoESecret,
        syncPortUsage: require("../lib/network-assets-service").syncPortUsage,
        saveNetworkAssets,
        comparePassword,
        logActivity,
        validatePhoneNumbers,
        getDb,
        getProfileBySubscription,
        isMikrotikSyncEnabled,
        buildMikrotikSyncResult,
        assertMikrotikResult,
        updatePPPoEProfile,
        getNextAvailableUserId,
        hashPassword,
        addPPPoEUser,
        getConfig,
        getPackages,
        renderTemplate,
        sendMessage,
        getStatusSnapshot,
        logWifiChange,
        logger: console
    });

    // Expose service ini untuk reuse DI LUAR HTTP (mis. handler intake PSB grup di message layer).
    // Sudah membawa SEMUA deps create/provision/welcome — JANGAN rakit ulang di tempat lain.
    try {
        const rt = getRuntime();
        if (rt) rt.apiUsersService = apiUsersService;
        global.__apiUsersService = apiUsersService;
    } catch (_e) { /* noop */ }

    const excelUpload = multer({
        storage: multer.memoryStorage(),
        limits: {
            fileSize: 5 * 1024 * 1024
        },
        fileFilter(req, file, callback) {
            const originalName = file?.originalname || '';
            const isExcelFile = /\.(xlsx|xls)$/i.test(originalName);
            if (!isExcelFile) {
                callback(createError(ErrorTypes.VALIDATION_ERROR, 'File harus berformat .xlsx atau .xls.', 400));
                return;
            }
            callback(null, true);
        }
    });

    function runExcelUpload(req, res, next) {
        excelUpload.single('excel_file')(req, res, next);
    }

 // GET /api/users - Get all users
 router.get('/users', ensureAuthenticated, (req, res) => {
     try {
         apiUsersService.listUsersWithIntegrityCheck()
             .then((result) => res.status(result.status).json(result.body))
             .catch((error) => {
                 console.error('[GET_USERS_ERROR]', error);
                 return res.status(500).json({
                     status: 500,
                     message: "Terjadi kesalahan saat memuat data pengguna",
                     error: error.message
                 });
             });
     } catch (error) {
         console.error('[GET_USERS_ERROR]', error);
         return res.status(500).json({
             status: 500,
             message: "Terjadi kesalahan saat memuat data pengguna",
             error: error.message
         });
     }
 });

 // GET /api/users/excel/template - Download official Excel template
 router.get('/users/excel/template', ensureAdmin, asyncHandler(async (req, res) => {
     const result = await apiUsersService.buildUsersExcelTemplate();
     res.setHeader('Content-Type', result.contentType);
     res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
     res.setHeader('Content-Length', Buffer.byteLength(result.buffer));
     res.end(result.buffer);
 }));

 // GET /api/users/excel/export - Export current users snapshot to Excel
 router.get('/users/excel/export', ensureAdmin, asyncHandler(async (req, res) => {
     const result = await apiUsersService.exportUsersToExcel();
     res.setHeader('Content-Type', result.contentType);
     res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
     res.setHeader('Content-Length', Buffer.byteLength(result.buffer));
     res.end(result.buffer);
 }));

 // POST /api/users/excel/import - Validate preview or commit import users from Excel
 router.post('/users/excel/import', ensureAdmin, runExcelUpload, asyncHandler(async (req, res) => {
     if (!req.file?.buffer) {
         throw createError(ErrorTypes.VALIDATION_ERROR, 'File Excel wajib diunggah sebelum preview/import.', 400);
     }

     const result = await apiUsersService.importUsersFromExcel({
         buffer: req.file.buffer,
         originalName: req.file.originalname,
         mode: req.query.mode || req.body?.mode || 'validate',
         actor: req.user,
         requestMeta: {
             ipAddress: req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'],
             userAgent: req.headers['user-agent']
         }
     });

     return res.status(result.status).json(result.body);
 }));

 // POST /api/users/update - Update user payment status
 router.post('/users/update', ensureAdmin, async (req, res) => {
     try {
         const result = await apiUsersService.updateUserPaymentStatus({
             id: req.body.id,
             paid: req.body.paid,
             paymentMethodInput: req.body.payment_method,
             username: req.user.username
         });

         return res.status(result.status).json(result.body);
     } catch (error) {
         console.error('[USER_UPDATE_ERROR]', error);
         return res.status(500).json({
             status: 500,
             message: "Terjadi kesalahan saat memperbarui data",
             error: error.message
         });
     }
 });

 // POST /api/users - Create or update user
 router.post('/users', ensureAdmin, async (req, res) => {
     try {
         const result = await apiUsersService.upsertUserFromAdminPanel({
             userData: req.body,
             actor: req.user,
             requestMeta: {
                 ipAddress: req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'],
                 userAgent: req.headers['user-agent']
             }
         });

         return res.status(result.status).json(result.body);
         
     } catch (error) {
         console.error('[API_USERS_POST_ERROR]', error);
         return res.status(500).json({
             status: 500,
             message: 'Terjadi kesalahan saat menyimpan data user',
             error: error.message
         });
     }
 });

 // POST /api/users/:id/send-welcome - Kirim (ulang) pesan "selamat datang" ke pelanggan.
// Dipakai mis. setelah No HP diisi untuk pelanggan yang dibuat tanpa HP (welcome CREATE terlewat).
router.post('/users/:id/send-welcome', ensureAdmin, async (req, res) => {
    try {
        const result = await apiUsersService.sendWelcomeToUser({ id: req.params.id });
        return res.status(result.status).json(result.body);
    } catch (error) {
        console.error('[API_USERS_SEND_WELCOME_ERROR]', error);
        return res.status(500).json({ status: 500, message: 'Gagal mengirim pesan selamat datang', error: error.message });
    }
});

 // POST /api/users/bulk-change-profile - Bulk change MikroTik profile for users with specific package
// IMPORTANT: This route MUST be defined BEFORE /users/:id to avoid route conflict
// Also updates the package configuration to sync the new profile
router.post('/users/bulk-change-profile', ensureAdmin, async (req, res) => {
    try {
        const { packageName, targetProfile } = req.body;
        const syncEnabled = isMikrotikSyncEnabled();
        
        // Validate input
        if (!packageName || !targetProfile) {
            return res.status(400).json({
                status: 400,
                message: 'Nama paket dan profil tujuan harus diisi'
            });
        }
        
        // Find all users with matching subscription AND pppoe_username
        const affectedUsers = getUsers().filter(u => 
            u.subscription === packageName && u.pppoe_username
        );
        
        if (affectedUsers.length === 0) {
            return res.json({
                status: 200,
                message: `Tidak ada pelanggan dengan paket "${packageName}" yang memiliki PPPoE username`,
                successCount: 0,
                failedCount: 0
            });
        }
        
        // Get old profile from package config for logging
        const packageConfig = getPackages().find(p => p.name === packageName);
        const oldProfile = packageConfig ? packageConfig.profile : null;
        
        console.log(`[BULK_CHANGE_PROFILE] Starting bulk profile change for package "${packageName}"`);
        console.log(`[BULK_CHANGE_PROFILE] Old profile: ${oldProfile} → New profile: ${targetProfile}`);
        console.log(`[BULK_CHANGE_PROFILE] Affected users: ${affectedUsers.length}`);
        
        let successCount = 0;
        let failedCount = 0;
        const errors = [];
        let syncStatus = syncEnabled ? 'applied' : 'applied_locally_sync_disabled';
        let syncMessage = syncEnabled
            ? 'Profile MikroTik berhasil disinkronkan.'
            : 'Sinkronisasi MikroTik dinonaktifkan. Konfigurasi paket hanya diperbarui lokal.';
        
        // Process each user - update MikroTik profile if sync policy allows it
        for (const user of affectedUsers) {
            if (!syncEnabled) {
                successCount++;
                continue;
            }

            try {
                assertMikrotikResult(
                    await updatePPPoEProfile(user.pppoe_username, targetProfile, { caller: 'api.bulk-change-profile' })
                );
                
                successCount++;
                console.log(`[BULK_CHANGE_PROFILE] Success: ${user.pppoe_username} (${user.name})`);
                
            } catch (error) {
                failedCount++;
                syncStatus = 'failed_sync';
                syncMessage = 'Sebagian atau seluruh profile MikroTik gagal diubah. Konfigurasi paket tidak diubah otomatis.';
                errors.push({
                    userId: user.id,
                    username: user.pppoe_username,
                    name: user.name,
                    error: error.message
                });
                console.error(`[BULK_CHANGE_PROFILE] Failed: ${user.pppoe_username} - ${error.message}`);
            }
        }
        
        // Update package configuration to sync the new profile
        let packageUpdated = false;
        if (packageConfig && successCount > 0 && failedCount === 0) {
            try {
                // Update in memory
                const nextPackages = updatePackages((currentPackages) => currentPackages.map((pkg) => (
                    pkg.name === packageName ? { ...pkg, profile: targetProfile } : pkg
                )));
                
                // Save to packages.json
                await savePackage(nextPackages);
                packageUpdated = true;
                console.log(`[BULK_CHANGE_PROFILE] Package "${packageName}" profile updated to "${targetProfile}" in packages.json`);
            } catch (saveError) {
                console.error(`[BULK_CHANGE_PROFILE] Failed to update packages.json:`, saveError);
            }
        }
        
        // Log activity
        try {
            await logActivity({
                userId: req.user.id,
                username: req.user.username,
                role: req.user.role,
                actionType: 'UPDATE',
                resourceType: 'user',
                resourceId: 'bulk',
                resourceName: `Bulk Profile Change: ${packageName}`,
                description: `Bulk changed MikroTik profile for package "${packageName}" from "${oldProfile}" to "${targetProfile}" for ${successCount} users (${failedCount} failed). Package config ${packageUpdated ? 'updated' : 'not updated'}.`,
                oldValue: { package: packageName, profile: oldProfile, affectedCount: affectedUsers.length },
                newValue: {
                    targetProfile,
                    successCount,
                    failedCount,
                    packageUpdated,
                    sync_policy: syncEnabled ? 'enabled' : 'disabled',
                    sync_status: failedCount > 0 ? 'failed_sync' : syncStatus,
                    sync_message: syncMessage
                },
                ipAddress: req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'],
                userAgent: req.headers['user-agent']
            });
        } catch (logErr) {
            console.error('[BULK_CHANGE_PROFILE] Activity log error:', logErr);
        }
        
        console.log(`[BULK_CHANGE_PROFILE] Completed: ${successCount} success, ${failedCount} failed, package updated: ${packageUpdated}`);
        
        return res.json({
            status: 200,
            message: `Berhasil mengubah profil ${successCount} pelanggan${failedCount > 0 ? `, ${failedCount} gagal` : ''}${packageUpdated ? '. Konfigurasi paket juga diperbarui.' : ''}`,
            successCount,
            failedCount,
            packageUpdated,
            oldProfile,
            newProfile: targetProfile,
            sync_policy: syncEnabled ? 'enabled' : 'disabled',
            sync_status: failedCount > 0 ? 'failed_sync' : syncStatus,
            sync_message: syncMessage,
            mikrotik_sync: buildMikrotikSyncResult(failedCount > 0 ? 'failed_sync' : syncStatus, syncMessage),
            errors: errors.length > 0 ? errors : undefined
        });
        
    } catch (error) {
        console.error('[BULK_CHANGE_PROFILE_ERROR]', error);
        return res.status(500).json({
            status: 500,
            message: 'Gagal melakukan perubahan profil massal',
            error: error.message
        });
    }
});

// POST /api/users/:id - Update existing user
router.post('/users/:id', ensureAdmin, async (req, res) => {
    try {
        const result = await apiUsersService.updateUserById({
            id: req.params.id,
            userData: req.body,
            actor: req.user,
            requestMeta: {
                ipAddress: req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'],
                userAgent: req.headers['user-agent']
            }
        });

        return res.status(result.status).json(result.body);
        
    } catch (error) {
        console.error('[API_USERS_UPDATE_ERROR]', error);
        return res.status(500).json({
            status: 500,
            message: 'Terjadi kesalahan saat memperbarui user',
            error: error.message
        });
    }
});

// GET /api/supported-countries - Get list of supported phone countries
router.get('/supported-countries', (req, res) => {
    const countries = getSupportedCountries();
    return res.json({
        status: 200,
        message: 'Supported countries for phone validation',
        data: countries,
        note: 'Any international format with + is also supported'
    });
});

// DELETE /api/users/:id - Delete a user
router.delete('/users/:id', ensureAdmin, async (req, res) => {
    try {
        const result = await apiUsersService.deleteUserById({
            userId: req.params.id,
            actor: req.user,
            requestMeta: {
                ipAddress: req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'],
                userAgent: req.headers['user-agent']
            }
        });

        return res.status(result.status).json(result.body);
        
    } catch (error) {
        console.error('[API_USERS_DELETE_ERROR]', error);
        return res.status(500).json({
            status: 500,
            message: 'Terjadi kesalahan saat menghapus user',
            error: error.message
        });
    }
});

// POST /api/users/delete-all - Delete all users
router.post('/users/delete-all', ensureAdmin, async (req, res) => {
    try {
        const result = await apiUsersService.deleteAllUsers({
            password: req.body.password,
            actor: req.user
        });

        return res.status(result.status).json(result.body);
        
    } catch (error) {
        console.error('[API_USERS_DELETE_ALL_ERROR]', error);
        return res.status(500).json({
            status: 500,
            message: 'Terjadi kesalahan saat menghapus semua user',
            error: error.message
        });
    }
});

// GET /api/start - Start WhatsApp connection
router.get('/start', ensureAdmin, async (req, res) => {
    try {
        if (hasAuthenticatedSession()) {
            return res.json({
                status: 200,
                message: 'WhatsApp sudah terhubung'
            });
        }
        
        try {
            await triggerWhatsAppReconnect();
            return res.json({
                status: 200,
                message: 'Memulai koneksi WhatsApp...'
            });
        } catch (runtimeError) {
            return res.status(500).json({
                status: 500,
                message: runtimeError.message || 'Fungsi connect tidak tersedia'
            });
        }
    } catch (error) {
        console.error('[API_START_ERROR]', error);
        return res.status(500).json({
            status: 500,
            message: 'Terjadi kesalahan saat memulai koneksi WhatsApp',
            error: error.message
        });
    }
});

    return router;
}

module.exports = createApiUsersRouter;
