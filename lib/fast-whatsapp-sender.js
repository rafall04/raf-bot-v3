/**
 * Header Doc
 * Purpose: Menyediakan helper pengiriman WA cepat dengan antarmuka kompatibel untuk broadcast ringan dan notifikasi tiket.
 * Caller: Service/handler legacy yang masih memakai signature `fastSend(raf, ...)`.
 * Deps: `./whatsapp-gateway` dan `./whatsapp-delivery-service`.
 * MainFuncs: `fastSend`, `fastSendMultiple`, `sendTicketNotification`, `formatPhoneJid`.
 * SideEffects: Mengirim pesan melalui gateway runtime WA aktif dengan signature lama tetap kompatibel.
 */

// Simple delay function instead of importing from baileys
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const { getConnectionState } = require('./whatsapp-gateway');
const { sendMessage, sendMessageToMany, ensureJid } = require('./whatsapp-delivery-service');

/**
 * Send WhatsApp message with minimal overhead
 * @param {Object} raf - WhatsApp connection
 * @param {string} phoneJid - Phone JID
 * @param {string} message - Message text
 * @returns {Object} Result
 */
async function fastSend(raf, phoneJid, message) {
    console.log(`[FAST_SEND] Attempting to send to ${phoneJid}`);
    console.log(`[FAST_SEND] WhatsApp state: ${getConnectionState()}`);
    console.log(`[FAST_SEND] RAF exists: ${!!raf}`);

    try {
        const delivery = await sendMessage(phoneJid, { text: message });
        if (delivery.sent) {
            console.log(`[FAST_SEND] Successfully sent to ${phoneJid}`);
            return { success: true, phoneJid: ensureJid(phoneJid) };
        }

        console.error('[SEND_MESSAGE_ERROR]', {
            phoneJid,
            error: delivery.warning || delivery.errorCode || 'WhatsApp not connected'
        });
        return { success: false, phoneJid, error: delivery.warning || delivery.errorCode || 'WhatsApp not connected' };
    } catch (error) {
        console.error('[SEND_MESSAGE_ERROR]', {
            phoneJid,
            error: error.message
        });
        console.error(`[FAST_SEND] Failed to send to ${phoneJid}:`, error.message);
        return { success: false, phoneJid, error: error.message };
    }
}

/**
 * Send to multiple recipients with minimal delay (like broadcast)
 * @param {Object} raf - WhatsApp connection
 * @param {Array} phoneNumbers - Array of phone numbers
 * @param {string} message - Message text
 * @param {number} delayMs - Delay between messages in ms (default: 500)
 * @returns {Object} Results
 */
async function fastSendMultiple(raf, phoneNumbers, message, delayMs = 500) {
    const results = [];
    const validRecipients = [];
    
    for (let i = 0; i < phoneNumbers.length; i++) {
        const phone = phoneNumbers[i];
        const phoneJid = formatPhoneJid(phone);
        
        if (!phoneJid) {
            results.push({ success: false, phone, error: 'Invalid phone number' });
            continue;
        }
        validRecipients.push({ phone, phoneJid });
    }

    for (let i = 0; i < validRecipients.length; i++) {
        const { phoneJid } = validRecipients[i];
        const delivery = await sendMessageToMany([phoneJid], { text: message });
        if (delivery.sent) {
            results.push({ success: true, phoneJid });
            console.log(`[FAST_SEND_MULTIPLE] Sent to ${phoneJid} (${i + 1}/${validRecipients.length})`);
        } else {
            const error = delivery.warning || delivery.errorCode || 'WhatsApp not connected';
            console.error('[SEND_MESSAGE_ERROR]', {
                phoneJid,
                error
            });
            console.error(`[FAST_SEND_MULTIPLE] Failed to send to ${phoneJid}:`, error);
            results.push({ success: false, phoneJid, error });
        }

        if (i < validRecipients.length - 1) {
            await delay(delayMs);
        }
    }
    
    const successCount = results.filter(r => r.success).length;
    console.log(`[FAST_SEND_MULTIPLE] Sent to ${successCount}/${phoneNumbers.length} recipients`);
    
    return {
        success: successCount > 0,
        successCount,
        totalCount: phoneNumbers.length,
        results
    };
}

/**
 * Format phone number to WhatsApp JID
 */
function formatPhoneJid(phone) {
    if (!phone) return null;
    
    phone = phone.toString().trim();
    
    // Already formatted
    if (phone.endsWith('@s.whatsapp.net')) {
        return phone;
    }
    
    // Remove non-numeric
    phone = phone.replace(/[^0-9]/g, '');
    
    // Convert to international format
    if (phone.startsWith('0')) {
        phone = '62' + phone.substring(1);
    } else if (!phone.startsWith('62')) {
        phone = '62' + phone;
    }
    
    return phone + '@s.whatsapp.net';
}

/**
 * Send notification for ticket - fast version
 */
async function sendTicketNotification(raf, ticket, message) {
    // Extract phone numbers
    const phoneNumbers = [];
    
    if (ticket.user?.phone_number) {
        const phones = ticket.user.phone_number.split('|').map(p => p.trim()).filter(p => p);
        phoneNumbers.push(...phones);
    }
    
    if (ticket.pelanggan?.phone_number) {
        const phones = ticket.pelanggan.phone_number.split('|').map(p => p.trim()).filter(p => p);
        phoneNumbers.push(...phones);
    }
    
    if (phoneNumbers.length === 0) {
        return { success: false, error: 'No phone numbers found' };
    }
    
    // Remove duplicates
    const uniqueNumbers = [...new Set(phoneNumbers)];
    
    // Send with small delay between messages (like broadcast)
    return await fastSendMultiple(raf, uniqueNumbers, message, 500);
}

module.exports = {
    fastSend,
    fastSendMultiple,
    sendTicketNotification,
    formatPhoneJid
};
