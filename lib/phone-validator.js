/**
 * Phone Number Validation Module
 * Ensures phone numbers are unique across all users
 * Handles multiple phone numbers per user (pipe-separated format)
 */

/**
 * Check if a phone number already exists in the database
 * @param {Object} db - Database connection
 * @param {string} phoneNumber - Phone number to check
 * @param {string} excludeUserId - User ID to exclude from check (for updates)
 * @returns {Promise<Object|null>} - Returns user object if exists, null otherwise
 */
async function checkPhoneExists(db, phoneNumber, excludeUserId = null) {
    return new Promise((resolve, reject) => {
        // Normalize phone number (remove spaces, dashes, etc)
        const normalizedPhone = phoneNumber.replace(/[\s\-\(\)]/g, '');
        
        // Build query
        let query = `
            SELECT id, name, phone_number 
            FROM users 
            WHERE phone_number LIKE ?
        `;
        
        const params = [`%${normalizedPhone}%`];
        
        // Exclude current user if updating
        if (excludeUserId) {
            query += ` AND id != ?`;
            params.push(excludeUserId);
        }
        
        db.get(query, params, (err, row) => {
            if (err) {
                console.error('[PHONE_VALIDATOR] Error checking phone:', err);
                reject(err);
            } else {
                resolve(row || null);
            }
        });
    });
}

/**
 * Validate multiple phone numbers (pipe-separated)
 * @param {Object} db - Database connection
 * @param {string} phoneNumbers - Pipe-separated phone numbers
 * @param {string} excludeUserId - User ID to exclude from check
 * @returns {Promise<Object>} - Validation result
 */
async function validatePhoneNumbers(db, phoneNumbers, excludeUserId = null) {
    if (!phoneNumbers) {
        return {
            valid: false,
            message: 'Nomor telepon tidak boleh kosong'
        };
    }
    
    // Split multiple phones and normalize
    const phones = phoneNumbers.split('|').map(p => p.trim()).filter(p => p);
    
    if (phones.length === 0) {
        return {
            valid: false,
            message: 'Nomor telepon tidak valid'
        };
    }
    
    // Check each phone number
    for (const phone of phones) {
        try {
            const existingUser = await checkPhoneExists(db, phone, excludeUserId);
            
            if (existingUser) {
                // Check if it's the same user (for pipe-separated phones)
                const existingPhones = existingUser.phone_number.split('|').map(p => p.trim());
                const isOwnNumber = excludeUserId && existingUser.id === excludeUserId;
                
                if (!isOwnNumber) {
                    return {
                        valid: false,
                        message: `Nomor ${phone} sudah terdaftar atas nama ${existingUser.name} (ID: ${existingUser.id})`,
                        conflictUser: existingUser
                    };
                }
            }
        } catch (error) {
            console.error('[PHONE_VALIDATOR] Error validating phone:', phone, error);
            return {
                valid: false,
                message: `Error validating nomor ${phone}: ${error.message}`
            };
        }
    }
    
    // Check for duplicates within the input
    const uniquePhones = new Set(phones);
    if (uniquePhones.size !== phones.length) {
        return {
            valid: false,
            message: 'Terdapat nomor yang duplikat dalam input'
        };
    }
    
    return {
        valid: true,
        message: 'OK',
        phones: phones
    };
}

/**
 * Validate phone format (Indonesian format)
 * @param {string} phone - Phone number to validate
 * @returns {boolean} - True if valid format
 */
function isValidPhoneFormat(phone) {
    // Remove all non-numeric characters
    const cleaned = phone.replace(/\D/g, '');
    
    // Indonesian phone patterns
    // 08xxx (10-13 digits) or 628xxx (11-14 digits) or +628xxx
    const patterns = [
        /^08\d{8,11}$/,      // 08xxxxxxxxx
        /^628\d{8,11}$/,     // 628xxxxxxxxx
        /^\+628\d{8,11}$/    // +628xxxxxxxxx
    ];
    
    return patterns.some(pattern => pattern.test(phone) || pattern.test(cleaned));
}

/**
 * Normalize phone number to standard format
 * @param {string} phone - Phone number to normalize
 * @returns {string} - Normalized phone (628xxx format)
 */
function normalizePhone(phone) {
    if (!phone) return '';
    
    // Remove all non-digit characters
    const cleaned = phone.replace(/\D/g, '');
    
    if (!cleaned) return '';
    
    // Handle different formats
    if (cleaned.startsWith('628')) {
        // Already in 628 format
        return cleaned;
    } else if (cleaned.startsWith('08')) {
        // Local format: 08xxx -> 62xxx
        return '62' + cleaned.substring(1);
    } else if (cleaned.startsWith('8') && cleaned.length >= 10) {
        // Format: 8xxxxxxxxx (10+ digits) -> 628xxxxxxxxx
        return '62' + cleaned;
    } else if (cleaned.startsWith('62')) {
        // Already has country code
        return cleaned;
    } else if (cleaned.length >= 9) {
        // Assume it's a local number without leading 0, add 62
        return '62' + cleaned;
    }
    
    // Return as-is if can't determine format
    return cleaned;
}

/**
 * Get all phone numbers from database for duplicate checking
 * @param {Object} db - Database connection
 * @returns {Promise<Map>} - Map of phone -> user
 */
async function getAllPhoneNumbers(db) {
    return new Promise((resolve, reject) => {
        const phoneMap = new Map();
        
        db.all('SELECT id, name, phone_number FROM users', [], (err, rows) => {
            if (err) {
                console.error('[PHONE_VALIDATOR] Error getting all phones:', err);
                reject(err);
            } else {
                rows.forEach(row => {
                    if (row.phone_number) {
                        const phones = row.phone_number.split('|').map(p => p.trim());
                        phones.forEach(phone => {
                            if (phone) {
                                const normalized = normalizePhone(phone);
                                phoneMap.set(normalized, {
                                    userId: row.id,
                                    userName: row.name,
                                    originalPhone: phone
                                });
                            }
                        });
                    }
                });
                resolve(phoneMap);
            }
        });
    });
}

module.exports = {
    checkPhoneExists,
    validatePhoneNumbers,
    isValidPhoneFormat,
    normalizePhone,
    getAllPhoneNumbers
};
