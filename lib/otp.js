/**
 * Header Doc
 * Purpose: Pembuatan OTP kriptografis + pembatas laju permintaan & verifikasi OTP portal
 *          pelanggan (anti OTP-bombing dan anti brute-force).
 * Caller: `routes/public.js` (handleOtpRequest / handleOtpVerify).
 * Deps: `crypto`, `./phone-validator` (normalizePhone).
 * MainFuncs: generateSecureOTP, checkOTPRequestLimit, checkOTPVerifyLimit, isOTPValid,
 *          clearOTPAttempts, kunciNomor.
 * SideEffects: Menyimpan hitungan percobaan di Map in-memory (hilang saat restart).
 */
const crypto = require('crypto');
const { normalizePhone } = require('./phone-validator');

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
/**
 * Kunci pembatas laju dari IDENTITAS, bukan dari string yang diketik.
 *
 * KENAPA — kunci dulu memakai nomor MENTAH, sehingga `081234567890`, `6281234567890`,
 * `+62 812-3456-7890` menjadi TIGA kunci berbeda dan masing-masing dapat jatah penuh.
 * Rem 3-OTP-per-jam dan lockout 5-percobaan-verifikasi karenanya bisa dilewati hanya
 * dengan mengubah format penulisan nomor — satu pelanggan bisa dibanjiri OTP dari nomor
 * bot (risiko diblokir WhatsApp), dan brute-force OTP praktis tanpa rem.
 *
 * Pola ini SENGAJA menyalin `resolveAuthLimiterKey` (lib/http-security.js), yang sudah
 * menormalkan lewat helper yang sama persis untuk alasan yang sama. Jangan bikin
 * normalisasi tandingan di sini.
 *
 * Nomor yang tak bisa dinormalkan (kosong/ngawur) dikembalikan apa adanya setelah
 * dirapikan — lebih baik satu kunci aneh yang tetap terbatasi daripada tanpa kunci.
 */
function kunciNomor(phoneNumber) {
    const normal = normalizePhone(phoneNumber);
    if (normal) return normal;
    return String(phoneNumber === undefined || phoneNumber === null ? '' : phoneNumber).trim().toLowerCase();
}

function checkOTPRequestLimit(phoneNumber) {
    const now = Date.now();
    const key = `request_${kunciNomor(phoneNumber)}`;
    
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
    // Dinormalkan juga — lihat alasan lengkap di `kunciNomor`. Tanpa ini, lockout
    // "salah 5 kali" bisa direset hanya dengan menulis ulang format nomornya.
    const key = `verify_${kunciNomor(phoneNumber)}`;
    
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
    // WAJIB memakai kunci yang SAMA dengan penulisnya. Kalau di sini masih memakai nomor
    // mentah sementara checkOTP*Limit sudah menormalkan, reset akan diam-diam tak
    // menghapus apa pun — pelanggan yang sudah berhasil verifikasi tetap terkunci.
    const kunci = kunciNomor(phoneNumber);
    otpAttempts.delete(`request_${kunci}`);
    otpAttempts.delete(`verify_${kunci}`);
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
