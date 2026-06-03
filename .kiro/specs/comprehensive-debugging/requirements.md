# Requirements Document

## Introduction

Dokumen ini mendefinisikan requirements untuk debugging menyeluruh pada project RAF Bot V2. Berdasarkan analisis kode, ditemukan beberapa area yang memerlukan perbaikan untuk meningkatkan stabilitas, keamanan, dan maintainability sistem.

## Glossary

- **RAF_Bot**: Sistem WhatsApp bot untuk manajemen pelanggan ISP
- **Saldo_Manager**: Modul yang mengelola saldo/balance pengguna
- **Agent_Voucher_Manager**: Modul yang mengelola inventori dan penjualan voucher oleh agent
- **Cron_Task**: Tugas terjadwal yang berjalan secara otomatis
- **Logger**: Modul untuk mencatat log aplikasi
- **Error_Handler**: Modul untuk menangani error secara terpusat
- **Database_Manager**: Modul yang mengelola koneksi dan operasi database SQLite/JSON

## Requirements

### Requirement 1: Error Logging Improvement

**User Story:** As a developer, I want error objects to be properly serialized in logs, so that I can debug issues effectively.

#### Acceptance Criteria

1. WHEN an error is logged using the Logger module, THE Logger SHALL serialize Error objects with message, stack, and custom properties
2. WHEN logging error objects that are empty or circular, THE Logger SHALL use util.inspect() as fallback
3. WHEN an error occurs in agent-voucher-manager, THE Agent_Voucher_Manager SHALL log the complete error details including stack trace

### Requirement 2: Database Connection Management

**User Story:** As a system administrator, I want database connections to be properly managed, so that the system doesn't experience SQLITE_BUSY errors.

#### Acceptance Criteria

1. THE Saldo_Manager SHALL use a singleton database connection pattern to prevent multiple connections
2. WHEN a database operation fails with SQLITE_BUSY, THE Database_Manager SHALL retry the operation with exponential backoff
3. WHEN the application shuts down, THE Database_Manager SHALL properly close all database connections
4. THE Database_Manager SHALL configure busy timeout for all SQLite connections

### Requirement 3: Memory Leak Prevention

**User Story:** As a system administrator, I want the application to manage memory efficiently, so that it doesn't crash due to memory exhaustion.

#### Acceptance Criteria

1. WHEN setInterval is used for cleanup tasks, THE System SHALL store interval references for proper cleanup on shutdown
2. WHEN the application receives SIGTERM or SIGINT, THE System SHALL clear all active intervals
3. THE System SHALL implement proper cleanup for message deduplication caches
4. WHEN file watchers are created, THE System SHALL track and cleanup watchers on shutdown

### Requirement 4: Input Validation Enhancement

**User Story:** As a developer, I want all user inputs to be properly validated, so that the system is protected from invalid data.

#### Acceptance Criteria

1. WHEN a user provides a phone number, THE System SHALL validate the format before processing
2. WHEN a user provides an amount for saldo operations, THE Saldo_Manager SHALL validate that amount is a positive number
3. WHEN a JID (WhatsApp ID) is provided, THE System SHALL normalize it to standard format before database operations
4. IF an invalid input is detected, THEN THE System SHALL return a descriptive error message

### Requirement 5: Test Infrastructure Setup

**User Story:** As a developer, I want a proper test infrastructure, so that I can write and run automated tests.

#### Acceptance Criteria

1. THE System SHALL have a test directory with proper Jest configuration
2. THE System SHALL have test database files separate from production
3. WHEN running tests, THE System SHALL use test environment configuration
4. THE System SHALL have at least one unit test for each core module

### Requirement 6: Cron Task Reliability

**User Story:** As a system administrator, I want cron tasks to be reliable and recoverable, so that scheduled operations don't fail silently.

#### Acceptance Criteria

1. WHEN a cron task fails, THE Cron_Task SHALL log the error and continue with next scheduled run
2. WHEN the application restarts, THE Cron_Task SHALL resume all scheduled tasks
3. THE Cron_Task SHALL validate cron expressions before scheduling
4. WHEN a cron task is disabled in config, THE System SHALL stop the task without errors

### Requirement 7: WhatsApp Connection Resilience

**User Story:** As a system administrator, I want WhatsApp connection to be resilient, so that the bot can recover from disconnections.

#### Acceptance Criteria

1. WHEN WhatsApp connection is lost, THE System SHALL attempt reconnection with exponential backoff
2. WHEN reconnection fails after maximum attempts, THE System SHALL send an alert notification
3. WHEN WhatsApp connection is restored, THE System SHALL resume message processing
4. THE System SHALL track connection state and expose it via API

### Requirement 8: JSON File Locking

**User Story:** As a developer, I want JSON file operations to be thread-safe, so that concurrent writes don't corrupt data.

#### Acceptance Criteria

1. WHEN writing to JSON files, THE Database_Manager SHALL acquire a file lock first
2. WHEN a file lock cannot be acquired, THE Database_Manager SHALL retry with backoff
3. WHEN a JSON file is corrupted, THE Database_Manager SHALL create a backup and initialize with empty state
4. THE Database_Manager SHALL release file locks in finally blocks to prevent deadlocks
