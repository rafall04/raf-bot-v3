/**
 * Database Inspector Tool
 * Inspect database structure and data to diagnose issues
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Database path
const dbPath = path.join(__dirname, '..', 'database', 'database.sqlite');

console.log('=== DATABASE INSPECTOR ===\n');
console.log(`Database path: ${dbPath}`);
console.log(`Database exists: ${fs.existsSync(dbPath)}\n`);

if (!fs.existsSync(dbPath)) {
    console.error('ERROR: Database file not found!');
    process.exit(1);
}

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    }

    console.log('✅ Connected to database\n');

    // Get all tables
    db.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name", [], (err, tables) => {
        if (err) {
            console.error('Error getting tables:', err.message);
            db.close();
            return;
        }

        console.log('📊 TABLES FOUND:');
        console.log('─'.repeat(50));
        tables.forEach((table, index) => {
            console.log(`${index + 1}. ${table.name}`);
        });
        console.log(`\nTotal tables: ${tables.length}\n`);

        // Check users table structure
        db.all("PRAGMA table_info(users)", [], (err, columns) => {
            if (err) {
                console.error('Error getting users table info:', err.message);
                db.close();
                return;
            }

            console.log('📋 USERS TABLE STRUCTURE:');
            console.log('─'.repeat(50));
            columns.forEach((col, index) => {
                const nullable = col.notnull === 0 ? 'NULL' : 'NOT NULL';
                const defaultVal = col.dflt_value ? ` DEFAULT ${col.dflt_value}` : '';
                console.log(`${index + 1}. ${col.name.padEnd(20)} ${col.type.padEnd(15)} ${nullable}${defaultVal}`);
            });
            console.log(`\nTotal columns: ${columns.length}\n`);

            // Count users
            db.get("SELECT COUNT(*) as count FROM users", [], (err, row) => {
                if (err) {
                    console.error('Error counting users:', err.message);
                    db.close();
                    return;
                }

                const totalUsers = row.count;
                console.log('👥 USERS COUNT:');
                console.log('─'.repeat(50));
                console.log(`Total users in database: ${totalUsers}\n`);

                // Count by status
                db.all("SELECT status, COUNT(*) as count FROM users GROUP BY status", [], (err, statusRows) => {
                    if (err) {
                        console.error('Error counting by status:', err.message);
                        db.close();
                        return;
                    }

                    if (statusRows.length > 0) {
                        console.log('📊 USERS BY STATUS:');
                        console.log('─'.repeat(50));
                        statusRows.forEach((row) => {
                            console.log(`  ${(row.status || 'NULL').padEnd(15)} : ${row.count}`);
                        });
                        console.log('');
                    }

                    // Count by paid status
                    db.all("SELECT paid, COUNT(*) as count FROM users GROUP BY paid", [], (err, paidRows) => {
                        if (err) {
                            console.error('Error counting by paid:', err.message);
                            db.close();
                            return;
                        }

                        if (paidRows.length > 0) {
                            console.log('💰 USERS BY PAID STATUS:');
                            console.log('─'.repeat(50));
                            paidRows.forEach((row) => {
                                const paidLabel = row.paid === 1 ? 'Paid' : 'Unpaid';
                                console.log(`  ${paidLabel.padEnd(15)} : ${row.count}`);
                            });
                            console.log('');
                        }

                        // Sample users (first 10)
                        db.all("SELECT id, name, phone_number, subscription, status, paid FROM users ORDER BY id LIMIT 10", [], (err, sampleUsers) => {
                            if (err) {
                                console.error('Error getting sample users:', err.message);
                                db.close();
                                return;
                            }

                            if (sampleUsers.length > 0) {
                                console.log('👤 SAMPLE USERS (First 10):');
                                console.log('─'.repeat(100));
                                console.log('ID'.padEnd(5) + 'Name'.padEnd(25) + 'Phone'.padEnd(20) + 'Subscription'.padEnd(15) + 'Status'.padEnd(10) + 'Paid');
                                console.log('─'.repeat(100));
                                sampleUsers.forEach((user) => {
                                    const id = String(user.id || '').padEnd(5);
                                    const name = (user.name || '').substring(0, 24).padEnd(25);
                                    const phone = (user.phone_number || '').substring(0, 19).padEnd(20);
                                    const sub = (user.subscription || '').substring(0, 14).padEnd(15);
                                    const status = (user.status || '').substring(0, 9).padEnd(10);
                                    const paid = user.paid === 1 ? 'Yes' : 'No';
                                    console.log(`${id}${name}${phone}${sub}${status}${paid}`);
                                });
                                console.log('');
                            } else {
                                console.log('⚠️  No users found in database!\n');
                            }

                            // Check if there are other tables with user data
                            const otherTables = tables.filter(t => t.name !== 'users');
                            if (otherTables.length > 0) {
                                console.log('📋 OTHER TABLES (might contain related data):');
                                console.log('─'.repeat(50));
                                otherTables.forEach((table) => {
                                    db.get(`SELECT COUNT(*) as count FROM ${table.name}`, [], (err, row) => {
                                        if (!err && row) {
                                            console.log(`  ${table.name.padEnd(30)} : ${row.count} rows`);
                                        }
                                    });
                                });
                                console.log('');
                            }

                            console.log('✅ Inspection complete!\n');
                            db.close();
                        });
                    });
                });
            });
        });
    });
});

