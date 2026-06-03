/**
 * Header Doc
 * Purpose: Mengelola diskon pelanggan dari panel admin dan notifikasi perubahan diskon.
 * Caller: Express route registry/API admin.
 * Deps: Activity logger, security rate-limit/input validation, SQLite env path, templating, domain events, gateway readiness, dan helper timing WA.
 * MainFuncs: Router CRUD diskon pelanggan dan helper notifikasi diskon.
 * SideEffects: Membaca/menulis data diskon pelanggan, log activity, dan emit event notifikasi WhatsApp.
 */

const express = require('express');
const router = express.Router();
const { logActivity } = require('../lib/activity-logger');
const { rateLimit, validateInput } = require('../lib/security');
const { getDatabasePath } = require('../lib/env-config');
const { renderTemplate } = require('../lib/templating');
const { formatCurrency, formatDate } = require('../lib/message-template-helper');
const { DOMAIN_EVENTS, emitAsync } = require('../lib/domain-events');
const { initializeDomainNotificationListeners } = require('../lib/domain-notification-listeners');
const { isReady } = require('../lib/whatsapp-gateway');
const { waitForWhatsAppDelay } = require('../lib/wa-timing');
const sqlite3 = require('sqlite3').verbose();

initializeDomainNotificationListeners();

// Get database connection
function getDb() {
    return new sqlite3.Database(getDatabasePath('users.sqlite'));
}

// Middleware for admin only
function ensureAdmin(req, res, next) {
    if (!req.user || !['admin', 'owner', 'superadmin'].includes(req.user.role)) {
        return res.status(403).json({ status: 403, message: "Akses ditolak. Hanya admin yang diizinkan." });
    }
    next();
}

// GET /api/discount/:userId - Get discount info for a user
router.get('/:userId', ensureAdmin, async (req, res) => {
    const { userId } = req.params;
    const db = getDb();
    
    try {
        db.get(
            `SELECT id, name, subscription, subscription_price, 
                    discount_amount, discount_percentage, discount_reason, 
                    discount_valid_until, discount_months, discount_months_used,
                    discount_created_by, discount_created_at
             FROM users WHERE id = ?`,
            [userId],
            (err, user) => {
                db.close();
                if (err) {
                    console.error('[DISCOUNT_GET_ERROR]', err);
                    return res.status(500).json({ status: 500, message: 'Gagal mengambil data diskon' });
                }
                
                if (!user) {
                    return res.status(404).json({ status: 404, message: 'User tidak ditemukan' });
                }
                
                // Calculate effective price
                const basePrice = user.subscription_price || 0;
                let discountValue = 0;
                
                // Check if discount is still valid
                // 1. Check discount_valid_until (legacy)
                // 2. Check discount_months vs discount_months_used (new system)
                let isValid = true;
                const discountMonths = user.discount_months || 0;
                const discountMonthsUsed = user.discount_months_used || 0;
                
                if (user.discount_valid_until) {
                    isValid = new Date(user.discount_valid_until) >= new Date();
                }
                
                // Jika menggunakan sistem bulan, cek apakah masih ada sisa bulan
                if (discountMonths > 0) {
                    isValid = discountMonthsUsed < discountMonths;
                }
                
                if (isValid) {
                    if (user.discount_percentage > 0) {
                        discountValue = Math.round(basePrice * user.discount_percentage / 100);
                    } else if (user.discount_amount > 0) {
                        discountValue = user.discount_amount;
                    }
                }
                
                const effectivePrice = Math.max(0, basePrice - discountValue);
                const remainingMonths = discountMonths > 0 ? Math.max(0, discountMonths - discountMonthsUsed) : null;
                
                res.json({
                    status: 200,
                    data: {
                        user_id: user.id,
                        user_name: user.name,
                        subscription: user.subscription,
                        base_price: basePrice,
                        discount_amount: user.discount_amount || 0,
                        discount_percentage: user.discount_percentage || 0,
                        discount_value: discountValue,
                        effective_price: effectivePrice,
                        discount_reason: user.discount_reason,
                        discount_valid_until: user.discount_valid_until,
                        discount_months: discountMonths,
                        discount_months_used: discountMonthsUsed,
                        remaining_months: remainingMonths,
                        discount_created_by: user.discount_created_by,
                        discount_created_at: user.discount_created_at,
                        is_discount_valid: isValid && discountValue > 0
                    }
                });
            }
        );
    } catch (error) {
        db.close();
        res.status(500).json({ status: 500, message: 'Terjadi kesalahan server' });
    }
});

