/**
 * Header Doc
 * Purpose: Mengelola perubahan paket pelanggan dari panel admin dan sinkronisasi notifikasi/domain terkait.
 * Caller: Express route registry/API admin.
 * Deps: Database JSON/SQLite, activity logger, security rate-limit, MikroTik helper, templating, request lock, dan whatsapp-critical-delivery (sendCritical).
 * MainFuncs: Router perubahan paket (single + bulk) dan helper notifikasi pelanggan terjamin (sendCritical: wait-ready + retry + dead-letter).
 * SideEffects: Membaca/menulis data pelanggan/request, update MikroTik, log activity, dan kirim notifikasi WhatsApp ke pelanggan (dead-letter bila gagal).
 */

const express = require('express');
const router = express.Router();
const { loadJSON } = require('../lib/database');
const { logActivity } = require('../lib/activity-logger');
const { rateLimit } = require('../lib/security');
const { getDatabasePath } = require('../lib/env-config');
const {
    updatePPPoEProfile,
    deleteActivePPPoEUser,
    assertMikrotikResult,
    isMikrotikSyncEnabled,
} = require('../lib/mikrotik');
const { getProfileBySubscription } = require('../lib/myfunc');
const { renderTemplate } = require('../lib/templating');
const { withLock } = require('../lib/request-lock');
const { sendCritical } = require('../lib/whatsapp-critical-delivery');
const sqlite3 = require('sqlite3').verbose();

// Get database connection
function getDb() {
    return new sqlite3.Database(getDatabasePath('users.sqlite'));
}

function isTruthySyncRequest(value) {
    if (value === undefined || value === null) return true;
    if (typeof value === 'string') return value.toLowerCase() !== 'false';
    return value !== false;
}

function buildSyncOutcome(status, message, extra = {}) {
    return {
        status,
        message,
        ...extra,
    };
}

async function syncPackageChangeToMikrotik(user, newPackage, requestedSync, caller) {
    const syncEnabled = isMikrotikSyncEnabled() && isTruthySyncRequest(requestedSync);
    if (!syncEnabled) {
        return buildSyncOutcome(
            'applied_locally_sync_disabled',
            'Sinkronisasi MikroTik dinonaktifkan. Perubahan hanya disimpan di aplikasi.'
        );
    }

    if (!user.pppoe_username) {
        return buildSyncOutcome(
            'skipped_no_pppoe',
            'Pelanggan tidak memiliki PPPoE username. Sinkronisasi MikroTik dilewati.'
        );
    }

    const targetProfile = getProfileBySubscription(newPackage);
    if (!targetProfile) {
        return buildSyncOutcome(
            'failed_sync',
            `Profile MikroTik untuk paket "${newPackage}" tidak ditemukan.`
        );
    }

    try {
        assertMikrotikResult(
            await updatePPPoEProfile(user.pppoe_username, targetProfile, { caller })
        );

        const disconnectResult = await deleteActivePPPoEUser(user.pppoe_username, { caller });
        if (!disconnectResult.ok) {
            console.warn(`[CHANGE_PACKAGE_WARN] Disconnect session warning for ${user.pppoe_username}: ${disconnectResult.message}`);
        }

        return buildSyncOutcome(
            'applied',
            `Profile MikroTik diubah ke ${targetProfile}.`,
            { profile: targetProfile }
        );
    } catch (error) {
        console.error('[CHANGE_PACKAGE_MIKROTIK_ERROR]', error);
        return buildSyncOutcome(
            'failed_sync',
            error.message || 'Sinkronisasi MikroTik gagal.',
            { errorCode: error.code || 'COMMAND_ERROR' }
        );
    }
}

// Middleware for admin only
function ensureAdmin(req, res, next) {
    if (!req.user || !['admin', 'owner', 'superadmin'].includes(req.user.role)) {
        return res.status(403).json({ status: 403, message: "Akses ditolak. Hanya admin yang diizinkan." });
    }
    next();
}

// GET /api/change-package/packages - Get available packages
router.get('/packages', ensureAdmin, (req, res) => {
    try {
        const packages = loadJSON('database/packages.json') || global.packages || [];
        res.json({ 
            status: 200, 
            data: packages.map(p => ({
                name: p.name,
                price: p.price,
                speed: p.speed || p.name,
                description: p.description || ''
            }))
        });
    } catch (error) {
        console.error('[GET_PACKAGES_ERROR]', error);
        res.status(500).json({ status: 500, message: 'Gagal mengambil daftar paket' });
    }
});

