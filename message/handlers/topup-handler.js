"use strict";

/**
 * Topup Handler with Payment Proof Upload
 * Menangani proses topup saldo dengan upload bukti transfer
 */

const fs = require('fs');
const path = require('path');
const saldoManager = require('../../lib/saldo-manager');
const { logger } = require('../../lib/logger');
const { renderTemplate } = require('../../lib/templating');
const { extractSenderInfo } = require('../../lib/jid-utils');
/**
 * Handle topup payment proof upload
 * @param {Object} msg - WhatsApp message object
 * @param {Object} user - User object
 * @returns {Promise<void>}
 */
async function handleTopupPaymentProof(msg, user, pushname = '') {
    const sender = msg.key.remoteJid;
    const senderInfo = extractSenderInfo(msg, sender);
    const requestLookupId = senderInfo.normalizedSender || sender;

    try {
        logger.info('[TOPUP_PROOF] Starting payment proof upload', {
            sender,
            requestLookupId,
            userId: user?.id,
            hasMessage: !!msg.message
        });

        // Get ALL user topup requests for debugging
        const allUserRequests = saldoManager.getUserTopupRequests(requestLookupId);
        logger.info('[TOPUP_PROOF] User topup requests found', {
            sender,
            requestLookupId,
            totalRequests: allUserRequests.length,
            requests: allUserRequests.map(r => ({
                id: r.id,
                status: r.status,
                method: r.paymentMethod,
                hasProof: !!r.paymentProof
            }))
        });

        // Get topup request that can accept proof upload
        // Allow upload for: pending OR waiting_verification with transfer method
        // This allows users to re-upload if they made a mistake
        const pendingRequests = allUserRequests
            .filter(r =>
                (r.status === 'pending' || r.status === 'waiting_verification') &&
                r.paymentMethod === 'transfer'
            );

        logger.info('[TOPUP_PROOF] Requests that can accept proof upload', {
            count: pendingRequests.length,
            allowedStatuses: ['pending', 'waiting_verification']
        });

        if (pendingRequests.length === 0) {
            logger.warn('[TOPUP_PROOF] No pending topup request found', { sender });

            const message = renderTemplate('topup_no_pending', {});

            // PENTING: Cek connection state dan gunakan error handling sesuai rules
            if (global.whatsappConnectionState === 'open' && global.raf && global.raf.sendMessage) {
                try {
                    await global.raf.sendMessage(sender, { text: message }, { skipDuplicateCheck: true });
                    logger.info('[TOPUP_PROOF] Sent no pending request message');
                } catch (error) {
                    console.error('[SEND_MESSAGE_ERROR]', {
                        sender,
                        error: error.message
                    });
                    logger.error('[TOPUP_PROOF] Failed to send no pending message:', error);
                }
            } else {
                console.warn('[SEND_MESSAGE_SKIP] WhatsApp not connected, skipping send to', sender);
                logger.warn('[TOPUP_PROOF] WhatsApp not connected, cannot send no pending message');
            }
            return;
        }

        const request = pendingRequests[0];

        logger.info('[TOPUP_PROOF] Found pending request', {
            requestId: pendingRequests[0].id,
            amount: pendingRequests[0].amount
        });

        // Check global.raf availability
        if (!global.raf || !global.raf.sendMessage) {
            logger.error('[TOPUP_PROOF] global.raf not available!');
            throw new Error('WhatsApp connection not available');
        }

        // Download the image/document
        logger.info('[TOPUP_PROOF] Downloading media...');
        const { downloadMediaMessage } = await import('@whiskeysockets/baileys');
        const buffer = await downloadMediaMessage(msg, 'buffer', {});
        logger.info('[TOPUP_PROOF] Media downloaded', { size: buffer.length });

        // Create directory if not exists
        const proofDir = path.join(__dirname, '../../temp/topup_proofs');
        if (!fs.existsSync(proofDir)) {
            fs.mkdirSync(proofDir, { recursive: true });
        }

        // Save file
        const fileExtension = msg.message.imageMessage ? 'jpg' : 'pdf';
        const fileName = `topup_${request.id}_${Date.now()}.${fileExtension}`;
        const filePath = path.join(proofDir, fileName);

        fs.writeFileSync(filePath, buffer);
        logger.info('[TOPUP_PROOF] File saved successfully', {
            requestId: request.id,
            file: fileName,
            path: filePath,
            isReupload: !!request.paymentProof
        });

        // Check if this is a re-upload
        const isReupload = !!request.paymentProof;

        // Update request with proof
        request.paymentProof = fileName;
        request.proofUploadedAt = new Date().toISOString();
        request.status = 'waiting_verification';
        saldoManager.saveTopupRequests();

        // Send confirmation to user
        let confirmMsg = isReupload ?
            `✅ *BUKTI TRANSFER DIPERBARUI*\n\n` :
            `✅ *BUKTI TRANSFER DITERIMA*\n\n`;

        confirmMsg += `ID Request: *${request.id}*\n`;
        confirmMsg += `Jumlah: *Rp ${request.amount.toLocaleString('id-ID')}*\n\n`;
        confirmMsg += `📋 *Status:* Menunggu Verifikasi Admin\n\n`;

        if (isReupload) {
            confirmMsg += `📸 Foto bukti transfer Anda telah diperbarui dan dikirimkan ke admin.\n`;
        } else {
            confirmMsg += `📸 Foto bukti transfer Anda telah dikirimkan ke admin.\n`;
        }

        confirmMsg += `⏳ Admin akan memverifikasi pembayaran dalam 1x24 jam.\n\n`;
        confirmMsg += `_Anda akan menerima notifikasi setelah pembayaran diverifikasi._`;

        // PENTING: Cek connection state dan gunakan error handling sesuai rules
        if (global.whatsappConnectionState === 'open' && global.raf && global.raf.sendMessage) {
            try {
                await global.raf.sendMessage(sender, { text: confirmMsg }, { skipDuplicateCheck: true });
                logger.info('Confirmation message sent to user', { userId: sender });
            } catch (error) {
                console.error('[SEND_MESSAGE_ERROR]', {
                    sender,
                    error: error.message
                });
                logger.error('Failed to send confirmation message:', error);
                // Jangan throw - notification tidak critical
            }
        } else {
            console.warn('[SEND_MESSAGE_SKIP] WhatsApp not connected, skipping send to', sender);
            logger.warn('Cannot send confirmation - WhatsApp not connected');
        }

        // Notify admins with the proof
        await notifyAdminsWithProof(request, filePath, user, pushname);

    } catch (error) {
        logger.error('[TOPUP_PROOF] CRITICAL ERROR - Failed to handle payment proof', {
            error: error.message,
            stack: error.stack,
            sender,
            userId: user?.id
        });

        // Always try to send error message to user
        // PENTING: Cek connection state dan gunakan error handling sesuai rules
        if (global.whatsappConnectionState === 'open' && global.raf && global.raf.sendMessage) {
            try {
                await global.raf.sendMessage(sender, {
                    text: `❌ Gagal mengupload bukti transfer. Silakan coba lagi.\n\nError: ${error.message}\n\n_Jika masalah berlanjut, hubungi admin._`
                }, { skipDuplicateCheck: true });
                logger.info('[TOPUP_PROOF] Error message sent to user');
            } catch (sendError) {
                console.error('[SEND_MESSAGE_ERROR]', {
                    sender,
                    error: sendError.message
                });
                logger.error('[TOPUP_PROOF] Failed to send error message', {
                    error: sendError.message
                });
            }
        } else {
            console.warn('[SEND_MESSAGE_SKIP] WhatsApp not connected, skipping send to', sender);
            logger.warn('[TOPUP_PROOF] Cannot send error message - WhatsApp not connected');
        }
    }
}

