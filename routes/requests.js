const express = require('express');
const fs = require('fs');
const path = require('path');
const { loadJSON, saveJSON } = require('../lib/database');
const { handlePaidStatusChange, sendTechnicianNotification } = require('../lib/approval-logic');
const { logActivity } = require('../lib/activity-logger');
const { rateLimit, validateInput } = require('../lib/security');
const { withLock } = require('../lib/request-lock');

const router = express.Router();

// Middleware for admin authentication
function ensureAdmin(req, res, next) {
    if (!req.user || !['admin', 'owner', 'superadmin'].includes(req.user.role)) {
        return res.status(403).json({ status: 403, message: "Akses ditolak. Hanya admin yang diizinkan." });
    }
    next();
}

// Helper function untuk mendapatkan harga package
function getPackagePrice(packageName) {
    // Handle null or undefined packageName
    if (!packageName || typeof packageName !== 'string') {
        console.warn('[getPackagePrice] packageName is null, undefined, or not a string:', packageName);
        return 0;
    }
    
    // First, try to find the package in the database
    const packagesDb = loadJSON('database/packages.json');
    const packageData = packagesDb.find(pkg => pkg.name === packageName);
    
    if (packageData && packageData.price) {
        return packageData.price;
    }
    
    // Fallback to parsing from package name
    const patterns = [
        /([0-9]+)K/i,           // Match patterns like "100K"
        /([0-9]+)000/,          // Match patterns like "100000"
        /([0-9]+)[.,]000/       // Match patterns like "100.000" or "100,000"
    ];
    
    for (const pattern of patterns) {
        const match = packageName.match(pattern);
        if (match) {
            const value = parseInt(match[1]);
            // If the pattern is "K", multiply by 1000
            if (pattern.source.includes('K')) {
                return value * 1000;
            }
            // For patterns with "000", return the value with 000 appended
            return value * 1000;
        }
    }
    
    return 0;
}

// Helper function untuk broadcast ke semua admin dan owner
async function broadcastToAdmins(message, excludePhoneNumbers = []) {
    if (!global.raf) {
        console.log('[BROADCAST_TO_ADMINS] WhatsApp connection not available');
        return;
    }
    
    const adminRecipients = new Set();
    
    // Tambahkan owner numbers dari config
    if (global.config.ownerNumber && Array.isArray(global.config.ownerNumber)) {
        global.config.ownerNumber.forEach(num => {
            if (num && num.trim()) {
                adminRecipients.add(num.trim());
            }
        });
    }
    
    // Tambahkan admin dan owner dari accounts database
    const adminAccounts = global.accounts.filter(acc => 
        ['admin', 'owner', 'superadmin'].includes(acc.role) && 
        acc.phone_number && 
        acc.phone_number.trim() !== ""
    );
    
    for (const admin of adminAccounts) {
        let adminJid = admin.phone_number.trim();
        if (!adminJid.endsWith('@s.whatsapp.net')) {
            if (adminJid.startsWith('0')) {
                adminJid = `62${adminJid.substring(1)}@s.whatsapp.net`;
            } else if (adminJid.startsWith('62')) {
                adminJid = `${adminJid}@s.whatsapp.net`;
            } else {
                continue;
            }
        }
        adminRecipients.add(adminJid);
    }
    
    // Filter out excluded numbers
    const recipientsToSend = Array.from(adminRecipients).filter(jid => {
        const phoneNumber = jid.replace('@s.whatsapp.net', '');
        return !excludePhoneNumbers.some(excluded => 
            jid.includes(excluded) || phoneNumber.includes(excluded)
        );
    });
    
    // Send message to all admin recipients
    // PENTING: Cek connection state dan gunakan error handling sesuai rules untuk multiple recipients
    const { delay } = await import('@whiskeysockets/baileys');
    for (const recipientJid of recipientsToSend) {
        if (global.whatsappConnectionState === 'open' && global.raf && global.raf.sendMessage) {
            try {
                if (typeof delay === 'function') await delay(1000);
                await global.raf.sendMessage(recipientJid, { text: message });
                console.log(`[BROADCAST_TO_ADMINS_SUCCESS] Message sent to ${recipientJid}`);
            } catch (error) {
                console.error('[SEND_MESSAGE_ERROR]', {
                    recipientJid,
                    error: error.message
                });
                console.error(`[BROADCAST_TO_ADMINS_ERROR] Failed to send to ${recipientJid}:`, error.message);
                // Continue to next recipient
            }
        } else {
            console.warn('[SEND_MESSAGE_SKIP] WhatsApp not connected, skipping send to', recipientJid);
        }
    }
    
    return recipientsToSend.length;
}