// POST /api/discount/:userId - Set discount for a user
router.post('/:userId', ensureAdmin, rateLimit('set-discount', 30, 60000), async (req, res) => {
    const { userId } = req.params;
    let { discount_amount, discount_percentage, discount_reason, discount_months } = req.body;
    
    // Validate inputs
    discount_amount = parseInt(discount_amount) || 0;
    discount_percentage = parseInt(discount_percentage) || 0;
    discount_months = parseInt(discount_months) || 1; // Default 1 bulan
    
    if (discount_amount < 0 || discount_percentage < 0) {
        return res.status(400).json({ status: 400, message: 'Diskon tidak boleh negatif' });
    }
    
    if (discount_percentage > 100) {
        return res.status(400).json({ status: 400, message: 'Persentase diskon maksimal 100%' });
    }
    
    if (discount_amount > 0 && discount_percentage > 0) {
        return res.status(400).json({ 
            status: 400, 
            message: 'Pilih salah satu: diskon nominal ATAU diskon persentase' 
        });
    }
    
    if (discount_months < 1 || discount_months > 12) {
        return res.status(400).json({ status: 400, message: 'Periode diskon harus antara 1-12 bulan' });
    }
    
    const db = getDb();
    const now = new Date().toISOString();
    
    try {
        // Check if user exists
        db.get('SELECT * FROM users WHERE id = ?', [userId], (err, user) => {
            if (err || !user) {
                db.close();
                return res.status(404).json({ status: 404, message: 'User tidak ditemukan' });
            }
            
            const oldDiscount = {
                discount_amount: user.discount_amount,
                discount_percentage: user.discount_percentage,
                discount_reason: user.discount_reason
            };
            
            // Update discount
            const sql = `
                UPDATE users SET 
                    discount_amount = ?,
                    discount_percentage = ?,
                    discount_reason = ?,
                    discount_months = ?,
                    discount_months_used = 0,
                    discount_valid_until = NULL,
                    discount_created_by = ?,
                    discount_created_at = ?,
                    updated_at = ?
                WHERE id = ?
            `;
            
            db.run(sql, [
                discount_amount,
                discount_percentage,
                discount_reason || null,
                discount_months,
                req.user.name || req.user.username,
                now,
                now,
                userId
            ], function(err) {
                if (err) {
                    db.close();
                    console.error('[DISCOUNT_SET_ERROR]', err);
                    return res.status(500).json({ status: 500, message: 'Gagal menyimpan diskon' });
                }
                
                // Update global.users
                const userIndex = global.users.findIndex(u => String(u.id) === String(userId));
                if (userIndex !== -1) {
                    global.users[userIndex].discount_amount = discount_amount;
                    global.users[userIndex].discount_percentage = discount_percentage;
                    global.users[userIndex].discount_reason = discount_reason;
                    global.users[userIndex].discount_months = discount_months;
                    global.users[userIndex].discount_months_used = 0;
                    global.users[userIndex].discount_valid_until = null;
                    global.users[userIndex].discount_created_by = req.user.name || req.user.username;
                    global.users[userIndex].discount_created_at = now;
                }
                
                // Log activity
                logActivity({
                    userId: req.user.id,
                    username: req.user.username,
                    role: req.user.role,
                    actionType: 'UPDATE',
                    resourceType: 'discount',
                    resourceId: userId,
                    resourceName: user.name,
                    description: `Admin mengatur diskon untuk ${user.name}: ${discount_percentage > 0 ? discount_percentage + '%' : 'Rp ' + discount_amount.toLocaleString('id-ID')} (${discount_months} bulan)`,
                    oldValue: oldDiscount,
                    newValue: { discount_amount, discount_percentage, discount_reason, discount_months },
                    ipAddress: req.ip,
                    userAgent: req.headers['user-agent']
                }).catch(console.error);
                
                db.close();
                
                // Send WhatsApp notification to customer
                sendDiscountNotification(user, {
                    discount_amount,
                    discount_percentage,
                    discount_reason,
                    discount_months,
                    admin_name: req.user.name || req.user.username
                });
                
                res.json({
                    status: 200,
                    message: 'Diskon berhasil disimpan',
                    data: {
                        discount_amount,
                        discount_percentage,
                        discount_reason,
                        discount_months
                    }
                });
            });
        });
    } catch (error) {
        db.close();
        console.error('[DISCOUNT_SET_ERROR]', error);
        res.status(500).json({ status: 500, message: 'Terjadi kesalahan server' });
    }
});

