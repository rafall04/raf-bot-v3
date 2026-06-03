/**
 * Header Doc
 * Purpose: Menangani cleanup session dan retry pengiriman saat terjadi error enkripsi/decrypt pada WhatsApp.
 * Caller: Boundary recovery/session yang membutuhkan resend dengan pemulihan session.
 * Deps: `fs`, `path`, `./whatsapp-gateway`, dan `./whatsapp-delivery-service`.
 * MainFuncs: `cleanSession`, `sendMessageWithRecovery`, `clearRetryCounters`, `getRetryStatus`.
 * SideEffects: Menghapus file session tertentu, membaca gateway/socket aktif, dan melakukan retry kirim pesan.
 */

const fs = require('fs');
const path = require('path');
const { getSocket } = require('./whatsapp-gateway');
const { sendMessage } = require('./whatsapp-delivery-service');

class WhatsAppSessionManager {
    constructor() {
        this.sessionPath = path.join(__dirname, '..', 'session');
        this.badMacRetries = new Map(); // Track retries per number
    }

    /**
     * Clean session for a specific phone number
     * @param {string} phoneJid - WhatsApp JID (e.g., 628xxx@s.whatsapp.net)
     */
    async cleanSession(phoneJid) {
        try {
            const phoneNumber = phoneJid.replace('@s.whatsapp.net', '');
            console.log(`[SESSION_CLEANUP] Cleaning session for ${phoneNumber}`);
            
            // Session files are usually stored with phone number as key
            const sessionFiles = [
                `session-${phoneNumber}.json`,
                `app-state-sync-key-${phoneNumber}.json`,
                `app-state-sync-version-${phoneNumber}.json`,
                `pre-keys-${phoneNumber}.json`,
                `sender-keys-${phoneNumber}.json`
            ];
            
            let cleaned = false;
            for (const file of sessionFiles) {
                const filePath = path.join(this.sessionPath, file);
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    console.log(`[SESSION_CLEANUP] Removed ${file}`);
                    cleaned = true;
                }
            }
            
            if (cleaned) {
                console.log(`[SESSION_CLEANUP] Session cleaned for ${phoneNumber}`);
            } else {
                console.log(`[SESSION_CLEANUP] No session files found for ${phoneNumber}`);
            }
            
            return cleaned;
        } catch (error) {
            console.error('[SESSION_CLEANUP] Error cleaning session:', error);
            return false;
        }
    }

    /**
     * Send message with session recovery on Bad MAC error
     * @param {object|Function} socketSource - Socket, getter socket, atau gateway-like accessor
     * @param {string} phoneJid - Recipient JID
     * @param {object} message - Message object
     * @param {number} maxRetries - Maximum retry attempts
     */
    async sendMessageWithRecovery(socketSource, phoneJid, message, maxRetries = 3) {
        const retryKey = phoneJid;
        let retries = this.badMacRetries.get(retryKey) || 0;
        
        if (retries >= maxRetries) {
            console.error(`[SESSION_RECOVERY] Max retries reached for ${phoneJid}`);
            this.badMacRetries.delete(retryKey);
            throw new Error('Max session recovery attempts reached');
        }
        
        try {
            const socket = this.resolveSocket(socketSource);
            if (!socket) {
                throw new Error('WhatsApp socket unavailable for session recovery');
            }

            // Add small delay to avoid session conflicts
            if (retries > 0) {
                console.log(`[SESSION_RECOVERY] Retry attempt ${retries} for ${phoneJid}`);
                await new Promise(resolve => setTimeout(resolve, 2000 * retries));
            }
            
            // Try to send message
            const delivery = await sendMessage(phoneJid, message);
            if (!delivery.sent) {
                throw new Error(delivery.warning || delivery.errorCode || 'WhatsApp delivery failed during session recovery');
            }
            
            // Success - reset retry counter
            this.badMacRetries.delete(retryKey);
            console.log(`[SESSION_RECOVERY] Message sent successfully to ${phoneJid}`);
            
            return delivery.result || delivery;
            
        } catch (error) {
            const errorMsg = error.message || error.toString();
            
            // Check for Bad MAC error
            if (errorMsg.includes('Bad MAC') || errorMsg.includes('decrypt')) {
                console.error(`[SESSION_RECOVERY] Bad MAC error for ${phoneJid}, attempting recovery...`);
                
                // Increment retry counter
                retries++;
                this.badMacRetries.set(retryKey, retries);
                
                // Clean the corrupted session
                await this.cleanSession(phoneJid);
                
                // Wait for session to be recreated
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                // Retry sending
                return this.sendMessageWithRecovery(socketSource, phoneJid, message, maxRetries);
                
            } else if (errorMsg.includes('timeout') || errorMsg.includes('Timeout')) {
                // Handle timeout differently
                console.error(`[SESSION_RECOVERY] Timeout error for ${phoneJid}`);
                
                if (retries < maxRetries - 1) {
                    retries++;
                    this.badMacRetries.set(retryKey, retries);
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    return this.sendMessageWithRecovery(socketSource, phoneJid, message, maxRetries);
                }
            }
            
            // Other errors - just throw
            this.badMacRetries.delete(retryKey);
            throw error;
        }
    }

    /**
     * Clear all retry counters
     */
    clearRetryCounters() {
        this.badMacRetries.clear();
        console.log('[SESSION_RECOVERY] Retry counters cleared');
    }

    /**
     * Get retry status for monitoring
     */
    getRetryStatus() {
        const status = [];
        for (const [jid, retries] of this.badMacRetries.entries()) {
            status.push({ jid, retries });
        }
        return status;
    }

    resolveSocket(socketSource) {
        if (typeof socketSource === 'function') {
            return socketSource();
        }
        if (socketSource && typeof socketSource.getSocket === 'function') {
            return socketSource.getSocket();
        }
        return socketSource || getSocket();
    }
}

// Export singleton instance
module.exports = new WhatsAppSessionManager();
