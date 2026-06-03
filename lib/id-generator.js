/**
 * ID Generator - Short, Efficient, User-Friendly IDs
 * Untuk transaction dan topup request yang mudah diketik dan dimonitor
 */

/**
 * Generate short random string
 * Menggunakan base32 (tanpa karakter yang mirip: 0, O, 1, I, L)
 * Hanya huruf kapital dan angka yang jelas
 */
function generateShortCode(length = 4) {
    // Base32 alphabet tanpa karakter yang membingungkan
    const chars = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // Tanpa: 0, O, 1, I, L
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

/**
 * Get date string in YYMMDD format
 */
function getDateString() {
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return yy + mm + dd;
}

/**
 * Get time string in HHMM format
 */
function getTimeString() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    return hh + mm;
}

/**
 * Generate Agent Transaction ID
 * Format: A-YYMMDD-XXXX
 * Example: A-251019-K3M7
 * Length: 13 characters (vs 28 sebelumnya)
 */
function generateAgentTransactionId() {
    const date = getDateString();
    const code = generateShortCode(4);
    return `A-${date}-${code}`;
}

/**
 * Generate Topup Request ID
 * Format: T-YYMMDD-XXXX
 * Example: T-251019-P9Q2
 * Length: 13 characters (vs 21 sebelumnya)
 */
function generateTopupRequestId() {
    const date = getDateString();
    const code = generateShortCode(4);
    return `T-${date}-${code}`;
}

/**
 * Generate Super Short ID (untuk display/quick reference)
 * Format: XXXX (only when space is very limited)
 * Example: K3M7
 * Length: 4 characters
 * WARNING: Not guaranteed unique across days
 */
function generateSuperShortId() {
    return generateShortCode(4);
}

/**
 * Generate Agent Transaction ID (Alternative - no dashes)
 * Format: AYYMMDDXXXX
 * Example: A251019K3M7
 * Length: 11 characters
 */
function generateAgentTransactionIdCompact() {
    const date = getDateString();
    const code = generateShortCode(4);
    return `A${date}${code}`;
}

/**
 * Generate Topup Request ID (Alternative - no dashes)
 * Format: TYYMMDDXXXX
 * Example: T251019P9Q2
 * Length: 11 characters
 */
function generateTopupRequestIdCompact() {
    const date = getDateString();
    const code = generateShortCode(4);
    return `T${date}${code}`;
}

/**
 * Parse transaction ID to get date
 */
function parseTransactionDate(transactionId) {
    try {
        // Try format with dashes: A-YYMMDD-XXXX
        if (transactionId.includes('-')) {
            const parts = transactionId.split('-');
            if (parts.length === 3) {
                const dateStr = parts[1]; // YYMMDD
                const yy = '20' + dateStr.substring(0, 2);
                const mm = dateStr.substring(2, 4);
                const dd = dateStr.substring(4, 6);
                return new Date(`${yy}-${mm}-${dd}`);
            }
        }
        
        // Try compact format: AYYMMDDXXXX
        if (transactionId.length === 11) {
            const dateStr = transactionId.substring(1, 7); // YYMMDD
            const yy = '20' + dateStr.substring(0, 2);
            const mm = dateStr.substring(2, 4);
            const dd = dateStr.substring(4, 6);
            return new Date(`${yy}-${mm}-${dd}`);
        }
    } catch (error) {
        return null;
    }
    return null;
}

/**
 * Validate transaction ID format
 */
function isValidTransactionId(transactionId) {
    if (!transactionId || typeof transactionId !== 'string') {
        return false;
    }
    
    // Check format with dashes: A-YYMMDD-XXXX or T-YYMMDD-XXXX
    const dashPattern = /^[AT]-\d{6}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/;
    if (dashPattern.test(transactionId)) {
        return true;
    }
    
    // Check compact format: AYYMMDDXXXX or TYYMMDDXXXX
    const compactPattern = /^[AT]\d{6}[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/;
    if (compactPattern.test(transactionId)) {
        return true;
    }
    
    return false;
}

module.exports = {
    generateAgentTransactionId,
    generateTopupRequestId,
    generateAgentTransactionIdCompact,
    generateTopupRequestIdCompact,
    generateSuperShortId,
    generateShortCode,
    getDateString,
    getTimeString,
    parseTransactionDate,
    isValidTransactionId
};