// Helper: Send WhatsApp notification when discount is set
async function sendDiscountNotification(user, discountInfo) {
    if (!isReady()) {
        console.log('[DISCOUNT_NOTIF] WhatsApp not connected, skipping notification');
        return;
    }
    
    if (!user.phone_number) {
        console.log('[DISCOUNT_NOTIF] User has no phone number, skipping notification');
        return;
    }
    
    try {
        // Format phone number
        let phoneJid = user.phone_number.split('|')[0].trim();
        if (!phoneJid.endsWith('@s.whatsapp.net')) {
            if (phoneJid.startsWith('0')) {
                phoneJid = `62${phoneJid.substring(1)}@s.whatsapp.net`;
            } else if (phoneJid.startsWith('62')) {
                phoneJid = `${phoneJid}@s.whatsapp.net`;
            } else {
                phoneJid = `${phoneJid}@s.whatsapp.net`;
            }
        }
        
        // Calculate prices
        const basePrice = user.subscription_price || 0;
        let discountValue = 0;
        let discountText = '';
        
        if (discountInfo.discount_percentage > 0) {
            discountValue = Math.round(basePrice * discountInfo.discount_percentage / 100);
            discountText = `${discountInfo.discount_percentage}%`;
        } else if (discountInfo.discount_amount > 0) {
            discountValue = discountInfo.discount_amount;
            discountText = formatCurrency(discountInfo.discount_amount);
        }
        
        const finalPrice = Math.max(0, basePrice - discountValue);
        
        // Format periode
        const discountMonths = discountInfo.discount_months || 1;
        const periodeText = discountMonths === 1 ? '1 bulan (bulan ini saja)' : `${discountMonths} bulan`;
        
        // Build placeholder data
        const placeholderData = {
            customer_name: user.name || '-',
            customer_id: user.id || '-',
            package_name: user.subscription || '-',
            base_price: formatCurrency(basePrice),
            discount_text: discountText,
            discount_amount: formatCurrency(discountInfo.discount_amount || 0),
            discount_percentage: discountInfo.discount_percentage ? `${discountInfo.discount_percentage}%` : '-',
            final_price: formatCurrency(finalPrice),
            discount_reason: discountInfo.discount_reason || 'Pelanggan setia',
            discount_months: periodeText,
            valid_until: periodeText,
            admin_name: discountInfo.admin_name || '-',
            company_name: global.config?.company_name || 'RAF NET',
            current_date: formatDate(new Date()),
        };
        
        // Get message from template
        const fallbackMessage = `🎉 *SELAMAT! ANDA MENDAPAT DISKON* 🎉\n\n` +
            `Halo *${placeholderData.customer_name}*,\n\n` +
            `Anda mendapatkan diskon khusus untuk tagihan internet.\n\n` +
            `📋 *Detail Diskon:*\n` +
            `• Paket: ${placeholderData.package_name}\n` +
            `• Harga Normal: ${placeholderData.base_price}\n` +
            `• Potongan: ${placeholderData.discount_text}\n` +
            `• *Harga Setelah Diskon: ${placeholderData.final_price}*\n\n` +
            `📝 *Alasan:* ${placeholderData.discount_reason}\n` +
            `⏰ *Berlaku:* ${placeholderData.discount_months}\n\n` +
            `Terima kasih! 🙏\n\n` +
            `_${placeholderData.company_name}_`;
        
        const unifiedMessage = renderTemplate('discount_notification', placeholderData);
        const message = !unifiedMessage.startsWith('Error: Template') ? unifiedMessage : fallbackMessage;
        
        if (!message) {
            console.log('[DISCOUNT_NOTIF] Template disabled or not found, skipping notification');
            return;
        }
        
        await waitForWhatsAppDelay(1000);
        await emitAsync(DOMAIN_EVENTS.DISCOUNT_APPLIED, {
            recipient: phoneJid,
            message: { text: message }
        });
        console.log(`[DISCOUNT_NOTIF_SUCCESS] Notification sent to ${user.name} (${phoneJid})`);
        
    } catch (error) {
        console.error(`[DISCOUNT_NOTIF_ERROR] Failed to send notification to ${user.name}:`, error.message);
    }
}

