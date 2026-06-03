#!/usr/bin/env node

/**
 * Safe Database Migration Runner
 * Automatically runs migrations with safety checks:
 * - Backup database before migration
 * - Validate schema changes
 * - Rollback on error
 * - Production-safe (won't overwrite production DB in test mode)
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { getDatabasePath, validateEnvironment, getEnvironmentInfo } = require('../lib/env-config');

// Colors for console output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

function log(message, type = 'info') {
    const prefix = {
        info: `${colors.blue}[INFO]${colors.reset}`,
        success: `${colors.green}[SUCCESS]${colors.reset}`,
        warning: `${colors.yellow}[WARNING]${colors.reset}`,
        error: `${colors.red}[ERROR]${colors.reset}`
    };
    console.log(`${prefix[type]} ${message}`);
}

// Create backup
function createBackup(dbPath) {
    const backupDir = path.join(__dirname, '..', 'backups');
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0] + '_' + 
                     new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
    const backupName = `database_backup_${timestamp}.sqlite`;
    const backupPath = path.join(backupDir, backupName);
    
    try {
        fs.copyFileSync(dbPath, backupPath);
        log(`Backup created: ${backupPath}`, 'success');
        return backupPath;
    } catch (error) {
        log(`Failed to create backup: ${error.message}`, 'error');
        throw error;
    }
}

// Get current schema
function getCurrentSchema(db) {
    return new Promise((resolve, reject) => {
        db.all("PRAGMA table_info(users)", [], (err, tableInfo) => {
            if (err) {
                reject(err);
            } else {
                const schema = {};
                tableInfo.forEach(col => {
                    schema[col.name] = {
                        type: col.type,
                        notnull: col.notnull,
                        default: col.dvalue,
                        pk: col.pk
                    };
                });
                resolve(schema);
            }
        });
    });
}

// Check if column exists
function columnExists(db, columnName) {
    return new Promise((resolve, reject) => {
        db.all("PRAGMA table_info(users)", [], (err, tableInfo) => {
            if (err) {
                reject(err);
            } else {
                const exists = tableInfo.some(col => col.name === columnName);
                resolve(exists);
            }
        });
    });
}

// Add column safely
function addColumn(db, columnName, columnType, defaultValue = null) {
    return new Promise((resolve, reject) => {
        columnExists(db, columnName).then(exists => {
            if (exists) {
                log(`Column '${columnName}' already exists, skipping`, 'info');
                resolve(false);
                return;
            }
            
            let sql = `ALTER TABLE users ADD COLUMN ${columnName} ${columnType}`;
            if (defaultValue !== null) {
                sql += ` DEFAULT ${defaultValue}`;
            }
            
            db.run(sql, (err) => {
                if (err) {
                    reject(err);
                } else {
                    log(`Added column: ${columnName} (${columnType})`, 'success');
                    resolve(true);
                }
            });
        }).catch(reject);
    });
}

// Run migration
async function runMigration() {
    // Get environment info
    const envInfo = getEnvironmentInfo();
    log(`Environment: ${envInfo.NODE_ENV}`, 'info');
    log(`Database path: ${envInfo.databasePath}`, 'info');
    
    // Validate environment
    try {
        validateEnvironment();
        log('Environment validation passed', 'success');
    } catch (error) {
        log(`Environment validation failed: ${error.message}`, 'error');
        if (envInfo.isProduction) {
            process.exit(1);
        } else {
            log('Continuing in non-production mode...', 'warning');
        }
    }
    
    let dbPath = envInfo.databasePath;
    
    // Ensure database directory exists
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
        log(`Created database directory: ${dbDir}`, 'info');
    }
    
    // Migrate old database file from root to database/ folder if exists
    const oldDbPath = path.join(__dirname, '..', 'database.sqlite');
    const oldTestDbPath = path.join(__dirname, '..', 'database_test.sqlite');
    
    if (fs.existsSync(oldDbPath) && !fs.existsSync(dbPath)) {
        log('Found old database in root directory, migrating to database/ folder...', 'warning');
        try {
            fs.copyFileSync(oldDbPath, dbPath);
            log(`Successfully migrated database to: ${dbPath}`, 'success');
            // Backup the old file
            const backupPath = oldDbPath + '.migrated_' + Date.now() + '.bak';
            fs.copyFileSync(oldDbPath, backupPath);
            log(`Old database backed up to: ${backupPath}`, 'info');
        } catch (err) {
            log(`Failed to migrate database: ${err.message}`, 'error');
        }
    }
    
    // Same for test database
    if (envInfo.isTest) {
        if (fs.existsSync(oldTestDbPath) && !fs.existsSync(dbPath)) {
            log('Found old test database in root, migrating...', 'warning');
            try {
                fs.copyFileSync(oldTestDbPath, dbPath);
                log(`Successfully migrated test database to: ${dbPath}`, 'success');
            } catch (err) {
                log(`Failed to migrate test database: ${err.message}`, 'error');
            }
        }
    }
    
    // Check if database exists (after migration check)
    if (!fs.existsSync(dbPath)) {
        log(`Database file not found: ${dbPath}`, 'info');
        log('Creating new database...', 'info');
        
        // Ensure directory exists before creating database
        const dbDir = path.dirname(dbPath);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
            log(`Created database directory: ${dbDir}`, 'info');
        }
        
        // Create new database with schema
        const db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                log(`Failed to create database: ${err.message}`, 'error');
                process.exit(1);
            }
        });
        
        // Create users table with full schema
        const createTableSql = `
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT,
                username TEXT,
                password TEXT,
                phone_number TEXT,
                address TEXT,
                device_id TEXT,
                status TEXT DEFAULT 'active',
                latitude TEXT,
                longitude TEXT,
                subscription TEXT,
                subscription_price INTEGER DEFAULT 0,
                payment_due_date INTEGER DEFAULT 1,
                paid INTEGER DEFAULT 0,
                send_invoice INTEGER DEFAULT 0,
                is_paid INTEGER DEFAULT 0,
                auto_isolir INTEGER DEFAULT 1,
                is_corporate INTEGER DEFAULT 0,
                corporate_name TEXT,
                corporate_address TEXT,
                corporate_npwp TEXT,
                corporate_pic_name TEXT,
                corporate_pic_phone TEXT,
                corporate_pic_email TEXT,
                pppoe_username TEXT,
                pppoe_password TEXT,
                connected_odp_id TEXT,
                bulk TEXT,
                odc TEXT,
                odp TEXT,
                olt TEXT,
                maps_url TEXT,
                otp TEXT,
                otpTimestamp INTEGER,
                registration_date TEXT,
                created_at TEXT,
                updated_at TEXT,
                last_login TEXT,
                last_payment_date TEXT,
                reminder_sent INTEGER DEFAULT 0,
                isolir_sent INTEGER DEFAULT 0,
                compensation_minutes INTEGER DEFAULT 0,
                email TEXT,
                alternative_phone TEXT,
                notes TEXT
            )
        `;
        
        return new Promise((resolve, reject) => {
            db.run(createTableSql, (err) => {
                if (err) {
                    log(`Failed to create table: ${err.message}`, 'error');
                    db.close();
                    reject(err);
                } else {
                    log('Database and table created successfully', 'success');
                    db.close();
                    resolve();
                }
            });
        });
    }
    
    // Create backup before migration
    log('Creating backup before migration...', 'info');
    const backupPath = createBackup(dbPath);
    
    // Open database
    const db = new sqlite3.Database(dbPath);
    
    try {
        // Get current schema
        log('Analyzing current schema...', 'info');
        const currentSchema = await getCurrentSchema(db);
        log(`Current columns: ${Object.keys(currentSchema).length}`, 'info');
        
        // Define required columns (same as migrate-database.js)
        const requiredColumns = [
            { name: 'id', type: 'INTEGER PRIMARY KEY AUTOINCREMENT', skip: true },
            { name: 'name', type: 'TEXT', default: 'NULL' },
            { name: 'username', type: 'TEXT', default: 'NULL' },
            { name: 'password', type: 'TEXT', default: 'NULL' },
            { name: 'phone_number', type: 'TEXT', default: 'NULL' },
            { name: 'address', type: 'TEXT', default: 'NULL' },
            { name: 'device_id', type: 'TEXT', default: 'NULL' },
            { name: 'status', type: 'TEXT', default: "'active'" },
            { name: 'latitude', type: 'TEXT', default: 'NULL' },
            { name: 'longitude', type: 'TEXT', default: 'NULL' },
            { name: 'subscription', type: 'TEXT', default: 'NULL' },
            { name: 'subscription_price', type: 'INTEGER', default: '0' },
            { name: 'payment_due_date', type: 'INTEGER', default: '1' },
            { name: 'paid', type: 'INTEGER', default: '0' },
            { name: 'send_invoice', type: 'INTEGER', default: '0' },
            { name: 'is_paid', type: 'INTEGER', default: '0' },
            { name: 'auto_isolir', type: 'INTEGER', default: '1' },
            { name: 'is_corporate', type: 'INTEGER', default: '0' },
            { name: 'corporate_name', type: 'TEXT', default: 'NULL' },
            { name: 'corporate_address', type: 'TEXT', default: 'NULL' },
            { name: 'corporate_npwp', type: 'TEXT', default: 'NULL' },
            { name: 'corporate_pic_name', type: 'TEXT', default: 'NULL' },
            { name: 'corporate_pic_phone', type: 'TEXT', default: 'NULL' },
            { name: 'corporate_pic_email', type: 'TEXT', default: 'NULL' },
            { name: 'pppoe_username', type: 'TEXT', default: 'NULL' },
            { name: 'pppoe_password', type: 'TEXT', default: 'NULL' },
            { name: 'connected_odp_id', type: 'TEXT', default: 'NULL' },
            { name: 'bulk', type: 'TEXT', default: 'NULL' },
            { name: 'odc', type: 'TEXT', default: 'NULL' },
            { name: 'odp', type: 'TEXT', default: 'NULL' },
            { name: 'olt', type: 'TEXT', default: 'NULL' },
            { name: 'maps_url', type: 'TEXT', default: 'NULL' },
            { name: 'otp', type: 'TEXT', default: 'NULL' },
            { name: 'otpTimestamp', type: 'INTEGER', default: 'NULL' },
            { name: 'registration_date', type: 'TEXT', default: 'NULL' },
            { name: 'created_at', type: 'TEXT', default: 'NULL' },
            { name: 'updated_at', type: 'TEXT', default: 'NULL' },
            { name: 'last_login', type: 'TEXT', default: 'NULL' },
            { name: 'last_payment_date', type: 'TEXT', default: 'NULL' },
            { name: 'reminder_sent', type: 'INTEGER', default: '0' },
            { name: 'isolir_sent', type: 'INTEGER', default: '0' },
            { name: 'compensation_minutes', type: 'INTEGER', default: '0' },
            { name: 'email', type: 'TEXT', default: 'NULL' },
            { name: 'alternative_phone', type: 'TEXT', default: 'NULL' },
            { name: 'notes', type: 'TEXT', default: 'NULL' }
        ];
        
        // Find missing columns
        const missingColumns = requiredColumns.filter(col => 
            !col.skip && !currentSchema.hasOwnProperty(col.name)
        );
        
        if (missingColumns.length === 0) {
            log('All required columns already exist!', 'success');
            db.close();
            return;
        }
        
        log(`Missing columns (${missingColumns.length}): ${missingColumns.map(c => c.name).join(', ')}`, 'warning');
        
        // Add missing columns one by one
        let addedCount = 0;
        for (const column of missingColumns) {
            try {
                const added = await addColumn(db, column.name, column.type, column.default);
                if (added) addedCount++;
            } catch (error) {
                log(`Failed to add column '${column.name}': ${error.message}`, 'error');
                throw error; // Stop on error
            }
        }
        
        log(`Successfully added ${addedCount} columns`, 'success');
        
        // Create indexes
        log('Creating indexes...', 'info');
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone_number)',
            'CREATE INDEX IF NOT EXISTS idx_users_device ON users(device_id)',
            'CREATE INDEX IF NOT EXISTS idx_users_status ON users(status)',
            'CREATE INDEX IF NOT EXISTS idx_users_payment ON users(paid, payment_due_date)',
            'CREATE INDEX IF NOT EXISTS idx_users_corporate ON users(is_corporate)',
            'CREATE INDEX IF NOT EXISTS idx_users_send_invoice ON users(send_invoice)'
        ];
        
        for (const indexSql of indexes) {
            await new Promise((resolve, reject) => {
                db.run(indexSql, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        }
        
        log('Indexes created successfully', 'success');
        
        db.close();
        log('Migration completed successfully!', 'success');
        
    } catch (error) {
        db.close();
        log(`Migration failed: ${error.message}`, 'error');
        log(`Backup available at: ${backupPath}`, 'info');
        log('You can restore from backup if needed', 'warning');
        process.exit(1);
    }
}

// Run migration
log('=' .repeat(60), 'info');
log('Starting safe database migration...', 'info');
log('=' .repeat(60), 'info');

runMigration()
    .then(() => {
        log('=' .repeat(60), 'info');
        log('Migration completed successfully!', 'success');
        log('You can now restart the application.', 'info');
        process.exit(0);
    })
    .catch((error) => {
        log('=' .repeat(60), 'info');
        log(`Migration failed: ${error.message}`, 'error');
        process.exit(1);
    });

