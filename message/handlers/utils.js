const { normalizePhoneNumber, resolveCustomerBySender } = require('../../lib/jid-utils');

"use strict";

/**
 * Utility Functions
 * Fungsi-fungsi helper yang digunakan di berbagai handler
 */

/**
 * Extract JID from WhatsApp ID
 * @param {string} jid - WhatsApp JID
 * @returns {string} Extracted phone number
 */
function extractPhoneNumber(jid) {
    if (!jid) return '';
    // Remove @s.whatsapp.net or @g.us
    return jid.split('@')[0];
}

/**
 * Format phone number to WhatsApp JID
 * @param {string} phoneNumber - Phone number
 * @returns {string} WhatsApp JID
 */
function formatToJID(phoneNumber) {
    // Remove non-numeric characters
    let cleaned = phoneNumber.replace(/\D/g, '');
    
    // Add country code if not present
    if (!cleaned.startsWith('62')) {
        if (cleaned.startsWith('0')) {
            cleaned = '62' + cleaned.substring(1);
        } else {
            cleaned = '62' + cleaned;
        }
    }
    
    return cleaned + '@s.whatsapp.net';
}

/**
 * Find user by phone number
 * @param {string} phoneNumber - Phone number to search
 * @returns {Object|null} User object or null
 */
function findUserByPhone(phoneNumber) {
    if (!phoneNumber || !global.users) return null;
    
    const cleanedNumber = normalizePhoneNumber(phoneNumber);
    
    return global.users.find(u => {
        if (!u.phone_number) return false;
        
        return u.phone_number.split("|").some(num => {
            const cleaned = normalizePhoneNumber(num);
            return cleaned === cleanedNumber;
        });
    });
}

/**
 * Get user by JID with LID awareness
 * @param {string} jid - WhatsApp JID
 * @param {Array} users - List of users to search from
 * @param {Object} msg - Optional message object
 * @param {Object} raf - Optional raf instance
 * @returns {Promise<Object|null>} User object or null
 */
async function getUserByJid(jid, users, msg = null, raf = null) {
    if (!jid) return null;
    const targetUsers = users || global.users;
    if (!targetUsers) return null;
    
    // Use LID-aware resolution
    const resolvedJid = await resolveCustomerBySender(jid, msg, raf);
    const phoneNumber = resolvedJid.split('@')[0];
    
    return targetUsers.find(u => {
        if (!u.phone_number) return false;
        return u.phone_number.split("|").some(num => {
            return normalizePhoneNumber(num) === phoneNumber;
        });
    });
}

/**
 * Find user by device ID
 * @param {string} deviceId - Device ID to search
 * @returns {Object|null} User object or null
 */
function findUserByDeviceId(deviceId) {
    if (!deviceId || !global.users) return null;
    
    return global.users.find(u => 
        u.device_id && u.device_id.toLowerCase() === deviceId.toLowerCase()
    );
}

/**
 * Check if user is admin/owner
 * @param {string} phoneNumber - Phone number to check
 * @returns {boolean} True if admin/owner
 */
function isAdmin(phoneNumber) {
    if (!phoneNumber) return false;
    
    const cleanedNumber = extractPhoneNumber(phoneNumber);
    
    // Check owner number
    if (global.config.ownerNumber) {
        // Handle ownerNumber as string or array
        let ownerNumbers = [];
        if (typeof global.config.ownerNumber === 'string') {
            ownerNumbers = global.config.ownerNumber.split(',').map(n => n.trim());
        } else if (Array.isArray(global.config.ownerNumber)) {
            ownerNumbers = global.config.ownerNumber.map(n => String(n).trim());
        } else {
            ownerNumbers = [String(global.config.ownerNumber).trim()];
        }
        
        if (ownerNumbers.some(n => n.includes(cleanedNumber) || cleanedNumber.includes(n))) {
            return true;
        }
    }
    
    // Check in accounts database
    if (global.accounts) {
        const account = global.accounts.find(acc => {
            if (!acc.phone_number) return false;
            const accNumber = acc.phone_number.replace(/\D/g, '');
            return accNumber === cleanedNumber || 
                   accNumber === '62' + cleanedNumber ||
                   '62' + accNumber === cleanedNumber;
        });
        
        if (account && ['admin', 'owner', 'superadmin'].includes(account.role)) {
            return true;
        }
    }
    
    return false;
}

/**
 * Check if user is teknisi
 * @param {string} phoneNumber - Phone number to check
 * @returns {boolean} True if teknisi
 */
