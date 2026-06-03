# Design Document: Database Migration Fix

## Overview

Perbaikan sistem migrasi database untuk menangani migrasi data pelanggan dari database lama (JSON atau SQLite) ke database baru (users.sqlite). Sistem ini akan menambahkan fitur field mapping, username/password generation, bulk format conversion, dan validasi data yang komprehensif.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Migration System                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │   Source     │    │  Migration   │    │   Target     │      │
│  │  Database    │───▶│   Engine     │───▶│  Database    │      │
│  │ (JSON/SQLite)│    │              │    │(users.sqlite)│      │
│  └──────────────┘    └──────┬───────┘    └──────────────┘      │
│                             │                                    │
│         ┌───────────────────┼───────────────────┐               │
│         │                   │                   │               │
│         ▼                   ▼                   ▼               │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐        │
│  │ Field Mapper │   │  Generators  │   │   Bulk       │        │
│  │              │   │ (Username/   │   │  Converter   │        │
│  │              │   │  Password)   │   │              │        │
│  └──────────────┘   └──────────────┘   └──────────────┘        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### 1. MigrationHelper Module (`lib/migration-helper.js`)

Module baru yang berisi semua helper functions untuk migrasi:

```javascript
/**
 * Field mapping dari nama field lama ke nama field baru
 */
const FIELD_MAPPING = {
    'phone': 'phone_number',
    'hp': 'phone_number',
    'package': 'subscription',
    'paket': 'subscription',
    'odp_id': 'connected_odp_id'
};

/**
 * Map field dari data lama ke format baru
 * @param {Object} oldData - Data dari database lama
 * @returns {Object} - Data dengan field yang sudah dimapping
 */
function mapFields(oldData) { }

/**
 * Generate username dari nama pelanggan
 * @param {string} name - Nama pelanggan
 * @returns {string} - Username yang di-generate
 */
function generateUsername(name) { }

/**
 * Generate password random
 * @returns {string} - Plain text password (untuk logging/notification)
 */
function generatePassword() { }

/**
 * Hash password dengan bcrypt
 * @param {string} password - Plain text password
 * @returns {Promise<string>} - Hashed password
 */
async function hashPassword(password) { }

/**
 * Convert bulk ke format standar JSON array string
 * @param {any} bulk - Bulk dalam berbagai format
 * @returns {string} - JSON string array seperti '["1","2"]'
 */
function convertBulkFormat(bulk) { }

/**
 * Prepare user data untuk insert ke database
 * @param {Object} userData - Data user dari source
 * @returns {Promise<Object>} - Data yang siap di-insert
 */
async function prepareUserData(userData) { }
```

### 2. Updated JSON Migration Endpoint (`routes/admin.js`)

Update endpoint `/api/migrate/users` untuk menggunakan MigrationHelper:

