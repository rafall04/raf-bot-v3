# Implementation Plan: Database Migration Fix

## Overview

Implementasi perbaikan sistem migrasi database dengan menambahkan module migration-helper.js dan update endpoint migrasi JSON di routes/admin.js.

## Tasks

- [x] 1. Create Migration Helper Module
  - [x] 1.1 Create `lib/migration-helper.js` with field mapping constants
    - Define FIELD_MAPPING object for old→new field names
    - Define USER_SCHEMA with all 40+ fields and defaults
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [x] 1.2 Implement `mapFields()` function
    - Map old field names to new field names
    - Handle priority when both old and new names exist
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [x] 1.3 Implement `generateUsername()` function
    - Convert name to lowercase
    - Remove non-alphanumeric characters
    - Limit to 10 characters
    - Append random 3-digit suffix
    - Handle empty/null names with "user" base
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 1.4 Implement `generatePassword()` and `hashPasswordAsync()` functions
    - Generate 8-character password with lowercase, uppercase, and digit
    - Hash with bcrypt
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 1.5 Implement `convertBulkFormat()` function
    - Handle comma-separated strings
    - Handle array of numbers
    - Handle array of strings
    - Handle single values
    - Default to '["1"]' for empty/null/undefined
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 1.6 Implement `prepareUserData()` function
    - Combine all transformations
    - Apply field mapping
    - Generate username/password if missing
    - Convert bulk format
    - Apply default values for missing fields
    - Handle boolean and integer type conversions
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 1.7 Write property tests for migration-helper functions
    - **Property 1: Field Mapping Correctness**
    - **Property 2: Username Generation Format**
    - **Property 3: Password Generation Complexity**
    - **Property 4: Bulk Format Conversion**
    - **Validates: Requirements 1.1-1.6, 2.1-2.6, 3.1-3.5, 4.1-4.6**

- [x] 2. Update JSON Migration Endpoint
  - [x] 2.1 Update INSERT statement in `/api/migrate/users` endpoint
    - Expand from 10 fields to all 40+ fields
    - Use prepareUserData() for each record
    - _Requirements: 5.1_

  - [x] 2.2 Update duplicate checking logic
    - Check only by ID, not phone_number
    - Allow multiple records with same phone_number
    - _Requirements: 8.1, 8.2, 8.4, 8.5_

  - [x] 2.3 Update phone number handling
    - Allow NULL phone_number values
    - Preserve pipe-separated format
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 2.4 Update migration result reporting
    - Report total, success, failed, skipped counts
    - Log detailed errors for failed records
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x] 2.5 Ensure migration continues on individual record failures
    - Wrap each record insert in try-catch
    - Continue processing remaining records
    - _Requirements: 7.5_

  - [x] 2.6 Write property tests for migration endpoint
    - **Property 5: Type Handling Correctness**
    - **Property 6: Phone Number Handling**
    - **Property 7: Duplicate Check by ID Only**
    - **Property 8: Migration Resilience**
    - **Validates: Requirements 5.4-5.6, 6.1-6.3, 7.5, 8.1-8.5**

- [x] 3. Checkpoint - Verify Migration Helper
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Update Data Reload Function
  - [x] 4.1 Update user reload in migration endpoint
    - Transform boolean fields correctly (paid, send_invoice, is_corporate)
    - Parse bulk JSON correctly
    - Handle all new fields
    - _Requirements: 5.4_

- [ ] 5. Final Checkpoint
  - Ensure all tests pass, ask the user if questions arise.
  - Test full migration flow with sample JSON file

## Notes

- All tasks are required for comprehensive implementation
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
