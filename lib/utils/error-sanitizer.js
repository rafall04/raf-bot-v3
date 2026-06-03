/**
 * Error Message Sanitization Utilities
 * 
 * Helper functions untuk sanitize error messages sebelum dikirim ke user
 * untuk prevent information disclosure dan security vulnerabilities.
 */

/**
 * Sanitize error message untuk prevent information disclosure
 * @param {Error|string} error - Error object atau error message
 * @param {Object} options - Sanitization options
 * @returns {string} Sanitized error message
 */
function sanitizeErrorMessage(error, options = {}) {
    const {
        isProduction = process.env.NODE_ENV === 'production',
        includeDetails = false,
        defaultMessage = 'Terjadi kesalahan. Silakan coba lagi.'
    } = options;

    // Extract message
    let message = '';
    if (typeof error === 'string') {
        message = error;
    } else if (error && error.message) {
        message = error.message;
    } else {
        return defaultMessage;
    }

    // In production, sanitize error messages to prevent information disclosure
    if (isProduction) {
        // Remove sensitive patterns
        message = removeSensitivePatterns(message);
        
        // Map technical errors to user-friendly messages
        message = mapToUserFriendlyMessage(message);
        
        // Limit message length
        if (message.length > 200) {
            message = message.substring(0, 200) + '...';
        }
    }

    return message || defaultMessage;
}

/**
 * Remove sensitive patterns from error messages
 * @param {string} message - Error message
 * @returns {string} Sanitized message
 */
function removeSensitivePatterns(message) {
    let sanitized = message;

    // Remove file paths
    sanitized = sanitized.replace(/\/[^\s]+/g, '[path]');
    
    // Remove absolute paths (Windows)
    sanitized = sanitized.replace(/[A-Z]:\\[^\s]+/g, '[path]');
    
    // Remove SQL queries
    sanitized = sanitized.replace(/SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|JOIN/gi, '[query]');
    
    // Remove database table/column names
    sanitized = sanitized.replace(/\b(users|accounts|reports|speed_requests|packages)\b/gi, '[table]');
    
    // Remove stack traces
    sanitized = sanitized.replace(/at\s+[^\n]+/g, '');
    sanitized = sanitized.replace(/Error:\s*/g, '');
    
    // Remove error codes that might reveal system info
    sanitized = sanitized.replace(/SQLITE_[A-Z_]+/g, '[db_error]');
    sanitized = sanitized.replace(/ECONNREFUSED|ETIMEDOUT|ENOTFOUND/g, '[network_error]');
    
    // Remove IP addresses
    sanitized = sanitized.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[ip]');
    
    // Remove email addresses
    sanitized = sanitized.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[email]');
    
    // Remove phone numbers
    sanitized = sanitized.replace(/\b\d{10,15}\b/g, '[phone]');
    
    // Remove tokens/JWT
    sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g, '[token]');
    sanitized = sanitized.replace(/\b[A-Za-z0-9\-_]{20,}\b/g, '[token]');

    return sanitized.trim();
}

/**
 * Map technical error messages to user-friendly messages
 * @param {string} message - Error message
 * @returns {string} User-friendly message
 */
function mapToUserFriendlyMessage(message) {
    const lowerMessage = message.toLowerCase();

    // Database errors
    if (lowerMessage.includes('database') || lowerMessage.includes('sqlite') || lowerMessage.includes('[db_error]')) {
        return 'Terjadi kesalahan pada database. Silakan hubungi admin.';
    }

    // Network errors
    if (lowerMessage.includes('network') || lowerMessage.includes('connection') || lowerMessage.includes('[network_error]')) {
        return 'Terjadi gangguan koneksi. Silakan coba beberapa saat lagi.';
    }

    // Authentication errors
    if (lowerMessage.includes('unauthorized') || lowerMessage.includes('invalid token') || lowerMessage.includes('authentication')) {
        return 'Sesi Anda telah berakhir. Silakan login kembali.';
    }

    // Authorization errors
    if (lowerMessage.includes('forbidden') || lowerMessage.includes('permission') || lowerMessage.includes('authorization')) {
        return 'Anda tidak memiliki izin untuk melakukan tindakan ini.';
    }

    // Validation errors
    if (lowerMessage.includes('validation') || lowerMessage.includes('invalid') || lowerMessage.includes('required')) {
        return 'Data yang Anda masukkan tidak valid. Silakan periksa kembali.';
    }

    // Not found errors
    if (lowerMessage.includes('not found') || lowerMessage.includes('tidak ditemukan')) {
        return 'Data yang Anda cari tidak ditemukan.';
    }

    // Rate limit errors
    if (lowerMessage.includes('rate limit') || lowerMessage.includes('too many')) {
        return 'Terlalu banyak percobaan. Silakan tunggu beberapa saat.';
    }

    // Default: return sanitized message or generic error
    if (message.length > 0 && message !== '[path]' && message !== '[query]') {
        return message;
    }

    return 'Terjadi kesalahan. Silakan coba lagi.';
}

/**
 * Check if error contains sensitive information
 * @param {Error|string} error - Error object atau error message
 * @returns {boolean} True if error contains sensitive information
 */
function containsSensitiveInfo(error) {
    const message = typeof error === 'string' ? error : (error?.message || '');
    const lowerMessage = message.toLowerCase();

    const sensitivePatterns = [
        /password/i,
        /token/i,
        /secret/i,
        /key/i,
        /api[_-]?key/i,
        /sql/i,
        /database/i,
        /file[_-]?path/i,
        /stack[_-]?trace/i,
        /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/, // IP address
        /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}/, // Email
        /Bearer\s+[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/ // JWT token
    ];

    return sensitivePatterns.some(pattern => pattern.test(lowerMessage));
}

/**
 * Create safe error response untuk user
 * @param {Error|string} error - Error object atau error message
 * @param {Object} options - Options
 * @returns {Object} Safe error response
 */
function createSafeErrorResponse(error, options = {}) {
    const {
        isProduction = process.env.NODE_ENV === 'production',
        defaultMessage = 'Terjadi kesalahan. Silakan coba lagi.',
        statusCode = 500
    } = options;

    const sanitizedMessage = sanitizeErrorMessage(error, {
        isProduction,
        defaultMessage
    });

    const response = {
        status: statusCode,
        message: sanitizedMessage
    };

    // Only include details in development
    if (!isProduction && error && typeof error === 'object') {
        response.debug = {
            error: error.message,
            code: error.code,
            type: error.name
        };
    }

    return response;
}

module.exports = {
    sanitizeErrorMessage,
    removeSensitivePatterns,
    mapToUserFriendlyMessage,
    containsSensitiveInfo,
    createSafeErrorResponse
};

