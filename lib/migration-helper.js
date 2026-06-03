/**
 * Migration Helper Module
 * 
 * Helper functions untuk migrasi data pelanggan dari database lama ke database baru.
 * Menangani field mapping, username/password generation, bulk format conversion, dan validasi data.
 * 
 * @module lib/migration-helper
 */

const bcrypt = require('bcrypt');

/**
 * Field mapping dari nama field lama ke nama field baru
 * Digunakan untuk memetakan field dari database lama ke schema baru
 */
const FIELD_MAPPING = {
    'phone': 'phone_number',
    'hp': 'phone_number',
    'package': 'subscription',
    'paket': 'subscription',
    'odp_id': 'connected_odp_id'
};

/**
 * User schema dengan semua field dan default values
 * Mendefinisikan struktur lengkap tabel users di database baru
 */
const USER_SCHEMA = {
    // Primary Key
    id: { type: 'INTEGER', primaryKey: true, autoIncrement: true, default: null },
    
    // Basic Info
    name: { type: 'TEXT', default: null },
    username: { type: 'TEXT', default: null, generated: true },
    password: { type: 'TEXT', default: null, generated: true },
    phone_number: { type: 'TEXT', default: null, mapped: ['phone', 'hp'] },
    address: { type: 'TEXT', default: null },
    email: { type: 'TEXT', default: null },
    alternative_phone: { type: 'TEXT', default: null },
    
    // Device & Location
    device_id: { type: 'TEXT', default: null },
    latitude: { type: 'TEXT', default: null },
    longitude: { type: 'TEXT', default: null },
    maps_url: { type: 'TEXT', default: null },
    
    // Subscription
    subscription: { type: 'TEXT', default: null, mapped: ['package', 'paket'] },
    subscription_price: { type: 'INTEGER', default: 0 },
    payment_due_date: { type: 'INTEGER', default: 1 },
    
    // Status Flags
    status: { type: 'TEXT', default: 'active' },
    paid: { type: 'INTEGER', default: 0 },
    send_invoice: { type: 'INTEGER', default: 0 },
    is_paid: { type: 'INTEGER', default: 0 },
    auto_isolir: { type: 'INTEGER', default: 1 },
    
    // Corporate Info
    is_corporate: { type: 'INTEGER', default: 0 },
    corporate_name: { type: 'TEXT', default: null },
    corporate_address: { type: 'TEXT', default: null },
    corporate_npwp: { type: 'TEXT', default: null },
    corporate_pic_name: { type: 'TEXT', default: null },
    corporate_pic_phone: { type: 'TEXT', default: null },
    corporate_pic_email: { type: 'TEXT', default: null },
    
    // PPPoE
    pppoe_username: { type: 'TEXT', default: null },
    pppoe_password: { type: 'TEXT', default: null },
    
    // Network
    connected_odp_id: { type: 'TEXT', default: null, mapped: ['odp_id'] },
    bulk: { type: 'TEXT', default: '["1"]', converted: true },
    odc: { type: 'TEXT', default: null },
    odp: { type: 'TEXT', default: null },
    olt: { type: 'TEXT', default: null },
    
    // OTP
    otp: { type: 'TEXT', default: null },
    otpTimestamp: { type: 'INTEGER', default: null },
    
    // Timestamps
    registration_date: { type: 'TEXT', default: null },
    created_at: { type: 'TEXT', default: null }, // Will use CURRENT_TIMESTAMP in DB
    updated_at: { type: 'TEXT', default: null }, // Will use CURRENT_TIMESTAMP in DB
    last_login: { type: 'TEXT', default: null },
    last_payment_date: { type: 'TEXT', default: null },
    
    // Notification Flags
    reminder_sent: { type: 'INTEGER', default: 0 },
    isolir_sent: { type: 'INTEGER', default: 0 },
    
    // Misc
    compensation_minutes: { type: 'INTEGER', default: 0 },
    notes: { type: 'TEXT', default: null }
};


/**
 * Map field dari data lama ke format baru
 * Memetakan nama field lama ke nama field baru sesuai FIELD_MAPPING
 * Jika field sudah ada dengan nama baru, nilai field baru akan diprioritaskan
 * 
 * @param {Object} oldData - Data dari database lama
 * @returns {Object} - Data dengan field yang sudah dimapping
 * 
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6
 */
