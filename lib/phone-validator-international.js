/**
 * International Phone Number Validation Module
 * Supports multiple countries and formats
 * Ensures phone numbers are unique across all users
 */

/**
 * Country phone configurations
 */
const COUNTRY_CONFIGS = {
    // Indonesia
    ID: {
        code: '62',
        patterns: [
            /^08\d{8,11}$/,       // 08xxxxxxxxx (local)
            /^628\d{8,11}$/,      // 628xxxxxxxxx (international)
            /^\+628\d{8,11}$/     // +628xxxxxxxxx (with plus)
        ],
        localPrefix: '08',
        minLength: 10,
        maxLength: 13
    },
    // Malaysia
    MY: {
        code: '60',
        patterns: [
            /^01\d{7,9}$/,        // 01xxxxxxxx (local)
            /^601\d{7,9}$/,       // 601xxxxxxxx (international)
            /^\+601\d{7,9}$/      // +601xxxxxxxx (with plus)
        ],
        localPrefix: '01',
        minLength: 9,
        maxLength: 11
    },
    // Singapore
    SG: {
        code: '65',
        patterns: [
            /^[89]\d{7}$/,        // 8xxxxxxx or 9xxxxxxx (local)
            /^65[89]\d{7}$/,      // 658xxxxxxx (international)
            /^\+65[89]\d{7}$/     // +658xxxxxxx (with plus)
        ],
        localPrefix: '',
        minLength: 8,
        maxLength: 8
    },
    // Thailand
    TH: {
        code: '66',
        patterns: [
            /^0[689]\d{7,8}$/,    // 06/08/09xxxxxxxx (local) - 9-10 digits total
            /^66[689]\d{7,8}$/,   // 666/668/669xxxxxxxx (international without +)
            /^\+66[689]\d{7,8}$/  // +666/668/669xxxxxxxx (with plus - for backward compatibility only)
        ],
        localPrefix: '0',
        minLength: 9,
        maxLength: 10,
        // Note: Thailand 08xx (9-10 digits) can conflict with Indonesia 08xx (10-13 digits)
        // Solution: For ambiguous cases, use country code (66xxx) or defaultCountry priority. Tanda + tidak diperlukan.
    },
    // Philippines
    PH: {
        code: '63',
        patterns: [
            /^09\d{9}$/,          // 09xxxxxxxxx (local) - 11 digits fixed
            /^639\d{9}$/,         // 639xxxxxxxxx (international without +)
            /^\+639\d{9}$/        // +639xxxxxxxxx (with plus - for backward compatibility only)
        ],
        localPrefix: '09',
        minLength: 11,
        maxLength: 11,
        // Note: Philippines 09xx (11 digits fixed) is unique and doesn't conflict with others
    },
    // India
    IN: {
        code: '91',
        patterns: [
            /^[6-9]\d{9}$/,       // 9xxxxxxxxx (local mobile)
            /^91[6-9]\d{9}$/,     // 919xxxxxxxxx (international)
            /^\+91[6-9]\d{9}$/    // +919xxxxxxxxx (with plus)
        ],
        localPrefix: '',
        minLength: 10,
        maxLength: 10
    },
    // USA/Canada
    US: {
        code: '1',
        patterns: [
            /^[2-9]\d{2}[2-9]\d{6}$/, // 2123456789 (local)
            /^1[2-9]\d{2}[2-9]\d{6}$/, // 12123456789 (international)
            /^\+1[2-9]\d{2}[2-9]\d{6}$/ // +12123456789 (with plus)
        ],
        localPrefix: '',
        minLength: 10,
        maxLength: 10
    },
    // United Kingdom
    GB: {
        code: '44',
        patterns: [
            /^07\d{9}$/,          // 07xxxxxxxxx (local mobile)
            /^447\d{9}$/,         // 447xxxxxxxxx (international)
            /^\+447\d{9}$/        // +447xxxxxxxxx (with plus)
        ],
        localPrefix: '07',
        minLength: 11,
        maxLength: 11
    },
    // Australia
    AU: {
        code: '61',
        patterns: [
            /^04\d{8}$/,          // 04xxxxxxxx (local mobile)
            /^614\d{8}$/,         // 614xxxxxxxx (international)
            /^\+614\d{8}$/        // +614xxxxxxxx (with plus)
        ],
        localPrefix: '04',
        minLength: 10,
        maxLength: 10
    },
    // Generic International (fallback)
    INTERNATIONAL: {
        code: '',
        patterns: [
            /^\+\d{7,15}$/,       // E.164 format (+1 to +999 followed by digits)
            /^\d{7,15}$/          // Just digits (7-15 is typical for most countries)
        ],
        localPrefix: '',
        minLength: 7,
        maxLength: 15
    }
};