// GET /api/requests
router.get('/', async (req, res) => {
    if (!req.user) {
        return res.status(401).json({ status: 401, message: "Unauthorized" });
    }
    
    try {
        const allRequests = loadJSON('database/requests.json');
        
        let filteredRequests = [];
        
        // Filter berdasarkan role
        if (req.user.role === 'teknisi') {
            // Teknisi hanya bisa lihat request yang dia buat
            filteredRequests = allRequests.filter(r => String(r.requested_by_teknisi_id) === String(req.user.id));
        } else if (['admin', 'owner', 'superadmin'].includes(req.user.role)) {
            // Admin bisa lihat semua requests
            filteredRequests = allRequests;
        } else {
            return res.status(403).json({ status: 403, message: "Akses ditolak" });
        }
        
        // Enrich data dengan informasi package, requestor name, dan updated_by_name
        const enrichedRequests = filteredRequests.map(request => {
            const user = global.users.find(u => String(u.id) === String(request.userId));
            const requestorAccount = global.accounts.find(a => String(a.id) === String(request.requested_by_teknisi_id));
            const updatedByAccount = request.updated_by ? 
                (request.updated_by === 'system' ? null : global.accounts.find(a => String(a.id) === String(request.updated_by))) 
                : null;
            
            // Determine the actual current status of the user
            const currentUserPaidStatus = user ? user.paid : false;
            
            // Determine if this is adding or removing income
            // Income is added when: request approved AND newStatus is true (changing to "Sudah Bayar")
            // Income is removed when: request approved AND newStatus is false (changing to "Belum Bayar")
            const isIncomePositive = request.status === 'approved' && request.newStatus === true;
            const isIncomeNegative = request.status === 'approved' && request.newStatus === false;
            
            // Safely get package price - handle null/undefined subscription
            const packagePrice = user && user.subscription ? getPackagePrice(user.subscription) : 0;
            
            return {
                ...request,
                requestorName: requestorAccount ? (requestorAccount.name || requestorAccount.username) : `Teknisi ID ${request.requested_by_teknisi_id}`,
                packageName: user?.subscription || 'N/A',
                packagePrice: packagePrice,
                updated_by_name: request.updated_by === 'system' ? 'Sistem' : 
                                (updatedByAccount ? (updatedByAccount.name || updatedByAccount.username) : 
                                (request.updated_by ? `ID: ${request.updated_by}` : '-')),
                // Add fields for income calculation
                currentUserPaidStatus: currentUserPaidStatus,
                isIncomePositive: isIncomePositive,
                isIncomeNegative: isIncomeNegative
            };
        });
        
        console.log(`[REQUESTS] ${req.user.username} (${req.user.role}): ${enrichedRequests.length} requests`);
        
        return res.status(200).json({ 
            status: 200, 
            data: enrichedRequests 
        });
    } catch (error) {
        console.error('[REQUESTS] Error:', error.message);
        return res.status(500).json({ status: 500, message: "Terjadi kesalahan server" });
    }
});