function mapFields(oldData) {
    if (!oldData || typeof oldData !== 'object') {
        return {};
    }

    const result = { ...oldData };

    // Apply field mapping
    for (const [oldField, newField] of Object.entries(FIELD_MAPPING)) {
        // Only map if old field exists and new field doesn't exist (or is null/undefined)
        // Use Object.prototype.hasOwnProperty.call for safety with null-prototype objects
        if (Object.prototype.hasOwnProperty.call(oldData, oldField)) {
            // If new field already exists with a value, prioritize it (Requirement 1.6)
            if (!Object.prototype.hasOwnProperty.call(result, newField) || result[newField] === null || result[newField] === undefined) {
                result[newField] = oldData[oldField];
            }
            // Remove old field name from result to avoid confusion
            if (oldField !== newField) {
                delete result[oldField];
            }
        }
    }

    return result;
}

/**
 * Generate username dari nama pelanggan
 * - Convert ke lowercase
 * - Hapus karakter non-alphanumeric
 * - Limit ke 10 karakter
 * - Tambahkan 3 digit random untuk uniqueness
 * 
 * @param {string} name - Nama pelanggan
 * @returns {string} - Username yang di-generate
 * 
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
 */
function generateUsername(name) {
    // Use "user" as base if name is empty or null (Requirement 2.6)
    let baseName = 'user';
    
    if (name && typeof name === 'string' && name.trim().length > 0) {
        // Convert to lowercase (Requirement 2.2)
        baseName = name.toLowerCase();
        
        // Remove non-alphanumeric characters (Requirement 2.3)
        baseName = baseName.replace(/[^a-z0-9]/g, '');
        
        // If after cleaning the name is empty, use "user"
        if (baseName.length === 0) {
            baseName = 'user';
        }
    }
    
    // Limit to 10 characters (Requirement 2.4)
    baseName = baseName.substring(0, 10);
    
    // Append random 3-digit suffix (Requirement 2.5)
    const randomSuffix = Math.floor(100 + Math.random() * 900).toString();
    
    return baseName + randomSuffix;
}

/**
 * Generate password random 8 karakter
 * Harus mengandung minimal 1 lowercase, 1 uppercase, dan 1 digit
 * 
 * @returns {string} - Plain text password
 * 
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */
function generatePassword() {
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const digits = '0123456789';
    const allChars = lowercase + uppercase + digits;
    
    // Ensure at least one of each required character type
    let password = '';
    
    // Add one lowercase (Requirement 3.2)
    password += lowercase[Math.floor(Math.random() * lowercase.length)];
    
    // Add one uppercase (Requirement 3.3)
    password += uppercase[Math.floor(Math.random() * uppercase.length)];
    
    // Add one digit (Requirement 3.4)
    password += digits[Math.floor(Math.random() * digits.length)];
    
    // Fill remaining 5 characters randomly (total 8 characters - Requirement 3.1)
    for (let i = 0; i < 5; i++) {
        password += allChars[Math.floor(Math.random() * allChars.length)];
    }
    
    // Shuffle the password to randomize position of required characters
    password = password.split('').sort(() => Math.random() - 0.5).join('');
    
    return password;
}

/**
 * Hash password dengan bcrypt
 * 
 * @param {string} password - Plain text password
 * @returns {Promise<string>} - Hashed password
 * 
 * Requirements: 3.5
 */
async function hashPasswordAsync(password) {
    const saltRounds = 10;
    return await bcrypt.hash(password, saltRounds);
}


/**
 * Convert bulk ke format standar JSON array string
 * Menangani berbagai format input dan mengkonversi ke format '["1","2"]'
 * 
 * @param {any} bulk - Bulk dalam berbagai format
 * @returns {string} - JSON string array seperti '["1","2"]'
 * 
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
 */
