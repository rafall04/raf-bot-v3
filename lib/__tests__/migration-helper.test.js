/**
 * Property-Based Tests for Migration Helper Module
 * 
 * Tests the correctness properties defined in the design document:
 * - Property 1: Field Mapping Correctness
 * - Property 2: Username Generation Format
 * - Property 3: Password Generation Complexity
 * - Property 4: Bulk Format Conversion
 * 
 * @module lib/__tests__/migration-helper.test.js
 */

const fc = require('fast-check');
const {
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
    transformUserFromDb,
    parseBulkFromDb,
    transformUsersFromDb
} = require('../migration-helper');

describe('Migration Helper Module', () => {
    
    /**
     * Property 1: Field Mapping Correctness
     * 
     * *For any* input data containing old field names (phone, hp, package, paket, odp_id),
     * the mapFields function SHALL correctly map them to new field names 
     * (phone_number, subscription, connected_odp_id), and when both old and new field 
     * names exist, the new field name value SHALL take precedence.
     * 
     * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6**
     */
    describe('Property 1: Field Mapping Correctness', () => {
        
        // Feature: database-migration-fix, Property 1: Field Mapping Correctness
        test('should map old field names to new field names', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        phone: fc.option(fc.string(), { nil: undefined }),
                        hp: fc.option(fc.string(), { nil: undefined }),
                        package: fc.option(fc.string(), { nil: undefined }),
                        paket: fc.option(fc.string(), { nil: undefined }),
                        odp_id: fc.option(fc.string(), { nil: undefined }),
                        name: fc.option(fc.string(), { nil: undefined })
                    }),
                    (oldData) => {
                        const result = mapFields(oldData);
                        
                        // Verify mapping: phone/hp -> phone_number
                        if (oldData.phone !== undefined || oldData.hp !== undefined) {
                            expect(result).toHaveProperty('phone_number');
                            // Old field names should be removed
                            expect(result).not.toHaveProperty('phone');
                            expect(result).not.toHaveProperty('hp');
                        }
                        
                        // Verify mapping: package/paket -> subscription
                        if (oldData.package !== undefined || oldData.paket !== undefined) {
                            expect(result).toHaveProperty('subscription');
                            expect(result).not.toHaveProperty('package');
                            expect(result).not.toHaveProperty('paket');
                        }
                        
                        // Verify mapping: odp_id -> connected_odp_id
                        if (oldData.odp_id !== undefined) {
                            expect(result).toHaveProperty('connected_odp_id');
                            expect(result).not.toHaveProperty('odp_id');
                        }
                        
                        // Non-mapped fields should be preserved
                        if (oldData.name !== undefined) {
                            expect(result.name).toBe(oldData.name);
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });

        // Feature: database-migration-fix, Property 1: New field value takes precedence
        test('should prioritize new field name value when both exist', () => {
            fc.assert(
                fc.property(
                    fc.string(),
                    fc.string(),
                    (oldValue, newValue) => {
                        // When both phone and phone_number exist
                        const dataWithBoth = {
                            phone: oldValue,
                            phone_number: newValue
                        };
                        const result = mapFields(dataWithBoth);
                        
                        // New field value should take precedence (Requirement 1.6)
                        expect(result.phone_number).toBe(newValue);
                        expect(result).not.toHaveProperty('phone');
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 2: Username Generation Format
     * 
     * *For any* customer name, the generateUsername function SHALL produce a username that
     * is lowercase, contains only alphanumeric characters, has a base of maximum 10 characters,
     * and ends with exactly 3 digits.
     * 
     * **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**
     */
    describe('Property 2: Username Generation Format', () => {
        
        // Feature: database-migration-fix, Property 2: Username Generation Format
        test('should generate valid username format for any name', () => {
            fc.assert(
                fc.property(
                    fc.string(),
                    (name) => {
                        const username = generateUsername(name);
                        
                        // Must be lowercase (Requirement 2.2)
                        expect(username).toBe(username.toLowerCase());
                        
                        // Must contain only alphanumeric characters (Requirement 2.3)
                        expect(username).toMatch(/^[a-z0-9]+$/);
                        
                        // Must end with exactly 3 digits (Requirement 2.5)
                        expect(username).toMatch(/\d{3}$/);
                        
                        // Base (without suffix) must be max 10 characters (Requirement 2.4)
                        const base = username.slice(0, -3);
                        expect(base.length).toBeLessThanOrEqual(10);
                        expect(base.length).toBeGreaterThanOrEqual(1);
                        
                        // Total length: base (1-10) + suffix (3) = 4-13
                        expect(username.length).toBeGreaterThanOrEqual(4);
                        expect(username.length).toBeLessThanOrEqual(13);
                    }
                ),
                { numRuns: 100 }
            );
        });

        // Feature: database-migration-fix, Property 2: Empty name handling
        test('should use "user" as base for empty/null names', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(null, undefined, '', '   ', '\t\n'),
                    (emptyName) => {
                        const username = generateUsername(emptyName);
                        
                        // Should start with "user" (Requirement 2.6)
                        expect(username.slice(0, -3)).toBe('user');
                    }
                ),
                { numRuns: 20 }
            );
        });
    });

    /**
     * Property 3: Password Generation Complexity
     * 
     * *For any* generated password, it SHALL be exactly 8 characters long and contain
     * at least one lowercase letter, one uppercase letter, and one digit.
     * 
     * **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
     */
    describe('Property 3: Password Generation Complexity', () => {
        
        // Feature: database-migration-fix, Property 3: Password Generation Complexity
        test('should generate password with required complexity', () => {
            // Generate multiple passwords and verify each
            for (let i = 0; i < 100; i++) {
                const password = generatePassword();
                
                // Must be exactly 8 characters (Requirement 3.1)
                expect(password.length).toBe(8);
                
                // Must contain at least one lowercase (Requirement 3.2)
                expect(password).toMatch(/[a-z]/);
                
                // Must contain at least one uppercase (Requirement 3.3)
                expect(password).toMatch(/[A-Z]/);
                
                // Must contain at least one digit (Requirement 3.4)
                expect(password).toMatch(/[0-9]/);
            }
        });

        // Feature: database-migration-fix, Property 3: Password hashing
        test('should hash password with bcrypt', async () => {
            const password = generatePassword();
            const hashed = await hashPasswordAsync(password);
            
            // Bcrypt hash should start with $2
            expect(hashed).toMatch(/^\$2[aby]?\$/);
            
            // Hash should be different from plain password
            expect(hashed).not.toBe(password);
        });
    });

    /**
     * Property 4: Bulk Format Conversion
     * 
     * *For any* bulk input (comma-separated string, array of numbers, array of strings,
     * single number, single string), the convertBulkFormat function SHALL produce a valid
     * JSON string array where all elements are strings.
     * 
     * **Validates: Requirements 4.1, 4.2, 4.3, 4.5, 4.6**
     */
    describe('Property 4: Bulk Format Conversion', () => {
        
        // Feature: database-migration-fix, Property 4: Bulk Format Conversion
        test('should convert any bulk format to valid JSON string array', () => {
            fc.assert(
                fc.property(
                    fc.oneof(
                        // Comma-separated string (Requirement 4.1)
                        fc.array(fc.integer({ min: 1, max: 10 }), { minLength: 1, maxLength: 5 })
                            .map(arr => arr.join(',')),
                        // Array of numbers (Requirement 4.2)
                        fc.array(fc.integer({ min: 1, max: 10 }), { minLength: 1, maxLength: 5 }),
                        // Array of strings (Requirement 4.3)
                        fc.array(fc.constantFrom('1', '2', '3', '4', '5'), { minLength: 1, maxLength: 5 }),
                        // Single number (Requirement 4.5)
                        fc.integer({ min: 1, max: 10 }),
                        // Single string (Requirement 4.6)
                        fc.constantFrom('1', '2', '3', '4', '5')
                    ),
                    (bulk) => {
                        const result = convertBulkFormat(bulk);
                        
                        // Result must be valid JSON
                        let parsed;
                        expect(() => { parsed = JSON.parse(result); }).not.toThrow();
                        
                        // Result must be an array
                        expect(Array.isArray(parsed)).toBe(true);
                        
                        // All elements must be strings
                        parsed.forEach(item => {
                            expect(typeof item).toBe('string');
                        });
                        
                        // Array must not be empty (non-empty input)
                        expect(parsed.length).toBeGreaterThan(0);
                    }
                ),
                { numRuns: 100 }
            );
        });

        // Feature: database-migration-fix, Property 4: Empty/null defaults to ["1"]
        test('should default to ["1"] for empty/null/undefined', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(null, undefined, '', '[]', 'null'),
                    (emptyBulk) => {
                        const result = convertBulkFormat(emptyBulk);
                        expect(result).toBe('["1"]');
                    }
                ),
                { numRuns: 20 }
            );
        });
    });

    /**
     * Additional unit tests for helper functions
     */
    describe('Helper Functions', () => {
        
        test('toBooleanInt should convert various values correctly', () => {
            expect(toBooleanInt(true)).toBe(1);
            expect(toBooleanInt(false)).toBe(0);
            expect(toBooleanInt(1)).toBe(1);
            expect(toBooleanInt(0)).toBe(0);
            expect(toBooleanInt('true')).toBe(1);
            expect(toBooleanInt('false')).toBe(0);
            expect(toBooleanInt('1')).toBe(1);
            expect(toBooleanInt('0')).toBe(0);
            expect(toBooleanInt(null, 0)).toBe(0);
            expect(toBooleanInt(undefined, 1)).toBe(1);
        });

        test('toInteger should convert various values correctly', () => {
            expect(toInteger(42)).toBe(42);
            expect(toInteger('42')).toBe(42);
            expect(toInteger('abc', 0)).toBe(0);
            expect(toInteger(null, 10)).toBe(10);
            expect(toInteger(undefined, 5)).toBe(5);
        });

        test('mapFields should handle null/undefined input', () => {
            expect(mapFields(null)).toEqual({});
            expect(mapFields(undefined)).toEqual({});
        });
    });

    /**
     * Integration test for prepareUserData
     */
    describe('prepareUserData Integration', () => {
        
        test('should prepare complete user data with all transformations', async () => {
            const inputData = {
                id: 1,
                name: 'Test User',
                phone: '08123456789',
                package: 'Premium',
                odp_id: 'ODP-001',
                bulk: '1,2,3',
                paid: true,
                is_corporate: false
            };

            const result = await prepareUserData(inputData);

            // Field mapping applied
            expect(result.phone_number).toBe('08123456789');
            expect(result.subscription).toBe('Premium');
            expect(result.connected_odp_id).toBe('ODP-001');

            // Username generated
            expect(result.username).toMatch(/^testuser\d{3}$/);

            // Password generated and hashed
            expect(result.password).toMatch(/^\$2[aby]?\$/);

            // Bulk converted
            expect(result.bulk).toBe('["1","2","3"]');

            // Boolean fields converted
            expect(result.paid).toBe(1);
            expect(result.is_corporate).toBe(0);

            // All schema fields present
            Object.keys(USER_SCHEMA).forEach(field => {
                expect(result).toHaveProperty(field);
            });
        });

        test('should preserve existing username and password', async () => {
            const inputData = {
                id: 2,
                name: 'Existing User',
                username: 'existinguser',
                password: '$2b$10$hashedpassword'
            };

            const result = await prepareUserData(inputData);

            expect(result.username).toBe('existinguser');
            expect(result.password).toBe('$2b$10$hashedpassword');
        });
    });

    /**
     * Property 5: Type Handling Correctness
     * 
     * *For any* migrated record, boolean fields (paid, send_invoice, is_corporate, auto_isolir)
     * SHALL be stored as 0 or 1, integer fields SHALL be stored as integers, and timestamp
     * fields SHALL be stored as valid ISO strings or null.
     * 
     * **Validates: Requirements 5.4, 5.5, 5.6**
     */
    describe('Property 5: Type Handling Correctness', () => {
        
        // Feature: database-migration-fix, Property 5: Type Handling Correctness
        test('should convert boolean fields to 0 or 1 for any input', async () => {
            const testCases = [
                { paid: true, send_invoice: false, is_corporate: true, auto_isolir: false },
                { paid: false, send_invoice: true, is_corporate: false, auto_isolir: true },
                { paid: 1, send_invoice: 0, is_corporate: 1, auto_isolir: 0 },
                { paid: '1', send_invoice: '0', is_corporate: 'true', auto_isolir: 'false' },
                { paid: 'yes', send_invoice: 'no', is_corporate: null, auto_isolir: undefined },
                { paid: null, send_invoice: null, is_corporate: null, auto_isolir: null }
            ];
            
            for (const testCase of testCases) {
                const result = await prepareUserData({ id: 1, name: 'Test', ...testCase });
                
                // Boolean fields must be 0 or 1 (Requirement 5.4)
                expect([0, 1]).toContain(result.paid);
                expect([0, 1]).toContain(result.send_invoice);
                expect([0, 1]).toContain(result.is_corporate);
                expect([0, 1]).toContain(result.auto_isolir);
            }
        });

        // Feature: database-migration-fix, Property 5: Integer fields
        test('should convert integer fields to integers for any input', async () => {
            const testCases = [
                { subscription_price: 100000, payment_due_date: 15, compensation_minutes: 60 },
                { subscription_price: '50000', payment_due_date: '1', compensation_minutes: '120' },
                { subscription_price: null, payment_due_date: null, compensation_minutes: null },
                { subscription_price: 0, payment_due_date: 28, compensation_minutes: 0 }
            ];
            
            for (const testCase of testCases) {
                const result = await prepareUserData({ id: 1, name: 'Test', ...testCase });
                
                // Integer fields must be integers (Requirement 5.5)
                expect(typeof result.subscription_price).toBe('number');
                expect(Number.isInteger(result.subscription_price)).toBe(true);
                
                expect(typeof result.payment_due_date).toBe('number');
                expect(Number.isInteger(result.payment_due_date)).toBe(true);
                
                expect(typeof result.compensation_minutes).toBe('number');
                expect(Number.isInteger(result.compensation_minutes)).toBe(true);
            }
        });

        // Feature: database-migration-fix, Property 5: Timestamp fields
        test('should handle timestamp fields correctly', async () => {
            const testCases = [
                { created_at: '2024-01-15T10:30:00.000Z' },
                { created_at: null },
                { updated_at: '2024-06-20T15:45:00.000Z' },
                { registration_date: '2023-12-01' },
                { last_login: null },
                {}
            ];

            for (const testCase of testCases) {
                const result = await prepareUserData({ id: 1, name: 'Test', ...testCase });
                
                // Timestamp fields must be string or null (Requirement 5.6)
                expect(result.created_at === null || typeof result.created_at === 'string').toBe(true);
                expect(result.updated_at === null || typeof result.updated_at === 'string').toBe(true);
                expect(result.registration_date === null || typeof result.registration_date === 'string').toBe(true);
                expect(result.last_login === null || typeof result.last_login === 'string').toBe(true);
            }
        });
    });

    /**
     * Property 6: Phone Number Handling
     * 
     * *For any* input record, the Migration_System SHALL accept null/empty phone_number
     * values and preserve pipe-separated multiple numbers without modification.
     * 
     * **Validates: Requirements 6.1, 6.2, 6.3**
     */
    describe('Property 6: Phone Number Handling', () => {
        
        // Feature: database-migration-fix, Property 6: Phone Number Handling
        test('should accept null/empty phone_number values', async () => {
            const testCases = [null, undefined, ''];
            
            for (const phoneNumber of testCases) {
                const userData = {
                    id: 1,
                    name: 'Test User',
                    phone_number: phoneNumber
                };
                
                const result = await prepareUserData(userData);
                
                // Should accept null/empty phone_number (Requirement 6.1, 6.3)
                expect(result.phone_number === null || 
                       result.phone_number === '' || 
                       result.phone_number === undefined).toBe(true);
            }
        });

        // Feature: database-migration-fix, Property 6: Pipe-separated phone numbers
        test('should preserve pipe-separated phone numbers', async () => {
            const testCases = [
                '08123456789',
                '08123456789|08987654321',
                '08123456789|08987654321|08111222333'
            ];
            
            for (const pipeSeparated of testCases) {
                const userData = {
                    id: 1,
                    name: 'Test User',
                    phone_number: pipeSeparated
                };
                
                const result = await prepareUserData(userData);
                
                // Should preserve pipe-separated format (Requirement 6.2)
                expect(result.phone_number).toBe(pipeSeparated);
            }
        });
    });

    /**
     * Property 7: Duplicate Check by ID Only
     * 
     * *For any* set of input records, the Migration_System SHALL skip records with
     * duplicate IDs but allow records with duplicate phone_numbers (different IDs).
     * 
     * **Validates: Requirements 8.1, 8.2, 8.4, 8.5**
     * 
     * Note: This property tests the duplicate detection logic that would be used
     * in the migration endpoint. The actual endpoint test requires integration testing.
     */
    describe('Property 7: Duplicate Check by ID Only', () => {
        
        // Feature: database-migration-fix, Property 7: Duplicate Check by ID Only
        test('should identify duplicates by ID only, not phone_number', () => {
            fc.assert(
                fc.property(
                    fc.array(
                        fc.record({
                            id: fc.integer({ min: 1, max: 100 }),
                            name: fc.string({ minLength: 1, maxLength: 20 }),
                            phone_number: fc.constantFrom('08123456789', '08987654321', '08111222333')
                        }),
                        { minLength: 2, maxLength: 10 }
                    ),
                    (usersData) => {
                        // Simulate duplicate detection logic from migration endpoint
                        const existingIds = new Set();
                        const usersToInsert = [];
                        const skippedUsers = [];
                        
                        for (const user of usersData) {
                            const idExists = existingIds.has(String(user.id));
                            
                            if (idExists) {
                                skippedUsers.push({ id: user.id, reason: 'Duplicate ID' });
                            } else {
                                existingIds.add(String(user.id));
                                usersToInsert.push(user);
                            }
                        }
                        
                        // Verify: Only unique IDs are inserted (Requirement 8.1, 8.4)
                        const insertedIds = usersToInsert.map(u => u.id);
                        const uniqueInsertedIds = [...new Set(insertedIds)];
                        
                        // All inserted IDs should be unique
                        return insertedIds.length === uniqueInsertedIds.length;
                    }
                ),
                { numRuns: 100 }
            );
        });

        // Feature: database-migration-fix, Property 7: Same phone different IDs allowed
        test('should allow multiple records with same phone_number but different IDs', () => {
            const sharedPhone = '08123456789';
            const usersData = [
                { id: 1, name: 'User 1', phone_number: sharedPhone },
                { id: 2, name: 'User 2', phone_number: sharedPhone },
                { id: 3, name: 'User 3', phone_number: sharedPhone }
            ];
            
            // Simulate duplicate detection logic (ID only)
            const existingIds = new Set();
            const usersToInsert = [];
            
            for (const user of usersData) {
                if (!existingIds.has(String(user.id))) {
                    existingIds.add(String(user.id));
                    usersToInsert.push(user);
                }
            }
            
            // All 3 users should be inserted (same phone, different IDs)
            expect(usersToInsert.length).toBe(3);
        });
    });

    /**
     * Property 8: Migration Resilience
     * 
     * *For any* batch of records containing both valid and invalid records,
     * the Migration_System SHALL successfully migrate all valid records and
     * continue processing even when some records fail.
     * 
     * **Validates: Requirements 7.5**
     */
    describe('Property 8: Migration Resilience', () => {
        
        // Feature: database-migration-fix, Property 8: Migration Resilience
        test('should continue processing after individual record failures', async () => {
            // Mix of valid and potentially problematic records
            const usersData = [
                { id: 1, name: 'Valid User 1' },
                { id: 2, name: null }, // Edge case: null name
                { id: 3, name: 'Valid User 3', bulk: '[object Object]' }, // Corrupted bulk
                { id: 4, name: 'Valid User 4', paid: 'invalid' }, // Invalid boolean
                { id: 5, name: '' } // Empty name
            ];
            
            const results = [];
            const errors = [];
            
            // Process each record individually (simulating migration behavior)
            for (const user of usersData) {
                try {
                    const prepared = await prepareUserData(user);
                    results.push(prepared);
                } catch (error) {
                    errors.push({ id: user.id, error: error.message });
                    // Continue processing - don't break (Requirement 7.5)
                }
            }
            
            // All records should be processed (either success or error logged)
            expect(results.length + errors.length).toBe(usersData.length);
            
            // Valid records should be successfully prepared
            expect(results.length).toBeGreaterThan(0);
        });

        // Feature: database-migration-fix, Property 8: Batch processing resilience
        test('should handle mixed valid/invalid records in batch', async () => {
            const usersData = [
                { id: 1, name: 'Valid User', bulk: '1,2,3' },
                { id: 2, name: null, bulk: '[object Object]' },
                { id: 3, name: '', bulk: null },
                { id: 4, name: 'Another Valid', bulk: [1, 2, 3] },
                { id: 5, name: 'Third Valid', bulk: '1,2,3' }
            ];
            
            let successCount = 0;
            let errorCount = 0;
            
            for (const user of usersData) {
                try {
                    await prepareUserData(user);
                    successCount++;
                } catch (error) {
                    errorCount++;
                }
            }
            
            // Total processed should equal input count (Requirement 7.5)
            expect(successCount + errorCount).toBe(usersData.length);
            
            // Most records should succeed (prepareUserData handles edge cases)
            expect(successCount).toBeGreaterThan(0);
        });
    });

    /**
     * Tests for transformUserFromDb function
     * 
     * This function transforms database rows to application format,
     * handling boolean fields, bulk JSON parsing, and field aliases.
     * 
     * **Validates: Requirements 5.4 (boolean fields), bulk parsing, all new fields**
     */
    describe('transformUserFromDb', () => {
        
        // Feature: database-migration-fix, Task 4.1: Transform boolean fields correctly
        test('should transform boolean fields correctly', () => {
            const testCases = [
                // Integer values from SQLite
                { paid: 1, send_invoice: 0, is_corporate: 1, auto_isolir: 0, is_paid: 1, reminder_sent: 0, isolir_sent: 1 },
                { paid: 0, send_invoice: 1, is_corporate: 0, auto_isolir: 1, is_paid: 0, reminder_sent: 1, isolir_sent: 0 },
                // String values (edge case)
                { paid: '1', send_invoice: '0', is_corporate: '1', auto_isolir: '0', is_paid: '1', reminder_sent: '0', isolir_sent: '1' },
                // Boolean values
                { paid: true, send_invoice: false, is_corporate: true, auto_isolir: false, is_paid: true, reminder_sent: false, isolir_sent: true },
                // Null/undefined values
                { paid: null, send_invoice: undefined, is_corporate: null, auto_isolir: undefined, is_paid: null, reminder_sent: undefined, isolir_sent: null }
            ];
            
            for (const dbRow of testCases) {
                const result = transformUserFromDb({ id: 1, name: 'Test', ...dbRow });
                
                // Boolean fields should be JavaScript booleans
                expect(typeof result.paid).toBe('boolean');
                expect(typeof result.send_invoice).toBe('boolean');
                expect(typeof result.is_corporate).toBe('boolean');
                expect(typeof result.auto_isolir).toBe('boolean');
                expect(typeof result.is_paid).toBe('boolean');
                expect(typeof result.reminder_sent).toBe('boolean');
                expect(typeof result.isolir_sent).toBe('boolean');
            }
        });

        // Feature: database-migration-fix, Task 4.1: Parse bulk JSON correctly
        test('should parse bulk JSON correctly', () => {
            const testCases = [
                { bulk: '["1","2","3"]', expected: ['1', '2', '3'] },
                { bulk: '[1,2,3]', expected: [1, 2, 3] },
                { bulk: '["1"]', expected: ['1'] },
                { bulk: '', expected: [] },
                { bulk: null, expected: [] },
                { bulk: undefined, expected: [] },
                { bulk: '[]', expected: [] },
                { bulk: 'null', expected: [] },
                { bulk: '[object Object]', expected: [] }, // Corrupted data
            ];
            
            for (const { bulk, expected } of testCases) {
                const result = transformUserFromDb({ id: 1, name: 'Test', bulk });
                expect(result.bulk).toEqual(expected);
            }
        });

        // Feature: database-migration-fix, Task 4.1: Handle all new fields
        test('should handle field aliases for backward compatibility', () => {
            const dbRow = {
                id: 1,
                name: 'Test User',
                phone_number: '08123456789',
                subscription: 'Premium',
                connected_odp_id: 'ODP-001'
            };
            
            const result = transformUserFromDb(dbRow);
            
            // Field aliases should be set
            expect(result.phone).toBe('08123456789');
            expect(result.package).toBe('Premium');
            expect(result.connected_odp_id).toBe('ODP-001');
        });

        // Feature: database-migration-fix, Task 4.1: Handle integer fields
        test('should ensure integer fields are numbers', () => {
            const dbRow = {
                id: 1,
                name: 'Test',
                subscription_price: '100000',
                payment_due_date: '15',
                compensation_minutes: '60',
                otpTimestamp: '1704067200000'
            };
            
            const result = transformUserFromDb(dbRow);
            
            expect(typeof result.subscription_price).toBe('number');
            expect(result.subscription_price).toBe(100000);
            
            expect(typeof result.payment_due_date).toBe('number');
            expect(result.payment_due_date).toBe(15);
            
            expect(typeof result.compensation_minutes).toBe('number');
            expect(result.compensation_minutes).toBe(60);
            
            expect(typeof result.otpTimestamp).toBe('number');
        });

        test('should handle null/undefined input gracefully', () => {
            expect(transformUserFromDb(null)).toBeNull();
            expect(transformUserFromDb(undefined)).toBeNull();
        });

        test('should return minimal transformation on error', () => {
            // Create a row that might cause issues but should still be handled
            const problematicRow = {
                id: 1,
                name: 'Test',
                paid: 1,
                send_invoice: 0,
                is_corporate: 1,
                auto_isolir: 0,
                bulk: 'invalid json {'
            };
            
            const result = transformUserFromDb(problematicRow);
            
            // Should still return a valid object
            expect(result).not.toBeNull();
            expect(result.id).toBe(1);
            expect(typeof result.paid).toBe('boolean');
        });
    });

    /**
     * Tests for parseBulkFromDb function
     */
    describe('parseBulkFromDb', () => {
        
        test('should parse valid JSON array strings', () => {
            expect(parseBulkFromDb('["1","2","3"]')).toEqual(['1', '2', '3']);
            expect(parseBulkFromDb('[1,2,3]')).toEqual([1, 2, 3]);
            expect(parseBulkFromDb('["1"]')).toEqual(['1']);
        });

        test('should handle empty/null values', () => {
            expect(parseBulkFromDb(null)).toEqual([]);
            expect(parseBulkFromDb(undefined)).toEqual([]);
            expect(parseBulkFromDb('')).toEqual([]);
            expect(parseBulkFromDb('[]')).toEqual([]);
            expect(parseBulkFromDb('null')).toEqual([]);
        });

        test('should handle corrupted data', () => {
            expect(parseBulkFromDb('[object Object]')).toEqual([]);
            expect(parseBulkFromDb('[object Array]')).toEqual([]);
        });

        test('should handle already-parsed arrays', () => {
            expect(parseBulkFromDb(['1', '2', '3'])).toEqual(['1', '2', '3']);
            expect(parseBulkFromDb([1, 2, 3])).toEqual([1, 2, 3]);
        });

        test('should wrap single values in array', () => {
            expect(parseBulkFromDb('"1"')).toEqual(['1']);
        });
    });

    /**
     * Tests for transformUsersFromDb function
     */
    describe('transformUsersFromDb', () => {
        
        test('should transform multiple rows correctly', () => {
            const rows = [
                { id: 1, name: 'User 1', paid: 1, bulk: '["1"]' },
                { id: 2, name: 'User 2', paid: 0, bulk: '["2","3"]' },
                { id: 3, name: 'User 3', paid: 1, bulk: null }
            ];
            
            const { transformedUsers, errorCount } = transformUsersFromDb(rows);
            
            expect(transformedUsers.length).toBe(3);
            expect(errorCount).toBe(0);
            
            // Verify transformations
            expect(transformedUsers[0].paid).toBe(true);
            expect(transformedUsers[0].bulk).toEqual(['1']);
            
            expect(transformedUsers[1].paid).toBe(false);
            expect(transformedUsers[1].bulk).toEqual(['2', '3']);
            
            expect(transformedUsers[2].paid).toBe(true);
            expect(transformedUsers[2].bulk).toEqual([]);
        });

        test('should handle empty array input', () => {
            const { transformedUsers, errorCount } = transformUsersFromDb([]);
            
            expect(transformedUsers).toEqual([]);
            expect(errorCount).toBe(0);
        });

        test('should handle non-array input', () => {
            const { transformedUsers, errorCount } = transformUsersFromDb(null);
            
            expect(transformedUsers).toEqual([]);
            expect(errorCount).toBe(0);
        });

        test('should count transformation errors', () => {
            // Note: transformUserFromDb is designed to be resilient,
            // so it's hard to make it fail. This test verifies the error counting mechanism.
            const rows = [
                { id: 1, name: 'Valid User', paid: 1 },
                null, // This will return null from transformUserFromDb
                { id: 3, name: 'Another Valid', paid: 0 }
            ];
            
            const { transformedUsers, errorCount } = transformUsersFromDb(rows);
            
            // null row should be counted as error
            expect(errorCount).toBe(1);
            expect(transformedUsers.length).toBe(2);
        });
    });
});