// POST /api/requests - with rate limiting and locking
// Rate limit: 30 requests per minute (cukup untuk operasional tagihan bulanan)
router.post('/', rateLimit('create-request', 30, 60000), async (req, res) => {
    if (!req.user || req.user.role !== 'teknisi') {
        return res.status(403).json({ status: 403, message: "Akses ditolak. Hanya teknisi yang dapat mengakses fitur ini." });
    }
    let { userId, newStatus } = req.body;
    
    // Validate and sanitize inputs
    try {
        userId = validateInput(userId, 'id', { required: true, maxLength: 50 });
        newStatus = validateInput(newStatus, 'boolean', { required: true });
    } catch (error) {
        return res.status(400).json({ 
            status: 400, 
            message: `Input validation error: ${error.message}` 
        });
    }
    
    // Use lock to prevent race condition when creating request for same user
    try {
        return await withLock(`create-request-${userId}`, async () => {
            const user = global.users.find(u => String(u.id) === String(userId));
            if (!user) {
                return res.status(404).json({ status: 404, message: "User tidak ditemukan." });
            }
            
            const allRequests = loadJSON('database/requests.json');
            const existingPendingRequest = allRequests.find(r => String(r.userId) === String(userId) && r.status === 'pending');
            
            if (existingPendingRequest) {
                // Cek apakah request sudah expired (lebih dari 7 hari)
                const requestAge = Date.now() - new Date(existingPendingRequest.created_at).getTime();
                const sevenDaysInMs = 7 * 24 * 60 * 60 * 1000;
                
                if (requestAge > sevenDaysInMs) {
                    // Auto-cancel request yang sudah expired
                    existingPendingRequest.status = 'cancelled_by_system';
                    existingPendingRequest.updated_at = new Date().toISOString();
                    existingPendingRequest.updated_by = 'system';
                    saveJSON('database/requests.json', allRequests);
                    console.log(`[REQUEST_AUTO_CANCEL] Request ID ${existingPendingRequest.id} auto-cancelled karena expired (>7 hari).`);
                } else {
                    // Cek apakah status user saat ini sudah sama dengan yang diajukan
                    if (user.paid === newStatus) {
                        // Jika status sudah sama, auto-cancel request lama
                        existingPendingRequest.status = 'cancelled_by_system';
                        existingPendingRequest.updated_at = new Date().toISOString();
                        existingPendingRequest.updated_by = 'system';
                        existingPendingRequest.cancel_reason = 'Status pelanggan sudah sesuai dengan pengajuan';
                        saveJSON('database/requests.json', allRequests);
                        console.log(`[REQUEST_AUTO_CANCEL] Request ID ${existingPendingRequest.id} auto-cancelled karena status sudah sesuai.`);
                    } else {
                        const conflictingTechnicianId = existingPendingRequest.requested_by_teknisi_id;
                        if (String(conflictingTechnicianId) === String(req.user.id)) {
                            return res.status(409).json({ status: 409, message: `Anda sudah memiliki pengajuan yang sedang menunggu untuk pelanggan ${user.name}. Harap batalkan atau tunggu hingga pengajuan tersebut diproses.` });
                        } else {
                            const conflictingTechnician = global.accounts.find(acc => String(acc.id) === String(conflictingTechnicianId));
                            const conflictingTechnicianName = conflictingTechnician ? conflictingTechnician.username : 'teknisi lain';
                            const requestDate = new Date(existingPendingRequest.created_at).toLocaleString('id-ID');
                            return res.status(409).json({ status: 409, message: `Gagal: Pelanggan ${user.name} sudah memiliki pengajuan aktif yang dibuat oleh ${conflictingTechnicianName} pada ${requestDate}. Hubungi admin untuk memproses atau membatalkan pengajuan tersebut.` });
                        }
                    }
                }
            }
            
            const newRequest = {
                id: Date.now(),
                userId: userId,
                userName: user.name,
                newStatus: newStatus,
                status: 'pending',
                // Teknisi request = pembayaran CASH (diterima langsung oleh teknisi)
                payment_method: newStatus === true ? 'CASH' : null,
                created_at: new Date().toISOString(),
                updated_at: null,
                updated_by: null,
                requested_by_teknisi_id: req.user.id
            };
            allRequests.push(newRequest);
            saveJSON('database/requests.json', allRequests);
            console.log(`[REQUEST_CREATE_LOG] Teknisi ID ${req.user.id} (${req.user.username}) membuat pengajuan baru untuk User ID ${userId} (${user.name}). Payment method: ${newRequest.payment_method || 'N/A'}`);
            
            // Broadcast ke semua admin dan owner
            const teknisiName = req.user.name || req.user.username;
            const statusText = newStatus ? "SUDAH BAYAR" : "BELUM BAYAR";
            // Safely get package price - handle null/undefined subscription
            const packagePrice = user && user.subscription ? getPackagePrice(user.subscription) : 0;
            const priceText = packagePrice > 0 ? `Rp ${packagePrice.toLocaleString('id-ID')}` : 'Tidak diketahui';
            const currentDate = new Date().toLocaleString('id-ID', { 
                dateStyle: 'medium', 
                timeStyle: 'short', 
                timeZone: 'Asia/Jakarta' 
            });
            
            const messageToAdmins = `🔔 *PENGAJUAN PEMBAYARAN BARU* 🔔\n\n` +
                `Teknisi *${teknisiName}* telah mengajukan perubahan status pembayaran:\n\n` +
                `📋 *Detail Pengajuan:*\n` +
                `• ID Request: #${newRequest.id}\n` +
                `• Waktu: ${currentDate}\n\n` +
                `👤 *Data Pelanggan:*\n` +
                `• Nama: ${user.name}\n` +
                `• Paket: ${user.subscription || 'Tidak ada'}\n` +
                `• Harga: ${priceText}\n` +
                `• Telepon: ${user.phone_number || 'Tidak ada'}\n` +
                `• Alamat: ${user.address || 'Tidak ada'}\n\n` +
                `💰 *Status Pembayaran:*\n` +
                `• Status Saat Ini: ${user.paid ? 'SUDAH BAYAR' : 'BELUM BAYAR'}\n` +
                `• Status Diajukan: *${statusText}*\n\n` +
                `⚠️ *PERHATIAN:*\n` +
                `Mohon segera ditinjau dan diproses di panel admin.\n` +
                `Pengajuan ini akan otomatis dibatalkan jika tidak diproses dalam 7 hari.\n\n` +
                `🔗 *Link Panel Admin:*\n` +
                `${global.config.site_url_bot || 'http://localhost:3100'}/pembayaran/requests`;
            
            await broadcastToAdmins(messageToAdmins);
            return res.status(201).json({ status: 201, message: "Pengajuan perubahan status berhasil dibuat dan sedang menunggu persetujuan.", data: newRequest });
        });
    } catch (error) {
        console.error('[CREATE_REQUEST_LOCK_ERROR]', error);
        return res.status(500).json({ 
            status: 500,
            message: error.message === `Could not acquire lock for create-request-${userId}`
                ? 'Request sedang diproses. Silakan coba lagi.'
                : 'Terjadi kesalahan saat memproses request'
        });
    }
});