/**
 * Notify admins with payment proof
 * @param {Object} request - Topup request object
 * @param {string} proofPath - Path to proof file
 * @param {Object} user - User object
 * @param {string} pushname - WhatsApp pushname
 */
async function notifyAdminsWithProof(request, proofPath, user, pushname = '') {
    try {
        const adminMessage = `📢 *BUKTI TRANSFER TOPUP DITERIMA*\n\n` +
            `👤 User: ${pushname || user.name || 'Pelanggan'}\n` +
            `📱 Telepon: ${request.userId.replace('@s.whatsapp.net', '')}\n` +
            `💰 Jumlah: *Rp ${request.amount.toLocaleString('id-ID')}*\n` +
            `🏦 Metode: Transfer Bank\n` +
            `📄 ID Request: *${request.id}*\n` +
            `📅 Waktu Upload: ${new Date().toLocaleString('id-ID')}\n\n` +
            `🔗 *Verifikasi di Panel Admin:*\n` +
            `${global.config.site_url_bot || 'http://localhost:3100'}/saldo-management\n\n` +
            `_Silakan verifikasi pembayaran ini._`;

        // Get admin recipients
        const adminRecipients = await getAdminRecipients();

        // Send to each admin with the proof image
        // PENTING: Cek connection state dan gunakan error handling sesuai rules untuk multiple recipients
        for (const adminJid of adminRecipients) {
            if (global.whatsappConnectionState === 'open' && global.raf && global.raf.sendMessage) {
                try {
                    // Send the proof image/document first
                    if (proofPath.endsWith('.jpg') || proofPath.endsWith('.png')) {
                        await global.raf.sendMessage(adminJid, {
                            image: { url: proofPath },
                            caption: adminMessage
                        });
                    } else {
                        await global.raf.sendMessage(adminJid, {
                            document: { url: proofPath },
                            fileName: path.basename(proofPath),
                            caption: adminMessage
                        });
                    }
                    logger.info('Admin notified with topup proof', { admin: adminJid, requestId: request.id });
                } catch (error) {
                    console.error('[SEND_MESSAGE_ERROR]', {
                        adminJid,
                        type: proofPath.endsWith('.jpg') || proofPath.endsWith('.png') ? 'image' : 'document',
                        error: error.message
                    });
                    logger.error('Failed to notify admin', { admin: adminJid, error });
                    // Continue to next recipient
                }
            } else {
                console.warn('[SEND_MESSAGE_SKIP] WhatsApp not connected, skipping send to', adminJid);
                logger.warn('Cannot notify admin - WhatsApp not connected', { admin: adminJid });
            }
        }
    } catch (error) {
        logger.error('Failed to notify admins with proof', error);
    }
}

