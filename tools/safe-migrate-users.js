/**
 * Safe User Migration Tool
 * Migrate users from old database to new database WITHOUT overwriting existing data
 * 
 * Features:
 * - Backup target database before migration
 * - Check for duplicates (by phone_number or id)
 * - Option to merge or skip duplicates
 * - Detailed migration report
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);

if (args.length < 1) {
    console.log('Usage: node tools/safe-migrate-users.js <source_database_path> [options]');
    console.log('');
    console.log('Options:');
    console.log('  --target <path>          Target database path (default: database/database.sqlite)');
    console.log('  --merge                  Merge duplicates (update existing users)');
    console.log('  --skip-duplicates        Skip duplicates (default: skip)');
    console.log('  --backup                 Create backup before migration (default: true)');
    console.log('  --dry-run                Show what would be migrated without actually migrating');
    console.log('');
    console.log('Examples:');
    console.log('  node tools/safe-migrate-users.js backups/database.backup.1762752373619.sqlite');
    console.log('  node tools/safe-migrate-users.js old-database.sqlite --merge');
    console.log('  node tools/safe-migrate-users.js backup.sqlite --dry-run');
    process.exit(1);
}

const sourceDbPath = args[0];
let targetDbPath = path.join(__dirname, '..', 'database', 'database.sqlite');
let mergeDuplicates = false;
let skipDuplicates = true;
let createBackup = true;
let dryRun = false;

// Parse arguments
for (let i = 1; i < args.length; i++) {
    if (args[i] === '--target' && args[i + 1]) {
        targetDbPath = path.resolve(args[i + 1]);
        i++;
    } else if (args[i] === '--merge') {
        mergeDuplicates = true;
        skipDuplicates = false;
    } else if (args[i] === '--skip-duplicates') {
        skipDuplicates = true;
        mergeDuplicates = false;
    } else if (args[i] === '--backup') {
        createBackup = true;
    } else if (args[i] === '--no-backup') {
        createBackup = false;
    } else if (args[i] === '--dry-run') {
        dryRun = true;
    }
}

console.log('=== SAFE USER MIGRATION TOOL ===\n');
console.log(`Source database: ${sourceDbPath}`);
console.log(`Target database: ${targetDbPath}`);
console.log(`Mode: ${dryRun ? 'DRY RUN (no changes will be made)' : 'LIVE MIGRATION'}`);
console.log(`Duplicate handling: ${mergeDuplicates ? 'MERGE (update existing)' : 'SKIP (ignore duplicates)'}`);
console.log(`Backup: ${createBackup ? 'YES' : 'NO'}\n`);

// Check if source database exists
if (!fs.existsSync(sourceDbPath)) {
    console.error(`ERROR: Source database not found: ${sourceDbPath}`);
    process.exit(1);
}

// Check if target database exists
if (!fs.existsSync(targetDbPath)) {
    console.warn(`WARNING: Target database not found: ${targetDbPath}`);
    console.log('Will create new database...\n');
}

function openDatabase(dbPath) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
            if (err) reject(err);
            else resolve(db);
        });
    });
}

function openWriteDatabase(dbPath) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath, (err) => {
            if (err) reject(err);
            else resolve(db);
        });
    });
}

function getAllUsers(db) {
    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM users ORDER BY id', [], (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

function checkUserExists(db, user, byPhone = true) {
    return new Promise((resolve, reject) => {
        if (byPhone && user.phone_number) {
            db.get('SELECT id, name, phone_number FROM users WHERE phone_number = ?', [user.phone_number], (err, row) => {
                if (err) reject(err);
                else resolve(row || null);
            });
        } else {
            db.get('SELECT id, name FROM users WHERE id = ?', [user.id], (err, row) => {
                if (err) reject(err);
                else resolve(row || null);
            });
        }
    });
}

async function createBackupFile(targetDbPath) {
    if (!fs.existsSync(targetDbPath)) {
        console.log('Target database does not exist, no backup needed.\n');
        return null;
    }

    const backupsDir = path.join(__dirname, '..', 'backups');
    if (!fs.existsSync(backupsDir)) {
        fs.mkdirSync(backupsDir, { recursive: true });
    }

    const timestamp = Date.now();
    const backupPath = path.join(backupsDir, `database_pre_migration_${timestamp}.sqlite`);
    
    console.log('Creating backup...');
    fs.copyFileSync(targetDbPath, backupPath);
    console.log(`Backup created: ${backupPath}\n`);
    
    return backupPath;
}

async function migrateUsers() {
    let sourceDb, targetDb;

    try {
        // Open databases
        console.log('Opening databases...');
        sourceDb = await openDatabase(sourceDbPath);
        
        if (!dryRun) {
            targetDb = await openWriteDatabase(targetDbPath);
        } else {
            targetDb = await openDatabase(targetDbPath);
        }
        console.log('Databases opened successfully.\n');

        // Create backup if needed
        let backupPath = null;
        if (createBackup && !dryRun) {
            backupPath = await createBackupFile(targetDbPath);
        }

        // Load users from source
        console.log('Loading users from source database...');
        const sourceUsers = await getAllUsers(sourceDb);
        console.log(`Found ${sourceUsers.length} users in source database.\n`);

        // Check existing users in target
        let targetUsers = [];
        let existingUserMap = new Map();
        
        if (fs.existsSync(targetDbPath)) {
            targetUsers = await getAllUsers(targetDb);
            console.log(`Found ${targetUsers.length} users in target database.\n`);
            
            // Build map of existing users by phone_number and id
            targetUsers.forEach(user => {
                if (user.phone_number) {
                    existingUserMap.set(user.phone_number, user);
                }
                existingUserMap.set(`id_${user.id}`, user);
            });
        }

        // Migration statistics
        const stats = {
            total: sourceUsers.length,
            skipped: 0,
            merged: 0,
            inserted: 0,
            errors: 0,
            duplicates: []
        };

        console.log('Starting migration...\n');

        if (dryRun) {
            console.log('=== DRY RUN MODE ===\n');
        }

        // Process each user
        for (const user of sourceUsers) {
            try {
                // Check if user exists
                const existingByPhone = user.phone_number ? existingUserMap.get(user.phone_number) : null;
                const existingById = existingUserMap.get(`id_${user.id}`);

                if (existingByPhone || existingById) {
                    const existing = existingByPhone || existingById;
                    stats.duplicates.push({
                        source: { id: user.id, name: user.name, phone: user.phone_number },
                        existing: { id: existing.id, name: existing.name, phone: existing.phone_number }
                    });

                    if (mergeDuplicates && !dryRun) {
                        // Update existing user
                        const updateFields = [];
                        const updateValues = [];
                        
                        // Update all fields except id
                        Object.keys(user).forEach(key => {
                            if (key !== 'id' && user[key] !== null && user[key] !== undefined) {
                                updateFields.push(`${key} = ?`);
                                updateValues.push(user[key]);
                            }
                        });
                        updateValues.push(existing.id);

                        const updateSql = `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`;
                        
                        await new Promise((resolve, reject) => {
                            targetDb.run(updateSql, updateValues, function(err) {
                                if (err) reject(err);
                                else {
                                    stats.merged++;
                                    resolve();
                                }
                            });
                        });

                        console.log(`✓ Merged: ${user.name} (ID: ${user.id} → ${existing.id})`);
                    } else {
                        stats.skipped++;
                        console.log(`⊘ Skipped (duplicate): ${user.name} (ID: ${user.id}, Phone: ${user.phone_number})`);
                    }
                } else {
                    // Insert new user
                    if (!dryRun) {
                        // Get all column names from source user
                        const columns = Object.keys(user).filter(key => user[key] !== null && user[key] !== undefined);
                        const values = columns.map(col => user[col]);
                        const placeholders = columns.map(() => '?').join(', ');
                        
                        const insertSql = `INSERT INTO users (${columns.join(', ')}) VALUES (${placeholders})`;
                        
                        await new Promise((resolve, reject) => {
                            targetDb.run(insertSql, values, function(err) {
                                if (err) {
                                    // If duplicate error, skip
                                    if (err.message.includes('UNIQUE') || err.message.includes('duplicate')) {
                                        stats.skipped++;
                                        console.log(`⊘ Skipped (constraint): ${user.name} (ID: ${user.id})`);
                                        resolve();
                                    } else {
                                        reject(err);
                                    }
                                } else {
                                    stats.inserted++;
                                    console.log(`+ Inserted: ${user.name} (ID: ${user.id})`);
                                    resolve();
                                }
                            });
                        });
                    } else {
                        stats.inserted++;
                        console.log(`+ Would insert: ${user.name} (ID: ${user.id}, Phone: ${user.phone_number})`);
                    }
                }
            } catch (err) {
                stats.errors++;
                console.error(`✗ Error migrating user ${user.id} (${user.name}):`, err.message);
            }
        }

        // Close databases
        sourceDb.close();
        if (!dryRun) {
            targetDb.close();
        }

        // Print summary
        console.log('\n' + '='.repeat(60));
        console.log('MIGRATION SUMMARY');
        console.log('='.repeat(60));
        console.log(`Total users in source: ${stats.total}`);
        console.log(`Inserted (new):       ${stats.inserted}`);
        console.log(`Merged (updated):     ${stats.merged}`);
        console.log(`Skipped (duplicates): ${stats.skipped}`);
        console.log(`Errors:               ${stats.errors}`);
        console.log('='.repeat(60));

        if (stats.duplicates.length > 0 && !mergeDuplicates) {
            console.log(`\n⚠️  Found ${stats.duplicates.length} duplicate(s). Use --merge to update them.`);
        }

        if (backupPath) {
            console.log(`\n✓ Backup saved: ${backupPath}`);
        }

        if (dryRun) {
            console.log('\n⚠️  DRY RUN MODE - No changes were made.');
            console.log('Run without --dry-run to perform actual migration.');
        } else {
            console.log('\n✅ Migration completed successfully!');
        }

    } catch (err) {
        console.error('\n❌ Migration failed:', err.message);
        if (sourceDb) sourceDb.close();
        if (targetDb) targetDb.close();
        process.exit(1);
    }
}

migrateUsers().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});

