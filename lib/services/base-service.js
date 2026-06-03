/**
 * Base Service Class
 * 
 * Base class untuk semua service classes di aplikasi.
 * Menyediakan common patterns dan utilities untuk services.
 * 
 * Semua service classes harus extend dari BaseService atau menggunakan
 * static methods pattern yang konsisten.
 */

const { createError, ErrorTypes } = require('../error-handler');

class BaseService {
    /**
     * Validate required fields
     * @param {Object} data - Data object to validate
     * @param {Array<string>} requiredFields - Array of required field names
     * @throws {Error} Jika ada field yang required tapi tidak ada
     */
    static validateRequired(data, requiredFields) {
        const missingFields = requiredFields.filter(field => !data[field]);
        
        if (missingFields.length > 0) {
            throw createError(
                ErrorTypes.VALIDATION_ERROR,
                `Field berikut wajib diisi: ${missingFields.join(', ')}`,
                400
            );
        }
    }

    /**
     * Validate field exists and is not empty
     * @param {*} value - Value to validate
     * @param {string} fieldName - Name of the field for error message
     * @throws {Error} Jika value tidak valid
     */
    static validateField(value, fieldName) {
        if (value === undefined || value === null || value === '') {
            throw createError(
                ErrorTypes.VALIDATION_ERROR,
                `Field '${fieldName}' wajib diisi`,
                400
            );
        }
    }

    /**
     * Normalize phone number untuk operasi database
     * @param {string} phoneNumber - Phone number to normalize
     * @returns {string} Normalized phone number
     */
    static normalizePhoneNumber(phoneNumber) {
        const { normalizePhoneNumber } = require('../utils');
        return normalizePhoneNumber(phoneNumber);
    }

    /**
     * Get customer JID dari phone number
     * @param {string} phoneNumber - Phone number
     * @returns {string} Customer JID format
     */
    static getCustomerJid(phoneNumber) {
        const normalized = this.normalizePhoneNumber(phoneNumber);
        return `${normalized}@s.whatsapp.net`;
    }

    /**
     * Get all customer JIDs dari phone numbers (support multiple numbers)
     * @param {string} phoneNumbers - Phone numbers separated by |
     * @returns {Array<string>} Array of customer JIDs
     */
    static getCustomerJids(phoneNumbers) {
        if (!phoneNumbers) return [];
        return phoneNumbers.split('|').map(n => this.getCustomerJid(n));
    }

    /**
     * Find user by ID
     * @param {number} userId - User ID
     * @returns {Object|null} User object or null
     */
    static findUserById(userId) {
        if (!global.users) return null;
        return global.users.find(u => u.id === userId) || null;
    }

    /**
     * Find user by username
     * @param {string} username - Username
     * @returns {Object|null} User object or null
     */
    static findUserByUsername(username) {
        if (!global.users) return null;
        return global.users.find(u => u.username === username) || null;
    }

    /**
     * Find package by name
     * @param {string} packageName - Package name
     * @returns {Object|null} Package object or null
     */
    static findPackageByName(packageName) {
        if (!global.packages) return null;
        return global.packages.find(p => p.name === packageName) || null;
    }

    /**
     * Log service operation
     * @param {string} serviceName - Name of the service
     * @param {string} operation - Operation name
     * @param {Object} context - Additional context
     */
    static logOperation(serviceName, operation, context = {}) {
        console.log(`[${serviceName}] ${operation}`, context);
    }

    /**
     * Log service error
     * @param {string} serviceName - Name of the service
     * @param {string} operation - Operation name
     * @param {Error} error - Error object
     * @param {Object} context - Additional context
     */
    static logError(serviceName, operation, error, context = {}) {
        console.error(`[${serviceName}_ERROR] ${operation}`, {
            error: error.message,
            stack: error.stack,
            ...context
        });
    }

    /**
     * Log data access untuk audit trail
     * 
     * @param {string} serviceName - Service name
     * @param {string} operation - Operation name (e.g., 'getProfile', 'cancelRequest')
     * @param {string|number} userId - User ID yang mengakses data
     * @param {string|number} resourceId - Resource ID yang diakses (optional)
     * @param {boolean} success - Whether operation was successful
     * @param {Object} req - Express request object (optional, for IP address)
     */
    static logDataAccess(serviceName, operation, userId, resourceId = null, success = true, req = null) {
        // Log in production atau jika NODE_ENV tidak di-set (default: log semua)
        const shouldLog = process.env.NODE_ENV === 'production' || !process.env.NODE_ENV || process.env.ENABLE_AUDIT_LOG === 'true';
        
        if (shouldLog) {
            const logData = {
                service: serviceName,
                operation,
                userId: String(userId),
                resourceId: resourceId ? String(resourceId) : null,
                success,
                timestamp: new Date().toISOString(),
                ip: req?.ip || req?.connection?.remoteAddress || 'unknown'
            };

            // Log dengan format yang konsisten
            if (success) {
                console.log('[DATA_ACCESS]', logData);
            } else {
                console.warn('[DATA_ACCESS_FAILED]', logData);
            }
        }
    }
}

module.exports = BaseService;