/**
 * Detect country from phone number
 * @param {string} phone - Phone number to detect
 * @returns {string} - Country code or 'UNKNOWN'
 */
function detectCountry(phone) {
    const cleaned = phone.replace(/[\s\-\(\)]/g, '');
    
    // Priority 1: Check format with country code (62, 66, 63, etc.) - WITHOUT +
    // This is the most reliable way to identify country
    for (const [country, config] of Object.entries(COUNTRY_CONFIGS)) {
        if (country === 'INTERNATIONAL') continue;
        if (config.code && cleaned.startsWith(config.code) && cleaned.length > config.code.length) {
            // Additional validation: check if it matches country patterns
            for (const pattern of config.patterns) {
                // Remove + from pattern if present for comparison
                const testCleaned = cleaned.replace(/^\+/, '');
                if (pattern.test(testCleaned)) {
                    return country;
                }
            }
        }
    }
    
    // Priority 2: Check format with country code WITH + (for backward compatibility)
    // But we'll normalize to format without +
    if (/^\+\d+$/.test(cleaned)) {
        // Remove + for matching
        const withoutPlus = cleaned.substring(1);
        // Try to match by country code
        for (const [country, config] of Object.entries(COUNTRY_CONFIGS)) {
            if (country === 'INTERNATIONAL') continue;
            if (config.code && withoutPlus.startsWith(config.code)) {
                return country;
            }
        }
        return 'INTERNATIONAL';
    }
    
    // Priority 3: Check local patterns (more ambiguous, conflicts possible)
    // IMPORTANT: Check more specific patterns first to avoid conflicts
    const matches = [];
    
    for (const [country, config] of Object.entries(COUNTRY_CONFIGS)) {
        if (country === 'INTERNATIONAL') continue;
        
        for (const pattern of config.patterns) {
            // Test pattern on cleaned number (without +)
            const testCleaned = cleaned.replace(/^\+/, '');
            if (pattern.test(testCleaned)) {
                // Only accept local patterns (those starting with 0) or country code patterns
                if (/^0/.test(testCleaned) || testCleaned.startsWith(config.code)) {
                    matches.push({ country, config, pattern });
                }
            }
        }
    }
    
    // If multiple matches (conflict), prioritize by specificity
    if (matches.length > 1) {
        // Sort by pattern specificity (more specific = fewer possible matches)
        // Philippines 09 fixed length (11) is more specific than others
        matches.sort((a, b) => {
            const aPattern = a.config.patterns.find(p => p.test(cleaned));
            const bPattern = b.config.patterns.find(p => p.test(cleaned));
            
            // Compare pattern string length (more specific = longer pattern string)
            const aSpecificity = aPattern ? aPattern.toString().length : 0;
            const bSpecificity = bPattern ? bPattern.toString().length : 0;
            
            return bSpecificity - aSpecificity;
        });
        
        // Return the most specific match
        console.warn(`[PHONE_VALIDATOR] Ambiguous phone number detected: ${cleaned}. Multiple countries matched: ${matches.map(m => m.country).join(', ')}. Selected: ${matches[0].country}`);
        return matches[0].country;
    } else if (matches.length === 1) {
        return matches[0].country;
    }
    
    // Priority 4: Default to Indonesia for backward compatibility (only if starts with 08)
    const cleanedWithoutPlus = cleaned.replace(/^\+/, '');
    if (/^08\d+$/.test(cleanedWithoutPlus) && cleanedWithoutPlus.length >= 10 && cleanedWithoutPlus.length <= 13) {
        return 'ID';
    }
    
    // Priority 5: Check if it's a valid international number (generic)
    if (COUNTRY_CONFIGS.INTERNATIONAL.patterns.some(p => p.test(cleanedWithoutPlus))) {
        return 'INTERNATIONAL';
    }
    
    return 'UNKNOWN';
}

