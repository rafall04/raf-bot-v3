/**
 * Helper functions untuk standardisasi API response format
 * Semua endpoint harus menggunakan helper ini untuk konsistensi
 */

/**
 * Send success response dengan format standar
 * @param {Object} res - Express response object
 * @param {*} data - Data to send (bisa object, array, atau null)
 * @param {string} message - Success message (default: "Success")
 * @param {number} statusCode - HTTP status code (default: 200)
 * @returns {Object} Express response
 */
function sendSuccess(res, data, message = "Success", statusCode = 200) {
    return res.status(statusCode).json({
        status: statusCode,
        message: message,
        data: data
    });
}

/**
 * Send error response dengan format standar
 * @param {Object} res - Express response object
 * @param {string} message - Error message dalam Bahasa Indonesia
 * @param {number} statusCode - HTTP status code (default: 500)
 * @param {*} details - Additional error details (optional, hanya di development)
 * @returns {Object} Express response
 */
function sendError(res, message, statusCode = 500, details = null) {
    // SECURITY: Sanitize error message untuk prevent information disclosure
    const { sanitizeErrorMessage } = require('./utils/error-sanitizer');
    const isProduction = process.env.NODE_ENV === 'production';
    
    // Sanitize message di production
    const sanitizedMessage = isProduction 
        ? sanitizeErrorMessage(message, { isProduction: true })
        : message;
    
    const response = {
        status: statusCode,
        message: sanitizedMessage
    };
    
    // Hanya tampilkan details di development mode
    if (details && !isProduction) {
        response.details = details;
    }
    
    return res.status(statusCode).json(response);
}

/**
 * Send paginated response
 * @param {Object} res - Express response object
 * @param {Array} data - Array of data
 * @param {number} total - Total count
 * @param {number} page - Current page (1-based)
 * @param {number} limit - Items per page
 * @param {string} message - Success message (default: "Success")
 * @returns {Object} Express response
 */
function sendPaginated(res, data, total, page, limit, message = "Success") {
    return res.status(200).json({
        status: 200,
        message: message,
        data: data,
        pagination: {
            total: total,
            page: page,
            limit: limit,
            totalPages: Math.ceil(total / limit)
        }
    });
}

module.exports = {
    sendSuccess,
    sendError,
    sendPaginated
};

