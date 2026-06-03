const express = require('express');
const crypto = require('crypto');
const { hashPassword } = require('../lib/password');
const { renderTemplate, templatesCache } = require('../lib/templating');
const { normalizePhoneNumber } = require('../lib/utils');
const { logActivity } = require('../lib/activity-logger');
const { updatePPPoEProfile, deleteActivePPPoEUser, getPPPoEUserProfile, getAllPPPoESecrets, assertMikrotikResult, isMikrotikSyncEnabled } = require('../lib/mikrotik');
const { getProfileBySubscription } = require('../lib/myfunc');
const { rebootRouter } = require('../lib/wifi');
const { sendMessageToMany } = require('../lib/whatsapp-delivery-service');
const { hasAuthenticatedSession, getConnectionState } = require('../lib/whatsapp-gateway');
const {
    queryDevices,
    extractPppoeUsername,
    extractSerialNumber,
    extractDeviceModel,
} = require('../lib/genieacs');
const IsolirService = require('../lib/services/isolir-service');

const router = express.Router();

// Middleware for admin-only routes
function ensureAdmin(req, res, next) {
    if (!req.user || !['admin', 'owner', 'superadmin'].includes(req.user.role)) {
        return res.status(403).json({ status: 403, message: "Akses ditolak." });
    }
    next();
}

// GET /api/users/search - Search users by name or ID
router.get('/search', ensureAdmin, (req, res) => {
    const { q, limit = 10 } = req.query;
    
    if (!q || q.trim().length < 2) {
        return res.json({ status: 200, data: [] });
    }
    
    const query = q.trim().toLowerCase();
    const maxLimit = Math.min(parseInt(limit) || 10, 50);
    
    const results = global.users
        .filter(user => {
            const nameMatch = user.name?.toLowerCase().includes(query);
            const idMatch = String(user.id).includes(query);
            const pppoeMatch = user.pppoe_username?.toLowerCase().includes(query);
            const phoneMatch = user.phone_number?.includes(query);
            return nameMatch || idMatch || pppoeMatch || phoneMatch;
        })
        .slice(0, maxLimit)
        .map(user => ({
            id: user.id,
            name: user.name,
            subscription: user.subscription,
            subscription_price: user.subscription_price,
            pppoe_username: user.pppoe_username,
            phone_number: user.phone_number,
            paid: user.paid,
            address: user.address
        }));
    
    res.json({ status: 200, data: results });
});

