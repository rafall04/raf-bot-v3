/**
 * Utility functions used across the application
 */

/**
 * Normalize phone number to WhatsApp format
 * @param {string} phone - Phone number to normalize
 * @returns {string} - Normalized phone number
 */
function normalizePhoneNumber(phone) {
    if (!phone) return '';
    let normalized = phone.trim().replace(/\D/g, '');
    if (normalized.startsWith('0')) {
        normalized = '62' + normalized.substring(1);
    }
    return normalized;
}

/**
 * Generate a random string for various purposes
 * @param {number} length - Length of the random string
 * @param {string} charset - Character set to use
 * @returns {string} - Random string
 */
function generateRandomString(length = 8, charset = 'ABCDEFGHJKLMNOPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789') {
    let result = '';
    for (let i = 0; i < length; i++) {
        result += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    return result;
}

/**
 * Format currency to Rupiah format
 * @param {number} amount - Amount to format
 * @returns {string} - Formatted currency string
 */
function formatRupiah(amount) {
    if (!amount || isNaN(amount)) return 'Rp 0';
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0
    }).format(amount);
}

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @returns {boolean} - True if valid email format
 */
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

/**
 * Validate phone number format (Indonesian)
 * @param {string} phone - Phone number to validate
 * @returns {boolean} - True if valid phone format
 */
function isValidPhoneNumber(phone) {
    if (!phone) return false;
    const normalized = normalizePhoneNumber(phone);
    // Indonesian phone numbers should start with 62 and be 10-15 digits
    return /^62\d{9,13}$/.test(normalized);
}

/**
 * Sleep/delay function
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise} - Promise that resolves after delay
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
    normalizePhoneNumber,
    generateRandomString,
    formatRupiah,
    isValidEmail,
    isValidPhoneNumber,
    sleep
};
