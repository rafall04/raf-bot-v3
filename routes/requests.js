/**
 * Header Doc
 * Purpose: Router approval request pembayaran teknisi/admin termasuk create/cancel/approve/bulk dan notifikasi owner.
 * Caller: Express route registry/admin teknisi payment flow.
 * Deps: database, approval logic, activity logger, request lock, template-service, WhatsApp delivery/gateway, payment finance service.
 * MainFuncs: ensureAdmin, broadcastToAdmins, create/cancel/approve/bulk payment request routes.
 * SideEffects: Menulis request/payment state, ledger pembayaran, activity log, dan mengirim notifikasi WhatsApp owner/admin.
 */
const express = require('express');
const { loadJSON, saveJSON } = require('../lib/database');
const { handlePaidStatusChange, sendTechnicianNotification } = require('../lib/approval-logic');
const { logActivity } = require('../lib/activity-logger');
const { rateLimit, validateInput } = require('../lib/security');
const { withLock } = require('../lib/request-lock');
const { sendMessageToMany } = require('../lib/whatsapp-delivery-service');
const { hasAuthenticatedSession } = require('../lib/whatsapp-gateway');
const { renderCategoryTemplate } = require('../lib/template-service');
const { createPaymentApprovalService, resolveArahPersetujuan } = require('../services/payment-approval.service');
const {
    getPeriodParts
} = require('../lib/technician-collection-settlement');
const {
    applyPaymentStatusChange,
    getPackagePrice: _getPackagePrice,
    getEffectivePrice,
    normalizeUserPaymentMethod,
    normalizePaymentRequestScope,
    isSamePaymentRequestScope
} = require('../lib/payment-finance-service');

const router = express.Router();
const paymentApprovalService = createPaymentApprovalService();

function renderResponseTemplate(key, data = {}) {
    return renderCategoryTemplate('responseTemplates', key, data).text;
}

// Middleware for admin authentication
function ensureAdmin(req, res, next) {
    if (!req.user || !['admin', 'owner', 'superadmin'].includes(req.user.role)) {
        return res.status(403).json({ status: 403, message: "Akses ditolak. Hanya admin yang diizinkan." });
    }
    next();
}

// Helper function untuk broadcast ke semua admin dan owner
// Susun daftar JID admin/owner penerima notifikasi (dari config.ownerNumber + accounts role admin).
// Dipisah dari broadcastToAdmins supaya jalur digest bisa memakai daftar yang sama.
function getAdminNotificationRecipients(excludePhoneNumbers = []) {
    const adminRecipients = new Set();

    if (global.config.ownerNumber && Array.isArray(global.config.ownerNumber)) {
        global.config.ownerNumber.forEach(num => {
            if (num && num.trim()) adminRecipients.add(num.trim());
        });
    }

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

    return Array.from(adminRecipients).filter(jid => {
        const phoneNumber = jid.replace('@s.whatsapp.net', '');
        return !excludePhoneNumbers.some(excluded =>
            jid.includes(excluded) || phoneNumber.includes(excluded)
        );
    });
}

// URL panel admin yang BISA DIKETUK dari HP. `site_url_bot` adalah loopback (127.0.0.1) —
// tautan mati saat diketuk. Pakai adminUrl publik bila ada; kalau tidak, JANGAN sertakan link
// loopback (lebih baik tanpa link daripada link mati).
function resolveAdminPanelUrl(pathSuffix = '/pembayaran/requests') {
    const c = global.config || {};
    const base = (c.paymentProof && c.paymentProof.adminUrl) || c.adminPanelUrl || '';
    if (base && !/127\.0\.0\.1|localhost/.test(base)) {
        return `${base.replace(/\/+$/, '')}${pathSuffix}`;
    }
    return '';
}

async function broadcastToAdmins(message, excludePhoneNumbers = []) {
    if (!hasAuthenticatedSession()) {
        console.log('[BROADCAST_TO_ADMINS] WhatsApp connection not available');
        return;
    }

    const recipientsToSend = getAdminNotificationRecipients(excludePhoneNumbers);
    const delivery = await sendMessageToMany(recipientsToSend, { text: message });
    console.log('[BROADCAST_TO_ADMINS_RESULT]', {
        requested: recipientsToSend.length,
        delivered: delivery.successCount,
        errorCode: delivery.errorCode || null
    });

    return recipientsToSend.length;
}