// POST /api/users/:id/credentials
router.post('/:id/credentials', ensureAdmin, async (req, res) => {
    const { id } = req.params;
    const { username: newUsername, password: newPassword } = req.body;

    const userToUpdate = global.users.find(v => String(v.id) === String(id));
    if (!userToUpdate) {
        return res.status(404).json({ status: 404, message: "Pengguna tidak ditemukan." });
    }

    try {
        let finalUsername = userToUpdate.username;
        let plainTextPassword = '';

        // Handle username update
        if (newUsername && newUsername.trim() !== '' && newUsername.trim() !== userToUpdate.username) {
            const existingUser = global.users.find(u => u.username === newUsername.trim() && String(u.id) !== String(id));
            if (existingUser) {
                return res.status(409).json({ status: 409, message: `Username "${newUsername}" sudah digunakan oleh pelanggan lain (${existingUser.name}).` });
            }
            finalUsername = newUsername.trim();
        } else if (!finalUsername || finalUsername.trim() === '') {
            // Generate username if it doesn't exist
            const nameParts = userToUpdate.name.toLowerCase().split(' ').filter(Boolean);
            let baseUsername = nameParts[0];
            if (nameParts.length > 1) {
                baseUsername += `.${nameParts[1].charAt(0)}`;
            }
            let counter = 1;
            finalUsername = baseUsername;
            while (global.users.some(u => u.username === finalUsername && String(u.id) !== String(id))) {
                counter++;
                finalUsername = `${baseUsername}${counter}`;
            }
        }

        // Handle password
        if (newPassword && newPassword.trim() !== '') {
            plainTextPassword = newPassword;
        } else {
            plainTextPassword = crypto.randomBytes(4).toString('hex');
        }

        const hashedPassword = await hashPassword(plainTextPassword);

        const sql = `UPDATE users SET username = ?, password = ? WHERE id = ?`;
        const params = [finalUsername, hashedPassword, id];

        await new Promise((resolve, reject) => {
            global.db.run(sql, params, function (err) {
                if (err) {
                    console.error("[DB_UPDATE_CREDS_ERROR]", err.message);
                    return reject(new Error("Gagal memperbarui kredensial pengguna di database."));
                }
                resolve();
            });
        });

        // Update in-memory data
        userToUpdate.username = finalUsername;
        userToUpdate.password = hashedPassword;

        // Send notification
        if (hasAuthenticatedSession() && templatesCache.notificationTemplates?.customer_welcome) {
            // PENTING: Ambil portal_url dari config (sama seperti saat create user baru)
            const portalUrl = global.config.welcomeMessage?.customerPortalUrl || global.config.company?.website || global.config.site_url_bot || 'https://rafnet.my.id/customer';
            
            const templateData = {
                nama_pelanggan: userToUpdate.name,
                username: finalUsername,
                password: plainTextPassword,
                portal_url: portalUrl, // PENTING: Tambahkan portal_url untuk template
                nama_wifi: global.config.nama || global.config.nama_wifi || 'Layanan Kami',
                nama_bot: global.config.namabot || global.config.botName || 'RAF NET BOT' // PENTING: Tambahkan nama_bot untuk template
            };
            const messageText = renderTemplate('customer_welcome', templateData);
            
            if (userToUpdate.phone_number) {
                const recipients = userToUpdate.phone_number.split('|').map(p => p.trim()).filter(Boolean);
                const delivery = await sendMessageToMany(recipients, { text: messageText });
                if (delivery.sent) {
                    console.log(`[CREDENTIAL_NOTIF_SUCCESS] Credentials sent to ${delivery.successCount} recipient(s)`);
                } else {
                    console.warn('[CREDENTIAL_NOTIF_SKIP] Credentials notification not sent', {
                        errorCode: delivery.errorCode
                    });
                }
            } else {
                if (getConnectionState() !== 'open') {
                    console.warn('[CREDENTIAL_NOTIF_SKIP] WhatsApp not connected, skipping send to', userToUpdate.phone_number);
                }
            }
        }

        return res.status(200).json({
            status: 200,
            message: "Kredensial berhasil dibuat/diperbarui.",
            generated_credentials: {
                username: finalUsername,
                password: plainTextPassword
            }
        });

    } catch (error) {
        console.error(`[USER_CREDENTIALS_ERROR] Failed to process credentials for user ${id}:`, error);
        return res.status(500).json({ status: 500, message: `Operasi gagal: ${error.message}` });
    }
});