/**
 * Validate phone format (international support)
 * @param {string} phone - Phone number to validate
 * @param {string} defaultCountry - Default country code (optional)
 * @returns {Object} - Validation result with country detection
 */
function isValidPhoneFormat(phone, defaultCountry = 'ID') {
    const cleaned = phone.replace(/[\s\-\(\)]/g, '').replace(/^\+/, ''); // Remove + if present
    
    // Detect country (will handle + internally)
    let country = detectCountry(phone.replace(/[\s\-\(\)]/g, '')); // Pass original with + if present for detection
    
    // If ambiguous (multiple countries possible) and default country provided, prefer default
    if (defaultCountry && defaultCountry !== 'ID') {
        const defaultConfig = COUNTRY_CONFIGS[defaultCountry];
        if (defaultConfig) {
            // Check if it matches default country patterns (test without +)
            const matchesDefault = defaultConfig.patterns.some(p => p.test(cleaned));
            
            if (matchesDefault) {
                // Additional check: if detected country conflicts with default, use default
                // This handles cases like 08xx which could be ID or TH
                const detectedConfig = COUNTRY_CONFIGS[country];
                const alsoMatchesDetected = detectedConfig && detectedConfig.patterns.some(p => p.test(cleaned));
                
                if (alsoMatchesDetected && country !== defaultCountry && country !== 'INTERNATIONAL') {
                    // Conflict detected - prefer default country
                    console.warn(`[PHONE_VALIDATOR] Phone ${cleaned} matches both ${country} and ${defaultCountry}. Using default: ${defaultCountry}`);
                    country = defaultCountry;
                } else if (!alsoMatchesDetected) {
                    country = defaultCountry;
                }
            }
        }
    }
    
    // If unknown and default country provided, try that
    if (country === 'UNKNOWN' && defaultCountry) {
        const config = COUNTRY_CONFIGS[defaultCountry];
        if (config) {
            for (const pattern of config.patterns) {
                if (pattern.test(cleaned)) {
                    country = defaultCountry;
                    break;
                }
            }
        }
    }
    
    // If still unknown, check international format
    if (country === 'UNKNOWN') {
        const isInternational = COUNTRY_CONFIGS.INTERNATIONAL.patterns.some(p => p.test(cleaned));
        if (isInternational) {
            country = 'INTERNATIONAL';
        }
    }
    
    return {
        valid: country !== 'UNKNOWN',
        country: country,
        format: country !== 'UNKNOWN' ? 'Valid' : 'Invalid',
        cleaned: cleaned, // Return cleaned without +
        warning: country === 'INTERNATIONAL' ? 'Format internasional terdeteksi. Pastikan country code benar.' : null
    };
}

/**
 * Normalize phone number to E.164 format
 * @param {string} phone - Phone number to normalize
 * @param {string} defaultCountry - Default country if not specified
 * @returns {string} - Normalized phone in international format
 */
function normalizePhone(phone, defaultCountry = 'ID') {
    const cleaned = phone.replace(/\D/g, ''); // Remove all non-digits including +
    const validation = isValidPhoneFormat(phone, defaultCountry);
    
    if (!validation.valid) {
        return phone; // Return as-is if invalid
    }
    
    const country = validation.country;
    const config = COUNTRY_CONFIGS[country];
    
    if (!config || country === 'INTERNATIONAL') {
        // Already in international format or generic
        // Remove + if present, return without +
        if (cleaned.startsWith('+')) {
            return cleaned.substring(1);
        }
        return cleaned; // Return without + sign
    }
    
    // Handle country-specific normalization
    if (config.localPrefix && cleaned.startsWith(config.localPrefix.replace(/^0/, ''))) {
        // Local format - add country code
        const withoutPrefix = cleaned.substring(config.localPrefix.length - 1);
        return config.code + withoutPrefix;
    } else if (cleaned.startsWith(config.code)) {
        // Already has country code (with or without +)
        // Remove + if present
        if (cleaned.startsWith('+' + config.code)) {
            return cleaned.substring(1); // Remove + but keep country code
        }
        return cleaned; // Already has country code without +
    } else if (cleaned.startsWith('0')) {
        // Starts with 0 (common for local format)
        return config.code + cleaned.substring(1);
    } else {
        // Assume it needs country code
        return config.code + cleaned;
    }
}