function convertBulkFormat(bulk) {
    // Default to '["1"]' for empty, null, or undefined (Requirement 4.4)
    if (bulk === null || bulk === undefined || bulk === '') {
        return '["1"]';
    }

    // Handle string input
    if (typeof bulk === 'string') {
        const trimmed = bulk.trim();
        
        // Empty string after trim
        if (trimmed === '' || trimmed === '[]' || trimmed === 'null') {
            return '["1"]';
        }
        
        // Handle corrupted data like "[object Object]"
        if (trimmed === '[object Object]' || trimmed.startsWith('[object')) {
            return '["1"]';
        }
        
        // Try to parse as JSON first
        try {
            const parsed = JSON.parse(trimmed);
            
            // If it's an array, convert all elements to strings
            if (Array.isArray(parsed)) {
                if (parsed.length === 0) {
                    return '["1"]';
                }
                // Convert all elements to strings (Requirement 4.2, 4.3)
                const stringArray = parsed.map(item => String(item));
                return JSON.stringify(stringArray);
            }
            
            // If it's a single value (number or string), wrap in array
            return JSON.stringify([String(parsed)]);
        } catch (e) {
            // Not valid JSON, check if comma-separated (Requirement 4.1)
            if (trimmed.includes(',')) {
                const parts = trimmed.split(',').map(s => s.trim()).filter(s => s.length > 0);
                if (parts.length === 0) {
                    return '["1"]';
                }
                return JSON.stringify(parts);
            }
            
            // Single string value (Requirement 4.6)
            return JSON.stringify([trimmed]);
        }
    }

    // Handle number input (Requirement 4.5)
    if (typeof bulk === 'number') {
        return JSON.stringify([String(bulk)]);
    }

    // Handle array input
    if (Array.isArray(bulk)) {
        if (bulk.length === 0) {
            return '["1"]';
        }
        // Convert all elements to strings (Requirement 4.2, 4.3)
        const stringArray = bulk.map(item => String(item));
        return JSON.stringify(stringArray);
    }

    // Handle object (shouldn't happen, but fallback)
    if (typeof bulk === 'object') {
        return '["1"]';
    }

    // Any other type, convert to string and wrap in array
    return JSON.stringify([String(bulk)]);
}


/**
 * Convert value to boolean integer (0 or 1)
 * 
 * @param {any} value - Value to convert
 * @param {number} defaultValue - Default value if conversion fails
 * @returns {number} - 0 or 1
 */
function toBooleanInt(value, defaultValue = 0) {
    if (value === null || value === undefined) {
        return defaultValue;
    }
    if (typeof value === 'boolean') {
        return value ? 1 : 0;
    }
    if (typeof value === 'number') {
        return value === 1 ? 1 : 0;
    }
    if (typeof value === 'string') {
        const lower = value.toLowerCase().trim();
        if (lower === 'true' || lower === '1' || lower === 'yes') {
            return 1;
        }
        return 0;
    }
    return defaultValue;
}

/**
 * Convert value to integer
 * 
 * @param {any} value - Value to convert
 * @param {number} defaultValue - Default value if conversion fails
 * @returns {number} - Integer value
 */