// POST /api/users/bulk-import - Bulk import users from MikroTik data
router.post('/bulk-import', ensureAdmin, async (req, res) => {
    try {
        const { users: usersToImport, defaultSettings } = req.body;
        
        if (!usersToImport || !Array.isArray(usersToImport) || usersToImport.length === 0) {
            return res.status(400).json({
                status: 400,
                message: 'Tidak ada data user untuk di-import'
            });
        }
        
        // Default settings (bulk is now per-user, fallback to default if not provided)
        const settings = {
            defaultBulk: defaultSettings?.bulk || ['1', '5'], // Default: SSID 1 + 5 (dual band)
            paid: defaultSettings?.paid || false,
            send_invoice: defaultSettings?.send_invoice !== false,
            send_psb_welcome: defaultSettings?.send_psb_welcome || false
        };
        
        const results = {
            success: [],
            failed: []
        };
        
        // Get next available user ID
        const { getNextAvailableUserId } = require('../lib/psb-database');
        
        for (const userData of usersToImport) {
            try {
                // Validate required fields
                if (!userData.name || !userData.name.trim()) {
                    results.failed.push({
                        pppoe_username: userData.pppoe_username,
                        reason: 'Nama pelanggan wajib diisi'
                    });
                    continue;
                }
                
                if (!userData.device_id || !userData.device_id.trim()) {
                    results.failed.push({
                        pppoe_username: userData.pppoe_username,
                        reason: 'Device ID wajib diisi'
                    });
                    continue;
                }
                
                if (!userData.phone_number || !userData.phone_number.trim()) {
                    // Phone number is optional, just log warning
                    console.log(`[BULK_IMPORT] User ${userData.pppoe_username} has no phone number`);
                }
                
                if (!userData.pppoe_username) {
                    results.failed.push({
                        pppoe_username: 'unknown',
                        reason: 'PPPoE username tidak valid'
                    });
                    continue;
                }
                
                // Check if PPPoE username already exists in system
                const existingUser = global.users.find(u => 
                    u.pppoe_username && 
                    u.pppoe_username.toLowerCase() === userData.pppoe_username.toLowerCase()
                );
                
                if (existingUser) {
                    results.failed.push({
                        pppoe_username: userData.pppoe_username,
                        reason: 'PPPoE username sudah terdaftar di sistem'
                    });
                    continue;
                }
                
                // Get next ID
                const newUserId = await getNextAvailableUserId();
                
                // Generate username from name
                const nameParts = userData.name.toLowerCase().split(' ').filter(Boolean);
                let baseUsername = nameParts[0] || 'user';
                if (nameParts.length > 1) {
                    baseUsername += nameParts[1].charAt(0);
                }
                let counter = 1;
                let finalUsername = baseUsername;
                while (global.users.some(u => u.username === finalUsername)) {
                    counter++;
                    finalUsername = `${baseUsername}${counter}`;
                }
                
                // Hash password for login (use PPPoE password)
                const loginPassword = await hashPassword(userData.pppoe_password || 'default123');
                
                // Use per-user bulk (SSID) if provided, otherwise use default
                const userBulk = userData.bulk && Array.isArray(userData.bulk) && userData.bulk.length > 0
                    ? userData.bulk
                    : settings.defaultBulk;
                
                // Create new user object
                const newUser = {
                    id: newUserId,
                    name: userData.name.trim(),
                    username: finalUsername,
                    password: loginPassword,
                    phone_number: (userData.phone_number || '').trim(),
                    address: userData.address || '',
                    device_id: userData.device_id || '',
                    subscription: userData.subscription || userData.profile || '',
                    pppoe_username: userData.pppoe_username,
                    pppoe_password: userData.pppoe_password || '',
                    bulk: userBulk,
                    paid: settings.paid,
                    send_invoice: settings.send_invoice,
                    status: 'active',
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    imported_from: 'mikrotik'
                };
                
                // Insert into database
                await new Promise((resolve, reject) => {
                    const insertQuery = `
                        INSERT INTO users (
                            id, name, username, password, phone_number, address, device_id,
                            subscription, pppoe_username, pppoe_password,
                            bulk, paid, send_invoice, status, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `;
                    
                    global.db.run(insertQuery, [
                        newUser.id,
                        newUser.name,
                        newUser.username,
                        newUser.password,
                        newUser.phone_number,
                        newUser.address,
                        newUser.device_id,
                        newUser.subscription,
                        newUser.pppoe_username,
                        newUser.pppoe_password,
                        JSON.stringify(newUser.bulk),
                        newUser.paid ? 1 : 0,
                        newUser.send_invoice ? 1 : 0,
                        newUser.status,
                        newUser.created_at,
                        newUser.updated_at
                    ], function(err) {
                        if (err) reject(err);
                        else resolve(this.lastID);
                    });
                });
                
                // Add to global.users
                global.users.push(newUser);
                
                // Send Import Welcome message if enabled
                if (settings.send_psb_welcome && newUser.phone_number) {
                    try {
                        if (templatesCache.notificationTemplates?.import_welcome) {
                            let displayProfile = '-';
                            if (newUser.subscription && global.packages) {
                                const matchedPkg = global.packages.find(p => p.name === newUser.subscription);
                                if (matchedPkg) {
                                    displayProfile = matchedPkg.displayProfile || matchedPkg.profile || '-';
                                }
                            }

                            const templateData = {
                                nama_pelanggan: newUser.name,
                                nama_paket: newUser.subscription || '-',
                                display_profile: displayProfile,
                                nama_wifi: global.config?.nama || 'RAF NET',
                                nama_bot: global.config?.namabot || 'RAF NET BOT'
                            };

                            const message = renderTemplate('import_welcome', templateData);
                            if (message) {
                                const recipients = newUser.phone_number.split('|').map((phone) => phone.trim()).filter(Boolean);
                                const delivery = await sendMessageToMany(recipients, { text: message });
                                if (delivery.sent) {
                                    console.log(`[BULK_IMPORT] Import Welcome sent to ${delivery.successCount} recipient(s) for ${newUser.pppoe_username}`);
                                } else {
                                    console.warn(`[BULK_IMPORT] Import Welcome not sent for ${newUser.pppoe_username}`, {
                                        errorCode: delivery.errorCode
                                    });
                                }
                            } else {
                                console.warn(`[BULK_IMPORT] Template import_welcome rendered empty for ${newUser.pppoe_username}`);
                            }
                        } else {
                            console.warn(`[BULK_IMPORT] Template import_welcome not found in templatesCache`);
                        }
                    } catch (msgErr) {
                        console.error(`[BULK_IMPORT] Failed to send Import Welcome for ${newUser.pppoe_username}:`, msgErr.message);
                        // Don't fail the import if message fails
                    }
                }
                
                results.success.push({
                    id: newUser.id,
                    name: newUser.name,
                    pppoe_username: newUser.pppoe_username,
                    username: newUser.username
                });
                
            } catch (userError) {
                console.error(`[BULK_IMPORT_ERROR] Failed to import ${userData.pppoe_username}:`, userError);
                results.failed.push({
                    pppoe_username: userData.pppoe_username || 'unknown',
                    reason: userError.message
                });
            }
        }
        
        // Log activity
        try {
            await logActivity({
                userId: req.user.id,
                username: req.user.username,
                role: req.user.role,
                actionType: 'CREATE',
                resourceType: 'user',
                resourceId: 'bulk-import',
                resourceName: 'Bulk Import from MikroTik',
                description: `Imported ${results.success.length} users from MikroTik (${results.failed.length} failed)`,
                oldValue: null,
                newValue: { 
                    successCount: results.success.length, 
                    failedCount: results.failed.length,
                    importedUsers: results.success.map(u => u.pppoe_username)
                },
                ipAddress: req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'],
                userAgent: req.headers['user-agent']
            });
        } catch (logErr) {
            console.error('[BULK_IMPORT] Activity log error:', logErr);
        }
        
        console.log(`[BULK_IMPORT] User ${req.user.username} imported ${results.success.length} users (${results.failed.length} failed)`);
        
        // Tambahkan info status WhatsApp untuk debugging
        const whatsappStatus = {
            connected: getConnectionState() === 'open',
            state: getConnectionState() || 'unknown',
            sendPsbWelcomeEnabled: settings.send_psb_welcome
        };
        
        return res.json({
            status: 200,
            message: `Berhasil import ${results.success.length} pelanggan${results.failed.length > 0 ? `, ${results.failed.length} gagal` : ''}`,
            results,
            whatsappStatus
        });
        
    } catch (error) {
        console.error('[BULK_IMPORT_ERROR]', error);
        return res.status(500).json({
            status: 500,
            message: 'Gagal melakukan bulk import',
            error: error.message
        });
    }
});

