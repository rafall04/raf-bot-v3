/**
 * Input Sanitization Utilities
 * 
 * Helper functions untuk sanitize dan validate user input
 * untuk prevent XSS, injection attacks, dan data corruption.
 */

/**
 * Sanitize string input - remove dangerous characters
 * @param {string} input - Input string
 * @param {Object} options - Sanitization options
 * @returns {string} Sanitized string
 */
function sanitizeString(input, options = {}) {
    if (typeof input !== 'string') {
        return String(input || '');
    }

    const {
        allowHTML = false,
        maxLength = 10000,
        trim = true,
        removeNullBytes = true
    } = options;

    let sanitized = input;

    // Remove null bytes (prevent null byte injection)
    if (removeNullBytes) {
        sanitized = sanitized.replace(/\0/g, '');
    }

    // Trim whitespace
    if (trim) {
        sanitized = sanitized.trim();
    }

    // Remove HTML tags if not allowed
    if (!allowHTML) {
        // Basic HTML tag removal (for simple cases)
        sanitized = sanitized.replace(/<[^>]*>/g, '');
    }

    // Limit length
    if (sanitized.length > maxLength) {
        sanitized = sanitized.substring(0, maxLength);
    }

    return sanitized;
}

/**
 * Sanitize username - alphanumeric + underscore only
 * @param {string} username - Username to sanitize
 * @returns {string} Sanitized username
 */
function sanitizeUsername(username) {
    if (typeof username !== 'string') {
        return '';
    }

    // Remove all non-alphanumeric and underscore characters
    return username.replace(/[^a-zA-Z0-9_]/g, '');
}

/**
 * Sanitize phone number - digits only
 * @param {string} phoneNumber - Phone number to sanitize
 * @returns {string} Sanitized phone number
 */
function sanitizePhoneNumber(phoneNumber) {
    if (typeof phoneNumber !== 'string') {
        return '';
    }

    // Remove all non-digit characters
    return phoneNumber.replace(/[^0-9]/g, '');
}

/**
 * Sanitize ID parameter - alphanumeric + underscore + dash only
 * @param {string} id - ID to sanitize
 * @returns {string} Sanitized ID
 */
function sanitizeId(id) {
    if (typeof id !== 'string') {
        return '';
    }

    // Allow alphanumeric, underscore, and dash
    return id.replace(/[^a-zA-Z0-9_\-]/g, '');
}

/**
 * Sanitize text content - remove script tags and dangerous patterns
 * @param {string} text - Text to sanitize
 * @param {number} maxLength - Maximum length
 * @returns {string} Sanitized text
 */
function sanitizeText(text, maxLength = 2000) {
    if (typeof text !== 'string') {
        return '';
    }

    let sanitized = text;

    // Remove script tags and event handlers
    sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    sanitized = sanitized.replace(/on\w+\s*=\s*["'][^"']*["']/gi, '');
    sanitized = sanitized.replace(/javascript:/gi, '');
    sanitized = sanitized.replace(/data:text\/html/gi, '');

    // Remove null bytes
    sanitized = sanitized.replace(/\0/g, '');

    // Trim and limit length
    sanitized = sanitized.trim();
    if (sanitized.length > maxLength) {
        sanitized = sanitized.substring(0, maxLength);
    }

    return sanitized;
}

/**
 * Sanitize object - recursively sanitize all string values
 * @param {Object} obj - Object to sanitize
 * @param {Object} options - Sanitization options
 * @returns {Object} Sanitized object
 */
function sanitizeObject(obj, options = {}) {
    if (!obj || typeof obj !== 'object') {
        return obj;
    }

    if (Array.isArray(obj)) {
        return obj.map(item => sanitizeObject(item, options));
    }

    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'string') {
            sanitized[key] = sanitizeString(value, options);
        } else if (typeof value === 'object' && value !== null) {
            sanitized[key] = sanitizeObject(value, options);
        } else {
            sanitized[key] = value;
        }
    }

    return sanitized;
}

/**
 * Validate and sanitize email (basic validation)
 * @param {string} email - Email to validate
 * @returns {string|null} Sanitized email or null if invalid
 */
function sanitizeEmail(email) {
    if (typeof email !== 'string') {
        return null;
    }

    const sanitized = email.trim().toLowerCase();
    
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(sanitized)) {
        return null;
    }

    // Limit length
    if (sanitized.length > 254) {
        return null;
    }

    return sanitized;
}

/**
 * Escape special characters for SQL (for additional safety, though we use parameterized queries)
 * @param {string} input - Input string
 * @returns {string} Escaped string
 */
function escapeSQL(input) {
    if (typeof input !== 'string') {
        return '';
    }

    // Basic SQL injection prevention (but we should always use parameterized queries)
    return input
        .replace(/'/g, "''")
        .replace(/\\/g, '\\\\')
        .replace(/\0/g, '');
}

module.exports = {
    sanitizeString,
    sanitizeUsername,
    sanitizePhoneNumber,
    sanitizeId,
    sanitizeText,
    sanitizeObject,
    sanitizeEmail,
    escapeSQL
};

