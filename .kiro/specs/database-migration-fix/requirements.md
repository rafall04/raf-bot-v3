# Requirements Document

## Introduction

Perbaikan sistem migrasi database untuk memastikan semua field dari database lama (JSON atau SQLite) dapat dimigrasikan dengan benar ke database baru (users.sqlite). Sistem harus menangani perbedaan nama field, generate nilai default untuk field yang kosong, dan konversi format data yang berbeda.

## Glossary

- **Migration_System**: Sistem yang menangani proses migrasi data dari database lama ke database baru
- **Field_Mapper**: Komponen yang memetakan nama field lama ke nama field baru
- **Username_Generator**: Komponen yang menghasilkan username dari nama pelanggan
- **Password_Generator**: Komponen yang menghasilkan password acak
- **Bulk_Converter**: Komponen yang mengkonversi format bulk dari berbagai format ke format JSON array string
- **Old_Database**: Database sumber (JSON atau SQLite lama)
- **New_Database**: Database tujuan (users.sqlite dengan schema lengkap)

## Requirements

### Requirement 1: Field Mapping

**User Story:** As an admin, I want the migration system to automatically map old field names to new field names, so that data from old databases can be correctly migrated.

#### Acceptance Criteria

1. WHEN migrating data with field `phone`, THE Migration_System SHALL map it to `phone_number`
2. WHEN migrating data with field `package`, THE Migration_System SHALL map it to `subscription`
3. WHEN migrating data with field `odp_id`, THE Migration_System SHALL map it to `connected_odp_id`
4. WHEN migrating data with field `hp`, THE Migration_System SHALL map it to `phone_number`
5. WHEN migrating data with field `paket`, THE Migration_System SHALL map it to `subscription`
6. WHEN a field exists in both old and new names, THE Migration_System SHALL prioritize the new field name value

### Requirement 2: Username Generation

**User Story:** As an admin, I want the system to generate usernames for customers who don't have one, so that all migrated customers have valid login credentials.

#### Acceptance Criteria

1. WHEN a customer has no username, THE Username_Generator SHALL generate one from the customer name
2. THE Username_Generator SHALL convert the name to lowercase
3. THE Username_Generator SHALL remove all non-alphanumeric characters from the name
4. THE Username_Generator SHALL limit the base username to 10 characters
5. THE Username_Generator SHALL append a random 3-digit number to ensure uniqueness
6. WHEN the customer name is empty or null, THE Username_Generator SHALL use "user" as the base

### Requirement 3: Password Generation

**User Story:** As an admin, I want the system to generate passwords for customers who don't have one, so that all migrated customers have valid login credentials.

#### Acceptance Criteria

1. WHEN a customer has no password, THE Password_Generator SHALL generate a random 8-character password
2. THE Password_Generator SHALL include at least one lowercase letter
3. THE Password_Generator SHALL include at least one uppercase letter
4. THE Password_Generator SHALL include at least one digit
5. THE Password_Generator SHALL store the password as a bcrypt hash in the database

### Requirement 4: Bulk Format Conversion

**User Story:** As an admin, I want the system to convert various bulk formats to the standard format, so that SSID assignments are correctly migrated.

#### Acceptance Criteria

1. WHEN bulk is a comma-separated string like "1,2,3", THE Bulk_Converter SHALL convert it to `'["1","2","3"]'`
2. WHEN bulk is an array of numbers like [1,2], THE Bulk_Converter SHALL convert it to `'["1","2"]'`
3. WHEN bulk is an array of strings like ["1","2"], THE Bulk_Converter SHALL keep it as `'["1","2"]'`
4. WHEN bulk is empty, null, or undefined, THE Bulk_Converter SHALL default to `'["1"]'`
5. WHEN bulk is a single number like 1, THE Bulk_Converter SHALL convert it to `'["1"]'`
6. WHEN bulk is a single string like "1", THE Bulk_Converter SHALL convert it to `'["1"]'`

### Requirement 5: Complete Field Migration

**User Story:** As an admin, I want all customer fields to be migrated, so that no data is lost during migration.

#### Acceptance Criteria

1. THE Migration_System SHALL migrate all 40+ fields defined in the users table schema
2. WHEN a field is missing in the source data, THE Migration_System SHALL use the default value from the schema
3. THE Migration_System SHALL preserve existing values and not overwrite with defaults
4. THE Migration_System SHALL handle boolean fields (paid, send_invoice, is_corporate, auto_isolir) correctly
5. THE Migration_System SHALL handle integer fields (subscription_price, payment_due_date, compensation_minutes) correctly
6. THE Migration_System SHALL handle timestamp fields (created_at, updated_at, registration_date) correctly

### Requirement 6: Phone Number Handling

**User Story:** As an admin, I want the system to handle phone numbers correctly including empty values, so that public facilities without phone numbers can be migrated.

#### Acceptance Criteria

1. WHEN phone_number is empty or null, THE Migration_System SHALL allow NULL value in the database
2. WHEN phone_number contains multiple numbers separated by "|", THE Migration_System SHALL preserve the format
3. THE Migration_System SHALL NOT reject records with empty phone numbers

### Requirement 7: Migration Validation

**User Story:** As an admin, I want the system to validate migrated data, so that I can be confident the migration was successful.

#### Acceptance Criteria

1. WHEN migration completes, THE Migration_System SHALL report the total number of records processed
2. WHEN migration completes, THE Migration_System SHALL report the number of records successfully migrated
3. WHEN migration completes, THE Migration_System SHALL report the number of records that failed
4. WHEN a record fails to migrate, THE Migration_System SHALL log the reason for failure
5. THE Migration_System SHALL continue processing remaining records even if some fail

### Requirement 8: Duplicate Prevention

**User Story:** As an admin, I want the system to prevent duplicate records based on unique identifiers, so that existing customers are not overwritten while allowing shared phone numbers.

#### Acceptance Criteria

1. WHEN a customer with the same ID already exists, THE Migration_System SHALL skip that record
2. THE Migration_System SHALL allow multiple customers with the same phone_number (1 orang bisa punya beberapa langganan/rumah)
3. THE Migration_System SHALL report the number of skipped duplicates
4. WHEN checking for duplicates, THE Migration_System SHALL only use ID as the unique identifier
5. THE Migration_System SHALL NOT use phone_number as duplicate check criteria
