"use strict";

/**
 * Header Doc
 * Purpose: Menyediakan respons error standar dan helper pengiriman error ke user secara konsisten.
 * Caller: Handler bot dan wrapper async yang butuh error response user-friendly.
 * Deps: `./logger` dan `./whatsapp-delivery-service`.
 * MainFuncs: `createErrorResponse`, `sendErrorResponse`, `handleAsync`, dan helper factory error.
 * SideEffects: Menulis log error dan mengirim pesan error via gateway runtime WA.
 */

const { logger } = require('./logger');
const { sendMessage } = require('./whatsapp-delivery-service');

/**
 * Error types
 */
const ErrorType = {
    VALIDATION: 'VALIDATION',
    AUTHENTICATION: 'AUTHENTICATION',
    AUTHORIZATION: 'AUTHORIZATION',
    NOT_FOUND: 'NOT_FOUND',
    NETWORK: 'NETWORK',
    DATABASE: 'DATABASE',
    EXTERNAL_API: 'EXTERNAL_API',
    RATE_LIMIT: 'RATE_LIMIT',
    SYSTEM: 'SYSTEM',
    UNKNOWN: 'UNKNOWN'
};

/**
 * User-friendly error messages in Indonesian
 */
const userMessages = {
    [ErrorType.VALIDATION]: '❌ Data yang Anda masukkan tidak valid. Silakan periksa kembali.',
    [ErrorType.AUTHENTICATION]: '❌ Anda belum terdaftar. Silakan hubungi admin untuk mendaftar.',
    [ErrorType.AUTHORIZATION]: '❌ Anda tidak memiliki akses untuk melakukan tindakan ini.',
    [ErrorType.NOT_FOUND]: '❌ Data yang Anda cari tidak ditemukan.',
    [ErrorType.NETWORK]: '❌ Terjadi gangguan koneksi. Silakan coba beberapa saat lagi.',
    [ErrorType.DATABASE]: '❌ Terjadi kesalahan pada database. Silakan hubungi admin.',
    [ErrorType.EXTERNAL_API]: '❌ Layanan sedang tidak tersedia. Silakan coba beberapa saat lagi.',
    [ErrorType.RATE_LIMIT]: '⚠️ Anda terlalu sering mengirim pesan. Silakan tunggu beberapa saat.',
    [ErrorType.SYSTEM]: '❌ Terjadi kesalahan sistem. Silakan coba lagi atau hubungi admin.',
    [ErrorType.UNKNOWN]: '❌ Terjadi kesalahan. Silakan coba lagi.'
};

/**
 * Determine error type from error object
 * @param {Error} error - Error object
 * @returns {string} Error type
 */
function getErrorType(error) {
    if (!error) return ErrorType.UNKNOWN;
    
    // Check error code
    if (error.code) {
        switch (error.code) {
            case 'ETIMEDOUT':
            case 'ECONNREFUSED':
            case 'ENOTFOUND':
            case 'ECONNRESET':
            case 'EHOSTUNREACH':
                return ErrorType.NETWORK;
            case 'SQLITE_ERROR':
            case 'SQLITE_CONSTRAINT':
            case 'SQLITE_MISMATCH':
                return ErrorType.DATABASE;
            case 'RATE_LIMIT_EXCEEDED':
                return ErrorType.RATE_LIMIT;
        }
    }
    
    // Check error message
    const message = (error.message || '').toLowerCase();
    
    if (message.includes('validation') || message.includes('invalid')) {
        return ErrorType.VALIDATION;
    }
    if (message.includes('unauthorized') || message.includes('not authorized')) {
        return ErrorType.AUTHORIZATION;
    }
    if (message.includes('not found') || message.includes('tidak ditemukan')) {
        return ErrorType.NOT_FOUND;
    }
    if (message.includes('network') || message.includes('connection')) {
        return ErrorType.NETWORK;
    }
    if (message.includes('database') || message.includes('sqlite')) {
        return ErrorType.DATABASE;
    }
    
    // Check HTTP status if available
    if (error.response && error.response.status) {
        const status = error.response.status;
        if (status === 401) return ErrorType.AUTHENTICATION;
        if (status === 403) return ErrorType.AUTHORIZATION;
        if (status === 404) return ErrorType.NOT_FOUND;
        if (status === 429) return ErrorType.RATE_LIMIT;
        if (status >= 500) return ErrorType.EXTERNAL_API;
    }
    
    return ErrorType.UNKNOWN;
}

