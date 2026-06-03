/**
 * OTP Generator
 * Generates secure 6-digit OTP codes for ticket verification
 */

/**
 * Generate random 6-digit OTP
 * @returns {string} 6-digit OTP code
 */
function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString(); // 6 digit OTP
}

module.exports = {
    generateOTP
};