// GET /api/users/isolated - Get list of isolated users
router.get('/isolated', ensureAdmin, async (req, res) => {
    try {
        const result = await IsolirService.listCandidates({
            search: req.query.search || '',
            onlyIsolated: true,
            page: req.query.page || 1,
            limit: req.query.limit || 20,
        });
        const isolatedUsers = (result.data?.items || []).map((user) => ({
            ...user,
            current_profile: user.currentProfile,
        }));
        return res.json({
            status: 200,
            data: isolatedUsers,
            total: result.data?.pagination?.totalItems || isolatedUsers.length,
            pagination: result.data?.pagination || null,
            meta: {
                summary: result.data?.summary || null,
            },
        });
        
    } catch (error) {
        console.error('[GET_ISOLATED_USERS_ERROR]', error);
        return res.status(500).json({
            status: 500,
            message: 'Gagal mengambil data pelanggan terisolir',
            error: error.message
        });
    }
});

// POST /api/users/buka-isolir - Open isolation for users (change profile back to subscription profile)
router.post('/buka-isolir', ensureAdmin, async (req, res) => {
    try {
        const result = await IsolirService.openUsers({
            userIds: req.body?.userIds,
            reboot: req.body?.reboot,
            reason: req.body?.reason || 'Buka isolir dari halaman admin',
        }, req);
        const results = {
            success: result.data.results.filter((item) => item.ok),
            failed: result.data.results.filter((item) => !item.ok),
        };
        
        // Log activity
        try {
            await logActivity({
                userId: req.user.id,
                username: req.user.username,
                role: req.user.role,
                actionType: 'UPDATE',
                resourceType: 'user',
                resourceId: 'buka-isolir',
                resourceName: 'Buka Isolir',
                description: `Buka isolir untuk ${results.success.length} pelanggan (${results.failed.length} gagal)`,
                oldValue: null,
                newValue: {
                    successCount: results.success.length,
                    failedCount: results.failed.length,
                    users: results.success.map(u => u.name)
                },
                ipAddress: req.ip || req.connection?.remoteAddress || req.headers['x-forwarded-for'],
                userAgent: req.headers['user-agent']
            });
        } catch (logErr) {
            console.error('[BUKA_ISOLIR] Activity log error:', logErr);
        }
        
        return res.json({
            status: results.success.length > 0 ? 200 : 500,
            message: result.message,
            results
        });
        
    } catch (error) {
        console.error('[BUKA_ISOLIR_ERROR]', error);
        return res.status(500).json({
            status: 500,
            message: 'Gagal melakukan buka isolir',
            error: error.message
        });
    }
});