/**
 * Create error response object
 * @param {Error} error - Error object
 * @param {string} customMessage - Optional custom message
 * @param {Object} context - Additional context
 * @returns {Object} Error response object
 */
function createErrorResponse(error, customMessage = null, context = {}) {
    const errorType = getErrorType(error);
    const userMessage = customMessage || userMessages[errorType] || userMessages[ErrorType.UNKNOWN];
    
    // Log the error
    const logContext = {
        type: errorType,
        code: error.code,
        status: error.response?.status,
        message: error.message,
        stack: error.stack,
        ...context
    };
    
    logger.error(`Error occurred: ${errorType}`, logContext);
    
    return {
        success: false,
        message: userMessage,
        errorType: errorType,
        // Include technical details only in development
        ...(process.env.NODE_ENV === 'development' && {
            debug: {
                message: error.message,
                code: error.code,
                type: errorType
            }
        })
    };
}

/**
 * Send error response via WhatsApp
 * @param {Object} raf - WhatsApp connection object legacy compatibility
 * @param {string} from - Recipient JID
 * @param {Error} error - Error object
 * @param {string} customMessage - Optional custom message
 * @param {Object} options - Additional options
 * @returns {Promise} Send message promise
 */
async function sendErrorResponse(raf, from, error, customMessage = null, options = {}) {
    const response = createErrorResponse(error, customMessage, {
        from: from,
        ...options.context
    });
    
    // Send message
    try {
        await sendMessage(from, {
            text: response.message
        }, options.messageOptions);
        
        return response;
    } catch (sendError) {
        logger.error('Failed to send error response', {
            originalError: error,
            sendError: sendError,
            from: from
        });
        throw sendError;
    }
}

/**
 * Handle async function errors
 * @param {Function} fn - Async function to wrap
 * @param {Object} context - Context for error handling
 * @returns {Function} Wrapped function
 */
function handleAsync(fn, context = {}) {
    return async (...args) => {
        try {
            return await fn(...args);
        } catch (error) {
            const { raf, from, customMessage } = context;
            
            if (raf && from) {
                await sendErrorResponse(raf, from, error, customMessage, {
                    context: { function: fn.name }
                });
            } else {
                logger.error(`Unhandled error in ${fn.name}`, error);
            }
            
            // Re-throw if needed
            if (context.rethrow) {
                throw error;
            }
        }
    };
}

/**
 * Create custom error with type
 * @param {string} message - Error message
 * @param {string} type - Error type
 * @param {Object} details - Additional details
 * @returns {Error} Custom error object
 */
function createError(message, type = ErrorType.UNKNOWN, details = {}) {
    const error = new Error(message);
    error.errorType = type;
    error.details = details;
    return error;
}

module.exports = {
    ErrorType,
    userMessages,
    getErrorType,
    createErrorResponse,
    sendErrorResponse,
    handleAsync,
    createError,
    
    // Convenience methods
    validationError: (message, details) => createError(message, ErrorType.VALIDATION, details),
    authenticationError: (message, details) => createError(message, ErrorType.AUTHENTICATION, details),
    authorizationError: (message, details) => createError(message, ErrorType.AUTHORIZATION, details),
    notFoundError: (message, details) => createError(message, ErrorType.NOT_FOUND, details),
    networkError: (message, details) => createError(message, ErrorType.NETWORK, details),
    databaseError: (message, details) => createError(message, ErrorType.DATABASE, details),
    rateLimitError: (message, details) => createError(message, ErrorType.RATE_LIMIT, details),
    systemError: (message, details) => createError(message, ErrorType.SYSTEM, details)
};
