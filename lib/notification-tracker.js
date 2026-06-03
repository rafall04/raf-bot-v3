/**
 * Notification Tracker
 * Prevents duplicate notifications for WhatsApp messages
 * Includes phone normalization and content-based deduplication
 */

const notificationCache = new Map();
const phoneCache = new Map();
const NOTIFICATION_TIMEOUT = 10000; // 10 seconds
const PHONE_CACHE_TIMEOUT = 60000; // 1 minute
const DEBUG = process.env.NOTIF_DEBUG === 'true' || false; // Set via env var

/**
 * Normalize phone number to consistent format
 * @param {string} phone - Phone number in any format
 * @returns {string} Normalized phone number
 */
function normalizePhone(phone) {
    if (!phone) return '';
    
    // Remove @s.whatsapp.net if present
    let cleaned = phone.replace('@s.whatsapp.net', '');
    
    // Remove all non-digits
    cleaned = cleaned.replace(/\D/g, '');
    
    // Convert to international format
    if (cleaned.startsWith('0')) {
        cleaned = '62' + cleaned.substring(1);
    } else if (!cleaned.startsWith('62')) {
        cleaned = '62' + cleaned;
    }
    
    return cleaned;
}

/**
 * Generate unique key for notification
 * @param {string} jid - Recipient JID
 * @param {object} message - Message object
 * @returns {string} Unique key
 */
function generateNotificationKey(jid, message) {
    const normalizedJid = normalizePhone(jid);
    
    // Extract text content
    let content = '';
    if (message.text) {
        // Take first 200 chars for comparison
        content = message.text.substring(0, 200);
    } else if (message.caption) {
        content = message.caption.substring(0, 200);
    }
    
    // Generate key
    return `${normalizedJid}-${content}`;
}

/**
 * Check if notification was recently sent
 * @param {string} jid - Recipient JID
 * @param {object} message - Message object
 * @returns {boolean} True if duplicate
 */
function isNotificationDuplicate(jid, message) {
    const key = generateNotificationKey(jid, message);
    
    if (notificationCache.has(key)) {
        const entry = notificationCache.get(key);
        const timeSinceLastSend = Date.now() - entry.timestamp;
        
        if (DEBUG) {
            console.log(`[NOTIF_TRACKER] Duplicate detected for ${normalizePhone(jid)}`);
            console.log(`[NOTIF_TRACKER] Time since last: ${timeSinceLastSend}ms`);
            console.log(`[NOTIF_TRACKER] Message preview: ${message.text?.substring(0, 50)}...`);
        }
        
        // Update count
        entry.count++;
        return true;
    }
    
    return false;
}

/**
 * Mark notification as sent
 * @param {string} jid - Recipient JID
 * @param {object} message - Message object
 */
function markNotificationSent(jid, message) {
    const key = generateNotificationKey(jid, message);
    
    notificationCache.set(key, {
        timestamp: Date.now(),
        count: 1,
        jid: normalizePhone(jid),
        preview: message.text?.substring(0, 50) || 'No text'
    });
    
    // Auto cleanup (silent - no logging needed for normal cleanup)
    setTimeout(() => {
        if (notificationCache.has(key)) {
            notificationCache.delete(key);
        }
    }, NOTIFICATION_TIMEOUT);
}

/**
 * Check if two JIDs refer to the same person
 * @param {string} jid1 - First JID
 * @param {string} jid2 - Second JID
 * @returns {boolean} True if same person
 */
function isSameRecipient(jid1, jid2) {
    return normalizePhone(jid1) === normalizePhone(jid2);
}

/**
 * Get all recent notifications for a recipient
 * @param {string} jid - Recipient JID
 * @returns {array} Recent notifications
 */
function getRecentNotifications(jid) {
    const normalized = normalizePhone(jid);
    const recent = [];
    
    notificationCache.forEach((entry, key) => {
        if (entry.jid === normalized) {
            recent.push({
                ...entry,
                age: Date.now() - entry.timestamp
            });
        }
    });
    
    return recent;
}

/**
 * Clear all tracked notifications
 */
function clearAll() {
    const size = notificationCache.size;
    notificationCache.clear();
    phoneCache.clear();
    
    if (DEBUG) {
        console.log(`[NOTIF_TRACKER] Cleared ${size} tracked notifications`);
    }
}

/**
 * Get statistics
 * @returns {object} Statistics
 */
function getStats() {
    const stats = {
        totalTracked: notificationCache.size,
        duplicatesPrevented: 0,
        topRecipients: new Map()
    };
    
    notificationCache.forEach(entry => {
        if (entry.count > 1) {
            stats.duplicatesPrevented += entry.count - 1;
        }
        
        const current = stats.topRecipients.get(entry.jid) || 0;
        stats.topRecipients.set(entry.jid, current + entry.count);
    });
    
    // Convert to array and sort
    stats.topRecipients = Array.from(stats.topRecipients.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([jid, count]) => ({ jid, count }));
    
    return stats;
}

/**
 * Deduplicate list of phone numbers
 * @param {array} phones - Array of phone numbers
 * @returns {array} Unique phone numbers
 */
function deduplicatePhones(phones) {
    const unique = new Set();
    const result = [];
    
    for (const phone of phones) {
        const normalized = normalizePhone(phone);
        if (!unique.has(normalized)) {
            unique.add(normalized);
            result.push(phone);
        }
    }
    
    if (DEBUG && phones.length !== result.length) {
        console.log(`[NOTIF_TRACKER] Deduplicated phones: ${phones.length} → ${result.length}`);
    }
    
    return result;
}

module.exports = {
    normalizePhone,
    isNotificationDuplicate,
    markNotificationSent,
    isSameRecipient,
    getRecentNotifications,
    clearAll,
    getStats,
    deduplicatePhones,
    generateNotificationKey
};