function isTeknisi(phoneNumber) {
    if (!phoneNumber || !global.accounts) return false;
    
    const cleanedNumber = extractPhoneNumber(phoneNumber);
    
    const account = global.accounts.find(acc => {
        if (!acc.phone_number) return false;
        const accNumber = acc.phone_number.replace(/\D/g, '');
        return accNumber === cleanedNumber || 
               accNumber === '62' + cleanedNumber ||
               '62' + accNumber === cleanedNumber;
    });
    
    return account && account.role === 'teknisi';
}

/**
 * Validate device ID format
 * @param {string} deviceId - Device ID to validate
 * @returns {boolean} True if valid
 */
function isValidDeviceId(deviceId) {
    if (!deviceId) return false;
    
    // Device ID should be alphanumeric with optional dashes/underscores
    // Length between 6-20 characters
    const deviceIdRegex = /^[a-zA-Z0-9_-]{6,20}$/;
    return deviceIdRegex.test(deviceId);
}

/**
 * Format date to Indonesian locale
 * @param {Date|string} date - Date to format
 * @param {Object} options - Formatting options
 * @returns {string} Formatted date string
 */
function formatDateIndonesian(date, options = {}) {
    const defaultOptions = {
        timeZone: 'Asia/Jakarta',
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    };
    
    const formatOptions = { ...defaultOptions, ...options };
    const dateObj = date instanceof Date ? date : new Date(date);
    
    return dateObj.toLocaleString('id-ID', formatOptions);
}

/**
 * Generate random string
 * @param {number} length - Length of string
 * @param {string} chars - Characters to use
 * @returns {string} Random string
 */
function generateRandomString(length = 8, chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') {
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

/**
 * Truncate text with ellipsis
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} Truncated text
 */
function truncateText(text, maxLength = 100) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
}

/**
 * Parse command and arguments from message
 * @param {string} message - Message text
 * @returns {Object} Object with command and args
 */
function parseCommand(message) {
    if (!message) return { command: '', args: [], q: '' };
    
    const trimmed = message.trim();
    const parts = trimmed.split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);
    const q = args.join(' ');
    
    return { command, args, q };
}

/**
 * Clean phone number (remove non-numeric)
 * @param {string} phoneNumber - Phone number to clean
 * @returns {string} Cleaned phone number
 */
function cleanPhoneNumber(phoneNumber) {
    if (!phoneNumber) return '';
    return phoneNumber.replace(/\D/g, '');
}

/**
 * Check if message is from group
 * @param {string} jid - WhatsApp JID
 * @returns {boolean} True if from group
 */
function isFromGroup(jid) {
    return jid && jid.endsWith('@g.us');
}

/**
 * Sleep/delay function
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise} Promise that resolves after delay
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Format bytes to human readable
 * @param {number} bytes - Bytes to format
 * @param {number} decimals - Number of decimals
 * @returns {string} Formatted string
 */
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Calculate time difference
 * @param {Date|string} startDate - Start date
 * @param {Date|string} endDate - End date
 * @returns {Object} Time difference object
 */
function calculateTimeDifference(startDate, endDate = new Date()) {
    const start = startDate instanceof Date ? startDate : new Date(startDate);
    const end = endDate instanceof Date ? endDate : new Date(endDate);
    
    const diffMs = end - start;
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    
    return {
        milliseconds: diffMs,
        seconds: diffSecs,
        minutes: diffMins,
        hours: diffHours,
        days: diffDays,
        formatted: `${diffDays}d ${diffHours % 24}h ${diffMins % 60}m ${diffSecs % 60}s`
    };
}

/**
 * Generate unique ID
 * @param {string} prefix - Optional prefix for the ID
 * @returns {string} Unique ID string
 */
function generateUniqueId(prefix = '') {
    const timestamp = Date.now().toString(36);
    const randomStr = Math.random().toString(36).substring(2, 8);
    return prefix ? `${prefix}_${timestamp}${randomStr}` : `${timestamp}${randomStr}`;
}

/**
 * Format phone number to standard format
 * @param {string} phone - Phone number to format
 * @returns {string} Formatted phone number
 */
function formatPhoneNumber(phone) {
    if (!phone) return '';
    // Remove all non-numeric characters
    let cleaned = phone.replace(/\D/g, '');
    // Add 62 if starts with 0
    if (cleaned.startsWith('0')) {
        cleaned = '62' + cleaned.substring(1);
    }
    // Add 62 if doesn't start with it
    if (!cleaned.startsWith('62')) {
        cleaned = '62' + cleaned;
    }
    return cleaned;
}

