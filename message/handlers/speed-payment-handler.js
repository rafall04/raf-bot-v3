/**
 * Header Doc
 * Purpose: Menangani unggahan bukti bayar dan pengecekan status request Speed Boost via WhatsApp.
 * Caller: Router bot `message/raf.js` dan flow Speed Boost.
 * Deps: `fs`, `path`, `../../lib/database`, `../../lib/whatsapp.adapter`, `./speed-status-handler`, `../../lib/template-service`, dan `../../lib/whatsapp-delivery-service`.
 * MainFuncs: `handleSpeedPaymentProof`, `handleSpeedRequestStatus`, `getUserPendingSpeedRequest`.
 * SideEffects: Menyimpan file bukti bayar, memperbarui `global.speed_requests`, dan mengirim pesan WhatsApp.
 */

const fs = require('fs');
const path = require('path');
const { downloadMedia } = require('../../lib/whatsapp.adapter');
const { sendMessage } = require('../../lib/whatsapp-delivery-service');
const { renderCategoryTemplate } = require('../../lib/template-service');
const { checkSpeedBoostStatus } = require('./speed-status-handler');

function renderResponseTemplate(key, data = {}) {
    const result = renderCategoryTemplate('responseTemplates', key, data);
    return result.found && result.text.trim() ? result.text : key;
}

async function deliverPayload(recipient, payload, options = {}) {
    return sendMessage(recipient, payload, options);
}

async function deliverText(recipient, text, options = {}) {
    return sendMessage(recipient, { text }, options);
}

async function deliverMedia(recipient, payload, options = {}) {
    return sendMessage(recipient, payload, options);
}

/**
 * Check if user has pending speed request that needs payment proof
 */
function getUserPendingSpeedRequest(userId) {
    // Find pending speed request that needs payment proof
    const pendingRequest = global.speed_requests?.find(req => 
        req.userId == userId && 
        req.status === 'pending' &&
        ['cash', 'transfer'].includes(req.paymentMethod) &&
        req.paymentStatus === 'unpaid'
    );
    
    return pendingRequest;
}

/**
 * Handle payment proof upload for speed request
 */
async function handleSpeedPaymentProof(msg, user) {
    try {
        // Check if user has pending speed request
        const pendingRequest = getUserPendingSpeedRequest(user.id);
        
        if (!pendingRequest) {
            await deliverPayload(msg.key.remoteJid, {
                text: renderResponseTemplate('speed_payment_no_pending')
            });
            return;
        }
        
        // Check if message contains image
        const messageType = Object.keys(msg.message)[0];
        if (!['imageMessage', 'documentMessage'].includes(messageType)) {
            await deliverPayload(msg.key.remoteJid, {
                text: renderResponseTemplate('speed_payment_upload_prompt', {
                    requestId: pendingRequest.id,
                    packageName: pendingRequest.requestedPackageName,
                    duration: pendingRequest.durationKey.replace('_', ' '),
                    price: `Rp ${Number(pendingRequest.price).toLocaleString('id-ID')}`,
                    paymentMethod: pendingRequest.paymentMethod === 'cash' ? 'Cash' : 'Transfer'
                })
            });
            return;
        }
        
        // Download the media
        const buffer = await downloadMedia(msg, 'buffer', {});
        
        // Create upload directory if not exists
        const uploadDir = path.join(__dirname, '..', '..', 'static', 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        
        // Generate filename
        const timestamp = Date.now();
        const extension = messageType === 'documentMessage' ? '.pdf' : '.jpg';
        const filename = `payment-speed-${timestamp}-${user.id}${extension}`;
        const filepath = path.join(uploadDir, filename);
        
        // Save file
        fs.writeFileSync(filepath, buffer);
        
        // Get caption if any
        const caption = msg.message[messageType]?.caption || '';
        
        // Update speed request with payment proof
        const requestIndex = global.speed_requests.findIndex(r => r.id === pendingRequest.id);
        if (requestIndex !== -1) {
            global.speed_requests[requestIndex].paymentProof = `/uploads/${filename}`;
            global.speed_requests[requestIndex].paymentStatus = 'pending'; // Waiting for verification
            global.speed_requests[requestIndex].paymentNotes = caption || 'Upload via WhatsApp';
            global.speed_requests[requestIndex].paymentDate = new Date().toISOString();
            global.speed_requests[requestIndex].updatedAt = new Date().toISOString();
            
            // Save to database
            const { saveSpeedRequests } = require('../../lib/database');
            saveSpeedRequests();
            
            // Send confirmation to user
            await deliverPayload(msg.key.remoteJid, {
                text: renderResponseTemplate('speed_payment_proof_received', {
                    requestId: pendingRequest.id,
                    packageName: pendingRequest.requestedPackageName,
                    duration: pendingRequest.durationKey.replace('_', ' '),
                    price: `Rp ${Number(pendingRequest.price).toLocaleString('id-ID')}`,
                    verificationStatus: renderResponseTemplate('speed_payment_verification_pending_label')
                })
            });
            
            // Notify admin about payment proof upload
            if (global.config.ownerNumber && Array.isArray(global.config.ownerNumber)) {
                const notifMessage = renderResponseTemplate('speed_payment_admin_notification', {
                    requestId: pendingRequest.id,
                    customerName: user.name,
                    customerPhone: user.phone_number,
                    packageName: pendingRequest.requestedPackageName,
                    duration: pendingRequest.durationKey.replace('_', ' '),
                    price: `Rp ${Number(pendingRequest.price).toLocaleString('id-ID')}`,
                    paymentMethod: pendingRequest.paymentMethod === 'cash' ? 'Cash' : 'Transfer',
                    notes: caption || '-'
                });
                
                for (const ownerNum of global.config.ownerNumber) {
                    const ownerJid = ownerNum.endsWith('@s.whatsapp.net') ? ownerNum : `${ownerNum}@s.whatsapp.net`;
                    try {
                        await deliverText(ownerJid, notifMessage);
                        
                        // Also send the payment proof image to admin
                        if (messageType === 'imageMessage') {
                            await deliverMedia(ownerJid, {
                                image: buffer,
                                caption: renderResponseTemplate('speed_payment_admin_media_caption', {
                                    customerName: user.name,
                                    packageName: pendingRequest.requestedPackageName
                                })
                            });
                        }
                    } catch (e) {
                        console.error(`[SPEED_PAYMENT_WA_NOTIF_ERROR] Failed to notify admin ${ownerJid}:`, e.message);
                    }
                }
            }
            
            console.log(`[SPEED_PAYMENT_WA] Payment proof uploaded via WhatsApp for request ${pendingRequest.id} by user ${user.name}`);
            return true;
        }
        
    } catch (error) {
        console.error('[SPEED_PAYMENT_WA_ERROR]', error);
        await deliverPayload(msg.key.remoteJid, {
            text: renderResponseTemplate('speed_payment_process_error')
        });
        return false;
    }
}

/**
 * Delegate speed request status to the canonical status handler.
 */
async function handleSpeedRequestStatus(msg, user) {
    return checkSpeedBoostStatus(msg, user, msg.key.remoteJid, false);
}

module.exports = {
    handleSpeedPaymentProof,
    handleSpeedRequestStatus,
    getUserPendingSpeedRequest
};