// GET /api/users/profile-diff - Scan profile differences between system and MikroTik
router.get('/profile-diff', ensureAdmin, async (req, res) => {
    try {
        console.log('[PROFILE_DIFF] Starting scan...');
        
        // Get all PPPoE secrets from MikroTik
        let mikrotikSecrets = [];
        try {
            const secretsResult = await getAllPPPoESecrets({ caller: 'users.sync-secrets' });
            assertMikrotikResult(secretsResult);
            mikrotikSecrets = secretsResult.data?.secrets || [];
            console.log(`[PROFILE_DIFF] Fetched ${mikrotikSecrets.length} PPPoE secrets from MikroTik`);
        } catch (err) {
            console.error('[PROFILE_DIFF] Failed to fetch PPPoE secrets:', err.message);
            return res.status(500).json({
                status: 500,
                message: 'Gagal mengambil data dari MikroTik: ' + err.message
            });
        }
        
        // Create map of pppoe_username -> profile
        const mikrotikProfileMap = new Map();
        for (const secret of mikrotikSecrets) {
            if (secret.name) {
                mikrotikProfileMap.set(secret.name.toLowerCase(), secret.profile);
            }
        }
        
        const different = [];
        const notFound = [];
        let sameCount = 0;
        
        for (const user of global.users) {
            if (!user.pppoe_username) continue;
            
            // Get expected profile from system (based on subscription/package)
            const systemProfile = getProfileBySubscription(user.subscription);
            if (!systemProfile) {
                // Skip users without valid subscription
                continue;
            }
            
            // Get current profile from MikroTik
            const mikrotikProfile = mikrotikProfileMap.get(user.pppoe_username.toLowerCase());
            
            if (!mikrotikProfile) {
                // User not found in MikroTik
                notFound.push({
                    id: user.id,
                    name: user.name,
                    pppoe_username: user.pppoe_username,
                    subscription: user.subscription,
                    systemProfile: systemProfile,
                    mikrotikProfile: null
                });
                continue;
            }
            
            // Compare profiles (case-insensitive)
            if (systemProfile.toLowerCase() !== mikrotikProfile.toLowerCase()) {
                different.push({
                    id: user.id,
                    name: user.name,
                    pppoe_username: user.pppoe_username,
                    subscription: user.subscription,
                    systemProfile: systemProfile,
                    mikrotikProfile: mikrotikProfile
                });
            } else {
                sameCount++;
            }
        }
        
        console.log(`[PROFILE_DIFF] Scan complete: ${different.length} different, ${sameCount} same, ${notFound.length} not found`);
        
        return res.json({
            status: 200,
            data: {
                different,
                notFound: notFound.length,
                same: sameCount
            }
        });
        
    } catch (error) {
        console.error('[PROFILE_DIFF_ERROR]', error);
        return res.status(500).json({
            status: 500,
            message: 'Gagal scan perbedaan profil',
            error: error.message
        });
    }
});