/**
 * Validate phone number
 * @param {string} phone - Phone number to validate
 * @returns {boolean} True if valid
 */
function validatePhoneNumber(phone) {
    if (!phone) return false;
    const cleaned = formatPhoneNumber(phone);
    // Indonesian phone number should be 10-13 digits after 62
    return /^62\d{9,12}$/.test(cleaned);
}

/**
 * Get time greeting based on current hour
 * @returns {string} Greeting message
 */
function getTimeGreeting() {
    const hour = new Date().getHours();
    if (hour < 10) return 'Selamat pagi';
    if (hour < 15) return 'Selamat siang';
    if (hour < 18) return 'Selamat sore';
    return 'Selamat malam';
}

/**
 * Truncate string to specified length
 * @param {string} str - String to truncate
 * @param {number} length - Max length
 * @returns {string} Truncated string
 */
function truncateString(str, length = 100) {
    if (!str) return '';
    if (str.length <= length) return str;
    return str.substring(0, length) + '...';
}

/**
 * Capitalize first letter
 * @param {string} str - String to capitalize
 * @returns {string} Capitalized string
 */
function capitalizeFirst(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Remove emojis from string
 * @param {string} str - String to clean
 * @returns {string} String without emojis
 */
function removeEmojis(str) {
    if (!str) return '';
    return str.replace(/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '');
}

/**
 * Extract numbers from string
 * @param {string} str - String to extract from
 * @returns {string} Numbers only
 */
function extractNumbers(str) {
    if (!str) return '';
    return str.replace(/\D/g, '');
}

/**
 * Validate email address
 * @param {string} email - Email to validate
 * @returns {boolean} True if valid
 */
function isValidEmail(email) {
    if (!email) return false;
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

/**
 * Get date string in YYYY-MM-DD format
 * @param {Date} date - Date object
 * @returns {string} Formatted date
 */
function getDateString(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Get day name in Indonesian
 * @param {Date} date - Date object
 * @returns {string} Day name
 */
function getDayName(date = new Date()) {
    const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    return days[date.getDay()];
}

/**
 * Get month name in Indonesian
 * @param {Date} date - Date object
 * @returns {string} Month name
 */
function getMonthName(date = new Date()) {
    const months = [
        'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    return months[date.getMonth()];
}

/**
 * Calculate age from birthdate
 * @param {Date|string} birthDate - Birth date
 * @returns {number} Age in years
 */
function calculateAge(birthDate) {
    const birth = new Date(birthDate);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
        age--;
    }
    return age;
}

/**
 * Check if current time is within working hours
 * @returns {boolean} True if within working hours
 */
function isWorkingHours() {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay();
    // Monday-Friday 8:00-17:00, Saturday 8:00-12:00
    if (day === 0) return false; // Sunday
    if (day === 6) return hour >= 8 && hour < 12; // Saturday
    return hour >= 8 && hour < 17; // Weekdays
}

/**
 * Format number to Rupiah currency
 * @param {number} amount - Amount to format
 * @returns {string} Formatted rupiah string
 */
function formatRupiah(amount) {
    if (typeof amount !== 'number') {
        amount = parseFloat(amount) || 0;
    }
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(amount).replace('IDR', 'Rp');
}

/**
 * Format date to Indonesian format
 * @param {Date|string} date - Date to format
 * @returns {string} Formatted date string
 */
function formatDate(date) {
    if (!date) return '-';
    
    const d = new Date(date);
    if (isNaN(d.getTime())) return '-';
    
    const months = [
        'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    
    const day = d.getDate();
    const month = months[d.getMonth()];
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    
    return `${day} ${month} ${year} ${hours}:${minutes}`;
}

module.exports = {
    extractPhoneNumber,
    formatToJID,
    isAdmin,
    isTeknisi,
    findUserByPhone,
    getUserByJid,
    findUserByDeviceId,
    isValidDeviceId,
    generateUniqueId,
    formatPhoneNumber,
    validatePhoneNumber,
    getTimeGreeting,
    sleep,
    truncateString,
    capitalizeFirst,
    removeEmojis,
    extractNumbers,
    isValidEmail,
    getDateString,
    getDayName,
    getMonthName,
    calculateAge,
    isWorkingHours,
    formatRupiah,
    formatDate,
    calculateTimeDifference,
    formatBytes,
    isFromGroup,
    cleanPhoneNumber,
    parseCommand,
    truncateText,
    generateRandomString,
    formatDateIndonesian
};
