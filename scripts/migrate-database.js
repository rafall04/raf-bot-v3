#!/usr/bin/env node

/**
 * Database Migration Runner - Comprehensive version
 * Ensures ALL required fields are added to SQLite database
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Colors for console output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
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

async function runMigration() {
    // All databases stored in database/ folder
    const dbDir = path.join(__dirname, '..', 'database');
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }
    
    // Try users.sqlite first (new format), fallback to database.sqlite (old format)
    let dbPath = path.join(dbDir, 'users.sqlite');
    if (!fs.existsSync(dbPath)) {
        dbPath = path.join(dbDir, 'database.sqlite');
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupPath = path.join(__dirname, '..', 'backups', `users_backup_${timestamp}.sqlite`);
    
    // Ensure backups directory exists
    const backupsDir = path.join(__dirname, '..', 'backups');
    if (!fs.existsSync(backupsDir)) {
        fs.mkdirSync(backupsDir, { recursive: true });
    }

    log(`Database path: ${dbPath}`);

    // Check if database exists
    if (!fs.existsSync(dbPath)) {
        log('Database file not found!', 'error');
        process.exit(1);
    }

    // Create backup
    log('Creating backup...', 'info');
    try {
        fs.copyFileSync(dbPath, backupPath);
        log(`Backup created: ${backupPath}`, 'success');
    } catch (error) {
        log(`Failed to create backup: ${error.message}`, 'error');
        process.exit(1);
    }

    const db = new sqlite3.Database(dbPath);

    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // Get current schema
            db.all("PRAGMA table_info(users)", [], (err, tableInfo) => {
                if (err) {
                    log(`Failed to get table info: ${err.message}`, 'error');
                    db.close();
                    reject(err);
                    return;
                }

                const existingColumns = tableInfo.map(col => col.name);
                log(`Current columns (${existingColumns.length}): ${existingColumns.join(', ')}`, 'info');

                // Complete list of required fields
                const requiredFields = [
                    // Basic user info
                    { name: 'id', type: 'INTEGER PRIMARY KEY AUTOINCREMENT', skip: true }, // Don't alter primary key
                    { name: 'name', type: 'TEXT', default: "NULL" },
                    { name: 'username', type: 'TEXT', default: "NULL" },
                    { name: 'password', type: 'TEXT', default: "NULL" },
                    { name: 'phone_number', type: 'TEXT', default: "NULL" },
                    { name: 'address', type: 'TEXT', default: "NULL" },
                    { name: 'device_id', type: 'TEXT', default: "NULL" },
                    { name: 'status', type: 'TEXT', default: "'active'" },
                    
                    // Location
                    { name: 'latitude', type: 'TEXT', default: "NULL" },
                    { name: 'longitude', type: 'TEXT', default: "NULL" },
                    
                    // Subscription & billing
                    { name: 'subscription', type: 'TEXT', default: "NULL" },
                    { name: 'subscription_price', type: 'INTEGER', default: "0" },
                    { name: 'payment_due_date', type: 'INTEGER', default: "1" },
                    { name: 'paid', type: 'INTEGER', default: "0" },
                    { name: 'send_invoice', type: 'INTEGER', default: "0" }, // CRITICAL FIELD
                    { name: 'is_paid', type: 'INTEGER', default: "0" },
                    { name: 'auto_isolir', type: 'INTEGER', default: "1" },
                    
                    // Corporate fields
                    { name: 'is_corporate', type: 'INTEGER', default: "0" },
                    { name: 'corporate_name', type: 'TEXT', default: "NULL" },
                    { name: 'corporate_address', type: 'TEXT', default: "NULL" },
                    { name: 'corporate_npwp', type: 'TEXT', default: "NULL" },
                    { name: 'corporate_pic_name', type: 'TEXT', default: "NULL" },
                    { name: 'corporate_pic_phone', type: 'TEXT', default: "NULL" },
                    { name: 'corporate_pic_email', type: 'TEXT', default: "NULL" },
                    
                    // PPPoE & network
                    { name: 'pppoe_username', type: 'TEXT', default: "NULL" },
                    { name: 'pppoe_password', type: 'TEXT', default: "NULL" },
                    { name: 'connected_odp_id', type: 'TEXT', default: "NULL" },
                    { name: 'bulk', type: 'TEXT', default: "NULL" },
                    
                    // Infrastructure
                    { name: 'odc', type: 'TEXT', default: "NULL" },
                    { name: 'odp', type: 'TEXT', default: "NULL" },
                    { name: 'olt', type: 'TEXT', default: "NULL" },
                    { name: 'maps_url', type: 'TEXT', default: "NULL" },
                    
                    // OTP
                    { name: 'otp', type: 'TEXT', default: "NULL" },
                    { name: 'otpTimestamp', type: 'INTEGER', default: "NULL" },
                    
                    // Timestamps
                    { name: 'registration_date', type: 'TEXT', default: "NULL" },
                    { name: 'created_at', type: 'TEXT', default: "NULL" },
                    { name: 'updated_at', type: 'TEXT', default: "NULL" },
                    { name: 'last_login', type: 'TEXT', default: "NULL" },
                    { name: 'last_payment_date', type: 'TEXT', default: "NULL" },
                    
                    // Notifications
                    { name: 'reminder_sent', type: 'INTEGER', default: "0" },
                    { name: 'isolir_sent', type: 'INTEGER', default: "0" },
                    
                    // Additional
                    { name: 'compensation_minutes', type: 'INTEGER', default: "0" },
                    { name: 'email', type: 'TEXT', default: "NULL" },
                    { name: 'alternative_phone', type: 'TEXT', default: "NULL" },
                    { name: 'notes', type: 'TEXT', default: "NULL" }
                ];

                const missingFields = [];
                const fieldsToAdd = [];

                // Check which fields are missing
                for (const field of requiredFields) {
                    if (field.skip) continue;
                    if (!existingColumns.includes(field.name)) {
                        missingFields.push(field.name);
                        fieldsToAdd.push(field);
                    }
                }

                if (missingFields.length === 0) {
                    log('All required fields already exist!', 'success');
                    db.close();
                    resolve();
                    return;
                }

                log(`Missing fields (${missingFields.length}): ${colors.yellow}${missingFields.join(', ')}${colors.reset}`, 'warning');
                log('Adding missing fields...', 'info');

                let addedCount = 0;
                let errorCount = 0;

                // Add each missing field
                const addField = (index) => {
                    if (index >= fieldsToAdd.length) {
                        // All fields processed
                        if (errorCount > 0) {
                            log(`Migration completed with ${errorCount} errors`, 'warning');
                        } else {
                            log(`Successfully added ${addedCount} new fields!`, 'success');
                        }
                        
                        // Create indexes
                        log('Creating indexes for better performance...', 'info');
                        const indexes = [
                            'CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone_number)',
                            'CREATE INDEX IF NOT EXISTS idx_users_device ON users(device_id)',
                            'CREATE INDEX IF NOT EXISTS idx_users_status ON users(status)',
                            'CREATE INDEX IF NOT EXISTS idx_users_payment ON users(paid, payment_due_date)',
                            'CREATE INDEX IF NOT EXISTS idx_users_corporate ON users(is_corporate)',
                            'CREATE INDEX IF NOT EXISTS idx_users_send_invoice ON users(send_invoice)'
                        ];

                        let indexCount = 0;
                        const createIndex = (idx) => {
                            if (idx >= indexes.length) {
                                log(`Created ${indexCount} indexes`, 'success');
                                db.close();
                                resolve();
                                return;
                            }

                            db.run(indexes[idx], (err) => {
                                if (!err) {
                                    indexCount++;
                                }
                                createIndex(idx + 1);
                            });
                        };
                        createIndex(0);
                        return;
                    }

                    const field = fieldsToAdd[index];
                    const sql = `ALTER TABLE users ADD COLUMN ${field.name} ${field.type} DEFAULT ${field.default}`;
                    
                    db.run(sql, (err) => {
                        if (err) {
                            log(`Failed to add ${field.name}: ${err.message}`, 'error');
                            errorCount++;
                        } else {
                            log(`Added field: ${colors.green}${field.name}${colors.reset}`, 'success');
                            addedCount++;
                            
                            // Set current timestamp for date fields
                            if (field.name === 'created_at' || field.name === 'updated_at') {
                                const updateSql = `UPDATE users SET ${field.name} = datetime('now') WHERE ${field.name} IS NULL`;
                                db.run(updateSql, (updateErr) => {
                                    if (!updateErr) {
                                        log(`  Set default timestamp for ${field.name}`, 'info');
                                    }
                                });
                            }
                        }
                        addField(index + 1);
                    });
                };

                addField(0);
            });
        });
    });
}

// Check if we have required dependencies
try {
    require('sqlite3');
} catch (error) {
    log('sqlite3 module not found. Please run: npm install sqlite3', 'error');
    process.exit(1);
}

// Run migration
log('Starting database migration...', 'info');
log('=' .repeat(50), 'info');

runMigration()
    .then(() => {
        log('=' .repeat(50), 'info');
        log('Migration completed successfully!', 'success');
        log('You can now restart the application.', 'info');
        process.exit(0);
    })
    .catch((error) => {
        log('=' .repeat(50), 'info');
        log(`Migration failed: ${error.message}`, 'error');
        log('Please restore from backup if needed.', 'warning');
        process.exit(1);
    });