// GET /api/change-package/:userId - Get current package info for a user
router.get('/:userId', ensureAdmin, async (req, res) => {
    const { userId } = req.params;
    
    const user = global.users.find(u => String(u.id) === String(userId));
    if (!user) {
        return res.status(404).json({ status: 404, message: 'User tidak ditemukan' });
    }
    
    const packages = loadJSON('database/packages.json') || global.packages || [];
    const currentPackage = packages.find(p => p.name === user.subscription);
    
    res.json({
        status: 200,
        data: {
            user_id: user.id,
            user_name: user.name,
            current_package: user.subscription,
            current_price: user.subscription_price || currentPackage?.price || 0,
            pppoe_username: user.pppoe_username,
            available_packages: packages.map(p => ({
                name: p.name,
                price: p.price,
                speed: p.speed || p.name
            }))
        }
    });
});

// POST /api/change-package/:userId - Change package for a user
router.post('/:userId', ensureAdmin, rateLimit('change-package', 20, 60000), async (req, res) => {
    const { userId } = req.params;
    const { new_package, sync_mikrotik, notes: _notes } = req.body;
    
    if (!new_package) {
        return res.status(400).json({ status: 400, message: 'Paket baru harus dipilih' });
    }
    
    const user = global.users.find(u => String(u.id) === String(userId));
    if (!user) {
        return res.status(404).json({ status: 404, message: 'User tidak ditemukan' });
    }
    
    const packages = loadJSON('database/packages.json') || global.packages || [];
    const newPackageData = packages.find(p => p.name === new_package);
    
    if (!newPackageData) {
        return res.status(400).json({ status: 400, message: 'Paket tidak ditemukan' });
    }
    
    // Check if same package
    if (user.subscription === new_package) {
        return res.status(400).json({ status: 400, message: 'Paket baru sama dengan paket saat ini' });
    }
    
    // Use lock to prevent race condition
    try {
        return await withLock(`change-package-${userId}`, async () => {
            const oldPackage = user.subscription;
            const oldPrice = user.subscription_price;
            const db = getDb();
            const now = new Date().toISOString();
            const syncResult = await syncPackageChangeToMikrotik(user, new_package, sync_mikrotik, 'change-package.single');

            if (syncResult.status === 'failed_sync') {
                db.close();
                return res.status(502).json({
                    status: 502,
                    message: syncResult.message,
                    sync_policy: isMikrotikSyncEnabled() ? 'enabled' : 'disabled',
                    sync_status: syncResult.status,
                    sync_message: syncResult.message,
                    mikrotik_sync: syncResult,
                });
            }

            const sql = `
                UPDATE users SET 
                    subscription = ?,
                    subscription_price = ?,
                    updated_at = ?
                WHERE id = ?
            `;
            
            return new Promise((resolve, _reject) => {
                db.run(sql, [new_package, newPackageData.price, now, userId], async function(err) {
                    if (err) {
                        db.close();
                        console.error('[CHANGE_PACKAGE_DB_ERROR]', err);
                        return resolve(res.status(500).json({ status: 500, message: 'Gagal mengubah paket di database' }));
                    }
                    
                    // Update global.users
                    const userIndex = global.users.findIndex(u => String(u.id) === String(userId));
                    if (userIndex !== -1) {
                        global.users[userIndex].subscription = new_package;
                        global.users[userIndex].subscription_price = newPackageData.price;
                    }
                    
                    // Log activity
                    logActivity({
                        userId: req.user.id,
                        username: req.user.username,
                        role: req.user.role,
                        actionType: 'UPDATE',
                        resourceType: 'package_change',
                        resourceId: userId,
                        resourceName: user.name,
                        description: `Admin mengubah paket ${user.name} dari ${oldPackage} ke ${new_package}`,
                        oldValue: {
                            subscription: oldPackage,
                            subscription_price: oldPrice,
                            sync_policy: isMikrotikSyncEnabled() ? 'enabled' : 'disabled',
                        },
                        newValue: {
                            subscription: new_package,
                            subscription_price: newPackageData.price,
                            sync_policy: isMikrotikSyncEnabled() ? 'enabled' : 'disabled',
                            sync_status: syncResult.status,
                            sync_message: syncResult.message,
                        },
                        ipAddress: req.ip,
                        userAgent: req.headers['user-agent']
                    }).catch(console.error);
                    
                    // Notify customer via WhatsApp (terjamin: sendCritical + dead-letter).
                    // Di-await supaya status notifikasi bisa ditampilkan ke admin, tapi
                    // best-effort — kegagalan kirim tidak membatalkan perubahan paket.
                    const notify = await notifyCustomerPackageChange(user, oldPackage, new_package, newPackageData.price);

                    db.close();
                    resolve(res.json({
                        status: 200,
                        message: 'Paket berhasil diubah',
                        data: {
                            user_id: userId,
                            user_name: user.name,
                            old_package: oldPackage,
                            new_package: new_package,
                            new_price: newPackageData.price,
                            sync_policy: isMikrotikSyncEnabled() ? 'enabled' : 'disabled',
                            sync_status: syncResult.status,
                            sync_message: syncResult.message,
                            mikrotik_sync: syncResult,
                            notify
                        }
                    }));
                });
            });
        });
    } catch (error) {
        console.error('[CHANGE_PACKAGE_ERROR]', error);
        return res.status(500).json({ 
            status: 500, 
            message: error.message?.includes('Could not acquire lock') 
                ? 'Request sedang diproses. Silakan coba lagi.'
                : 'Terjadi kesalahan server'
        });
    }
});