// POST /api/request/cancel - with rate limiting
// Rate limit: 30 requests per minute
router.post('/cancel', rateLimit('cancel-request', 30, 60000), async (req, res) => {
    if (!req.user || req.user.role !== 'teknisi') {
        return res.status(403).json({ status: 403, message: "Akses ditolak. Hanya teknisi yang dapat mengakses fitur ini." });
    }
    let { requestId } = req.body;
    const technicianId = req.user.id;
    
    // Validate requestId
    try {
        requestId = validateInput(requestId, 'id', { required: true, maxLength: 50 });
    } catch (error) {
        return res.status(400).json({ 
            status: 400, 
            message: `Input validation error: ${error.message}` 
        });
    }
    let allRequests = loadJSON('database/requests.json');
    const requestIndex = allRequests.findIndex(r => String(r.id) === String(requestId) && String(r.requested_by_teknisi_id) === String(technicianId));
    if (requestIndex === -1) {
        return res.status(404).json({ status: 404, message: 'Pengajuan tidak ditemukan atau Anda tidak berhak membatalkannya.' });
    }
    const requestToUpdate = allRequests[requestIndex];
    if (requestToUpdate.status !== 'pending') {
        return res.status(400).json({ status: 400, message: `Pengajuan dengan ID ${requestId} tidak dapat dibatalkan karena statusnya bukan 'pending' (Status saat ini: ${requestToUpdate.status}).` });
    }
    requestToUpdate.status = 'cancelled_by_technician';
    requestToUpdate.notes = 'Dibatalkan oleh teknisi via panel.';
    requestToUpdate.updated_at = new Date().toISOString();
    requestToUpdate.updated_by = technicianId;
    allRequests[requestIndex] = requestToUpdate;
    saveJSON('database/requests.json', allRequests);
    console.log(`[REQUEST_CANCEL_LOG] Teknisi ID ${technicianId} membatalkan pengajuan ID ${requestId}.`);
    
    // Send notification to owner
    if (global.raf && global.config.ownerNumber && Array.isArray(global.config.ownerNumber) && global.config.ownerNumber.length > 0) {
        const userPelanggan = global.users.find(u => String(u.id) === String(requestToUpdate.userId));
        const namaPelanggan = userPelanggan ? userPelanggan.name : `ID ${requestToUpdate.userId}`;
        const teknisiPembuat = global.accounts.find(acc => String(acc.id) === String(requestToUpdate.requested_by_teknisi_id));
        const namaTeknisi = teknisiPembuat ? (teknisiPembuat.name || teknisiPembuat.username) : `ID ${requestToUpdate.requested_by_teknisi_id}`;
        const messageToOwner = `🔔 *Info: Pengajuan Dibatalkan Teknisi* 🔔\n\nTeknisi *${namaTeknisi}* telah membatalkan pengajuan perubahan status pembayaran untuk pelanggan:\n\n👤 *Nama Pelanggan:* ${namaPelanggan}\n🆔 *ID Request:* ${requestToUpdate.id}\n⏰ *Waktu Pembatalan:* ${new Date(requestToUpdate.updated_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}\n\nStatus pengajuan kini: Dibatalkan oleh Teknisi.`;
        // PENTING: Cek connection state dan gunakan error handling sesuai rules untuk multiple recipients
        for (const singleOwnerNum of global.config.ownerNumber) {
            const { delay } = await import('@whiskeysockets/baileys');
            const ownerNumberJid = singleOwnerNum.endsWith('@s.whatsapp.net') ? singleOwnerNum : `${singleOwnerNum}@s.whatsapp.net`;
            if (global.whatsappConnectionState === 'open' && global.raf && global.raf.sendMessage) {
                try {
                    await delay(1000);
                    await global.raf.sendMessage(ownerNumberJid, { text: messageToOwner });
                } catch (error) {
                    console.error('[SEND_MESSAGE_ERROR]', {
                        ownerNumberJid,
                        error: error.message
                    });
                    console.error(`[REQUEST_CANCEL_NOTIF_OWNER_ERROR] Gagal kirim notif pembatalan ke owner ${ownerNumberJid}:`, error);
                    // Continue to next owner
                }
            } else {
                console.warn('[SEND_MESSAGE_SKIP] WhatsApp not connected, skipping send to owner', ownerNumberJid);
            }
        }
    }
    return res.status(200).json({ status: 200, message: `Pengajuan dengan ID ${requestId} berhasil dibatalkan.` });
});

