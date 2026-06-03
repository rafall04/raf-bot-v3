/**
 * Secure OTP generation and management utilities
 */
const crypto = require('crypto');

/**
 * Generate a cryptographically secure OTP
 * @param {number} length - Length of the OTP (default: 6)
 * @returns {string} - Secure OTP
 */
function generateSecureOTP(length = 6) {
    const digits = '0123456789';
    let otp = '';
    
    for (let i = 0; i < length; i++) {
        const randomIndex = crypto.randomInt(0, digits.length);
        otp += digits[randomIndex];
    }
    
    return otp;
}

/**
 * OTP attempt tracking for rate limiting
 */
const otpAttempts = new Map();
const MAX_OTP_REQUESTS = 3; // Maximum OTP requests per phone number per hour
const MAX_VERIFY_ATTEMPTS = 5; // Maximum verification attempts per OTP
const OTP_REQUEST_WINDOW = 60 * 60 * 1000; // 1 hour in milliseconds
const OTP_VALIDITY_PERIOD = 5 * 60 * 1000; // 5 minutes in milliseconds

/**
 * Check if OTP request is allowed (rate limiting)
 * @param {string} phoneNumber - Phone number requesting OTP
 * @returns {object} - { allowed: boolean, remainingTime?: number }
 */
function checkOTPRequestLimit(phoneNumber) {
    const now = Date.now();
    const key = `request_${phoneNumber}`;
    
    if (!otpAttempts.has(key)) {
        otpAttempts.set(key, { count: 1, firstAttempt: now });
        return { allowed: true };
    }
    
    const attempts = otpAttempts.get(key);
    const timeSinceFirst = now - attempts.firstAttempt;
    
    // Reset counter if window has passed
    if (timeSinceFirst > OTP_REQUEST_WINDOW) {
        otpAttempts.set(key, { count: 1, firstAttempt: now });
        return { allowed: true };
    }
    
    // Check if limit exceeded
    if (attempts.count >= MAX_OTP_REQUESTS) {
        const remainingTime = OTP_REQUEST_WINDOW - timeSinceFirst;
        return { 
            allowed: false, 
            remainingTime: Math.ceil(remainingTime / (60 * 1000)) // in minutes
        };
    }
    
    // Increment counter
    attempts.count++;
    return { allowed: true };
}

/**
 * Check if OTP verification is allowed (prevent brute force)
 * @param {string} phoneNumber - Phone number attempting verification
 * @returns {object} - { allowed: boolean, attemptsLeft?: number }
 */
function checkOTPVerifyLimit(phoneNumber) {
    const key = `verify_${phoneNumber}`;
    
    if (!otpAttempts.has(key)) {
        otpAttempts.set(key, { count: 1, firstAttempt: Date.now() });
        return { allowed: true, attemptsLeft: MAX_VERIFY_ATTEMPTS - 1 };
    }
    
    const attempts = otpAttempts.get(key);
    
    if (attempts.count >= MAX_VERIFY_ATTEMPTS) {
        return { allowed: false, attemptsLeft: 0 };
    }
    
    attempts.count++;
    return { 
        allowed: true, 
        attemptsLeft: MAX_VERIFY_ATTEMPTS - attempts.count 
    };
}

/**
 * Reset OTP attempts for a phone number (called after successful verification)
 * @param {string} phoneNumber - Phone number to reset
 */
function resetOTPAttempts(phoneNumber) {
    otpAttempts.delete(`request_${phoneNumber}`);
    otpAttempts.delete(`verify_${phoneNumber}`);
}

/**
 * Check if OTP is still valid based on timestamp
 * @param {number} otpTimestamp - Timestamp when OTP was generated
 * @returns {boolean} - True if OTP is still valid
 */
function isOTPValid(otpTimestamp) {
    if (!otpTimestamp) return false;
    const now = Date.now();
    return (now - otpTimestamp) <= OTP_VALIDITY_PERIOD;
}

/**
 * Clean up expired OTP attempts (should be called periodically)
 */
function cleanupExpiredAttempts() {
    const now = Date.now();
    for (const [key, value] of otpAttempts.entries()) {
        if (now - value.firstAttempt > OTP_REQUEST_WINDOW) {
            otpAttempts.delete(key);
        }
    }
}

// Clean up expired attempts every hour
setInterval(cleanupExpiredAttempts, 60 * 60 * 1000);

module.exports = {
    generateSecureOTP,
    checkOTPRequestLimit,
    checkOTPVerifyLimit,
    resetOTPAttempts,
    isOTPValid,
    cleanupExpiredAttempts,
    OTP_VALIDITY_PERIOD,
    MAX_OTP_REQUESTS,
    MAX_VERIFY_ATTEMPTS
};
