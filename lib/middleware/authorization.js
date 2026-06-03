/**
 * Authorization Middleware & Helpers
 * 
 * Helper functions untuk verify resource ownership dan authorization checks.
 */

const { createError, ErrorTypes } = require('../error-handler');

/**
 * Verify that resource belongs to user
 * 
 * @param {Object} resource - Resource object to verify
 * @param {string|number} userId - User ID to verify against
 * @param {string} resourceName - Name of resource for error message
 * @throws {Error} Jika resource tidak ditemukan atau tidak dimiliki user
 */
function verifyResourceOwnership(resource, userId, resourceName = 'Resource') {
    if (!resource) {
        throw createError(
            ErrorTypes.NOT_FOUND_ERROR,
            `${resourceName} tidak ditemukan.`,
            404
        );
    }

    // Strict comparison dengan String() untuk handle number/string mismatch
    if (String(resource.userId) !== String(userId)) {
        throw createError(
            ErrorTypes.AUTHORIZATION_ERROR,
            `Anda tidak memiliki izin untuk mengakses ${resourceName} ini.`,
            403
        );
    }
}

/**
 * Verify that user can only access their own data
 * 
 * @param {Object} user - User object from request
 * @param {string|number} targetUserId - Target user ID to check
 * @param {string} action - Action being performed (for logging)
 * @throws {Error} Jika user mencoba akses data user lain
 */
function verifySelfAccess(user, targetUserId, action = 'access') {
    if (!user || !user.id) {
        throw createError(
            ErrorTypes.AUTHENTICATION_ERROR,
            'Authentication required',
            401
        );
    }

    if (String(user.id) !== String(targetUserId)) {
        // Log suspicious activity
        console.warn('[AUTHORIZATION_VIOLATION]', {
            userId: user.id,
            attemptedUserId: targetUserId,
            action,
            timestamp: new Date().toISOString()
        });

        throw createError(
            ErrorTypes.AUTHORIZATION_ERROR,
            'Anda tidak memiliki izin untuk mengakses data ini.',
            403
        );
    }
}

/**
 * Verify request ownership by requestId
 * 
 * @param {Object} request - Request object (speed request, report, etc.)
 * @param {Object} user - User object from request
 * @param {string} requestType - Type of request (for error message)
 * @throws {Error} Jika request tidak ditemukan atau tidak dimiliki user
 */
function verifyRequestOwnership(request, user, requestType = 'Permintaan') {
    verifyResourceOwnership(request, user.id, requestType);
}

module.exports = {
    verifyResourceOwnership,
    verifySelfAccess,
    verifyRequestOwnership
};