function toInteger(value, defaultValue = 0) {
    if (value === null || value === undefined) {
        return defaultValue;
    }
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Prepare user data untuk insert ke database
 * Menggabungkan semua transformasi: field mapping, username/password generation,
 * bulk conversion, dan default values
 * 
 * @param {Object} userData - Data user dari source
 * @returns {Promise<Object>} - Data yang siap di-insert dengan semua field
 * 
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6
 */
async function prepareUserData(userData) {
    if (!userData || typeof userData !== 'object') {
        throw new Error('Invalid user data: must be an object');
    }

    // Step 1: Apply field mapping
    const mappedData = mapFields(userData);

    // Step 2: Prepare result object with all fields from schema
    const result = {};

    // Step 3: Process each field in schema
    for (const [fieldName, fieldConfig] of Object.entries(USER_SCHEMA)) {
        const { type, default: defaultValue } = fieldConfig;
        
        // Get value from mapped data or use default
        let value = mappedData.hasOwnProperty(fieldName) ? mappedData[fieldName] : defaultValue;

        // Handle special cases
        switch (fieldName) {
            case 'id':
                // Preserve ID if exists, otherwise let DB auto-generate
                result[fieldName] = mappedData.id !== undefined ? mappedData.id : null;
                break;

            case 'username':
                // Generate username if missing (Requirement 5.2)
                if (!value || (typeof value === 'string' && value.trim() === '')) {
                    result[fieldName] = generateUsername(mappedData.name);
                } else {
                    result[fieldName] = value;
                }
                break;

            case 'password':
                // Generate and hash password if missing (Requirement 5.2)
                if (!value || (typeof value === 'string' && value.trim() === '')) {
                    const plainPassword = generatePassword();
                    result[fieldName] = await hashPasswordAsync(plainPassword);
                    // Store plain password temporarily for logging/notification
                    result._generatedPassword = plainPassword;
                } else {
                    // If password exists but not hashed, hash it
                    if (typeof value === 'string' && !value.startsWith('$2')) {
                        result[fieldName] = await hashPasswordAsync(value);
                    } else {
                        result[fieldName] = value;
                    }
                }
                break;

            case 'bulk':
                // Convert bulk format (Requirement 5.3)
                result[fieldName] = convertBulkFormat(value);
                break;

            // Boolean fields (Requirement 5.4)
            case 'paid':
            case 'send_invoice':
            case 'is_paid':
            case 'is_corporate':
            case 'auto_isolir':
            case 'reminder_sent':
            case 'isolir_sent':
                result[fieldName] = toBooleanInt(value, defaultValue);
                break;

            // Integer fields (Requirement 5.5)
            case 'subscription_price':
            case 'payment_due_date':
            case 'compensation_minutes':
            case 'otpTimestamp':
                result[fieldName] = toInteger(value, defaultValue);
                break;

            // Timestamp fields (Requirement 5.6)
            case 'created_at':
            case 'updated_at':
                // Use current timestamp if not provided
                if (!value) {
                    result[fieldName] = new Date().toISOString();
                } else {
                    result[fieldName] = value;
                }
                break;

            case 'registration_date':
            case 'last_login':
            case 'last_payment_date':
                // Keep as-is or null
                result[fieldName] = value || null;
                break;

            default:
                // For all other fields, use value or default
                result[fieldName] = value !== undefined ? value : defaultValue;
        }
    }

    return result;
}

/**
 * Get list of all field names in order for INSERT statement
 * 
 * @returns {string[]} - Array of field names
 */
function getFieldNames() {
    return Object.keys(USER_SCHEMA);
}

/**
 * Get placeholders for INSERT statement
 * 
 * @returns {string} - Comma-separated placeholders like "?, ?, ?"
 */
function getPlaceholders() {
    return Object.keys(USER_SCHEMA).map(() => '?').join(', ');
}

/**
 * Get values array from prepared user data for INSERT statement
 * 
 * @param {Object} preparedData - Data from prepareUserData()
 * @returns {any[]} - Array of values in field order
 */
function getValuesArray(preparedData) {
    return Object.keys(USER_SCHEMA).map(field => preparedData[field]);
}

/**
 * Transform user data from database row to application format
 * Handles boolean fields, bulk JSON parsing, and field aliases
 * 
 * @param {Object} dbRow - Raw database row
 * @returns {Object} - Transformed user object for application use
 * 
 * Requirements: 5.4 (boolean fields), bulk parsing, all new fields
 */
function transformUserFromDb(dbRow) {
    if (!dbRow || typeof dbRow !== 'object') {
        return null;
    }

    try {
        const transformed = {
            // Spread all original fields first
            ...dbRow,
            
            // Transform boolean fields correctly (Requirement 5.4)
            paid: dbRow.paid === 1 || dbRow.paid === '1' || dbRow.paid === true,
            send_invoice: dbRow.send_invoice === 1 || dbRow.send_invoice === '1' || dbRow.send_invoice === true,
            is_corporate: dbRow.is_corporate === 1 || dbRow.is_corporate === '1' || dbRow.is_corporate === true,
            auto_isolir: dbRow.auto_isolir === 1 || dbRow.auto_isolir === '1' || dbRow.auto_isolir === true,
            is_paid: dbRow.is_paid === 1 || dbRow.is_paid === '1' || dbRow.is_paid === true,
            reminder_sent: dbRow.reminder_sent === 1 || dbRow.reminder_sent === '1' || dbRow.reminder_sent === true,
            isolir_sent: dbRow.isolir_sent === 1 || dbRow.isolir_sent === '1' || dbRow.isolir_sent === true,
            
            // Parse bulk JSON correctly
            bulk: parseBulkFromDb(dbRow.bulk),
            
            // Handle field aliases for backward compatibility
            connected_odp_id: dbRow.connected_odp_id || null,
            phone: dbRow.phone_number || dbRow.phone || null,
            package: dbRow.subscription || dbRow.package || null,
            
            // Ensure integer fields are numbers
            subscription_price: toInteger(dbRow.subscription_price, 0),
            payment_due_date: toInteger(dbRow.payment_due_date, 1),
            compensation_minutes: toInteger(dbRow.compensation_minutes, 0),
            otpTimestamp: dbRow.otpTimestamp ? toInteger(dbRow.otpTimestamp, null) : null
        };

        return transformed;
    } catch (error) {
        console.error(`[TRANSFORM_USER] Error transforming user ${dbRow.id}:`, error.message);
        // Return minimal transformation on error
        return {
            ...dbRow,
            paid: dbRow.paid === 1 || dbRow.paid === '1' || dbRow.paid === true,
            send_invoice: dbRow.send_invoice === 1 || dbRow.send_invoice === '1' || dbRow.send_invoice === true,
            is_corporate: dbRow.is_corporate === 1 || dbRow.is_corporate === '1' || dbRow.is_corporate === true,
            auto_isolir: dbRow.auto_isolir === 1 || dbRow.auto_isolir === '1' || dbRow.auto_isolir === true,
            bulk: [],
            connected_odp_id: dbRow.connected_odp_id || null,
            phone: dbRow.phone_number || dbRow.phone || null,
            package: dbRow.subscription || dbRow.package || null
        };
    }
}

/**
 * Parse bulk field from database to array
 * Handles various formats: JSON string, corrupted data, empty values
 * 
 * @param {any} bulk - Bulk value from database
 * @returns {Array} - Parsed array of bulk values
 */
function parseBulkFromDb(bulk) {
    try {
        if (!bulk) return [];
        
        if (typeof bulk === 'string') {
            const trimmed = bulk.trim();
            
            // Handle empty or null-like strings
            if (trimmed === '' || trimmed === '[]' || trimmed === 'null') {
                return [];
            }
            
            // Handle corrupted data like "[object Object]"
            if (trimmed === '[object Object]' || trimmed.startsWith('[object')) {
                console.warn(`[PARSE_BULK] Corrupted bulk data: "${trimmed}", resetting to default`);
                return [];
            }
            
            // Parse JSON
            const parsed = JSON.parse(trimmed);
            
            // Ensure it's an array
            if (Array.isArray(parsed)) {
                return parsed;
            }
            
            // If single value, wrap in array
            return [parsed];
        }
        
        // If already an array, return as-is
        if (Array.isArray(bulk)) {
            return bulk;
        }
        
        // For any other type, return empty array
        return [];
    } catch (e) {
        console.warn(`[PARSE_BULK] Failed to parse bulk:`, e.message);
        return [];
    }
}

/**
 * Transform multiple user rows from database
 * 
 * @param {Array} rows - Array of database rows
 * @returns {Object} - Object with transformedUsers array and errorCount
 */
function transformUsersFromDb(rows) {
    if (!Array.isArray(rows)) {
        return { transformedUsers: [], errorCount: 0 };
    }

    const transformedUsers = [];
    let errorCount = 0;

    for (const row of rows) {
        const transformed = transformUserFromDb(row);
        if (transformed) {
            transformedUsers.push(transformed);
        } else {
            errorCount++;
        }
    }

    return { transformedUsers, errorCount };
}

// Export all functions and constants
module.exports = {
    FIELD_MAPPING,
    USER_SCHEMA,
    mapFields,
    generateUsername,
    generatePassword,
    hashPasswordAsync,
    convertBulkFormat,
    prepareUserData,
    toBooleanInt,
    toInteger,
    getFieldNames,
    getPlaceholders,
    getValuesArray,
    transformUserFromDb,
    parseBulkFromDb,
    transformUsersFromDb
};