// POST /api/users/sync-profiles - Sync profiles from system to MikroTik
router.post('/sync-profiles', ensureAdmin, async (req, res) => {
    try {
        const { users: usersToSync } = req.body;
        const syncEnabled = isMikrotikSyncEnabled(global.config);
        
        if (!usersToSync || !Array.isArray(usersToSync) || usersToSync.length === 0) {
            return res.status(400).json({
                status: 400,
                message: 'Tidak ada pelanggan yang dipilih untuk disinkronkan'
            });
        }

        if (!syncEnabled) {
            return res.status(409).json({
                status: 409,
                message: 'Sinkronisasi MikroTik sedang dinonaktifkan dari halaman pengaturan.',
                sync_policy: 'disabled',
                sync_status: 'applied_locally_sync_disabled',
                sync_message: 'Aksi sinkronisasi ke MikroTik diblokir karena policy sync dimatikan.'
            });
        }
        
        const results = {
            success: [],
            failed: []
        };
        
        for (const userData of usersToSync) {
            const user = global.users.find(u => u.id === userData.id);
            
            if (!user) {
                results.failed.push({
                    id: userData.id,
                    name: userData.name,
                    reason: 'Pelanggan tidak ditemukan di sistem'
                });
                continue;
            }
            
            if (!user.pppoe_username) {
                results.failed.push({
                    id: userData.id,
                    name: userData.name,
                    reason: 'PPPoE username tidak tersedia'
                });
                continue;
            }
            
            // Get target profile from system
            const targetProfile = getProfileBySubscription(user.subscription);
            
            if (!targetProfile) {
                results.failed.push({
                    id: userData.id,
                    name: userData.name,
                    reason: `Profil tidak ditemukan untuk paket: ${user.subscription}`
                });
                continue;
            }
            
            try {
                // Update PPPoE profile in MikroTik
                console.log(`[SYNC_PROFILE] Updating ${user.pppoe_username} to profile: ${targetProfile}`);
                assertMikrotikResult(
                    await updatePPPoEProfile(user.pppoe_username, targetProfile, { caller: 'users.bulk-buka-isolir' })
                );
                
                // Disconnect active session to apply new profile
                try {
                    const disconnectResult = await deleteActivePPPoEUser(user.pppoe_username, { caller: 'users.bulk-buka-isolir' });
                    if (!disconnectResult.ok) {
                        throw new Error(disconnectResult.message);
                    }
                } catch (disconnectErr) {
                    // Session might not be active, continue anyway
                    console.log(`[SYNC_PROFILE] Session disconnect note for ${user.pppoe_username}: ${disconnectErr.message}`);
                }
                
                results.success.push({
                    id: user.id,
                    name: user.name,
                    pppoe_username: user.pppoe_username,
                    oldProfile: userData.mikrotikProfile,
                    newProfile: targetProfile
                });
                
                console.log(`[SYNC_PROFILE_SUCCESS] ${user.name} (${user.pppoe_username}): ${userData.mikrotikProfile} -> ${targetProfile}`);
                
            } catch (error) {
                console.error(`[SYNC_PROFILE_ERROR] Failed for ${user.name}:`, error);
                results.failed.push({
                    id: userData.id,
                    name: userData.name,
                    reason: error.message
                });
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
                resourceId: 'sync-profiles',
                resourceName: 'Sync Profiles to MikroTik',
                description: `Sinkronisasi profil ${results.success.length} pelanggan ke MikroTik (${results.failed.length} gagal)`,
                oldValue: null,
                newValue: {
                    successCount: results.success.length,
                    failedCount: results.failed.length,
                    users: results.success.map(u => `${u.name}: ${u.oldProfile} -> ${u.newProfile}`)
                },
                ipAddress: req.ip || req.connection?.remoteAddress || req.headers['x-forwarded-for'],
                userAgent: req.headers['user-agent']
            });
        } catch (logErr) {
            console.error('[SYNC_PROFILE] Activity log error:', logErr);
        }
        
        const message = results.success.length > 0
            ? `Berhasil sinkronisasi ${results.success.length} pelanggan${results.failed.length > 0 ? `, ${results.failed.length} gagal` : ''}`
            : 'Gagal sinkronisasi semua pelanggan';
        
        return res.json({
            status: results.success.length > 0 ? 200 : 500,
            message,
            results,
            sync_policy: 'enabled',
            sync_status: results.failed.length > 0 ? 'failed_sync' : 'applied',
            sync_message: results.failed.length > 0
                ? 'Sebagian sinkronisasi gagal diterapkan ke MikroTik.'
                : 'Semua profil terpilih berhasil disinkronkan ke MikroTik.'
        });
        
    } catch (error) {
        console.error('[SYNC_PROFILE_ERROR]', error);
        return res.status(500).json({
            status: 500,
            message: 'Gagal melakukan sinkronisasi profil',
            error: error.message
        });
    }
});

