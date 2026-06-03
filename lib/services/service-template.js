/**
 * Service Template
 * 
 * Template untuk membuat service class baru.
 * Copy file ini dan rename sesuai domain service yang akan dibuat.
 * 
 * Contoh:
 * - Copy ke `customer-service.js` untuk CustomerService
 * - Copy ke `report-service.js` untuk ReportService
 */

const BaseService = require('./base-service');
const { createError, ErrorTypes } = require('../error-handler');

/**
 * {Domain}Service
 * 
 * Service untuk handle business logic terkait {domain}.
 * 
 * Prinsip:
 * - Stateless: Semua methods adalah static
 * - Single Responsibility: Fokus pada satu domain
 * - Error Handling: Throw errors yang akan di-handle oleh route handlers
 */
class DomainService extends BaseService {
    /**
     * Example method - Get data
     * 
     * @param {Object} user - User object
     * @returns {Promise<Object>} Data result
     * @throws {Error} Jika ada error
     */
    static async getData(user) {
        // Validation
        if (!user) {
            throw createError(
                ErrorTypes.VALIDATION_ERROR,
                "User tidak ditemukan",
                400
            );
        }

        // Business logic here
        // ...

        // Return data
        return {
            // data structure
        };
    }

    /**
     * Example method - Create/Update data
     * 
     * @param {Object} user - User object
     * @param {Object} data - Data to create/update
     * @returns {Promise<Object>} Result
     * @throws {Error} Jika ada error
     */
    static async createOrUpdate(user, data) {
        // Validation
        this.validateRequired(data, ['requiredField1', 'requiredField2']);

        // Business logic here
        // ...

        // Return result
        return {
            message: "Operasi berhasil",
            // additional data
        };
    }

    /**
     * Example method - Delete data
     * 
     * @param {Object} user - User object
     * @param {string} id - ID to delete
     * @returns {Promise<Object>} Result
     * @throws {Error} Jika ada error
     */
    static async delete(user, id) {
        // Validation
        this.validateField(id, 'id');

        // Business logic here
        // ...

        // Return result
        return {
            message: "Data berhasil dihapus"
        };
    }
}

module.exports = DomainService;

