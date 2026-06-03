/**
 * Header Doc
 * Purpose: Menyediakan utilitas error terpusat, wrapper async, dan validasi operasi HTTP/DB/WA.
 * Caller: Controller Express, service layer, dan middleware global error.
 * Deps: `./whatsapp-gateway`.
 * MainFuncs: `APIError`, `createError`, `errorHandler`, `asyncHandler`, `whatsappOperation`.
 * SideEffects: Membentuk response error HTTP dan melempar exception terstandar.
 */
const { isReady } = require('./whatsapp-gateway');

/**
 * Standard error response structure
 */
class APIError extends Error {
    constructor(message, statusCode = 500, errorCode = null, details = null) {
        super(message);
        this.name = 'APIError';
        this.statusCode = statusCode;
        this.errorCode = errorCode;
        this.details = details;
        this.timestamp = new Date().toISOString();
    }
}

/**
 * Common error types
 */
const ErrorTypes = {
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    DATABASE_ERROR: 'DATABASE_ERROR',
    AUTHENTICATION_ERROR: 'AUTHENTICATION_ERROR',
    AUTHORIZATION_ERROR: 'AUTHORIZATION_ERROR',
    NOT_FOUND_ERROR: 'NOT_FOUND_ERROR',
    RATE_LIMIT_ERROR: 'RATE_LIMIT_ERROR',
    EXTERNAL_API_ERROR: 'EXTERNAL_API_ERROR',
    WHATSAPP_ERROR: 'WHATSAPP_ERROR',
    MIKROTIK_ERROR: 'MIKROTIK_ERROR',
    INTERNAL_ERROR: 'INTERNAL_ERROR'
};

/**
 * Create standardized error responses
 */
function createError(type, message, statusCode = 500, details = null) {
    return new APIError(message, statusCode, type, details);
}

/**
 * Express error handling middleware
 */
function errorHandler(err, req, res, next) {
    const isProduction = process.env.NODE_ENV === 'production';
    const { sanitizeErrorMessage, containsSensitiveInfo } = require('./utils/error-sanitizer');

    // Log the error for debugging (always log full details)
    console.error(`[ERROR_HANDLER] ${new Date().toISOString()}`, {
        error: err.message,
        stack: err.stack,
        url: req.url,
        method: req.method,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        sensitive: containsSensitiveInfo(err)
    });

    // Handle APIError instances
    if (err instanceof APIError) {
        const safeMessage = isProduction 
            ? sanitizeErrorMessage(err.message, { isProduction: true })
            : err.message;
            
        return res.status(err.statusCode).json({
            status: err.statusCode,
            message: safeMessage,
            errorCode: err.errorCode,
            timestamp: err.timestamp,
            ...(!isProduction && { details: err.details })
        });
    }

    // Handle specific error types
    if (err.name === 'ValidationError') {
        const safeMessage = isProduction 
            ? 'Data yang Anda masukkan tidak valid. Silakan periksa kembali.'
            : err.message;
            
        return res.status(400).json({
            status: 400,
            message: safeMessage,
            errorCode: ErrorTypes.VALIDATION_ERROR,
            timestamp: new Date().toISOString(),
            ...(!isProduction && { details: err.message })
        });
    }

    if (err.code === 'SQLITE_CONSTRAINT') {
        return res.status(409).json({
            status: 409,
            message: isProduction 
                ? 'Data yang Anda masukkan tidak valid atau sudah ada di sistem.'
                : 'Database constraint violation',
            errorCode: ErrorTypes.DATABASE_ERROR,
            timestamp: new Date().toISOString()
        });
    }

    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
        return res.status(401).json({
            status: 401,
            message: 'Sesi Anda telah berakhir. Silakan login kembali.',
            errorCode: ErrorTypes.AUTHENTICATION_ERROR,
            timestamp: new Date().toISOString()
        });
    }

    // Default error response - SECURITY: Never expose error details in production
    const safeMessage = isProduction 
        ? 'Terjadi kesalahan pada server. Silakan coba lagi atau hubungi admin.'
        : err.message;
        
    res.status(500).json({
        status: 500,
        message: safeMessage,
        errorCode: 'INTERNAL_SERVER_ERROR',
        timestamp: new Date().toISOString(),
        ...(!isProduction && { debug: { error: err.message, stack: err.stack } })
    });
}

/**
 * Async wrapper to catch errors in async route handlers
 */
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

/**
 * Database operation wrapper with error handling
 */
function dbOperation(operation, errorMessage = 'Database operation failed') {
    return new Promise((resolve, reject) => {
        try {
            operation((err, result) => {
                if (err) {
                    console.error(`[DB_ERROR] ${errorMessage}:`, err);
                    reject(createError(
                        ErrorTypes.DATABASE_ERROR,
                        errorMessage,
                        500,
                        err.message
                    ));
                } else {
                    resolve(result);
                }
            });
        } catch (error) {
            console.error(`[DB_OPERATION_ERROR] ${errorMessage}:`, error);
            reject(createError(
                ErrorTypes.DATABASE_ERROR,
                errorMessage,
                500,
                error.message
            ));
        }
    });
}

/**
 * WhatsApp operation wrapper with error handling
 */
async function whatsappOperation(operation, errorMessage = 'WhatsApp operation failed') {
    try {
        if (!isReady()) {
            throw createError(
                ErrorTypes.WHATSAPP_ERROR,
                'WhatsApp bot is offline',
                503
            );
        }
        return await operation();
    } catch (error) {
        console.error(`[WHATSAPP_ERROR] ${errorMessage}:`, error);
        if (error instanceof APIError) {
            throw error;
        }
        throw createError(
            ErrorTypes.WHATSAPP_ERROR,
            errorMessage,
            500,
            error.message
        );
    }
}

/**
 * External API operation wrapper with error handling
 */
async function externalApiOperation(operation, errorMessage = 'External API operation failed') {
    try {
        return await operation();
    } catch (error) {
        console.error(`[EXTERNAL_API_ERROR] ${errorMessage}:`, error);
        
        if (error.response) {
            // API responded with error status
            throw createError(
                ErrorTypes.EXTERNAL_API_ERROR,
                `${errorMessage}: ${error.response.status} ${error.response.statusText}`,
                error.response.status >= 500 ? 502 : 400,
                error.response.data
            );
        } else if (error.request) {
            // Network error
            throw createError(
                ErrorTypes.EXTERNAL_API_ERROR,
                `${errorMessage}: Network error`,
                503
            );
        } else {
            // Other error
            throw createError(
                ErrorTypes.EXTERNAL_API_ERROR,
                errorMessage,
                500,
                error.message
            );
        }
    }
}

/**
 * Validation helper
 */
function validateRequired(data, requiredFields) {
    const missing = requiredFields.filter(field => !data[field]);
    if (missing.length > 0) {
        throw createError(
            ErrorTypes.VALIDATION_ERROR,
            `Missing required fields: ${missing.join(', ')}`,
            400
        );
    }
}

/**
 * Authorization helper
 */
function requireRole(user, allowedRoles) {
    if (!user) {
        throw createError(
            ErrorTypes.AUTHENTICATION_ERROR,
            'Authentication required',
            401
        );
    }
    
    if (!allowedRoles.includes(user.role)) {
        throw createError(
            ErrorTypes.AUTHORIZATION_ERROR,
            'Insufficient permissions',
            403
        );
    }
}

module.exports = {
    APIError,
    ErrorTypes,
    createError,
    errorHandler,
    asyncHandler,
    dbOperation,
    whatsappOperation,
    externalApiOperation,
    validateRequired,
    requireRole
};