// GET /api/users/device-id-diff - Scan device ID differences between system and GenieACS
router.get('/device-id-diff', ensureAdmin, async (req, res) => {
    try {
        console.log('[DEVICE_ID_DIFF] Starting scan...');
        
        const projectionFields = [
            'Device.DeviceInfo',
            'InternetGatewayDevice.DeviceInfo',
            'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username',
            'Device.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username',
            'Device.PPP.Interface.1.Username',
        ];
        
        let genieacsDevices = [];
        try {
            const response = await queryDevices({
                projection: projectionFields,
                limit: 1000,
                timeoutMs: 30000,
                operation: 'users.deviceIdDiff',
            });
            if (!response.ok) {
                throw new Error(response.message);
            }
            genieacsDevices = response.data || [];
        } catch (err) {
            console.error('[DEVICE_ID_DIFF] Failed to fetch GenieACS devices:', err.message);
            return res.status(500).json({
                status: 500,
                message: 'Gagal mengambil data dari GenieACS: ' + err.message
            });
        }
        
        console.log(`[DEVICE_ID_DIFF] Fetched ${genieacsDevices.length} devices from GenieACS`);
        
        // Create map of pppUsername -> device info
        const pppToDeviceMap = new Map();
        for (const device of genieacsDevices) {
            const deviceId = device._id;
            
            // Get PPP username
            const pppUsername = extractPppoeUsername(device);
            
            if (pppUsername) {
                const model = extractDeviceModel(device) || '-';
                const serialNumber = extractSerialNumber(device) || deviceId;
                
                pppToDeviceMap.set(pppUsername.toLowerCase(), {
                    deviceId: deviceId,
                    model: model,
                    serialNumber: serialNumber
                });
            }
        }
        
        console.log(`[DEVICE_ID_DIFF] Found ${pppToDeviceMap.size} devices with PPP username`);
        
        // Find differences
        const different = [];
        let sameCount = 0;
        let notFoundCount = 0;
        
        for (const user of global.users) {
            if (!user.pppoe_username) continue;
            
            const genieDevice = pppToDeviceMap.get(user.pppoe_username.toLowerCase());
            
            if (!genieDevice) {
                // User's PPPoE not found in any GenieACS device
                notFoundCount++;
                continue;
            }
            
            // Compare device IDs
            if (user.device_id !== genieDevice.deviceId) {
                different.push({
                    id: user.id,
                    name: user.name,
                    pppoe_username: user.pppoe_username,
                    old_device_id: user.device_id || null,
                    new_device_id: genieDevice.deviceId,
                    model: genieDevice.model,
                    serial_number: genieDevice.serialNumber
                });
            } else {
                sameCount++;
            }
        }
        
        console.log(`[DEVICE_ID_DIFF] Results: ${different.length} different, ${sameCount} same, ${notFoundCount} not found`);
        
        return res.json({
            status: 200,
            message: `Ditemukan ${different.length} pelanggan dengan Device ID berbeda`,
            data: different,
            stats: {
                total: global.users.filter(u => u.pppoe_username).length,
                different: different.length,
                same: sameCount,
                notFound: notFoundCount
            }
        });
        
    } catch (error) {
        console.error('[DEVICE_ID_DIFF_ERROR]', error);
        return res.status(500).json({
            status: 500,
            message: 'Gagal melakukan scan Device ID',
            error: error.message
        });
    }
});

