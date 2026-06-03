/**
 * Detailed Database Inspector
 * Reads database.sqlite and shows all data including NULL values
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'database', 'database.sqlite');

console.log('=== DETAILED DATABASE INSPECTION ===');
console.log('File path:', dbPath);
console.log('File exists:', fs.existsSync(dbPath));

if (fs.existsSync(dbPath)) {
    const stats = fs.statSync(dbPath);
    console.log('File size:', stats.size, 'bytes');
    console.log('Last modified:', stats.mtime);
}
console.log('');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    }
    
    console.log('✅ Connected to database');
    console.log('');
    
    // Check table structure
    db.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name", [], (err, tables) => {
        if (err) {
            console.error('Error getting tables:', err.message);
            db.close();
            return;
        }
        
        console.log('Tables found:', tables.map(t => t.name).join(', '));
        console.log('');
        
        // Get users count
        db.get("SELECT COUNT(*) as count FROM users", [], (err, row) => {
            if (err) {
                console.error('Error counting users:', err.message);
                db.close();
                return;
            }
            
            console.log('📊 Users count:', row.count);
            console.log('');
            
            // Get ALL users (no LIMIT to see everything)
            db.all("SELECT * FROM users", [], (err, users) => {
                if (err) {
                    console.error('Error loading users:', err.message);
                    db.close();
                    return;
                }
                
                console.log('📋 Total rows returned:', users ? users.length : 0);
                console.log('');
                
                if (users && users.length > 0) {
                    console.log('═══════════════════════════════════════════════════════');
                    console.log('ALL USERS DATA (including NULL values):');
                    console.log('═══════════════════════════════════════════════════════');
                    
                    users.forEach((user, idx) => {
                        console.log(`\n--- User Row ${idx + 1} (ID: ${user.id || '(no ID)'}) ---`);
                        Object.keys(user).forEach(key => {
                            const value = user[key];
                            if (value === null) {
                                console.log(`  ${key}: NULL`);
                            } else if (value === undefined) {
                                console.log(`  ${key}: undefined`);
                            } else if (typeof value === 'string' && value.length === 0) {
                                console.log(`  ${key}: (empty string)`);
                            } else if (typeof value === 'number' && value === 0 && (key === 'id' || key.includes('count'))) {
                                console.log(`  ${key}: ${value}`);
                            } else {
                                const displayValue = typeof value === 'string' && value.length > 100 
                                    ? value.substring(0, 100) + '...' 
                                    : value;
                                console.log(`  ${key}: ${JSON.stringify(displayValue)}`);
                            }
                        });
                    });
                } else {
                    console.log('⚠️  No users found in table');
                    console.log('');
                    console.log('This means:');
                    console.log('  - Either the table is truly empty');
                    console.log('  - Or there are rows but all fields are NULL/empty');
                    console.log('');
                    
                    // Check if table structure exists
                    db.all("PRAGMA table_info(users)", [], (err, columns) => {
                        if (!err && columns && columns.length > 0) {
                            console.log('Table structure exists with', columns.length, 'columns:');
                            columns.forEach(col => {
                                console.log(`  - ${col.name} (${col.type})`);
                            });
                        }
                        
                        // Check database file content
                        db.get("SELECT COUNT(*) as count FROM sqlite_master WHERE type='table'", [], (err, row) => {
                            console.log('');
                            console.log('Database metadata:');
                            console.log('  Tables in database:', row ? row.count : 0);
                            
                                // Get page info
                            db.get("SELECT * FROM pragma_page_count(), pragma_page_size()", [], (err, pageInfo) => {
                                if (!err && pageInfo) {
                                    const totalSize = pageInfo.page_count * pageInfo.page_size;
                                    const fileStats = fs.statSync(dbPath);
                                    console.log('  Page count:', pageInfo.page_count);
                                    console.log('  Page size:', pageInfo.page_size);
                                    console.log('  Calculated size:', totalSize, 'bytes');
                                    console.log('  Actual file size:', fileStats.size, 'bytes');
                                    
                                    if (totalSize !== fileStats.size) {
                                        console.log('');
                                        console.log('⚠️  WARNING: Size mismatch detected!');
                                        console.log('  This may indicate:');
                                        console.log('    - File contains deleted but not vacuumed data');
                                        console.log('    - Or there are other tables/data');
                                    }
                                }
                                
                                // Check other tables for data
                                console.log('');
                                console.log('Checking other tables for data:');
                                let tablesChecked = 0;
                                const allTables = ['activity_logs', 'login_logs', 'sqlite_sequence'];
                                
                                allTables.forEach(tableName => {
                                    db.get(`SELECT COUNT(*) as count FROM ${tableName}`, [], (err, row) => {
                                        if (!err) {
                                            console.log(`  ${tableName}: ${row.count} rows`);
                                        }
                                        tablesChecked++;
                                        if (tablesChecked === allTables.length) {
                                            db.close();
                                        }
                                    });
                                });
                            });
                        });
                    });
                }
            });
        });
    });
});