// DELETE /api/discount/:userId - Remove discount from a user
router.delete('/:userId', ensureAdmin, async (req, res) => {
    const { userId } = req.params;
    const db = getDb();
    const now = new Date().toISOString();
    
    try {
        db.get('SELECT * FROM users WHERE id = ?', [userId], (err, user) => {
            if (err || !user) {
                db.close();
                return res.status(404).json({ status: 404, message: 'User tidak ditemukan' });
            }
            
            const sql = `
                UPDATE users SET 
                    discount_amount = 0,
                    discount_percentage = 0,
                    discount_reason = NULL,
                    discount_valid_until = NULL,
                    discount_created_by = NULL,
                    discount_created_at = NULL,
                    updated_at = ?
                WHERE id = ?
            `;
            
            db.run(sql, [now, userId], function(err) {
                if (err) {
                    db.close();
                    return res.status(500).json({ status: 500, message: 'Gagal menghapus diskon' });
                }
                
                // Update global.users
                const userIndex = global.users.findIndex(u => String(u.id) === String(userId));
                if (userIndex !== -1) {
                    global.users[userIndex].discount_amount = 0;
                    global.users[userIndex].discount_percentage = 0;
                    global.users[userIndex].discount_reason = null;
                    global.users[userIndex].discount_valid_until = null;
                    global.users[userIndex].discount_created_by = null;
                    global.users[userIndex].discount_created_at = null;
                }
                
                // Log activity
                logActivity({
                    userId: req.user.id,
                    username: req.user.username,
                    role: req.user.role,
                    actionType: 'DELETE',
                    resourceType: 'discount',
                    resourceId: userId,
                    resourceName: user.name,
                    description: `Admin menghapus diskon untuk ${user.name}`,
                    ipAddress: req.ip,
                    userAgent: req.headers['user-agent']
                }).catch(console.error);
                
                db.close();
                res.json({ status: 200, message: 'Diskon berhasil dihapus' });
            });
        });
    } catch (error) {
        db.close();
        res.status(500).json({ status: 500, message: 'Terjadi kesalahan server' });
    }
});

