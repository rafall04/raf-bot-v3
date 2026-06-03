/**
 * Check raw database data including potential deleted rows
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'database', 'database.sqlite');

console.log('=== RAW DATABASE DATA CHECK ===');
console.log('');

// First, try to read file as binary to see what Notepad++ might see
if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    console.log('File size:', fileBuffer.length, 'bytes');
    console.log('');
    
    // Check for null bytes or readable text
    let nullCount = 0;
    let readableText = '';
    let binaryCount = 0;
    
    for (let i = 0; i < Math.min(10000, fileBuffer.length); i++) {
        const byte = fileBuffer[i];
        if (byte === 0) {
            nullCount++;
        } else if (byte >= 32 && byte <= 126) {
            readableText += String.fromCharCode(byte);
            if (readableText.length > 500) break;
        } else {
            binaryCount++;
        }
    }
    
    console.log('First 10000 bytes analysis:');
    console.log('  Null bytes:', nullCount);
    console.log('  Binary bytes:', binaryCount);
    console.log('  Readable text length:', readableText.length);
    console.log('');
    
    if (readableText.length > 0) {
        console.log('Readable text found in file (first 500 chars):');
        console.log(readableText.substring(0, 500));
        console.log('');
    }
}

// Now check database structure
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    }
    
    console.log('=== DATABASE STRUCTURE ===');
    console.log('');
    
    // Get all table schemas
    db.all("SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name", [], (err, tables) => {
        if (err) {
            console.error('Error getting tables:', err.message);
            db.close();
            return;
        }
        
        tables.forEach(table => {
            console.log(`Table: ${table.name}`);
            if (table.sql) {
                console.log(`  Schema: ${table.sql.substring(0, 200)}...`);
            }
            
            // Get row count for each table
            db.get(`SELECT COUNT(*) as count FROM ${table.name}`, [], (err, row) => {
                if (!err) {
                    console.log(`  Rows: ${row.count}`);
                }
                
                // For users table, check if there are any rows with all NULL values
                if (table.name === 'users') {
                    db.all(`SELECT * FROM ${table.name}`, [], (err, users) => {
                        if (!err) {
                            console.log(`  Total rows returned by SELECT *: ${users ? users.length : 0}`);
                            
                            if (users && users.length > 0) {
                                console.log('  ⚠️  Found rows in users table!');
                                users.forEach((user, idx) => {
                                    const hasData = Object.values(user).some(val => val !== null && val !== undefined && val !== '');
                                    if (!hasData) {
                                        console.log(`    Row ${idx + 1}: All NULL values`);
                                    } else {
                                        console.log(`    Row ${idx + 1}: Has data - ID: ${user.id || '(no ID)'}`);
                                    }
                                });
                            } else {
                                console.log('  No rows found');
                            }
                        }
                        
                        // Check if table has any data pages
                        db.get("SELECT page_count FROM pragma_page_count()", [], (err, pageInfo) => {
                            db.get("SELECT page_size FROM pragma_page_size()", [], (err, sizeInfo) => {
                                if (!err && pageInfo && sizeInfo) {
                                    console.log(`  Pages: ${pageInfo.page_count}, Page size: ${sizeInfo.page_size}`);
                                    console.log(`  Total space: ${pageInfo.page_count * sizeInfo.page_size} bytes`);
                                }
                                
                                db.close();
                            });
                        });
                    });
                }
            });
        });
    });
});

