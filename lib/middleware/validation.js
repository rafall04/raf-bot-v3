/**
 * Input Validation Middleware
 * 
 * Middleware untuk validasi input menggunakan express-validator.
 * Menyediakan validation rules dan error handling yang konsisten.
 */

const { body, param, query, validationResult } = require('express-validator');
const { sendError } = require('../response-helper');
const { sanitizeString, sanitizeText, sanitizeUsername, sanitizeId } = require('../utils/sanitization');

/**
 * Middleware untuk handle validation errors
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function handleValidationErrors(req, res, next) {
    const errors = validationResult(req);
    
    if (!errors.isEmpty()) {
        // Ambil error pertama untuk message
        const firstError = errors.array()[0];
        const errorMessage = firstError.msg || 'Data tidak valid';
        
        return sendError(res, errorMessage, 400);
    }
    
    next();
}

/**
 * Validation rules untuk login
 */
const loginValidation = [
    body('username')
        .trim()
        .notEmpty().withMessage('Username wajib diisi')
        .isLength({ min: 3, max: 50 }).withMessage('Username harus 3-50 karakter')
        .matches(/^[a-zA-Z0-9_]+$/).withMessage('Username hanya boleh mengandung huruf, angka, dan underscore')
        .customSanitizer(value => sanitizeUsername(value)),
    body('password')
        .notEmpty().withMessage('Password wajib diisi')
        .isLength({ min: 6, max: 128 }).withMessage('Password minimal 6 karakter dan maksimal 128 karakter')
        .customSanitizer(value => sanitizeString(value, { maxLength: 128 })),
    handleValidationErrors
];

/**
 * Validation rules untuk customer login
 * Mendukung login dengan username ATAU nomor HP
 */
const customerLoginValidation = [
    body('username')
        .trim()
        .notEmpty().withMessage('Username atau nomor HP wajib diisi')
        .isLength({ min: 3, max: 50 }).withMessage('Username atau nomor HP harus 3-50 karakter')
        // Validasi lebih fleksibel: bisa username (a-zA-Z0-9_) atau nomor HP (08xxx, 628xxx, +628xxx)
        .custom((value) => {
            // Check jika format username (a-zA-Z0-9_)
            const isUsername = /^[a-zA-Z0-9_]+$/.test(value);
            // Check jika format nomor HP (08xxx, 628xxx, +628xxx, atau hanya angka)
            const cleanedPhone = value.replace(/\D/g, '');
            const isPhoneNumber = /^(08|62|628)\d{8,13}$/.test(cleanedPhone) || /^\d{10,15}$/.test(cleanedPhone);
            
            if (!isUsername && !isPhoneNumber) {
                throw new Error('Format tidak valid. Gunakan username atau nomor HP (08xxx, 628xxx)');
            }
            return true;
        })
        .customSanitizer(value => {
            // Jika format username, sanitize sebagai username
            if (/^[a-zA-Z0-9_]+$/.test(value)) {
                return sanitizeUsername(value);
            }
            // Jika format nomor HP, hanya trim (tidak perlu sanitize khusus)
            return value.trim();
        }),
    body('password')
        .notEmpty().withMessage('Password wajib diisi')
        .isLength({ min: 6, max: 128 }).withMessage('Password minimal 6 karakter dan maksimal 128 karakter')
        .customSanitizer(value => sanitizeString(value, { maxLength: 128 })),
    handleValidationErrors
];

/**
 * Validation rules untuk OTP request
 */
const otpRequestValidation = [
    body('phoneNumber')
        .trim()
        .notEmpty().withMessage('Nomor telepon wajib diisi')
        .matches(/^(\+62|62|0)[0-9]{9,12}$/).withMessage('Format nomor telepon tidak valid')
        .customSanitizer(value => {
            // Normalize phone number: remove +, leading 0, add 62
            let normalized = value.replace(/[^0-9]/g, '');
            if (normalized.startsWith('0')) {
                normalized = '62' + normalized.substring(1);
            } else if (!normalized.startsWith('62')) {
                normalized = '62' + normalized;
            }
            return normalized;
        }),
    handleValidationErrors
];

/**
 * Validation rules untuk OTP verify
 */
const otpVerifyValidation = [
    body('phoneNumber')
        .trim()
        .notEmpty().withMessage('Nomor telepon wajib diisi')
        .matches(/^(\+62|62|0)[0-9]{9,12}$/).withMessage('Format nomor telepon tidak valid'),
    body('otp')
        .trim()
        .notEmpty().withMessage('OTP wajib diisi')
        .isLength({ min: 4, max: 6 }).withMessage('OTP harus 4-6 digit')
        .isNumeric().withMessage('OTP harus berupa angka'),
    handleValidationErrors
];

