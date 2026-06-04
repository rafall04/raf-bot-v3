/**
 * OTP Generator
 * Generates secure 6-digit OTP codes for ticket verification
 */

const crypto = require('crypto');

/**
 * Generate random 6-digit OTP using CSPRNG
 * @returns {string} 6-digit OTP code
 */
function generateOTP() {
    // crypto.randomInt(min, max) → uniform integer in [min, max). Range [100000, 1000000).
    return crypto.randomInt(100000, 1000000).toString();
}

module.exports = {
    generateOTP
};
