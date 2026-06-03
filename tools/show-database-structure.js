/**
 * Show database structure - what Notepad++ would see
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { getDatabasePath } = require('../lib/env-config');

const dbPath = getDatabasePath('database.sqlite');

console.log('=== DATABASE STRUCTURE (What Notepad++ sees) ===');
console.log('');

const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
        console.error('Error:', err.message);
        process.exit(1);
    }
    
    // Get CREATE TABLE statement for users
    db.all("SELECT sql FROM sqlite_master WHERE type='table' ORDER BY name", [], (err, tables) => {
        if (err) {
            console.error('Error:', err.message);
            db.close();
            return;
        }
        
        console.log('📋 CREATE TABLE STATEMENTS:');
        console.log('═══════════════════════════════════════════════════════');
        console.log('');
        
        tables.forEach((table, idx) => {
            console.log(`${idx + 1}. Table: ${table.name}`);
            console.log('─'.repeat(60));
            if (table.sql) {
                // Format SQL for readability
                const sql = table.sql
                    .replace(/\(/g, '(\n    ')
                    .replace(/\)/g, '\n)')
                    .replace(/,/g, ',\n    ')
                    .replace(/CREATE TABLE/g, 'CREATE TABLE');
                
                console.log(sql);
                console.log('');
            }
        });
        
        // Check if there are any rows in users
        db.get("SELECT COUNT(*) as count FROM users", [], (err, row) => {
            console.log('═══════════════════════════════════════════════════════');
            console.log('');
            console.log('📊 USERS TABLE STATUS:');
            console.log('  Rows in users table:', row.count);
            console.log('');
            
            if (row.count === 0) {
                console.log('✅ CONFIRMED: Users table is EMPTY (0 rows)');
                console.log('');
                console.log('⚠️  IMPORTANT:');
                console.log('  If you see "NULL" in Notepad++, it is from the CREATE TABLE statement above,');
                console.log('  NOT from actual user data. The "NULL" you see is the default value');
                console.log('  definition in the table structure (e.g., "name TEXT NULL").');
                console.log('');
                console.log('  User data has been completely deleted.');
                console.log('  What remains is only the table structure (schema).');
            } else {
                console.log('⚠️  WARNING: Users table has', row.count, 'rows!');
                console.log('  This should be 0 if delete all was successful.');
            }
            
            db.close();
        });
    });
});