// POST /api/change-package/bulk - Bulk change package (admin)
router.post('/bulk/change', ensureAdmin, rateLimit('bulk-change-package', 5, 60000), async (req, res) => {
    const { user_ids, new_package, sync_mikrotik } = req.body;
    
    if (!Array.isArray(user_ids) || user_ids.length === 0) {
        return res.status(400).json({ status: 400, message: 'Pilih minimal satu pelanggan' });
    }
    
    if (!new_package) {
        return res.status(400).json({ status: 400, message: 'Paket baru harus dipilih' });
    }
    
    const packages = loadJSON('database/packages.json') || global.packages || [];
    const newPackageData = packages.find(p => p.name === new_package);
    
    if (!newPackageData) {
        return res.status(400).json({ status: 400, message: 'Paket tidak ditemukan' });
    }
    
    const db = getDb();
    const now = new Date().toISOString();
    const results = [];
    
    try {
        for (const userId of user_ids) {
            const user = global.users.find(u => String(u.id) === String(userId));
            if (!user) {
                results.push({ user_id: userId, success: false, message: 'User tidak ditemukan' });
                continue;
            }
            
            const oldPackage = user.subscription;
            
            const syncResult = await syncPackageChangeToMikrotik(user, new_package, sync_mikrotik, 'change-package.bulk');
            if (syncResult.status === 'failed_sync') {
                results.push({
                    user_id: userId,
                    user_name: user.name,
                    old_package: oldPackage,
                    new_package,
                    success: false,
                    sync_policy: isMikrotikSyncEnabled() ? 'enabled' : 'disabled',
                    sync_status: syncResult.status,
                    sync_message: syncResult.message,
                });
                continue;
            }

            try {
                await new Promise((resolve, reject) => {
                    db.run(
                        'UPDATE users SET subscription = ?, subscription_price = ?, updated_at = ? WHERE id = ?',
                        [new_package, newPackageData.price, now, userId],
                        (err) => err ? reject(err) : resolve()
                    );
                });
            } catch (error) {
                results.push({
                    user_id: userId,
                    user_name: user.name,
                    old_package: oldPackage,
                    new_package,
                    success: false,
                    sync_policy: isMikrotikSyncEnabled() ? 'enabled' : 'disabled',
                    sync_status: syncResult.status,
                    sync_message: `Database gagal diupdate: ${error.message}`,
                });
                continue;
            }

            const userIndex = global.users.findIndex(u => String(u.id) === String(userId));
            if (userIndex !== -1) {
                global.users[userIndex].subscription = new_package;
                global.users[userIndex].subscription_price = newPackageData.price;
            }

            // Beri tahu pelanggan (terjamin: sendCritical + dead-letter). Sebelumnya
            // jalur bulk TIDAK pernah memberi tahu pelanggan sama sekali.
            const notify = await notifyCustomerPackageChange(user, oldPackage, new_package, newPackageData.price);

            results.push({
                user_id: userId,
                user_name: user.name,
                old_package: oldPackage,
                new_package: new_package,
                success: true,
                sync_policy: isMikrotikSyncEnabled() ? 'enabled' : 'disabled',
                sync_status: syncResult.status,
                sync_message: syncResult.message,
                mikrotik_sync: syncResult,
                notify
            });
        }

        const successCount = results.filter(r => r.success).length;
        const notifiedCount = results.filter(r => r.success && r.notify && r.notify.notified).length;

        // Log activity
        logActivity({
            userId: req.user.id,
            username: req.user.username,
            role: req.user.role,
            actionType: 'BULK_UPDATE',
            resourceType: 'package_change',
            resourceId: 'bulk',
            resourceName: `${successCount} pelanggan`,
            description: `Admin mengubah paket ${successCount} pelanggan ke ${new_package} (${notifiedCount} pelanggan diberi tahu via WA)`,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent']
        }).catch(console.error);

        db.close();
        res.json({
            status: 200,
            message: `Berhasil mengubah paket ${successCount} dari ${user_ids.length} pelanggan`,
            data: results,
            summary: {
                total: user_ids.length,
                success: successCount,
                notified: notifiedCount
            }
        });
    } catch (error) {
        db.close();
        console.error('[BULK_CHANGE_PACKAGE_ERROR]', error);
        res.status(500).json({ status: 500, message: 'Terjadi kesalahan server' });
    }
});