// GET /api/discount/effective-price/:userId - Get effective price after discount for a user
// This endpoint is accessible by teknisi and admin
router.get('/effective-price/:userId', async (req, res) => {
    if (!req.user) {
        return res.status(401).json({ status: 401, message: 'Unauthorized' });
    }
    
    const { userId } = req.params;
    const db = getDb();
    
    try {
        db.get(
            `SELECT id, name, subscription, subscription_price, 
                    discount_amount, discount_percentage, discount_reason, 
                    discount_valid_until, discount_months, discount_months_used
             FROM users WHERE id = ?`,
            [userId],
            (err, user) => {
                db.close();
                if (err) {
                    console.error('[DISCOUNT_EFFECTIVE_PRICE_ERROR]', err);
                    return res.status(500).json({ status: 500, message: 'Gagal mengambil data' });
                }
                
                if (!user) {
                    return res.status(404).json({ status: 404, message: 'User tidak ditemukan' });
                }
                
                // Calculate effective price
                const basePrice = user.subscription_price || 0;
                let discountValue = 0;
                let discountText = '';
                
                // Check if discount is still valid
                // 1. Check discount_valid_until (legacy)
                // 2. Check discount_months vs discount_months_used (new system)
                let isValid = true;
                const discountMonths = user.discount_months || 0;
                const discountMonthsUsed = user.discount_months_used || 0;
                
                if (user.discount_valid_until) {
                    isValid = new Date(user.discount_valid_until) >= new Date();
                }
                
                // Jika menggunakan sistem bulan, cek apakah masih ada sisa bulan
                if (discountMonths > 0) {
                    isValid = discountMonthsUsed < discountMonths;
                }
                
                if (isValid) {
                    if (user.discount_percentage > 0) {
                        discountValue = Math.round(basePrice * user.discount_percentage / 100);
                        discountText = `${user.discount_percentage}%`;
                    } else if (user.discount_amount > 0) {
                        discountValue = user.discount_amount;
                        discountText = `Rp ${user.discount_amount.toLocaleString('id-ID')}`;
                    }
                }
                
                const effectivePrice = Math.max(0, basePrice - discountValue);
                const remainingMonths = discountMonths > 0 ? Math.max(0, discountMonths - discountMonthsUsed) : null;
                
                res.json({
                    status: 200,
                    data: {
                        user_id: user.id,
                        user_name: user.name,
                        subscription: user.subscription,
                        base_price: basePrice,
                        discount_amount: isValid ? (user.discount_amount || 0) : 0,
                        discount_percentage: isValid ? (user.discount_percentage || 0) : 0,
                        discount_value: discountValue,
                        discount_text: discountText,
                        discount_reason: isValid ? user.discount_reason : null,
                        discount_months: discountMonths,
                        discount_months_used: discountMonthsUsed,
                        remaining_months: remainingMonths,
                        effective_price: effectivePrice,
                        has_discount: discountValue > 0,
                        is_discount_valid: isValid && discountValue > 0
                    }
                });
            }
        );
    } catch (error) {
        db.close();
        res.status(500).json({ status: 500, message: 'Terjadi kesalahan server' });
    }
});

// GET /api/discount/list/all - Get all users with active discounts
router.get('/list/all', ensureAdmin, async (req, res) => {
    const db = getDb();
    
    try {
        const sql = `
            SELECT id, name, subscription, subscription_price,
                   discount_amount, discount_percentage, discount_reason,
                   discount_months, discount_months_used,
                   discount_valid_until, discount_created_by, discount_created_at
            FROM users 
            WHERE discount_amount > 0 OR discount_percentage > 0
            ORDER BY discount_created_at DESC
        `;
        
        db.all(sql, [], (err, rows) => {
            db.close();
            if (err) {
                console.error('[DISCOUNT_LIST_ERROR]', err);
                return res.status(500).json({ status: 500, message: 'Gagal mengambil daftar diskon' });
            }
            
            // Calculate effective prices
            const usersWithDiscount = rows.map(user => {
                const basePrice = user.subscription_price || 0;
                let discountValue = 0;
                
                // Check if discount is still valid (has remaining months)
                const discountMonths = user.discount_months || 0;
                const discountMonthsUsed = user.discount_months_used || 0;
                const remainingMonths = discountMonths - discountMonthsUsed;
                const isValid = discountMonths === 0 || remainingMonths > 0; // 0 = unlimited
                
                if (isValid) {
                    if (user.discount_percentage > 0) {
                        discountValue = Math.round(basePrice * user.discount_percentage / 100);
                    } else if (user.discount_amount > 0) {
                        discountValue = user.discount_amount;
                    }
                }
                
                const effectivePrice = Math.max(0, basePrice - discountValue);
                
                return {
                    ...user,
                    discount_value: discountValue,
                    effective_price: effectivePrice,
                    remaining_months: remainingMonths,
                    is_discount_valid: isValid
                };
            });
            
            res.json({ status: 200, data: usersWithDiscount });
        });
    } catch (error) {
        db.close();
        res.status(500).json({ status: 500, message: 'Terjadi kesalahan server' });
    }
});

module.exports = router;
