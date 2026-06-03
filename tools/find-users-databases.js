/**
 * Find Users in All Databases
 * Check all possible database locations for user data
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const rootDir = path.join(__dirname, '..');

console.log('=== FIND USERS IN ALL DATABASES ===\n');

// Check all possible database locations
const dbLocations = [
    { name: 'Main Database (database/)', path: path.join(rootDir, 'database', 'database.sqlite') },
    { name: 'Main Database (root)', path: path.join(rootDir, 'database.sqlite') },
    { name: 'PSB Database (database/)', path: path.join(rootDir, 'database', 'psb_database.sqlite') },
    { name: 'PSB Database (root)', path: path.join(rootDir, 'psb_database.sqlite') },
    { name: 'Test Database (database/)', path: path.join(rootDir, 'database', 'database_test.sqlite') },
    { name: 'Test Database (root)', path: path.join(rootDir, 'database_test.sqlite') },
];

// Also check backups
const backupsDir = path.join(rootDir, 'backups');
if (fs.existsSync(backupsDir)) {
    try {
        const backupFiles = fs.readdirSync(backupsDir).filter(f => 
            f.endsWith('.sqlite') || f.endsWith('.sqlite3') || f.endsWith('.db')
        );
        backupFiles.forEach((file, index) => {
            dbLocations.push({
                name: `Backup ${index + 1}: ${file}`,
                path: path.join(backupsDir, file)
            });
        });
    } catch (err) {
        console.warn('Could not read backups directory:', err.message);
    }
}

async function checkDatabase(dbInfo) {
    return new Promise((resolve) => {
        if (!fs.existsSync(dbInfo.path)) {
            resolve({ ...dbInfo, exists: false, users: 0, error: null });
            return;
        }

        const db = new sqlite3.Database(dbInfo.path, sqlite3.OPEN_READONLY, (err) => {
            if (err) {
                resolve({ ...dbInfo, exists: true, users: 0, error: err.message });
                return;
            }

            // Check if users table exists
            db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='users'", [], (err, row) => {
                if (err || !row) {
                    db.close();
                    resolve({ ...dbInfo, exists: true, hasUsersTable: false, users: 0, error: 'No users table' });
                    return;
                }

                // Count users
                db.get("SELECT COUNT(*) as count FROM users", [], (err, row) => {
                    const userCount = err ? 0 : (row ? row.count : 0);
                    
                    // Get sample data if any
                    let sample = null;
                    if (userCount > 0) {
                        db.all("SELECT id, name, phone_number, status, paid FROM users ORDER BY id LIMIT 3", [], (err, rows) => {
                            db.close();
                            resolve({
                                ...dbInfo,
                                exists: true,
                                hasUsersTable: true,
                                users: userCount,
                                sample: rows || [],
                                error: null
                            });
                        });
                    } else {
                        db.close();
                        resolve({
                            ...dbInfo,
                            exists: true,
                            hasUsersTable: true,
                            users: 0,
                            sample: [],
                            error: null
                        });
                    }
                });
            });
        });
    });
}

async function main() {
    console.log('Checking all database locations...\n');
    
    const results = [];
    for (const dbInfo of dbLocations) {
        const result = await checkDatabase(dbInfo);
        results.push(result);
    }

    console.log('📊 DATABASE SCAN RESULTS:');
    console.log('═'.repeat(80));
    
    let foundDatabases = 0;
    let totalUsers = 0;

    results.forEach((result, index) => {
        if (!result.exists) {
            console.log(`${index + 1}. ❌ ${result.name}`);
            console.log(`   Path: ${result.path}`);
            console.log(`   Status: File not found\n`);
            return;
        }

        foundDatabases++;
        console.log(`${index + 1}. ✅ ${result.name}`);
        console.log(`   Path: ${result.path}`);
        
        if (result.error) {
            console.log(`   Error: ${result.error}\n`);
            return;
        }

        if (!result.hasUsersTable) {
            console.log(`   Status: No users table\n`);
            return;
        }

        const status = result.users > 0 ? '✅' : '⚠️';
        console.log(`   Status: ${status} ${result.users} users found`);
        totalUsers += result.users;

        if (result.sample && result.sample.length > 0) {
            console.log(`   Sample users:`);
            result.sample.forEach(user => {
                const name = (user.name || 'N/A').substring(0, 20);
                const phone = user.phone_number || 'N/A';
                const status = user.status || 'N/A';
                console.log(`      - ID: ${user.id}, Name: ${name}, Phone: ${phone}, Status: ${status}`);
            });
        }
        console.log('');
    });

    console.log('═'.repeat(80));
    console.log(`Summary: ${foundDatabases} database(s) found, ${totalUsers} total users across all databases\n`);

    // Find databases with users
    const dbsWithUsers = results.filter(r => r.users > 0);
    if (dbsWithUsers.length > 0) {
        console.log('🔍 DATABASES WITH USERS:');
        console.log('─'.repeat(80));
        dbsWithUsers.forEach((db, index) => {
            console.log(`${index + 1}. ${db.name}`);
            console.log(`   Path: ${db.path}`);
            console.log(`   Users: ${db.users}\n`);
        });

        if (dbsWithUsers.length > 1) {
            console.log('⚠️  WARNING: Multiple databases contain users!');
            console.log('   You may need to consolidate data from these databases.\n');
        }
    } else {
        console.log('⚠️  WARNING: No users found in any database!');
        console.log('   If you expected to see users, check:');
        console.log('   1. Are you looking at the correct database file?');
        console.log('   2. Is the database path correct?');
        console.log('   3. Are users stored in a different location?\n');
    }
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});

