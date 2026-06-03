/**
 * Migration Script: database.sqlite -> users.sqlite
 * 
 * This script migrates the main database from database.sqlite to users.sqlite
 * to separate customer data from log data.
 * 
 * Steps:
 * 1. Backup old database.sqlite
 * 2. Copy database.sqlite to users.sqlite
 * 3. Remove login_logs and activity_logs tables from users.sqlite (they're in activity_logs.sqlite)
 * 4. Remove sqlite_sequence entries for log tables
 * 5. Run VACUUM to optimize
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const { getDatabasePath } = require('../lib/env-config');

const dbDir = path.join(__dirname, '..', 'database');
const oldDbPath = path.join(dbDir, 'database.sqlite');
const newDbPath = path.join(dbDir, 'users.sqlite');
const backupDir = path.join(__dirname, '..', 'backups');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
const backupPath = path.join(backupDir, `database.backup.${timestamp}.sqlite`);

console.log('=== MIGRATION: database.sqlite -> users.sqlite ===');
console.log('');

// Ensure backup directory exists
if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
    console.log(`📁 Created backup directory: ${backupDir}`);
}

// Check if old database exists
if (!fs.existsSync(oldDbPath)) {
    console.log('✅ Old database.sqlite not found. Migration not needed.');
    console.log('');
    
    // Check if new database already exists
    if (fs.existsSync(newDbPath)) {
        console.log('✅ users.sqlite already exists. Migration already completed.');
        process.exit(0);
    } else {
        console.log('ℹ️  No existing database found. System will create users.sqlite on first run.');
        process.exit(0);
    }
}

// Check if new database already exists
if (fs.existsSync(newDbPath)) {
    console.log('⚠️  users.sqlite already exists!');
    console.log('   If you want to re-migrate, please delete users.sqlite first.');
    console.log('');
    process.exit(1);
}

console.log('📋 Migration Steps:');
console.log('  1. Backup old database.sqlite');
console.log('  2. Copy database.sqlite to users.sqlite');
console.log('  3. Remove login_logs and activity_logs tables from users.sqlite');
console.log('  4. Clean up sqlite_sequence');
console.log('  5. Run VACUUM to optimize');
console.log('');

// Step 1: Backup
console.log('📦 Step 1: Creating backup...');
try {
    fs.copyFileSync(oldDbPath, backupPath);
    console.log(`✅ Backup created: ${backupPath}`);
} catch (err) {
    console.error('❌ Failed to create backup:', err.message);
    process.exit(1);
}

// Step 2: Copy to new database
console.log('');
console.log('📋 Step 2: Copying database...');
try {
    fs.copyFileSync(oldDbPath, newDbPath);
    console.log(`✅ Database copied: ${oldDbPath} -> ${newDbPath}`);
} catch (err) {
    console.error('❌ Failed to copy database:', err.message);
    process.exit(1);
}

// Step 3-5: Open new database and clean up
const newDb = new sqlite3.Database(newDbPath, (err) => {
    if (err) {
        console.error('❌ Error opening new database:', err.message);
        process.exit(1);
    }
    
    console.log('');
    console.log('✅ Connected to new database');
    console.log('');
    
    // Step 3: Remove log tables (they're in activity_logs.sqlite)
    console.log('📋 Step 3: Removing log tables from users.sqlite...');
    
    newDb.serialize(() => {
        // Drop login_logs table if exists
        newDb.run('DROP TABLE IF EXISTS login_logs', (err) => {
            if (err) {
                console.warn('⚠️  Warning: Could not drop login_logs table:', err.message);
            } else {
                console.log('✅ Dropped login_logs table');
            }
        });
        
        // Drop activity_logs table if exists
        newDb.run('DROP TABLE IF EXISTS activity_logs', (err) => {
            if (err) {
                console.warn('⚠️  Warning: Could not drop activity_logs table:', err.message);
            } else {
                console.log('✅ Dropped activity_logs table');
            }
        });
        
        // Drop indexes for log tables
        const logIndexes = [
            'idx_login_logs_user_id',
            'idx_login_logs_username',
            'idx_login_logs_login_time',
            'idx_login_logs_action_type',
            'idx_login_logs_ip',
            'idx_activity_logs_user_id',
            'idx_activity_logs_action_type',
            'idx_activity_logs_resource_type',
            'idx_activity_logs_timestamp'
        ];
        
        let droppedIndexes = 0;
        logIndexes.forEach((indexName, idx) => {
            newDb.run(`DROP INDEX IF EXISTS ${indexName}`, (err) => {
                if (!err) droppedIndexes++;
                if (idx === logIndexes.length - 1) {
                    console.log(`✅ Dropped ${droppedIndexes} log-related indexes`);
                }
            });
        });
        
        // Step 4: Clean up sqlite_sequence
        console.log('');
        console.log('📋 Step 4: Cleaning up sqlite_sequence...');
        newDb.run("DELETE FROM sqlite_sequence WHERE name IN ('login_logs', 'activity_logs')", (err) => {
            if (err) {
                console.warn('⚠️  Warning: Could not clean sqlite_sequence:', err.message);
            } else {
                console.log('✅ Cleaned sqlite_sequence');
            }
        });
        
        // Step 5: Run VACUUM
        console.log('');
        console.log('📋 Step 5: Running VACUUM...');
        newDb.run('VACUUM', (err) => {
            if (err) {
                console.error('❌ Error running VACUUM:', err.message);
            } else {
                console.log('✅ VACUUM completed');
            }
            
            // Verify migration
            console.log('');
            console.log('📋 Verification:');
            newDb.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name", [], (err, tables) => {
                if (err) {
                    console.error('❌ Error verifying tables:', err.message);
                } else {
                    console.log('✅ Tables in users.sqlite:');
                    tables.forEach(table => {
                        console.log(`   - ${table.name}`);
                    });
                    
                    // Check for users table
                    const hasUsers = tables.some(t => t.name === 'users');
                    if (hasUsers) {
                        newDb.get("SELECT COUNT(*) as count FROM users", [], (err, row) => {
                            if (!err && row) {
                                console.log(`✅ Users table: ${row.count} rows`);
                            }
                            
                            newDb.close();
                            
                            console.log('');
                            console.log('═══════════════════════════════════════════════════════');
                            console.log('✅ MIGRATION COMPLETE!');
                            console.log('');
                            console.log('📁 Files:');
                            console.log(`  Old: ${oldDbPath} (backed up)`);
                            console.log(`  New: ${newDbPath}`);
                            console.log(`  Backup: ${backupPath}`);
                            console.log('');
                            console.log('⚠️  IMPORTANT:');
                            console.log('  1. Test your application with users.sqlite');
                            console.log('  2. Once verified, you can delete database.sqlite');
                            console.log('  3. Log tables (login_logs, activity_logs) are now in activity_logs.sqlite');
                            console.log('');
                            process.exit(0);
                        });
                    } else {
                        console.error('❌ Users table not found! Migration may have failed.');
                        newDb.close();
                        process.exit(1);
                    }
                }
            });
        });
    });
});