// POST /api/users/sync-device-ids - Sync device IDs for selected users
router.post('/sync-device-ids', ensureAdmin, async (req, res) => {
    try {
        const { items } = req.body;
        
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({
                status: 400,
                message: 'Tidak ada data untuk disinkronkan'
            });
        }
        
        const results = {
            success: [],
            failed: []
        };
        
        for (const item of items) {
            const { userId, newDeviceId } = item;
            
            const user = global.users.find(u => u.id === userId);
            if (!user) {
                results.failed.push({
                    userId: userId,
                    reason: 'Pelanggan tidak ditemukan'
                });
                continue;
            }
            
            const oldDeviceId = user.device_id;
            
            try {
                // Update in database
                await new Promise((resolve, reject) => {
                    global.db.run(
                        'UPDATE users SET device_id = ?, updated_at = ? WHERE id = ?',
                        [newDeviceId, new Date().toISOString(), userId],
                        function(err) {
                            if (err) reject(err);
                            else resolve();
                        }
                    );
                });
                
                // Update in memory
                user.device_id = newDeviceId;
                user.updated_at = new Date().toISOString();
                
                results.success.push({
                    userId: userId,
                    name: user.name,
                    oldDeviceId: oldDeviceId,
                    newDeviceId: newDeviceId
                });
                
                console.log(`[SYNC_DEVICE_ID] Updated ${user.name}: ${oldDeviceId} -> ${newDeviceId}`);
                
            } catch (err) {
                console.error(`[SYNC_DEVICE_ID] Failed for user ${userId}:`, err.message);
                results.failed.push({
                    userId: userId,
                    name: user.name,
                    reason: err.message
                });
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
                resourceId: 'sync-device-ids',
                resourceName: 'Sync Device IDs',
                description: `Synced Device ID for ${results.success.length} users (${results.failed.length} failed)`,
                oldValue: null,
                newValue: {
                    successCount: results.success.length,
                    failedCount: results.failed.length,
                    users: results.success.map(u => ({ name: u.name, old: u.oldDeviceId, new: u.newDeviceId }))
                },
                ipAddress: req.ip || req.connection?.remoteAddress || req.headers['x-forwarded-for'],
                userAgent: req.headers['user-agent']
            });
        } catch (logErr) {
            console.error('[SYNC_DEVICE_ID] Activity log error:', logErr);
        }
        
        const message = results.success.length > 0
            ? `Berhasil update ${results.success.length} Device ID${results.failed.length > 0 ? `, ${results.failed.length} gagal` : ''}`
            : 'Gagal update semua Device ID';
        
        return res.json({
            status: results.success.length > 0 ? 200 : 500,
            message,
            results
        });
        
    } catch (error) {
        console.error('[SYNC_DEVICE_ID_ERROR]', error);
        return res.status(500).json({
            status: 500,
            message: 'Gagal melakukan sinkronisasi Device ID',
            error: error.message
        });
    }
});

module.exports = router;