/**
 * Get admin recipients for notifications
 * @returns {Promise<Array>} Array of admin JIDs
 */
async function getAdminRecipients() {
    const adminRecipients = new Set();

    // Add owner numbers from config
    if (global.config.ownerNumber && Array.isArray(global.config.ownerNumber)) {
        global.config.ownerNumber.forEach(num => {
            if (num && num.trim()) {
                adminRecipients.add(num.trim());
            }
        });
    }

    // Add admins from accounts database
    if (global.accounts) {
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
    }

    return Array.from(adminRecipients);
}

/**
 * Handle topup verification (called when admin approves/rejects)
 * @param {string} requestId - Request ID
 * @param {boolean} approved - Whether approved or rejected
 * @param {string} adminName - Admin who verified
 * @param {string} notes - Optional notes
 */
async function handleTopupVerification(requestId, approved, adminName, notes = '') {
    try {
        const requests = saldoManager.getAllTopupRequests();
        const request = requests.find(r => r.id === requestId);

        if (!request) {
            throw new Error('Request not found');
        }

        if (request.status !== 'waiting_verification' && request.status !== 'pending') {
            throw new Error('Request is not waiting for verification');
        }

        const userJid = request.userId;

        if (approved) {
            // Update request status
            request.status = 'verified';
            request.verifiedAt = new Date().toISOString();
            request.verifiedBy = adminName;
            request.verificationNotes = notes;

            // Get customer name from request (stored during creation)
            const customerName = request.customerName || null;

            // Create user saldo if not exists (with pushname for better UX)
            await saldoManager.createUserSaldo(userJid, customerName);

            // Add saldo to user (pass customerName for pushname update AND requestId for proof linking)
            const transaction = await saldoManager.addSaldo(userJid, request.amount, `Topup verified - ${request.paymentMethod}`, customerName, requestId);

            // Save changes
            saldoManager.saveTopupRequests();

            // Notify user (only if WhatsApp is connected)
            // PENTING: Cek connection state dan gunakan error handling sesuai rules
            if (global.whatsappConnectionState === 'open' && global.raf && global.raf.sendMessage) {
                try {
                    // Ambil saldo setelah transaksi (await karena getSaldo return Promise)
                    const currentSaldo = await saldoManager.getSaldo(userJid);
                    const successMsg = renderTemplate('topup_verified_success', {
                        request_id: request.id,
                        harga: `Rp ${request.amount.toLocaleString('id-ID')}`,
                        formattedSaldo: `Rp ${currentSaldo.toLocaleString('id-ID')}`
                    });

                    await global.raf.sendMessage(userJid, { text: successMsg });
                } catch (waError) {
                    console.error('[SEND_MESSAGE_ERROR]', {
                        userJid,
                        error: waError.message
                    });
                    logger.warn('Failed to send WhatsApp notification:', waError.message);
                    // Don't throw, just log - WhatsApp notification is not critical
                }
            } else {
                console.warn('[SEND_MESSAGE_SKIP] WhatsApp not connected, skipping send to', userJid);
                logger.warn('Cannot send topup success notification - WhatsApp not connected');
            }

            logger.info('Topup verified and approved', {
                requestId,
                amount: request.amount,
                user: userJid,
                verifiedBy: adminName
            });

            return { success: true, message: 'Topup berhasil diverifikasi dan saldo telah ditambahkan.' };

        } else {
            // Reject request
            request.status = 'rejected';
            request.rejectedAt = new Date().toISOString();
            request.rejectedBy = adminName;
            request.rejectionReason = notes || 'Bukti transfer tidak valid';

            // Save changes
            saldoManager.saveTopupRequests();

            // Notify user (only if WhatsApp is connected)
            // PENTING: Cek connection state dan gunakan error handling sesuai rules
            if (global.whatsappConnectionState === 'open' && global.raf && global.raf.sendMessage) {
                try {
                    const rejectMsg = renderTemplate('topup_rejected', {
                        request_id: request.id,
                        harga: `Rp ${request.amount.toLocaleString('id-ID')}`,
                        alasan: request.rejectionReason || 'Bukti transfer tidak valid'
                    });

                    await global.raf.sendMessage(userJid, { text: rejectMsg });
                } catch (waError) {
                    console.error('[SEND_MESSAGE_ERROR]', {
                        userJid,
                        error: waError.message
                    });
                    logger.warn('Failed to send WhatsApp rejection notification:', waError.message);
                    // Don't throw, just log - WhatsApp notification is not critical
                }
            } else {
                console.warn('[SEND_MESSAGE_SKIP] WhatsApp not connected, skipping send to', userJid);
                logger.warn('Cannot send topup rejection notification - WhatsApp not connected');
            }

            logger.info('Topup rejected', {
                requestId,
                reason: request.rejectionReason,
                rejectedBy: adminName
            });

            return { success: true, message: 'Topup telah ditolak.' };
        }

    } catch (error) {
        logger.error('Failed to verify topup', error);
        throw error;
    }
}

module.exports = {
    handleTopupPaymentProof,
    handleTopupVerification,
    notifyAdminsWithProof,
    getAdminRecipients
};