```javascript
// Sebelum: INSERT hanya 10 field
// Sesudah: INSERT semua 40+ field dengan mapping dan generation

const insertStmt = db.prepare(`INSERT OR IGNORE INTO users
    (id, name, username, password, phone_number, address, device_id, 
     status, latitude, longitude, subscription, subscription_price,
     payment_due_date, paid, send_invoice, is_paid, auto_isolir,
     is_corporate, corporate_name, corporate_address, corporate_npwp,
     corporate_pic_name, corporate_pic_phone, corporate_pic_email,
     pppoe_username, pppoe_password, connected_odp_id, bulk,
     odc, odp, olt, maps_url, registration_date, created_at, updated_at,
     reminder_sent, isolir_sent, compensation_minutes, email,
     alternative_phone, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
```

## Data Models

### User Schema (Target)

```javascript
const USER_SCHEMA = {
    // Primary Key
    id: { type: 'INTEGER', primaryKey: true, autoIncrement: true },
    
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
    created_at: { type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
    updated_at: { type: 'TEXT', default: 'CURRENT_TIMESTAMP' },
    last_login: { type: 'TEXT', default: null },
    last_payment_date: { type: 'TEXT', default: null },
    
    // Notification Flags
    reminder_sent: { type: 'INTEGER', default: 0 },
    isolir_sent: { type: 'INTEGER', default: 0 },
    
    // Misc
    compensation_minutes: { type: 'INTEGER', default: 0 },
    notes: { type: 'TEXT', default: null }
};
```

### Field Mapping Table

| Old Field Name | New Field Name | Notes |
|---------------|----------------|-------|
| phone | phone_number | Nomor HP pelanggan |
| hp | phone_number | Alias Indonesia |
| package | subscription | Nama paket |
| paket | subscription | Alias Indonesia |
| odp_id | connected_odp_id | ID ODP yang terhubung |

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Field Mapping Correctness

*For any* input data containing old field names (phone, hp, package, paket, odp_id), the mapFields function SHALL correctly map them to new field names (phone_number, subscription, connected_odp_id), and when both old and new field names exist, the new field name value SHALL take precedence.

**Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6**

### Property 2: Username Generation Format

*For any* customer name, the generateUsername function SHALL produce a username that is lowercase, contains only alphanumeric characters, has a base of maximum 10 characters, and ends with exactly 3 digits.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**

### Property 3: Password Generation Complexity

*For any* generated password, it SHALL be exactly 8 characters long and contain at least one lowercase letter, one uppercase letter, and one digit.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

### Property 4: Bulk Format Conversion

*For any* bulk input (comma-separated string, array of numbers, array of strings, single number, single string), the convertBulkFormat function SHALL produce a valid JSON string array where all elements are strings.

**Validates: Requirements 4.1, 4.2, 4.3, 4.5, 4.6**

### Property 5: Type Handling Correctness

*For any* migrated record, boolean fields (paid, send_invoice, is_corporate, auto_isolir) SHALL be stored as 0 or 1, integer fields SHALL be stored as integers, and timestamp fields SHALL be stored as valid ISO strings or null.

**Validates: Requirements 5.4, 5.5, 5.6**

### Property 6: Phone Number Handling

*For any* input record, the Migration_System SHALL accept null/empty phone_number values and preserve pipe-separated multiple numbers without modification.

**Validates: Requirements 6.1, 6.2, 6.3**

### Property 7: Duplicate Check by ID Only

*For any* set of input records, the Migration_System SHALL skip records with duplicate IDs but allow records with duplicate phone_numbers (different IDs).

**Validates: Requirements 8.1, 8.2, 8.4, 8.5**

### Property 8: Migration Resilience

*For any* batch of records containing both valid and invalid records, the Migration_System SHALL successfully migrate all valid records and continue processing even when some records fail.

**Validates: Requirements 7.5**

## Error Handling

### Error Categories

1. **Field Mapping Errors**
   - Unknown field names: Log warning, skip field
   - Type mismatch: Attempt conversion, use default on failure

2. **Generation Errors**
   - Username collision: Retry with different random suffix (max 3 attempts)
   - Password generation failure: Use fallback generator

3. **Bulk Conversion Errors**
   - Invalid JSON: Default to `'["1"]'`
   - Corrupted data: Log warning, use default

4. **Database Errors**
   - Constraint violation: Skip record, log error
   - Connection error: Abort migration, report partial results

### Error Response Format

```javascript
{
    status: 500,
    message: "Migrasi selesai dengan error",
    details: {
        totalRecords: 100,
        successCount: 95,
        errorCount: 5,
        skippedDuplicates: 2,
        errors: [
            { id: 5, name: "John", error: "Invalid bulk format" },
            // ...
        ]
    }
}
```

## Testing Strategy

### Unit Tests

1. **Field Mapper Tests**
   - Test each field mapping individually
   - Test priority when both old and new names exist
   - Test with missing fields

2. **Username Generator Tests**
   - Test with normal names
   - Test with special characters
   - Test with empty/null names
   - Test uniqueness suffix

3. **Password Generator Tests**
   - Test length requirement
   - Test character requirements
   - Test bcrypt hashing

4. **Bulk Converter Tests**
   - Test comma-separated input
   - Test array of numbers
   - Test array of strings
   - Test single values
   - Test empty/null/undefined

### Property-Based Tests

Using fast-check library for JavaScript:

1. **Property 1**: Field mapping round-trip
2. **Property 2**: Username format validation
3. **Property 3**: Password complexity validation
4. **Property 4**: Bulk conversion idempotence
5. **Property 5**: Type handling correctness
6. **Property 6**: Phone number preservation
7. **Property 7**: Duplicate detection by ID only
8. **Property 8**: Migration resilience

### Integration Tests

1. **Full Migration Test**
   - Upload JSON file with various data formats
   - Verify all records migrated correctly
   - Verify generated fields are valid

2. **Duplicate Handling Test**
   - Upload file with duplicate IDs
   - Verify duplicates are skipped
   - Verify same phone numbers are allowed

3. **Error Recovery Test**
   - Upload file with some invalid records
   - Verify valid records are migrated
   - Verify error report is accurate
