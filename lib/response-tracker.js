/**
 * Response Tracker
 * Prevents duplicate responses by tracking message IDs
 */

const responseTracker = new Map();
const RESPONSE_TIMEOUT = 5000; // 5 seconds
const DEBUG = false; // Set to true for debugging

/**
 * Check if a message has already been responded to
 * @param {string} msgId - Message ID to check
 * @returns {boolean} True if already responded
 */
function hasResponded(msgId) {
    if (!msgId) return false;
    const responded = responseTracker.has(msgId);
    if (DEBUG && responded) {
        console.log(`[RESPONSE_TRACKER] Message ${msgId} already responded`);
    }
    return responded;
}

/**
 * Mark a message as responded
 * @param {string} msgId - Message ID to mark
 */
function markResponded(msgId) {
    if (!msgId) return;
    
    responseTracker.set(msgId, {
        timestamp: Date.now(),
        count: (responseTracker.get(msgId)?.count || 0) + 1
    });
    
    if (DEBUG) {
        const data = responseTracker.get(msgId);
        console.log(`[RESPONSE_TRACKER] Marked ${msgId} as responded (count: ${data.count})`);
    }
    
    // Auto cleanup after timeout
    setTimeout(() => {
        if (responseTracker.has(msgId)) {
            if (DEBUG) {
                const data = responseTracker.get(msgId);
                console.log(`[RESPONSE_TRACKER] Cleaning up ${msgId} (had ${data.count} responses)`);
            }
            responseTracker.delete(msgId);
        }
    }, RESPONSE_TIMEOUT);
}

/**
 * Get response count for a message
 * @param {string} msgId - Message ID to check
 * @returns {number} Number of responses sent
 */
function getResponseCount(msgId) {
    if (!msgId) return 0;
    return responseTracker.get(msgId)?.count || 0;
}

/**
 * Clear all tracked responses (for cleanup)
 */
function clearAll() {
    const size = responseTracker.size;
    responseTracker.clear();
    if (DEBUG) {
        console.log(`[RESPONSE_TRACKER] Cleared ${size} tracked responses`);
    }
}

/**
 * Get statistics about tracked responses
 * @returns {object} Statistics
 */
function getStats() {
    const stats = {
        totalTracked: responseTracker.size,
        duplicates: 0,
        messages: []
    };
    
    responseTracker.forEach((data, msgId) => {
        if (data.count > 1) {
            stats.duplicates++;
            stats.messages.push({
                msgId,
                count: data.count,
                age: Date.now() - data.timestamp
            });
        }
    });
    
    return stats;
}

module.exports = {
    hasResponded,
    markResponded,
    getResponseCount,
    clearAll,
    getStats
};