// Helper: Notify customer about package change.
//
// Pakai sendCritical (tunggu-ready + retry + DEAD-LETTER) — BUKAN fire-and-forget.
// Notifikasi perubahan paket tidak boleh hilang diam-diam saat WA sedang reconnect:
// kalau gagal, masuk dead-letter dan otomatis di-retry saat WA tersambung lagi.
// Best-effort terhadap caller: TIDAK pernah throw — kegagalan kirim tidak boleh
// menggagalkan perubahan paket yang sudah commit di DB/MikroTik.
//
// @returns {Promise<{notified, delivered, total, queued, skipped?}>}
async function notifyCustomerPackageChange(user, oldPackage, newPackage, newPrice) {
    if (!user || !user.phone_number) {
        return { notified: false, delivered: 0, total: 0, queued: 0, skipped: 'no_phone' };
    }

    const priceNum = Number(newPrice) || 0;
    let message;
    try {
        const unifiedMessage = renderTemplate('package_changed', {
            customer_name: user.name,
            old_package: oldPackage || '-',
            new_package: newPackage,
            new_price: `Rp ${priceNum.toLocaleString('id-ID')}/bulan`,
            effective_date: new Date().toLocaleDateString('id-ID'),
            company_name: global.config?.companyName || 'RAF NET'
        });
        if (unifiedMessage && !unifiedMessage.startsWith('Error: Template')) {
            message = unifiedMessage;
        }
    } catch (e) {
        console.error('[PACKAGE_CHANGE_TEMPLATE_ERROR]', e.message);
    }

    // Fallback message if template not available
    if (!message) {
        message = `🔔 *INFO PERUBAHAN PAKET* 🔔\n\n` +
            `Halo *${user.name}*,\n\n` +
            `Paket internet Anda telah diubah:\n\n` +
            `📦 *Paket Lama:* ${oldPackage || '-'}\n` +
            `📦 *Paket Baru:* ${newPackage}\n` +
            `💰 *Harga Baru:* Rp ${priceNum.toLocaleString('id-ID')}/bulan\n\n` +
            `Perubahan ini berlaku mulai sekarang.\n` +
            `Jika ada pertanyaan, silakan hubungi kami.\n\n` +
            `Terima kasih 🙏`;
    }

    const phones = String(user.phone_number).split('|').map((p) => p.trim()).filter(Boolean);
    if (phones.length === 0) {
        return { notified: false, delivered: 0, total: 0, queued: 0, skipped: 'no_phone' };
    }

    let delivered = 0;
    for (const phone of phones) {
        try {
            // waitForReadyMs dipangkas (8s) supaya request admin tidak menggantung
            // lama saat WA down — sisanya dijamin lewat dead-letter + auto-retry.
            const result = await sendCritical(phone, { text: message }, {
                label: 'package_change',
                waitForReadyMs: 8000,
            });
            if (result && result.delivered) {
                delivered += 1;
                console.log(`[PACKAGE_CHANGE_NOTIF] Terkirim ke ${user.name} (${phone})`);
            } else {
                console.warn(`[PACKAGE_CHANGE_NOTIF] Masuk antrian dead-letter untuk ${user.name} (${phone})`);
            }
        } catch (e) {
            console.error('[PACKAGE_CHANGE_NOTIF_ERROR]', e.message);
        }
    }

    return {
        notified: delivered > 0,
        delivered,
        total: phones.length,
        queued: phones.length - delivered, // belum terkirim → dead-letter, auto-retry saat WA reconnect
    };
}

module.exports = router;