// POST /api/approve-paid-change - with rate limiting and locking
router.post('/approve-paid-change', rateLimit('approve-request', 20, 60000), async (req, res) => {
    if (!req.user || !['admin', 'owner', 'superadmin'].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak." });
    }
    
    let { requestId, approved } = req.body;
    
    // Validate inputs
    try {
        requestId = validateInput(requestId, 'id', { required: true, maxLength: 50 });
        approved = validateInput(approved, 'boolean', { required: true });
    } catch (error) {
        return res.status(400).json({ 
            message: `Input validation error: ${error.message}` 
        });
    }
    console.log(`[API_APPROVE_PAID] Action: approve-paid-change for requestId: ${requestId}, approved: ${approved}`);
    
    // Use lock to prevent race condition on single request
    try {
        return await withLock(`request-${requestId}`, async () => {
            const allRequests = loadJSON('database/requests.json');
            const requestIndex = allRequests.findIndex(r => String(r.id) === String(requestId) && r.status === "pending");
            if (requestIndex === -1) {
                return res.status(404).json({ message: 'Permintaan tidak ditemukan atau sudah diproses.' });
            }
            
            const requestToUpdate = allRequests[requestIndex];
            const finalStatus = approved ? "approved" : "rejected";
            requestToUpdate.status = finalStatus;
            requestToUpdate.updated_at = new Date().toISOString();
            requestToUpdate.updated_by = req.user ? req.user.id : null;
            const userToUpdate = global.users.find(u => String(u.id) === String(requestToUpdate.userId));
            
            if (approved && userToUpdate) {
                const newPaidStatus = requestToUpdate.newStatus === true ? 1 : 0;
                try {
            // Check if send_invoice column exists
            const checkSendInvoiceColumn = async () => {
                return new Promise((resolve) => {
                    global.db.all(`PRAGMA table_info(users)`, (err, columns) => {
                        if (err) {
                            console.error('[APPROVE_CHECK_COLUMN_ERROR]', err.message);
                            return resolve(false);
                        }
                        const hasSendInvoice = columns.some(col => col.name === 'send_invoice');
                        if (!hasSendInvoice) {
                            console.log('[APPROVE_SCHEMA_UPDATE] Adding missing send_invoice column...');
                            global.db.run(`ALTER TABLE users ADD COLUMN send_invoice INTEGER DEFAULT 0`, (alterErr) => {
                                if (alterErr) {
                                    console.error('[APPROVE_ADD_COLUMN_ERROR]', alterErr.message);
                                    return resolve(false);
                                }
                                console.log('[APPROVE_SCHEMA_UPDATE] send_invoice column added successfully.');
                                resolve(true);
                            });
                        } else {
                            resolve(true);
                        }
                    });
                });
            };
            
            const hasSendInvoiceColumn = await checkSendInvoiceColumn();
            const sendInvoiceValue = req.body.send_invoice === true || req.body.send_invoice === 'true' || req.body.send_invoice === 1 ? 1 : 0;
            
            // Update database with or without send_invoice column
            if (hasSendInvoiceColumn) {
                await new Promise((resolve, reject) => {
                    global.db.run('UPDATE users SET paid = ?, send_invoice = ? WHERE id = ?', [newPaidStatus, sendInvoiceValue, userToUpdate.id], function(err) {
                        if (err) {
                            console.error(`[APPROVE_PAID_DB_ERROR] Gagal update status paid dan send_invoice untuk user ID ${userToUpdate.id}:`, err.message);
                            return reject(new Error(`Gagal memperbarui status paid dan send_invoice di database untuk user ID ${userToUpdate.id}.`));
                        }
                        resolve();
                    });
                });
                userToUpdate.send_invoice = (sendInvoiceValue === 1);
            } else {
                // Update only paid status if send_invoice column doesn't exist
                await new Promise((resolve, reject) => {
                    global.db.run('UPDATE users SET paid = ? WHERE id = ?', [newPaidStatus, userToUpdate.id], function(err) {
                        if (err) {
                            console.error(`[APPROVE_PAID_DB_ERROR] Gagal update status paid untuk user ID ${userToUpdate.id}:`, err.message);
                            return reject(new Error(`Gagal memperbarui status paid di database untuk user ID ${userToUpdate.id}.`));
                        }
                        resolve();
                    });
                });
            }
                    const oldPaidStatus = userToUpdate.paid;
                    userToUpdate.paid = (newPaidStatus === 1);
                    
                    // Log activity
                    try {
                        await logActivity({
                            userId: req.user.id,
                            username: req.user.username,
                            role: req.user.role,
                            actionType: 'UPDATE',
                            resourceType: 'payment',
                            resourceId: userToUpdate.id.toString(),
                            resourceName: userToUpdate.name,
                            description: `Approved payment request for user ${userToUpdate.name}`,
                            oldValue: { paid: oldPaidStatus },
                            newValue: { paid: userToUpdate.paid },
                            ipAddress: req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'],
                            userAgent: req.headers['user-agent']
                        });
                    } catch (logErr) {
                        console.error('[ACTIVITY_LOG_ERROR] Failed to log payment approval:', logErr);
                    }
                    
                    if (userToUpdate.paid === true) {
                        // Determine payment method:
                        // 1. If admin provides payment_method in request body, use that
                        // 2. Otherwise, use payment_method from the original request
                        // 3. If request is from teknisi and newStatus is true (Sudah Bayar), default to CASH
                        //    because teknisi receives cash directly from customer in the field
                        // 4. Fallback to TRANSFER_BANK for backward compatibility
                        let paymentMethod = 'TRANSFER_BANK';
                        if (req.body.payment_method && ['CASH', 'TRANSFER_BANK'].includes(req.body.payment_method)) {
                            paymentMethod = req.body.payment_method;
                        } else if (requestToUpdate.payment_method) {
                            paymentMethod = requestToUpdate.payment_method;
                        } else if (requestToUpdate.requested_by_teknisi_id && requestToUpdate.newStatus === true) {
                            // Old teknisi requests without payment_method field - default to CASH
                            paymentMethod = 'CASH';
                        }
                        
                        // Store payment_method in request for history
                        requestToUpdate.payment_method = paymentMethod;
                        
                        console.log(`[APPROVE_PAID] Payment method for ${userToUpdate.name}: ${paymentMethod}`);
                        
                        // Record payment in payment_history table
                        const currentMonth = new Date().getMonth() + 1;
                        const currentYear = new Date().getFullYear();
                        const amountPaid = requestToUpdate.amount_paid || getPackagePrice(userToUpdate.subscription);
                        const amountDue = requestToUpdate.amount_due || getPackagePrice(userToUpdate.subscription);
                        const isPartial = requestToUpdate.is_partial_payment || false;
                        const createdBy = requestToUpdate.requested_by_teknisi_id 
                            ? (global.accounts.find(a => String(a.id) === String(requestToUpdate.requested_by_teknisi_id))?.username || 'teknisi')
                            : (req.user?.username || 'admin');
                        
                        try {
                            await new Promise((resolve, reject) => {
                                global.db.run(
                                    `INSERT INTO payment_history (user_id, amount_paid, amount_due, is_partial, period_month, period_year, payment_method, notes, created_by, created_at)
                                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
                                    [
                                        userToUpdate.id,
                                        amountPaid,
                                        amountDue,
                                        isPartial ? 1 : 0,
                                        currentMonth,
                                        currentYear,
                                        paymentMethod,
                                        requestToUpdate.notes || `Pembayaran via approval request #${requestToUpdate.id}`,
                                        createdBy
                                    ],
                                    function(err) {
                                        if (err) {
                                            console.error(`[APPROVE_PAID_HISTORY_ERROR] Failed to record payment history:`, err.message);
                                            reject(err);
                                        } else {
                                            console.log(`[APPROVE_PAID_HISTORY] Payment recorded for ${userToUpdate.name}: Rp ${amountPaid.toLocaleString('id-ID')}`);
                                            resolve(this.lastID);
                                        }
                                    }
                                );
                            });
                        } catch (historyError) {
                            console.error(`[APPROVE_PAID_HISTORY_ERROR] Could not record payment history:`, historyError.message);
                            // Continue anyway - payment status is already updated
                        }
                        
                        // Increment discount_months_used jika user memiliki diskon berbasis bulan
                        if (userToUpdate.discount_months > 0 && userToUpdate.discount_months_used < userToUpdate.discount_months) {
                            const newDiscountMonthsUsed = (userToUpdate.discount_months_used || 0) + 1;
                            await new Promise((resolve, reject) => {
                                global.db.run('UPDATE users SET discount_months_used = ? WHERE id = ?', 
                                    [newDiscountMonthsUsed, userToUpdate.id], 
                                    function(err) {
                                        if (err) {
                                            console.error(`[APPROVE_PAID_DISCOUNT_ERROR] Gagal update discount_months_used untuk user ID ${userToUpdate.id}:`, err.message);
                                            return reject(err);
                                        }
                                        console.log(`[APPROVE_PAID_DISCOUNT] Updated discount_months_used for ${userToUpdate.name}: ${newDiscountMonthsUsed}/${userToUpdate.discount_months}`);
                                        resolve();
                                    }
                                );
                            });
                            userToUpdate.discount_months_used = newDiscountMonthsUsed;
                            
                            // Jika sudah habis periode diskon, reset diskon
                            if (newDiscountMonthsUsed >= userToUpdate.discount_months) {
                                console.log(`[APPROVE_PAID_DISCOUNT] Discount period ended for ${userToUpdate.name}, resetting discount...`);
                                await new Promise((resolve, reject) => {
                                    global.db.run(`UPDATE users SET 
                                        discount_amount = 0, 
                                        discount_percentage = 0, 
                                        discount_reason = NULL,
                                        discount_valid_until = NULL,
                                        discount_created_by = NULL,
                                        discount_created_at = NULL
                                        WHERE id = ?`, 
                                        [userToUpdate.id], 
                                        function(err) {
                                            if (err) {
                                                console.error(`[APPROVE_PAID_DISCOUNT_RESET_ERROR]`, err.message);
                                                return reject(err);
                                            }
                                            console.log(`[APPROVE_PAID_DISCOUNT] Discount reset for ${userToUpdate.name}`);
                                            resolve();
                                        }
                                    );
                                });
                                // Update global.users
                                userToUpdate.discount_amount = 0;
                                userToUpdate.discount_percentage = 0;
                                userToUpdate.discount_reason = null;
                                userToUpdate.discount_valid_until = null;
                                userToUpdate.discount_created_by = null;
                                userToUpdate.discount_created_at = null;
                            }
                        }
                        
                        // handlePaidStatusChange now handles invoice PDF sending based on send_invoice flag
                        await handlePaidStatusChange(userToUpdate, {
                            paidDate: new Date().toISOString(),
                            method: paymentMethod,
                            approvedBy: req.user ? req.user.username : 'Admin',
                            notes: `Pembayaran disetujui melalui sistem approval (${paymentMethod === 'CASH' ? 'Tunai' : 'Transfer Bank'})`,
                            requestedByTeknisiId: requestToUpdate.requested_by_teknisi_id,
                            isPartial: requestToUpdate.is_partial_payment,
                            amountPaid: requestToUpdate.amount_paid,
                            amountRemaining: requestToUpdate.amount_remaining
                        });
                    }
                } catch (e) {
                    console.error(`[ASYNC_APPROVE_PAID_ERROR] A post-approval operation failed for user ${userToUpdate.name}:`, e.message);
                    return res.status(500).json({ status: 500, message: `Proses persetujuan gagal: ${e.message}` });
                }
                allRequests[requestIndex] = requestToUpdate;
                saveJSON('database/requests.json', allRequests);
                sendTechnicianNotification(true, requestToUpdate, userToUpdate);
                return res.json({ message: `Permintaan berhasil di-approved.` });
            } else {
                allRequests[requestIndex] = requestToUpdate;
                saveJSON('database/requests.json', allRequests);
                return res.json({ message: `Permintaan berhasil di-${finalStatus}.` });
            }
        });
    } catch (error) {
        console.error('[APPROVE_PAID_LOCK_ERROR]', error);
        return res.status(500).json({ 
            message: error.message === `Could not acquire lock for request-${requestId}`
                ? 'Request sedang diproses. Silakan coba lagi.'
                : 'Terjadi kesalahan saat memproses request'
        });
    }
});