/**
 * Check if a phone number already exists in the database
 * @param {Object} db - Database connection
 * @param {string} phoneNumber - Phone number to check
 * @param {string} excludeUserId - User ID to exclude from check (for updates)
 * @returns {Promise<Object|null>} - Returns user object if exists, null otherwise
 */
async function checkPhoneExists(db, phoneNumber, excludeUserId = null) {
    return new Promise((resolve, reject) => {
        // Normalize phone number for comparison
        const normalized = normalizePhone(phoneNumber);
        
        // Build query
        let query = `
            SELECT id, name, phone_number 
            FROM users 
            WHERE phone_number LIKE ?
        `;
        
        const params = [`%${normalized}%`];
        
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
 * @param {string} defaultCountry - Default country for validation
 * @returns {Promise<Object>} - Validation result
 */
async function validatePhoneNumbers(db, phoneNumbers, excludeUserId = null, defaultCountry = 'ID') {
    if (!phoneNumbers) {
        return {
            valid: false,
            message: 'Phone number cannot be empty'
        };
    }
    
    // Split multiple phones and normalize
    const phones = phoneNumbers.split('|').map(p => p.trim()).filter(p => p);
    
    if (phones.length === 0) {
        return {
            valid: false,
            message: 'Invalid phone number'
        };
    }
    
    const phoneDetails = [];
    
    // Validate format for each phone
    for (const phone of phones) {
        const validation = isValidPhoneFormat(phone, defaultCountry);
        
        if (!validation.valid) {
            let errorMessage = `Invalid phone format: ${phone}. `;
            
            // Provide helpful message for ambiguous cases
            const cleaned = phone.replace(/[\s\-\(\)]/g, '').replace(/^\+/, ''); // Remove + if present
            if (/^08\d+$/.test(cleaned) && cleaned.length >= 9 && cleaned.length <= 13) {
                errorMessage += `Nomor "08xx" dapat berupa Indonesia (10-13 digit) atau Thailand (9-10 digit). `;
                errorMessage += `Untuk Indonesia gunakan: 081234567890 atau 6281234567890. `;
                errorMessage += `Untuk Thailand gunakan: 66812345678 (wajib dengan country code 66).`;
            } else if (/^09\d+$/.test(cleaned) && cleaned.length === 11) {
                errorMessage += `Nomor "09xx" 11 digit biasanya Philippines. `;
                errorMessage += `Untuk Philippines gunakan: 639123456789 (wajib dengan country code 63). `;
                errorMessage += `Untuk Indonesia 09xx (jika ada), gunakan: 091234567890 atau 6291234567890.`;
            } else {
                errorMessage += `Supported countries: Indonesia, Malaysia, Singapore, Thailand, Philippines, India, USA, UK, Australia. `;
                errorMessage += `Untuk negara non-Indonesia, gunakan format dengan country code (contoh: 66xxx untuk Thailand, 63xxx untuk Philippines).`;
            }
            
            return {
                valid: false,
                message: errorMessage
            };
        }
        
        // Normalize phone number
        const normalized = normalizePhone(phone, validation.country);
        
        // Check for potential conflicts and add warnings
        const cleaned = phone.replace(/[\s\-\(\)]/g, '').replace(/^\+/, '');
        let warning = null;
        
        // Check conflict: Indonesia 08xx (10-13) vs Thailand 08xx (9-10)
        if (/^08\d+$/.test(cleaned)) {
            if (cleaned.length >= 9 && cleaned.length <= 13) {
                // Potential conflict - check which country was detected
                if (validation.country === 'ID' && cleaned.length <= 10) {
                    // Could be Thailand, but detected as Indonesia (due to default)
                    warning = `Nomor "08xx" ${cleaned.length} digit dapat berupa Indonesia atau Thailand. Dideteksi sebagai Indonesia (default). Jika ini Thailand, gunakan format 66xxx.`;
                } else if (validation.country === 'TH' && cleaned.length >= 10) {
                    // Could be Indonesia, but detected as Thailand
                    warning = `Nomor "08xx" ${cleaned.length} digit dapat berupa Indonesia atau Thailand. Dideteksi sebagai Thailand. Jika ini Indonesia, gunakan format 62xxx.`;
                }
            }
        }
        
        // Check conflict: Indonesia 09xx vs Philippines 09xx
        if (/^09\d+$/.test(cleaned) && cleaned.length === 11) {
            if (validation.country === 'ID') {
                // Philippines is more specific for 09xx 11 digits
                warning = `Nomor "09xx" 11 digit biasanya Philippines. Jika ini Philippines, gunakan format 63xxx (tanpa +).`;
            }
        }
        
        // Verify normalization matches detected country
        const countryCode = normalized.substring(0, 2); // No need to remove + anymore, normalizePhone doesn't add it
        const expectedCountryCode = COUNTRY_CONFIGS[validation.country]?.code;
        
        if (expectedCountryCode && countryCode !== expectedCountryCode && !warning) {
            // Potential mismatch
            warning = `Country code tidak sesuai dengan negara yang dideteksi. Pastikan format benar.`;
            console.warn(`[PHONE_VALIDATOR] Phone ${phone} detected as ${validation.country} but normalized to ${countryCode} (expected ${expectedCountryCode})`);
        }
        
        phoneDetails.push({
            original: phone,
            normalized: normalized,
            country: validation.country,
            warning: warning || validation.warning
        });
    }
    
    // Check each phone number for duplicates in database
    for (const phoneDetail of phoneDetails) {
        try {
            const existingUser = await checkPhoneExists(db, phoneDetail.normalized, excludeUserId);
            
            if (existingUser) {
                const isOwnNumber = excludeUserId && existingUser.id === excludeUserId;
                
                if (!isOwnNumber) {
                    return {
                        valid: false,
                        message: `Phone number ${phoneDetail.original} (${phoneDetail.country}) is already registered to ${existingUser.name} (ID: ${existingUser.id})`,
                        conflictUser: existingUser
                    };
                }
            }
        } catch (error) {
            console.error('[PHONE_VALIDATOR] Error validating phone:', phoneDetail.original, error);
            return {
                valid: false,
                message: `Error validating phone ${phoneDetail.original}: ${error.message}`
            };
        }
    }
    
    // Check for duplicates within the input
    const normalizedPhones = phoneDetails.map(pd => pd.normalized);
    const uniquePhones = new Set(normalizedPhones);
    if (uniquePhones.size !== normalizedPhones.length) {
        return {
            valid: false,
            message: 'Duplicate phone numbers found in input'
        };
    }
    
    return {
        valid: true,
        message: 'OK',
        phones: phoneDetails,
        countries: [...new Set(phoneDetails.map(pd => pd.country))]
    };
}

/**
 * Get supported countries list
 * @returns {Array} - List of supported countries with details
 */
function getSupportedCountries() {
    return Object.entries(COUNTRY_CONFIGS)
        .filter(([code]) => code !== 'INTERNATIONAL')
        .map(([code, config]) => ({
            code: code,
            countryCode: config.code,
            name: getCountryName(code),
            example: getExampleNumber(code)
        }));
}

/**
 * Get country name from code
 * @param {string} code - Country code
 * @returns {string} - Country name
 */
function getCountryName(code) {
    const names = {
        ID: 'Indonesia',
        MY: 'Malaysia',
        SG: 'Singapore',
        TH: 'Thailand',
        PH: 'Philippines',
        IN: 'India',
        US: 'USA/Canada',
        GB: 'United Kingdom',
        AU: 'Australia',
        INTERNATIONAL: 'International'
    };
    return names[code] || code;
}

/**
 * Get example phone number for country
 * @param {string} code - Country code
 * @returns {string} - Example number
 */
function getExampleNumber(code) {
    const examples = {
        ID: '081234567890',
        MY: '0123456789',
        SG: '91234567',
        TH: '0812345678',
        PH: '09123456789',
        IN: '9876543210',
        US: '2125551234',
        GB: '07123456789',
        AU: '0412345678',
        INTERNATIONAL: '+1234567890'
    };
    return examples[code] || '';
}

module.exports = {
    checkPhoneExists,
    validatePhoneNumbers,
    isValidPhoneFormat,
    normalizePhone,
    detectCountry,
    getSupportedCountries,
    getCountryName,
    COUNTRY_CONFIGS
};
