/**
 * Deep inspection of database.sqlite - check ALL tables for ANY user data
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { getDatabasePath } = require('../lib/env-config');

const dbPath = getDatabasePath('database.sqlite');

console.log('=== DEEP DATABASE INSPECTION ===');
console.log('Database path:', dbPath);
console.log('');

if (!fs.existsSync(dbPath)) {
    console.error('❌ Database file not found!');
    process.exit(1);
}

const stats = fs.statSync(dbPath);
console.log('File size:', stats.size, 'bytes');
console.log('');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ Error opening database:', err.message);
        process.exit(1);
    }
    
    console.log('✅ Connected to database');
    console.log('');
    
    // Get ALL tables
    db.all("SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name", [], (err, tables) => {
        if (err) {
            console.error('Error getting tables:', err.message);
            db.close();
            return;
        }
        
        console.log('📋 TABLES FOUND:', tables.length);
        console.log('═══════════════════════════════════════════════════════');
        console.log('');
        
        let tableIndex = 0;
        
        function checkNextTable() {
            if (tableIndex >= tables.length) {
                // All tables checked
                console.log('');
                console.log('═══════════════════════════════════════════════════════');
                console.log('✅ DEEP INSPECTION COMPLETE');
                db.close();
                return;
            }
            
            const table = tables[tableIndex];
            console.log(`${tableIndex + 1}. TABLE: ${table.name}`);
            console.log('─'.repeat(60));
            
            // Get row count
            db.get(`SELECT COUNT(*) as count FROM ${table.name}`, [], (err, row) => {
                if (err) {
                    console.error(`  ❌ Error counting rows: ${err.message}`);
                    tableIndex++;
                    checkNextTable();
                    return;
                }
                
                const rowCount = row ? row.count : 0;
                console.log(`  📊 Total rows: ${rowCount}`);
                console.log('');
                
                if (rowCount > 0) {
                    // Get ALL rows from this table
                    db.all(`SELECT * FROM ${table.name}`, [], (err, rows) => {
                        if (err) {
                            console.error(`  ❌ Error loading rows: ${err.message}`);
                            tableIndex++;
                            checkNextTable();
                            return;
                        }
                        
                        console.log(`  📋 ALL DATA (${rows.length} rows):`);
                        console.log('');
                        
                        rows.forEach((rowData, idx) => {
                            console.log(`  ┌─ Row ${idx + 1} ─────────────────────────────────────────┐`);
                            Object.keys(rowData).forEach(key => {
                                const value = rowData[key];
                                let displayValue;
                                
                                if (value === null) {
                                    displayValue = '(NULL)';
                                } else if (value === undefined) {
                                    displayValue = '(undefined)';
                                } else if (typeof value === 'string' && value.length === 0) {
                                    displayValue = '(empty string)';
                                } else if (typeof value === 'string' && value.length > 100) {
                                    displayValue = value.substring(0, 100) + '... (truncated)';
                                } else {
                                    displayValue = JSON.stringify(value);
                                }
                                
                                // Highlight potential user data
                                const isPotentialUserData = (
                                    key.toLowerCase().includes('name') ||
                                    key.toLowerCase().includes('phone') ||
                                    key.toLowerCase().includes('address') ||
                                    key.toLowerCase().includes('subscription') ||
                                    key.toLowerCase().includes('pppoe') ||
                                    key.toLowerCase().includes('device') ||
                                    (value && typeof value === 'string' && 
                                     (value.match(/^62\d{9,}$/) || // Indonesian phone number
                                      value.match(/^[A-Za-z0-9]+$/))) // Potential username
                                );
                                
                                if (isPotentialUserData && value !== null && value !== undefined && value !== '') {
                                    console.log(`  │ ⚠️  ${key}: ${displayValue}`);
                                } else {
                                    console.log(`  │    ${key}: ${displayValue}`);
                                }
                            });
                            console.log(`  └─────────────────────────────────────────────────────────┘`);
                            console.log('');
                        });
                        
                        // Check for specific user-related fields
                        if (table.name === 'users') {
                            console.log('  🔍 SPECIFIC USER DATA CHECK:');
                            const userFields = ['name', 'phone_number', 'address', 'subscription', 'pppoe_username', 'device_id'];
                            let foundUserData = false;
                            
                            rows.forEach((row, idx) => {
                                const hasUserData = userFields.some(field => {
                                    const value = row[field];
                                    return value !== null && value !== undefined && value !== '' && value !== 0;
                                });
                                
                                if (hasUserData) {
                                    if (!foundUserData) {
                                        foundUserData = true;
                                        console.log('  ⚠️  FOUND USER DATA IN ROWS:');
                                    }
                                    console.log(`    Row ${idx + 1}:`);
                                    userFields.forEach(field => {
                                        if (row[field] !== null && row[field] !== undefined && row[field] !== '' && row[field] !== 0) {
                                            console.log(`      ${field}: ${row[field]}`);
                                        }
                                    });
                                }
                            });
                            
                            if (!foundUserData) {
                                console.log('  ✅ No user data found - table is empty or all fields are NULL');
                            }
                        }
                        
                        tableIndex++;
                        checkNextTable();
                    });
                } else {
                    console.log('  ✅ Table is empty (0 rows)');
                    console.log('');
                    tableIndex++;
                    checkNextTable();
                }
            });
        }
        
        checkNextTable();
    });
});

