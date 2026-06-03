const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Path to your database
const dbPath = path.join(__dirname, '..', 'database', 'database.sqlite');

console.log('[MIGRATION] Starting to add corporate columns to users table...');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('[ERROR] Could not connect to database:', err.message);
        process.exit(1);
    }
    console.log('[SUCCESS] Connected to SQLite database.');
});

// List of columns to add
const columnsToAdd = [
    { name: 'is_corporate', type: 'INTEGER DEFAULT 0' },
    { name: 'corporate_name', type: 'TEXT' },
    { name: 'corporate_address', type: 'TEXT' },
    { name: 'corporate_npwp', type: 'TEXT' },
    { name: 'corporate_pic_name', type: 'TEXT' },
    { name: 'corporate_pic_phone', type: 'TEXT' },
    { name: 'corporate_pic_email', type: 'TEXT' }
];

// Function to check if column exists
function columnExists(tableName, columnName, callback) {
    db.all(`PRAGMA table_info(${tableName})`, [], (err, rows) => {
        if (err) {
            callback(err, false);
            return;
        }
        const exists = rows.some(row => row.name === columnName);
        callback(null, exists);
    });
}

// Function to add column if it doesn't exist
function addColumnIfNotExists(tableName, columnName, columnType, callback) {
    columnExists(tableName, columnName, (err, exists) => {
        if (err) {
            console.error(`[ERROR] Failed to check column ${columnName}:`, err.message);
            callback(err);
            return;
        }
        
        if (exists) {
            console.log(`[SKIP] Column ${columnName} already exists.`);
            callback(null);
        } else {
            const sql = `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`;
            db.run(sql, (err) => {
                if (err) {
                    console.error(`[ERROR] Failed to add column ${columnName}:`, err.message);
                    callback(err);
                } else {
                    console.log(`[SUCCESS] Added column ${columnName} to ${tableName} table.`);
                    callback(null);
                }
            });
        }
    });
}

// Process all columns sequentially
let index = 0;
function processNextColumn() {
    if (index >= columnsToAdd.length) {
        console.log('[MIGRATION] All columns processed successfully!');
        
        // Show current table structure
        db.all('PRAGMA table_info(users)', [], (err, rows) => {
            if (!err) {
                console.log('\n[INFO] Current users table structure:');
                rows.forEach(row => {
                    console.log(`  - ${row.name} (${row.type})`);
                });
            }
            
            db.close((err) => {
                if (err) {
                    console.error('[ERROR] Error closing database:', err.message);
                } else {
                    console.log('[SUCCESS] Database connection closed.');
                }
                process.exit(0);
            });
        });
        return;
    }
    
    const column = columnsToAdd[index];
    addColumnIfNotExists('users', column.name, column.type, (err) => {
        if (err) {
            console.error('[FATAL] Migration failed. Please check the error above.');
            process.exit(1);
        }
        index++;
        processNextColumn();
    });
}

// Start the migration
processNextColumn();
