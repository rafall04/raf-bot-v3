/**
 * Header Doc
 * Purpose: Membungkus `sendMessage` socket aktif untuk mencegah duplikasi notifikasi massal pada jalur runtime legacy.
 * Caller: Bootstrap/runtime legacy yang masih membutuhkan wrapper anti-duplikasi.
 * Deps: `./notification-tracker` dan `./whatsapp-gateway`.
 * MainFuncs: `initializeWrapper`, `removeWrapper`, `getWrapperStatus`, `resetBlockedCount`, `getOriginalSendMessage`.
 * SideEffects: Memodifikasi method `sendMessage` pada socket yang diberikan dan memblokir pesan duplikat.
 */

const { 
    isNotificationDuplicate, 
    markNotificationSent,
    normalizePhone,
    getStats 
} = require('./notification-tracker');
const { getConnectionState, isReady } = require('./whatsapp-gateway');

let originalSendMessage = null;
let wrapperActive = false;
let blockedCount = 0;

/**
 * Initialize the wrapper
 * @param {object} raf - WhatsApp connection object
 */
function initializeWrapper(raf) {
    if (!raf || !raf.sendMessage) {
        console.warn('[NOTIF] Cannot initialize - raf.sendMessage not available');
        return false;
    }
    
    if (wrapperActive) {
        // Already initialized (silent)
        return true;
    }
    
    // Store original function
    originalSendMessage = raf.sendMessage.bind(raf);
    
    // Expose original function for direct access (to skip duplicate check)
    raf.sendMessage._originalSendMessage = originalSendMessage;
    
    // Create wrapped function
    raf.sendMessage = async function(jid, message, options) {
        try {
            // Check if skipDuplicateCheck option is set (for command responses)
            const skipDuplicateCheck = options && options.skipDuplicateCheck === true;
            
            // Check for duplicate (skip if skipDuplicateCheck is true)
            if (!skipDuplicateCheck && isNotificationDuplicate(jid, message)) {
                blockedCount++;
                const normalized = normalizePhone(jid);
                console.log(`[NOTIF_DUPLICATE_BLOCKED] #${blockedCount} to ${normalized}`);
                console.log(`[NOTIF_DUPLICATE_BLOCKED] Message: ${message.text?.substring(0, 50)}...`);
                
                // Return fake success to prevent errors
                return {
                    key: {
                        id: `BLOCKED_${Date.now()}_${Math.random()}`,
                        fromMe: true,
                        remoteJid: jid
                    },
                    status: 'blocked_duplicate'
                };
            }
            
            // If skipDuplicateCheck, skip duplicate check (no logging needed for normal operation)
            
            // Check connection state before sending
            if (!isReady()) {
                const runtimeState = getConnectionState();
                console.warn(`[NOTIF_WRAPPER] WhatsApp not connected (state: ${runtimeState}), skipping send to ${jid}`);
                throw new Error(`WhatsApp connection not ready (state: ${runtimeState})`);
            }
            
            // Mark as sent (only if not skipping duplicate check, to avoid polluting cache)
            if (!skipDuplicateCheck) {
                markNotificationSent(jid, message);
            }
            
            // Send actual message with retry for USync errors
            let lastError = null;
            const maxRetries = 2;
            
            for (let attempt = 0; attempt <= maxRetries; attempt++) {
                try {
                    if (attempt > 0) {
                        // Wait before retry (exponential backoff)
                        const delay = 1000 * Math.pow(2, attempt - 1);
                        console.log(`[NOTIF_WRAPPER] Retry attempt ${attempt} after ${delay}ms delay`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                    }
                    
                    return await originalSendMessage(jid, message, options);
                    
                } catch (error) {
                    lastError = error;
                    const errorMsg = error.message || error.toString();
                    
                    // Check if it's a USync error (attrs undefined)
                    if (errorMsg.includes('attrs') || errorMsg.includes('USyncQuery') || errorMsg.includes('parseUSyncQueryResult')) {
                        console.warn(`[NOTIF_WRAPPER] USync error on attempt ${attempt + 1}/${maxRetries + 1}:`, errorMsg);
                        
                        // If last attempt, don't retry
                        if (attempt >= maxRetries) {
                            console.error('[NOTIF_WRAPPER] Max retries reached for USync error, giving up');
                            break;
                        }
                        
                        // Continue to retry
                        continue;
                    }
                    
                    // For other errors, throw immediately
                    throw error;
                }
            }
            
            // If we get here, all retries failed
            throw lastError || new Error('Failed to send message after retries');
            
        } catch (error) {
            const errorMsg = error.message || error.toString();
            
            // Don't retry on connection errors or USync errors (already retried)
            if (errorMsg.includes('connection not ready') || 
                errorMsg.includes('attrs') || 
                errorMsg.includes('USyncQuery')) {
                console.error('[NOTIF_WRAPPER] Non-retryable error:', errorMsg);
                // Return fake success to prevent breaking the flow
                return {
                    key: {
                        id: `ERROR_${Date.now()}_${Math.random()}`,
                        fromMe: false,
                        remoteJid: jid
                    },
                    status: 'error',
                    error: errorMsg
                };
            }
            
            // For other errors, log and throw
            console.error('[NOTIF_WRAPPER] Error in wrapped sendMessage:', error);
            throw error;
        }
    };
    
    wrapperActive = true;
    // Notification wrapper initialized (silent)
    return true;
}

/**
 * Remove the wrapper (for testing/debugging)
 * @param {object} raf - WhatsApp connection object
 */
function removeWrapper(raf) {
    if (!wrapperActive || !originalSendMessage) {
        console.log('[NOTIF_WRAPPER] Not active, nothing to remove');
        return false;
    }
    
    raf.sendMessage = originalSendMessage;
    wrapperActive = false;
    originalSendMessage = null;
    
    console.log('[NOTIF_WRAPPER] Removed wrapper, using original sendMessage');
    return true;
}

/**
 * Get wrapper status
 * @returns {object} Status information
 */
function getWrapperStatus() {
    const stats = getStats();
    
    return {
        active: wrapperActive,
        blockedCount,
        ...stats
    };
}

/**
 * Reset blocked count
 */
function resetBlockedCount() {
    const previous = blockedCount;
    blockedCount = 0;
    return previous;
}

/**
 * Get the original sendMessage function (before wrapper)
 * This allows bypassing duplicate check for command responses
 * @returns {function|null} Original sendMessage function or null if not available
 */
function getOriginalSendMessage() {
    if (!wrapperActive || !originalSendMessage) {
        return null;
    }
    return originalSendMessage;
}

module.exports = {
    initializeWrapper,
    removeWrapper,
    getWrapperStatus,
    resetBlockedCount,
    getOriginalSendMessage
};