// GET /api/requests
router.get('/', async (req, res) => {
    if (!req.user) {
        return res.status(401).json({ status: 401, message: "Unauthorized" });
    }
    
    try {
        const allRequests = loadJSON('database/requests.json').map(normalizePaymentRequestScope);
        
        let filteredRequests = [];
        
        // Filter berdasarkan role
        if (req.user.role === 'teknisi') {
            // Teknisi hanya bisa lihat request yang dia buat
            filteredRequests = allRequests.filter(r => String(r.requested_by_teknisi_id) === String(req.user.id));
        } else if (req.user.role === 'agen') {
            // Agen hanya bisa lihat request yang dia buat
            filteredRequests = allRequests.filter(r => String(r.requested_by_agen_id) === String(req.user.id));
        } else if (['admin', 'owner', 'superadmin'].includes(req.user.role)) {
            // Admin bisa lihat semua requests
            filteredRequests = allRequests;
        } else {
            return res.status(403).json({ status: 403, message: "Akses ditolak" });
        }
        
        // Enrich data dengan informasi package, requestor name, dan updated_by_name
        const enrichedRequests = filteredRequests.map(request => {
            const user = global.users.find(u => String(u.id) === String(request.userId));
            const requestorId = request.requested_by_agen_id || request.requested_by_teknisi_id;
            const requestorAccount = global.accounts.find(a => String(a.id) === String(requestorId));
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
            const packagePrice = user ? getEffectivePrice(user) : 0;
            
            return {
                ...request,
                requestorName: requestorAccount ? (requestorAccount.name || requestorAccount.username) : `${request.collector_role === 'agen' ? 'Agen' : 'Teknisi'} ID ${requestorId}`,
                packageName: user?.subscription || 'N/A',
                packagePrice: packagePrice,
                updated_by_name: request.updated_by === 'system' ? 'Sistem' : 
                                (updatedByAccount ? (updatedByAccount.name || updatedByAccount.username) : 
                                (request.updated_by ? `ID: ${request.updated_by}` : '-')),
                period_month: request.period_month,
                period_year: request.period_year,
                request_type: request.request_type,
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
    if (!req.user || !['teknisi', 'agen'].includes(req.user.role)) {
        return res.status(403).json({ status: 403, message: "Akses ditolak. Hanya teknisi atau agen yang dapat mengakses fitur ini." });
    }
    const isAgenRequestor = req.user.role === 'agen';
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

            // Agen hanya boleh menagih pelanggan yang ditugaskan kepadanya.
            if (isAgenRequestor && String(user.assigned_agen_id || '') !== String(req.user.id)) {
                return res.status(403).json({ status: 403, message: "Akses ditolak. Pelanggan ini tidak ditugaskan kepada Anda." });
            }

            const { periodMonth, periodYear } = getPeriodParts({ date: new Date() });
            const scopedDraft = {
                userId,
                request_type: 'payment_status_change',
                period_month: periodMonth,
                period_year: periodYear
            };
            const allRequests = loadJSON('database/requests.json').map(normalizePaymentRequestScope);
            const existingPendingRequest = allRequests.find((request) => request.status === 'pending' && isSamePaymentRequestScope(request, scopedDraft));
            
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
                        const conflictingOwnerId = existingPendingRequest.requested_by_agen_id || existingPendingRequest.requested_by_teknisi_id;
                        // Sebutkan JENIS yang menghalangi. Sejak penjaga jadi tipe-agnostik (#b254),
                        // pengajuan cicilan bisa menolak pengajuan pelunasan — tanpa disebutkan,
                        // teknisi bingung ("saya belum pernah kirim yang penuh").
                        const jenisPenghalang = existingPendingRequest.request_type === 'partial_payment'
                            ? 'cicilan'
                            : 'pelunasan penuh';
                        if (String(conflictingOwnerId) === String(req.user.id)) {
                            return res.status(409).json({ status: 409, message: `Anda sudah punya pengajuan *${jenisPenghalang}* yang menunggu untuk pelanggan ${user.name} di periode ini. Batalkan dulu pengajuan itu, atau tunggu admin memprosesnya.` });
                        } else {
                            const conflictingOwner = global.accounts.find(acc => String(acc.id) === String(conflictingOwnerId));
                            const conflictingOwnerName = conflictingOwner ? conflictingOwner.username : 'petugas lain';
                            const requestDate = new Date(existingPendingRequest.created_at).toLocaleString('id-ID');
                            return res.status(409).json({ status: 409, message: `Gagal: Pelanggan ${user.name} sudah memiliki pengajuan aktif yang dibuat oleh ${conflictingOwnerName} pada ${requestDate}. Hubungi admin untuk memproses atau membatalkan pengajuan tersebut.` });
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
                request_type: 'payment_status_change',
                period_month: periodMonth,
                period_year: periodYear,
                // Teknisi/agen request = pembayaran CASH (diterima langsung di lapangan)
                payment_method: newStatus === true ? 'CASH' : null,
                created_at: new Date().toISOString(),
                updated_at: null,
                updated_by: null,
                collector_role: isAgenRequestor ? 'agen' : 'teknisi',
                requested_by_teknisi_id: isAgenRequestor ? null : req.user.id,
                requested_by_agen_id: isAgenRequestor ? req.user.id : null
            };
            allRequests.push(newRequest);
            saveJSON('database/requests.json', allRequests);
            console.log(`[REQUEST_CREATE_LOG] ${isAgenRequestor ? 'Agen' : 'Teknisi'} ID ${req.user.id} (${req.user.username}) membuat pengajuan baru untuk User ID ${userId} (${user.name}). Payment method: ${newRequest.payment_method || 'N/A'}`);
            
            // Broadcast ke semua admin dan owner
            const teknisiName = req.user.name || req.user.username;
            const statusText = newStatus ? "SUDAH BAYAR" : "BELUM BAYAR";
            // Safely get package price - handle null/undefined subscription
            const packagePrice = user ? getEffectivePrice(user) : 0;
            const priceText = packagePrice > 0 ? `Rp ${packagePrice.toLocaleString('id-ID')}` : 'Tidak diketahui';
            const currentDate = new Date().toLocaleString('id-ID', { 
                dateStyle: 'medium', 
                timeStyle: 'short', 
                timeZone: 'Asia/Jakarta' 
            });
            
            // Link panel yang bisa diketuk dari HP (loopback → dibiarkan kosong oleh template).
            const adminPanelUrl = resolveAdminPanelUrl('/pembayaran/requests');
            const messageToAdmins = renderResponseTemplate('routes_request_payment_new_owner_notification', {
                technicianName: teknisiName,
                requestId: newRequest.id,
                requestedAt: currentDate,
                customerName: user.name,
                packageName: user.subscription || 'Tidak ada',
                price: priceText,
                phoneNumber: user.phone_number || 'Tidak ada',
                address: user.address || 'Tidak ada',
                currentStatus: user.paid ? 'SUDAH BAYAR' : 'BELUM BAYAR',
                requestedStatus: statusText,
                // Jangan pakai loopback (127.0.0.1) — mati saat diketuk dari HP. URL publik bila ada,
                // kalau tidak instruksi singkat (label "Link Panel Admin" tetap bermakna, bukan link mati).
                adminUrl: adminPanelUrl || 'Buka panel admin → menu Pembayaran → Pengajuan.'
            });

            // Digest anti-spam: pengajuan PERTAMA ke tiap admin dikirim detail penuh & membuka
            // jendela; pengajuan berikutnya dalam jendela digabung jadi satu ringkasan (lib/notification-digest).
            // Request tunggal tetap instan. Gate config.paymentRequestDigest.enabled (default OFF → perilaku lama).
            const digestCfg = (global.config && global.config.paymentRequestDigest) || {};
            if (digestCfg.enabled === true && hasAuthenticatedSession()) {
                try {
                    const { enqueueOrSendFirst } = require('../lib/notification-digest');
                    const windowMs = Number.isFinite(digestCfg.windowMinutes)
                        ? digestCfg.windowMinutes * 60000
                        : undefined;
                    const recipients = getAdminNotificationRecipients();
                    for (const recipient of recipients) {
                        await enqueueOrSendFirst({
                            recipient,
                            kind: 'payment_request_new',
                            detailText: messageToAdmins,
                            summaryItem: {
                                customerName: user.name,
                                price: packagePrice,
                                teknisiName,
                                adminUrl: adminPanelUrl
                            },
                            windowMs
                        });
                    }
                } catch (digestErr) {
                    // Never-throw: kalau digest gagal, jatuh ke broadcast biasa agar notifikasi tak hilang.
                    console.error('[NOTIF_DIGEST] enqueue gagal, fallback broadcast:', digestErr.message);
                    await broadcastToAdmins(messageToAdmins);
                }
            } else {
                await broadcastToAdmins(messageToAdmins);
            }
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
    if (!req.user || !['teknisi', 'agen'].includes(req.user.role)) {
        return res.status(403).json({ status: 403, message: "Akses ditolak. Hanya teknisi atau agen yang dapat mengakses fitur ini." });
    }
    const isAgenRequestor = req.user.role === 'agen';
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
    let allRequests = loadJSON('database/requests.json').map(normalizePaymentRequestScope);
    const ownerField = isAgenRequestor ? 'requested_by_agen_id' : 'requested_by_teknisi_id';
    const requestIndex = allRequests.findIndex(r => String(r.id) === String(requestId) && String(r[ownerField]) === String(technicianId));
    if (requestIndex === -1) {
        return res.status(404).json({ status: 404, message: 'Pengajuan tidak ditemukan atau Anda tidak berhak membatalkannya.' });
    }
    const requestToUpdate = allRequests[requestIndex];
    if (requestToUpdate.status !== 'pending') {
        return res.status(400).json({ status: 400, message: `Pengajuan dengan ID ${requestId} tidak dapat dibatalkan karena statusnya bukan 'pending' (Status saat ini: ${requestToUpdate.status}).` });
    }
    requestToUpdate.status = isAgenRequestor ? 'cancelled_by_agen' : 'cancelled_by_technician';
    requestToUpdate.notes = isAgenRequestor ? 'Dibatalkan oleh agen via panel.' : 'Dibatalkan oleh teknisi via panel.';
    requestToUpdate.updated_at = new Date().toISOString();
    requestToUpdate.updated_by = technicianId;
    allRequests[requestIndex] = requestToUpdate;
    saveJSON('database/requests.json', allRequests);
    console.log(`[REQUEST_CANCEL_LOG] Teknisi ID ${technicianId} membatalkan pengajuan ID ${requestId}.`);
    
    // Send notification to owner
    if (hasAuthenticatedSession() && global.config.ownerNumber && Array.isArray(global.config.ownerNumber) && global.config.ownerNumber.length > 0) {
        const userPelanggan = global.users.find(u => String(u.id) === String(requestToUpdate.userId));
        const namaPelanggan = userPelanggan ? userPelanggan.name : `ID ${requestToUpdate.userId}`;
        const teknisiPembuat = global.accounts.find(acc => String(acc.id) === String(requestToUpdate.requested_by_teknisi_id));
        const namaTeknisi = teknisiPembuat ? (teknisiPembuat.name || teknisiPembuat.username) : `ID ${requestToUpdate.requested_by_teknisi_id}`;
        const messageToOwner = renderResponseTemplate('routes_request_payment_cancelled_owner_notification', {
            technicianName: namaTeknisi,
            customerName: namaPelanggan,
            requestId: requestToUpdate.id,
            cancelledAt: new Date(requestToUpdate.updated_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
        });
        const ownerDelivery = await sendMessageToMany(global.config.ownerNumber, { text: messageToOwner });
        if (!ownerDelivery.sent) {
            console.error('[REQUEST_CANCEL_NOTIF_OWNER_ERROR]', ownerDelivery.errorCode || 'SEND_FAILED');
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
            const allRequests = loadJSON('database/requests.json').map(normalizePaymentRequestScope);
            const requestIndex = allRequests.findIndex(r => String(r.id) === String(requestId) && r.status === "pending");
            if (requestIndex === -1) {
                return res.status(404).json({ message: 'Permintaan tidak ditemukan atau sudah diproses.' });
            }
            
            const requestToUpdate = allRequests[requestIndex];
            const finalStatus = approved ? "approved" : "rejected";
            const requestTimestamp = new Date().toISOString();
            const nextRequestState = {
                ...requestToUpdate,
                status: finalStatus,
                updated_at: requestTimestamp,
                updated_by: req.user ? req.user.id : null
            };
            const userToUpdate = global.users.find(u => String(u.id) === String(requestToUpdate.userId));
            
            if (approved && !userToUpdate) {
                return res.status(404).json({ status: 404, message: 'User untuk pengajuan ini tidak ditemukan.' });
            }

            if (approved && userToUpdate) {
                // Arah persetujuan ditentukan JENIS pengajuan, bukan boolean `newStatus`.
                // `routes/partial-payment.js` menyimpan cicilan dengan `newStatus: isFullyPaid`
                // = false justru saat teknisi MENERIMA uang, sehingga pemetaan lama
                // (`newStatus === true ? 1 : 0`) mengirim setiap cicilan ke cabang PEMBALIKAN.
                const arahPersetujuan = resolveArahPersetujuan(requestToUpdate);
                if (arahPersetujuan.arah === "tolak") {
                    return res.status(400).json({ status: 400, message: arahPersetujuan.alasan });
                }
                const newPaidStatus = arahPersetujuan.arah === "kredit" ? 1 : 0;
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
            
                const oldPaidStatus = userToUpdate.paid;
                    
                    let financeResult;
                    if (newPaidStatus === 1) {
                        let paymentMethod = normalizeUserPaymentMethod(req.body.payment_method);
                        if (!paymentMethod && req.body.payment_method) {
                            return res.status(400).json({ status: 400, message: 'payment_method harus CASH atau TRANSFER_BANK.' });
                        }
                        // URUTAN PRIORITAS, bukan rantai if/else-if yang saling menimpa.
                        //
                        // Bentuk sebelumnya: `if (!paymentMethod && ...) {...} else if (kolektor)
                        // {...CASH}`. Ketika admin SUDAH memilih metode lewat `req.body`,
                        // `paymentMethod` terisi sehingga cabang pertama gagal — lalu jatuh ke
                        // `else if` dan pilihan admin DITIMPA menjadi CASH begitu pengajuannya
                        // datang dari teknisi/agen. Admin memilih TRANSFER_BANK, ledger mencatat
                        // CASH.
                        if (!paymentMethod) {
                            if (nextRequestState.payment_method) {
                                paymentMethod = normalizeUserPaymentMethod(nextRequestState.payment_method);
                            } else if (nextRequestState.requested_by_teknisi_id || nextRequestState.requested_by_agen_id) {
                                // Ada kolektor di lapangan = tunai. Syarat `newStatus === true`
                                // sengaja tak dipakai: cicilan menyimpan `false` padahal itu
                                // justru penagihan tunai.
                                paymentMethod = 'CASH';
                            }
                        }
                        if (!paymentMethod) {
                            paymentMethod = 'TRANSFER_BANK';
                        }

                        nextRequestState.payment_method = paymentMethod;
                        console.log(`[APPROVE_PAID] Payment method for ${userToUpdate.name}: ${paymentMethod}`);

                        const { periodMonth, periodYear } = getPeriodParts({
                            periodMonth: parseInt(nextRequestState.period_month, 10),
                            periodYear: parseInt(nextRequestState.period_year, 10),
                            date: nextRequestState.updated_at || nextRequestState.created_at
                        });
                        const amountPaid = nextRequestState.amount_paid || getEffectivePrice(userToUpdate);
                        const amountDue = nextRequestState.amount_due || getEffectivePrice(userToUpdate);
                        const isPartial = nextRequestState.is_partial_payment || false;
                        // Tentukan kolektor: teknisi ATAU agen (tak pernah keduanya) agar komisi
                        // dikreditkan ke ledger yang benar lewat applyPaymentStatusChange.
                        const isAgenRequest = nextRequestState.collector_role === 'agen' || !!nextRequestState.requested_by_agen_id;
                        const collectorId = isAgenRequest ? nextRequestState.requested_by_agen_id : nextRequestState.requested_by_teknisi_id;
                        const collectorAccount = collectorId ? global.accounts.find(a => String(a.id) === String(collectorId)) : null;
                        const createdBy = collectorAccount?.username || (isAgenRequest ? 'agen' : (nextRequestState.requested_by_teknisi_id ? 'teknisi' : (req.user?.username || 'admin')));

                        financeResult = await applyPaymentStatusChange({
                            user: userToUpdate,
                            paid: true,
                            periodMonth,
                            periodYear,
                            amountPaid,
                            amountDue,
                            isPartial,
                            paymentMethod,
                            notes: nextRequestState.notes || `Pembayaran via approval request #${nextRequestState.id}`,
                            createdBy,
                            sourceRequestId: nextRequestState.id,
                            teknisiId: (!isAgenRequest && nextRequestState.requested_by_teknisi_id) ? String(nextRequestState.requested_by_teknisi_id) : null,
                            agenId: (isAgenRequest && nextRequestState.requested_by_agen_id) ? String(nextRequestState.requested_by_agen_id) : null,
                            agenName: isAgenRequest ? (collectorAccount?.name || collectorAccount?.username || null) : null,
                            onFinalPaid: async (ctx = {}) => {
                                await handlePaidStatusChange(userToUpdate, {
                                    paidDate: new Date().toISOString(),
                                    method: paymentMethod,
                                    approvedBy: req.user ? req.user.username : 'Admin',
                                    notes: `Pembayaran disetujui melalui sistem approval (${paymentMethod === 'CASH' ? 'Tunai' : 'Transfer Bank'})`,
                                    requestedByTeknisiId: nextRequestState.requested_by_teknisi_id,
                                    isPartial: nextRequestState.is_partial_payment,
                                    amountPaid: nextRequestState.amount_paid,
                                    amountRemaining: nextRequestState.amount_remaining,
                                    // Dipakai struk kanonik: periode + nomor rujukan yang bisa disebut pelanggan.
                                    periodMonth: ctx.periodMonth,
                                    periodYear: ctx.periodYear,
                                    paymentHistoryId: ctx.paymentHistoryId
                                });
                            }
                        });
                        if (financeResult.action !== 'paid') {
                            return res.status(409).json({ status: 409, message: 'Pengajuan tidak dapat di-approve karena posisi pembayaran sudah berubah.' });
                        }
                        console.log(`[APPROVE_PAID_HISTORY] Payment recorded for ${userToUpdate.name}: Rp ${amountPaid.toLocaleString('id-ID')}`);
                    } else {
                        const { periodMonth, periodYear } = getPeriodParts({
                            periodMonth: parseInt(nextRequestState.period_month, 10),
                            periodYear: parseInt(nextRequestState.period_year, 10),
                            date: nextRequestState.updated_at || nextRequestState.created_at
                        });
                        financeResult = await applyPaymentStatusChange({
                            user: userToUpdate,
                            paid: false,
                            periodMonth,
                            periodYear,
                            amountDue: nextRequestState.amount_due || getEffectivePrice(userToUpdate),
                            notes: nextRequestState.notes || `Reversal approval request #${nextRequestState.id}`,
                            createdBy: req.user ? req.user.username : 'Admin',
                            sourceRequestId: nextRequestState.id
                        });
                        if (financeResult.action !== 'reversed') {
                            return res.status(409).json({ status: 409, message: 'Pengajuan tidak dapat di-approve karena posisi pembayaran sudah berubah.' });
                        }
                    }

                    if (hasSendInvoiceColumn) {
                        await new Promise((resolve, reject) => {
                            global.db.run('UPDATE users SET send_invoice = ? WHERE id = ?', [sendInvoiceValue, userToUpdate.id], function(err) {
                                if (err) {
                                    console.error(`[APPROVE_PAID_DB_ERROR] Gagal update send_invoice untuk user ID ${userToUpdate.id}:`, err.message);
                                    return reject(new Error(`Gagal memperbarui send_invoice di database untuk user ID ${userToUpdate.id}.`));
                                }
                                resolve();
                            });
                        });
                        userToUpdate.send_invoice = (sendInvoiceValue === 1);
                    }

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
                        newValue: { paid: userToUpdate.paid === 1 },
                        ipAddress: req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'],
                        userAgent: req.headers['user-agent']
                    }).catch((logErr) => {
                        console.error('[ACTIVITY_LOG_ERROR] Failed to log payment approval:', logErr);
                    });
                } catch (e) {
                    console.error(`[ASYNC_APPROVE_PAID_ERROR] A post-approval operation failed for user ${userToUpdate.name}:`, e.message);
                    return res.status(500).json({ status: 500, message: `Proses persetujuan gagal: ${e.message}` });
                }
                allRequests[requestIndex] = nextRequestState;
                saveJSON('database/requests.json', allRequests);
                sendTechnicianNotification(true, nextRequestState, userToUpdate);
                return res.json({ message: `Permintaan berhasil di-approved.` });
            } else {
                allRequests[requestIndex] = nextRequestState;
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

// POST /api/requests/bulk-approve - owner route untuk approval payment request
router.post('/bulk-approve', ensureAdmin, rateLimit('bulk-approve', 30, 60000), async (req, res) => {
    try {
        return await withLock('bulk-approve-requests', async () => {
            let { requestIds } = req.body;

            try {
                requestIds = validateInput(requestIds, 'array', {
                    required: true,
                    minItems: 1,
                    maxItems: 500
                });
                requestIds = requestIds.map((id) =>
                    validateInput(id, 'id', { required: true, maxLength: 50 })
                );
            } catch (error) {
                return res.status(400).json({
                    status: 400,
                    message: `Input validation error: ${error.message}`
                });
            }

            // Jalur BARU: antre lalu balas seketika. Tanpa ini operator menunggu di depan
            // spinner selama seluruh batch menembak MikroTik satu per satu, dibatasi 20
            // pelanggan, lalu harus mengklik lagi untuk 20 berikutnya.
            const jobService = require('../services/bulk-approval-job.service');
            if (jobService.aktif()) {
                const antre = await jobService.enqueueBulkApproval({ requestIds, actor: req.user });
                if (!antre.ok && antre.reason === 'sedang_berjalan') {
                    return res.status(409).json({
                        status: 409,
                        message: 'Masih ada proses otorisasi yang berjalan. Buka log di bawah untuk melihat kemajuannya.',
                        job_id: antre.job && antre.job.id
                    });
                }
                if (!antre.ok) {
                    return res.status(400).json({ status: 400, message: 'Tidak ada pengajuan yang bisa diproses' });
                }
                return res.status(202).json({
                    status: 202,
                    job_id: antre.job.id,
                    total: antre.total,
                    antre: antre.antre,
                    message: `${antre.antre} pengajuan sedang diproses di latar. Hasil per pelanggan muncul di log di bawah.`
                });
            }

            const result = await paymentApprovalService.bulkApproveRequests({
                requestIds,
                actor: req.user
            });
            return res.json(result);
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

/**
 * Log otorisasi — kemajuan + hasil PER PELANGGAN.
 *
 * Inilah pengganti spinner: operator menutup dialognya, pekerjaan jalan terus, dan tiap
 * kegagalan tercatat dengan nama pelanggan + alasannya alih-alih lewat sekali lalu hilang.
 */
router.get('/bulk-approve/log', ensureAdmin, async (req, res) => {
    try {
        const repo = require('../repositories/approval-job.repository');
        const job = req.query.job_id ? await repo.getJob(req.query.job_id) : await repo.getLatestJob();
        if (!job) {
            return res.json({ status: 200, data: null });
        }
        const items = await repo.getJobItems(job.id, { limit: 300 });
        res.json({
            status: 200,
            data: {
                id: job.id,
                status: job.status,
                oleh: job.actor_username,
                total: job.total_items,
                selesai: job.done_count,
                berhasil: job.ok_count,
                gagal: job.failed_count,
                dilewati: job.skipped_count,
                mulai: job.started_at,
                akhir: job.finished_at,
                items
            }
        });
    } catch (error) {
        console.error('[OTORISASI_LOG_ERROR]', error);
        res.status(500).json({ status: 500, message: 'Gagal memuat log otorisasi' });
    }
});

// Legacy path sengaja dikunci agar owner tunggal approval payment tetap di route `/bulk-approve`.
router.post('/bulk-approve-legacy-disabled', ensureAdmin, rateLimit('bulk-approve', 30, 60000), async (req, res) => {
    return res.status(410).json({
        status: 410,
        message: "Legacy bulk approve dinonaktifkan. Gunakan endpoint /api/requests/bulk-approve."
    });

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
        
            const allRequests = loadJSON('database/requests.json').map(normalizePaymentRequestScope);
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
                const approvedRequest = {
                    ...request,
                    status: 'approved',
                    updated_at: new Date().toISOString(),
                    updated_by: req.user.username
                };
                const newPaidStatus = request.newStatus;
                
                // Check if send_invoice column exists (use cached result)
                const hasColumn = await checkSendInvoiceColumn();
                
                // Keep send_invoice in sync without mutating paid flag directly.
                const sendInvoiceValue = user.send_invoice ? 1 : 0;
                
                // Handle paid status change (send invoice if needed)
                if (newPaidStatus === true) {
                    let paymentMethod = normalizeUserPaymentMethod(approvedRequest.payment_method);
                    if (!paymentMethod && approvedRequest.requested_by_teknisi_id && approvedRequest.newStatus === true) {
                        paymentMethod = 'CASH';
                    }
                    if (!paymentMethod) {
                        paymentMethod = 'TRANSFER_BANK';
                    }
                    approvedRequest.payment_method = paymentMethod;
                    const { periodMonth, periodYear } = getPeriodParts({
                        periodMonth: parseInt(approvedRequest.period_month, 10),
                        periodYear: parseInt(approvedRequest.period_year, 10),
                        date: approvedRequest.updated_at || approvedRequest.created_at
                    });
                    const amountPaid = approvedRequest.amount_paid || getEffectivePrice(user);
                    const amountDue = approvedRequest.amount_due || getEffectivePrice(user);
                    const isPartial = approvedRequest.is_partial_payment || false;
                    const createdBy = approvedRequest.requested_by_teknisi_id
                        ? (global.accounts.find(a => String(a.id) === String(approvedRequest.requested_by_teknisi_id))?.username || 'teknisi')
                        : (req.user?.username || 'admin');

                    const financeResult = await applyPaymentStatusChange({
                        user,
                        paid: true,
                        periodMonth,
                        periodYear,
                        amountPaid,
                        amountDue,
                        isPartial,
                        paymentMethod,
                        notes: approvedRequest.notes || `Pembayaran via bulk approval request #${approvedRequest.id}`,
                        createdBy,
                        sourceRequestId: approvedRequest.id,
                        teknisiId: approvedRequest.requested_by_teknisi_id ? String(approvedRequest.requested_by_teknisi_id) : null,
                        onFinalPaid: async (ctx = {}) => {
                            await handlePaidStatusChange(user, {
                                paidDate: new Date().toISOString(),
                                method: paymentMethod,
                                approvedBy: req.user.username,
                                notes: `Status pembayaran diperbarui (${paymentMethod === 'CASH' ? 'Tunai' : 'Transfer Bank'})`,
                                // Dipakai struk kanonik: periode + nomor rujukan yang bisa disebut pelanggan.
                                periodMonth: ctx.periodMonth,
                                periodYear: ctx.periodYear,
                                paymentHistoryId: ctx.paymentHistoryId
                            });
                        }
                    });
                    if (financeResult.action !== 'paid') {
                        results.failed.push({
                            id: requestId,
                            reason: financeResult.reason || financeResult.action || 'payment_not_applied'
                        });
                        continue;
                    }
                } else {
                    const { periodMonth, periodYear } = getPeriodParts({
                        periodMonth: parseInt(approvedRequest.period_month, 10),
                        periodYear: parseInt(approvedRequest.period_year, 10),
                        date: approvedRequest.updated_at || approvedRequest.created_at
                    });
                    const financeResult = await applyPaymentStatusChange({
                        user,
                        paid: false,
                        periodMonth,
                        periodYear,
                        amountDue: approvedRequest.amount_due || getEffectivePrice(user),
                        notes: approvedRequest.notes || `Reversal bulk approval request #${approvedRequest.id}`,
                        createdBy: req.user.username,
                        sourceRequestId: approvedRequest.id
                    });
                    if (financeResult.action !== 'reversed') {
                        results.failed.push({
                            id: requestId,
                            reason: financeResult.reason || financeResult.action || 'reversal_not_applied'
                        });
                        continue;
                    }
                }

                if (hasColumn) {
                    await new Promise((resolve, reject) => {
                        global.db.run('UPDATE users SET send_invoice = ? WHERE id = ?', 
                            [sendInvoiceValue, user.id], 
                            function(err) {
                                if (err) reject(err);
                                else resolve();
                            }
                        );
                    });
                }
                
                // Send notification to technician
                allRequests[requestIndex] = approvedRequest;
                sendTechnicianNotification(true, approvedRequest, user);
                
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