// POST /api/requests/bulk-approve - Approve maksimal 20 request per klik
// Admin harus klik lagi untuk approve batch berikutnya
router.post('/bulk-approve', ensureAdmin, rateLimit('bulk-approve', 30, 60000), async (req, res) => {
    // Use lock to prevent race conditions during bulk operations
    try {
        return await withLock('bulk-approve-requests', async () => {
        let { requestIds } = req.body;
        
        // Validate input
        try {
            requestIds = validateInput(requestIds, 'array', { 
                required: true, 
                minItems: 1, 
                maxItems: 500  // Accept up to 500, but only process 20
            });
            
            // Validate each ID in the array
            requestIds = requestIds.map(id => 
                validateInput(id, 'id', { required: true, maxLength: 50 })
            );
        } catch (error) {
            return res.status(400).json({
                status: 400,
                message: `Input validation error: ${error.message}`
            });
        }
        
        // LIMIT: Hanya proses maksimal 20 request per klik
        const MAX_PER_BATCH = 20;
        const totalRequested = requestIds.length;
        const requestIdsToProcess = requestIds.slice(0, MAX_PER_BATCH);
        const remainingCount = Math.max(0, totalRequested - MAX_PER_BATCH);
        
        const allRequests = loadJSON('database/requests.json');
        const results = {
            approved: [],
            failed: [],
            notFound: [],
            remaining: remainingCount,
            totalRequested: totalRequested,
            processed: requestIdsToProcess.length
        };
        
        // Helper function to check send_invoice column (cache result)
        let hasSendInvoiceColumn = null;
        const checkSendInvoiceColumn = async () => {
            if (hasSendInvoiceColumn !== null) return hasSendInvoiceColumn;
            return new Promise((resolve) => {
                global.db.all("PRAGMA table_info(users)", (err, columns) => {
                    if (err) {
                        console.error('[BULK_APPROVE_PRAGMA_ERROR]', err);
                        hasSendInvoiceColumn = false;
                        resolve(false);
                        return;
                    }
                    hasSendInvoiceColumn = columns.some(col => col.name === 'send_invoice');
                    resolve(hasSendInvoiceColumn);
                });
            });
        };
        
        // Log bulk operation start
        console.log(`[BULK_APPROVE] Processing ${requestIdsToProcess.length} of ${totalRequested} requests by ${req.user.username}`);
        const startTime = Date.now();
        
        // Process requests (max 20)
        for (const requestId of requestIdsToProcess) {
            const requestIndex = allRequests.findIndex(r => String(r.id) === String(requestId));
            
            if (requestIndex === -1) {
                results.notFound.push(requestId);
                continue;
            }
            
            const request = allRequests[requestIndex];
            
            // Skip if not pending
            if (request.status !== 'pending') {
                results.failed.push({
                    id: requestId,
                    reason: `Status bukan pending (status: ${request.status})`
                });
                continue;
            }
            
            // Find user
            const user = global.users.find(u => String(u.id) === String(request.userId));
            if (!user) {
                results.failed.push({
                    id: requestId,
                    reason: 'User tidak ditemukan'
                });
                continue;
            }
            
            try {
                // Update request status
                request.status = 'approved';
                request.updated_at = new Date().toISOString();
                request.updated_by = req.user.username;
                
                // Update user paid status
                const newPaidStatus = request.newStatus;
                user.paid = newPaidStatus;
                
                // Check if send_invoice column exists (use cached result)
                const hasColumn = await checkSendInvoiceColumn();
                
                // Update database
                if (hasColumn) {
                    const sendInvoiceValue = user.send_invoice ? 1 : 0;
                    await new Promise((resolve, reject) => {
                        global.db.run('UPDATE users SET paid = ?, send_invoice = ? WHERE id = ?', 
                            [newPaidStatus ? 1 : 0, sendInvoiceValue, user.id], 
                            function(err) {
                                if (err) reject(err);
                                else resolve();
                            }
                        );
                    });
                } else {
                    await new Promise((resolve, reject) => {
                        global.db.run('UPDATE users SET paid = ? WHERE id = ?', 
                            [newPaidStatus ? 1 : 0, user.id], 
                            function(err) {
                                if (err) reject(err);
                                else resolve();
                            }
                        );
                    });
                }
                
                // Handle paid status change (send invoice if needed)
                if (newPaidStatus === true) {
                    // Use payment_method from original request (CASH for teknisi) or fallback to TRANSFER_BANK
                    const paymentMethod = request.payment_method || 'TRANSFER_BANK';
                    request.payment_method = paymentMethod; // Store for history
                    
                    // Increment discount_months_used jika user memiliki diskon berbasis bulan
                    if (user.discount_months > 0 && user.discount_months_used < user.discount_months) {
                        const newDiscountMonthsUsed = (user.discount_months_used || 0) + 1;
                        await new Promise((resolve, reject) => {
                            global.db.run('UPDATE users SET discount_months_used = ? WHERE id = ?', 
                                [newDiscountMonthsUsed, user.id], 
                                function(err) {
                                    if (err) return reject(err);
                                    resolve();
                                }
                            );
                        });
                        user.discount_months_used = newDiscountMonthsUsed;
                        console.log(`[BULK_APPROVE_DISCOUNT] Updated discount_months_used for ${user.name}: ${newDiscountMonthsUsed}/${user.discount_months}`);
                        
                        // Jika sudah habis periode diskon, reset diskon
                        if (newDiscountMonthsUsed >= user.discount_months) {
                            await new Promise((resolve, reject) => {
                                global.db.run(`UPDATE users SET 
                                    discount_amount = 0, 
                                    discount_percentage = 0, 
                                    discount_reason = NULL,
                                    discount_valid_until = NULL,
                                    discount_created_by = NULL,
                                    discount_created_at = NULL
                                    WHERE id = ?`, 
                                    [user.id], 
                                    function(err) {
                                        if (err) return reject(err);
                                        resolve();
                                    }
                                );
                            });
                            user.discount_amount = 0;
                            user.discount_percentage = 0;
                            user.discount_reason = null;
                            console.log(`[BULK_APPROVE_DISCOUNT] Discount reset for ${user.name}`);
                        }
                    }
                    
                    await handlePaidStatusChange(user, {
                        paidDate: new Date().toISOString(),
                        method: paymentMethod,
                        approvedBy: req.user.username,
                        notes: `Status pembayaran diperbarui (${paymentMethod === 'CASH' ? 'Tunai' : 'Transfer Bank'})`
                    });
                }
                
                // Send notification to technician
                sendTechnicianNotification(true, request, user);
                
                results.approved.push({
                    id: requestId,
                    userName: user.name,
                    newStatus: newPaidStatus
                });
                
            } catch (error) {
                console.error(`[BULK_APPROVE_ERROR] Failed to approve request ${requestId}:`, error);
                results.failed.push({
                    id: requestId,
                    reason: error.message
                });
            }
        }
        
        // Save all requests
        saveJSON('database/requests.json', allRequests);
        
        // Log completion
        const elapsedTime = Date.now() - startTime;
        console.log(`[BULK_APPROVE] Completed in ${elapsedTime}ms. Approved: ${results.approved.length}, Failed: ${results.failed.length}, Not Found: ${results.notFound.length}, Remaining: ${remainingCount}`);
        
        // Prepare response message
        let message = '';
        if (results.approved.length > 0) {
            message += `✅ ${results.approved.length} permintaan berhasil disetujui.`;
        }
        if (results.failed.length > 0) {
            message += ` ❌ ${results.failed.length} gagal.`;
        }
        if (results.notFound.length > 0) {
            message += ` ⚠️ ${results.notFound.length} tidak ditemukan.`;
        }
        if (remainingCount > 0) {
            message += ` 📋 Sisa ${remainingCount} request pending. Klik lagi untuk approve batch berikutnya.`;
        }
        
            return res.json({
                status: 200,
                message: message.trim(),
                results
            });
        });
    } catch (error) {
        console.error('[BULK_APPROVE_ERROR]', error);
        return res.status(500).json({
            status: 500,
            message: error.message === `Could not acquire lock for bulk-approve-requests` 
                ? 'Sedang ada proses bulk approve lain yang berjalan. Silakan coba lagi.'
                : 'Terjadi kesalahan saat memproses bulk approval'
        });
    }
});

module.exports = router;