/**
 * Validation rules untuk update account
 */
const updateAccountValidation = [
    body('currentPassword')
        .notEmpty().withMessage('Password saat ini wajib diisi')
        .isLength({ min: 6, max: 128 }).withMessage('Password minimal 6 karakter dan maksimal 128 karakter')
        .customSanitizer(value => sanitizeString(value, { maxLength: 128 })),
    body('newUsername')
        .optional()
        .trim()
        .isLength({ min: 3, max: 50 }).withMessage('Username baru harus 3-50 karakter')
        .matches(/^[a-zA-Z0-9_]+$/).withMessage('Username hanya boleh mengandung huruf, angka, dan underscore')
        .customSanitizer(value => sanitizeUsername(value)),
    body('newPassword')
        .optional()
        .isLength({ min: 6, max: 128 }).withMessage('Password baru minimal 6 karakter dan maksimal 128 karakter')
        .customSanitizer(value => sanitizeString(value, { maxLength: 128 })),
    handleValidationErrors
];

/**
 * Validation rules untuk submit report
 */
const submitReportValidation = [
    body('category')
        .trim()
        .notEmpty().withMessage('Kategori laporan wajib diisi')
        .isIn(['internet', 'wifi', 'tagihan', 'lainnya']).withMessage('Kategori laporan tidak valid')
        .customSanitizer(value => sanitizeString(value, { maxLength: 50 })),
    body('reportText')
        .trim()
        .notEmpty().withMessage('Isi laporan wajib diisi')
        .isLength({ min: 10, max: 2000 }).withMessage('Isi laporan harus 10-2000 karakter')
        .customSanitizer(value => sanitizeText(value, 2000)),
    handleValidationErrors
];

/**
 * Validation rules untuk request speed boost
 */
const requestSpeedValidation = [
    body('targetPackageName')
        .trim()
        .notEmpty().withMessage('Nama paket tujuan wajib diisi')
        .isLength({ min: 1, max: 100 }).withMessage('Nama paket tidak valid')
        .customSanitizer(value => sanitizeString(value, { maxLength: 100 })),
    body('duration')
        .trim()
        .notEmpty().withMessage('Durasi wajib diisi')
        .isIn(['1_day', '3_days', '7_days', '1 day', '3 days', '7 days']).withMessage('Durasi tidak valid. Gunakan: 1_day, 3_days, atau 7_days')
        .customSanitizer(value => sanitizeString(value, { maxLength: 20 })),
    body('paymentMethod')
        .optional()
        .isIn(['cash', 'transfer', 'double_billing']).withMessage('Metode pembayaran tidak valid')
        .customSanitizer(value => sanitizeString(value, { maxLength: 20 })),
    handleValidationErrors
];

/**
 * Validation rules untuk cancel speed request
 */
const cancelSpeedRequestValidation = [
    body('requestId')
        .trim()
        .notEmpty().withMessage('ID permintaan wajib diisi')
        .matches(/^speedreq_\d+_\d+$/).withMessage('Format ID permintaan tidak valid')
        .customSanitizer(value => sanitizeId(value)),
    handleValidationErrors
];

/**
 * Validation rules untuk request package change
 */
const requestPackageChangeValidation = [
    body('targetPackageName')
        .trim()
        .notEmpty().withMessage('Nama paket tujuan wajib diisi')
        .isLength({ min: 1, max: 100 }).withMessage('Nama paket tidak valid')
        .customSanitizer(value => sanitizeString(value, { maxLength: 100 })),
    handleValidationErrors
];

/**
 * Validation rules untuk ID parameter
 */
const idParamValidation = [
    param('id')
        .notEmpty().withMessage('ID wajib diisi')
        .matches(/^[a-zA-Z0-9_\-]+$/).withMessage('Format ID tidak valid')
        .customSanitizer(value => sanitizeId(value)),
    handleValidationErrors
];

module.exports = {
    handleValidationErrors,
    loginValidation,
    customerLoginValidation,
    otpRequestValidation,
    otpVerifyValidation,
    updateAccountValidation,
    submitReportValidation,
    requestSpeedValidation,
    cancelSpeedRequestValidation,
    requestPackageChangeValidation,
    idParamValidation
};

