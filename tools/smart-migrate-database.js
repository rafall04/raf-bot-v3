/**
 * Smart Database Migration Tool
 * Automatically detects missing columns in old SQLite database and adds them
 * Preserves all existing data
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Database paths - all databases stored in database/ folder
const dbDir = path.join(__dirname, '..', 'database');
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}
const dbPath = path.join(dbDir, 'database.sqlite');
const backupsDir = path.join(__dirname, '..', 'backups');

// Create backups directory if it doesn't exist
if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
}

const backupPath = path.join(backupsDir, `database.backup.${Date.now()}.sqlite`);

// Expected schema based on current application requirements
const EXPECTED_SCHEMA = {
    columns: [
        { name: 'id', type: 'INTEGER PRIMARY KEY AUTOINCREMENT', nullable: false },
        { name: 'name', type: 'TEXT', nullable: false, default: "'User'" },
        { name: 'username', type: 'TEXT', nullable: true, default: null },
        { name: 'password', type: 'TEXT', nullable: true, default: null },
        { name: 'phone_number', type: 'TEXT', nullable: true, default: null },
        { name: 'address', type: 'TEXT', nullable: true, default: null },
        { name: 'latitude', type: 'REAL', nullable: true, default: null },
        { name: 'longitude', type: 'REAL', nullable: true, default: null },
        { name: 'subscription', type: 'TEXT', nullable: true, default: null },
        { name: 'device_id', type: 'TEXT', nullable: true, default: null },
        { name: 'status', type: 'TEXT', nullable: true, default: "'active'" },
        { name: 'paid', type: 'INTEGER', nullable: true, default: 0 },
        { name: 'send_invoice', type: 'INTEGER', nullable: true, default: 1 },
        { name: 'is_corporate', type: 'INTEGER', nullable: true, default: 0 },
        { name: 'corporate_name', type: 'TEXT', nullable: true, default: null },
        { name: 'corporate_address', type: 'TEXT', nullable: true, default: null },
        { name: 'corporate_npwp', type: 'TEXT', nullable: true, default: null },
        { name: 'corporate_pic_name', type: 'TEXT', nullable: true, default: null },
        { name: 'corporate_pic_phone', type: 'TEXT', nullable: true, default: null },
        { name: 'corporate_pic_email', type: 'TEXT', nullable: true, default: null },
        { name: 'pppoe_username', type: 'TEXT', nullable: true, default: null },
        { name: 'pppoe_password', type: 'TEXT', nullable: true, default: null },
        { name: 'connected_odp_id', type: 'INTEGER', nullable: true, default: null },
        { name: 'bulk', type: 'TEXT', nullable: true, default: null },
        { name: 'created_at', type: 'TEXT', nullable: true, default: 'CURRENT_TIMESTAMP' },
        { name: 'updated_at', type: 'TEXT', nullable: true, default: 'CURRENT_TIMESTAMP' },
        // Additional fields that might be used
        { name: 'otp', type: 'TEXT', nullable: true, default: null },
        { name: 'otpTimestamp', type: 'INTEGER', nullable: true, default: null }
    ],
    indexes: [
        { name: 'idx_users_phone', column: 'phone_number' },
        { name: 'idx_users_device', column: 'device_id' },
        { name: 'idx_users_username', column: 'username' },
        { name: 'idx_users_pppoe', column: 'pppoe_username' }
    ]
};

console.log('');
console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║       SMART DATABASE MIGRATION TOOL FOR RAF-BOT V2       ║');
console.log('╚══════════════════════════════════════════════════════════╝');
console.log('');

// Check if database exists
if (!fs.existsSync(dbPath)) {
    console.error('❌ Database not found at:', dbPath);
    process.exit(1);
}

console.log('📂 Database found:', dbPath);
console.log('📦 Creating backup:', backupPath);

// Create backup
try {
    fs.copyFileSync(dbPath, backupPath);
    console.log('✅ Backup created successfully');
} catch (err) {
    console.error('❌ Failed to create backup:', err.message);
    process.exit(1);
}

// Connect to database
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ Failed to connect to database:', err);
        process.exit(1);
    }
    console.log('✅ Connected to database');
});

// Function to get current schema
function getCurrentSchema() {
    return new Promise((resolve, reject) => {
        db.all("PRAGMA table_info(users)", [], (err, columns) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(columns);
        });
    });
}

// Function to get existing indexes
function getExistingIndexes() {
    return new Promise((resolve, reject) => {
        db.all("PRAGMA index_list(users)", [], (err, indexes) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(indexes);
        });
    });
}

// Function to check if table exists
function tableExists() {
    return new Promise((resolve, reject) => {
        db.get(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
            [],
            (err, row) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(!!row);
            }
        );
    });
}

// Function to create table if not exists
function createTable() {
    return new Promise((resolve, reject) => {
        const createTableSQL = `
            CREATE TABLE users (
                ${EXPECTED_SCHEMA.columns.map(col => {
                    let def = `${col.name} ${col.type}`;
                    if (!col.nullable && col.name !== 'id') def += ' NOT NULL';
                    if (col.default !== null && col.default !== undefined) {
                        if (col.default === 'CURRENT_TIMESTAMP') {
                            def += ` DEFAULT CURRENT_TIMESTAMP`;
                        } else {
                            def += ` DEFAULT ${col.default}`;
                        }
                    }
                    return def;
                }).join(',\n                ')}
            )
        `;
        
        db.run(createTableSQL, [], function(err) {
            if (err) {
                reject(err);
                return;
            }
            console.log('✅ Created users table');
            resolve();
        });
    });
}

// Function to add missing column
function addColumn(column) {
    return new Promise((resolve, reject) => {
        let alterSQL = `ALTER TABLE users ADD COLUMN ${column.name} ${column.type}`;
        
        // Add default value if specified
        // Note: SQLite doesn't allow CURRENT_TIMESTAMP in ALTER TABLE
        if (column.default !== null && column.default !== undefined) {
            if (column.default === 'CURRENT_TIMESTAMP') {
                // For timestamp columns, we can't use CURRENT_TIMESTAMP in ALTER TABLE
                // Just add the column without default, it will be NULL for existing rows
                // New inserts can still use CURRENT_TIMESTAMP
                console.log(`  ⚠️  Note: ${column.name} will be NULL for existing rows (SQLite limitation)`);
            } else {
                alterSQL += ` DEFAULT ${column.default}`;
            }
        }
        
        db.run(alterSQL, [], async function(err) {
            if (err) {
                // Column might already exist with a different definition
                if (err.message.includes('duplicate column name')) {
                    console.log(`  ℹ️  Column ${column.name} already exists`);
                    resolve();
                } else {
                    reject(err);
                }
                return;
            }
            console.log(`  ✅ Added column: ${column.name} (${column.type})`);
            
            // For timestamp columns, update existing rows with current timestamp
            if (column.name === 'created_at' || column.name === 'updated_at') {
                const updateSQL = `UPDATE users SET ${column.name} = datetime('now') WHERE ${column.name} IS NULL`;
                db.run(updateSQL, [], function(updateErr) {
                    if (updateErr) {
                        console.log(`  ⚠️  Could not update ${column.name} for existing rows:`, updateErr.message);
                    } else if (this.changes > 0) {
                        console.log(`  ✅ Updated ${this.changes} rows with current timestamp for ${column.name}`);
                    }
                    resolve();
                });
            } else {
                resolve();
            }
        });
    });
}

// Function to create missing index
function createIndex(index) {
    return new Promise((resolve, reject) => {
        const createIndexSQL = `CREATE INDEX IF NOT EXISTS ${index.name} ON users(${index.column})`;
        
        db.run(createIndexSQL, [], function(err) {
            if (err) {
                reject(err);
                return;
            }
            console.log(`  ✅ Created index: ${index.name}`);
            resolve();
        });
    });
}

// Main migration function
async function migrate() {
    try {
        console.log('');
        console.log('🔍 Analyzing database structure...');
        
        // Check if table exists
        const exists = await tableExists();
        
        if (!exists) {
            console.log('');
            console.log('⚠️  Table "users" does not exist');
            console.log('📝 Creating table with full schema...');
            await createTable();
            
            // Create all indexes
            console.log('');
            console.log('📑 Creating indexes...');
            for (const index of EXPECTED_SCHEMA.indexes) {
                await createIndex(index);
            }
        } else {
            // Get current schema
            const currentColumns = await getCurrentSchema();
            const currentColumnNames = currentColumns.map(col => col.name.toLowerCase());
            
            console.log(`  Found ${currentColumns.length} existing columns`);
            
            // Find missing columns
            const missingColumns = EXPECTED_SCHEMA.columns.filter(
                expectedCol => !currentColumnNames.includes(expectedCol.name.toLowerCase())
            );
            
            if (missingColumns.length === 0) {
                console.log('');
                console.log('✅ Database schema is already up to date!');
            } else {
                console.log('');
                console.log(`📝 Found ${missingColumns.length} missing columns:`);
                missingColumns.forEach(col => {
                    console.log(`  - ${col.name} (${col.type})`);
                });
                
                console.log('');
                console.log('🔧 Adding missing columns...');
                
                // Add each missing column
                for (const column of missingColumns) {
                    await addColumn(column);
                }
                
                console.log('');
                console.log('✅ All missing columns have been added!');
            }
            
            // Check and create missing indexes
            console.log('');
            console.log('📑 Checking indexes...');
            
            const existingIndexes = await getExistingIndexes();
            const existingIndexNames = existingIndexes.map(idx => idx.name.toLowerCase());
            
            for (const index of EXPECTED_SCHEMA.indexes) {
                if (!existingIndexNames.includes(index.name.toLowerCase())) {
                    await createIndex(index);
                } else {
                    console.log(`  ℹ️  Index ${index.name} already exists`);
                }
            }
        }
        
        // Verify final schema
        console.log('');
        console.log('🔍 Verifying final schema...');
        
        const finalColumns = await getCurrentSchema();
        const finalColumnNames = finalColumns.map(col => col.name.toLowerCase());
        
        // Check if all expected columns exist
        let allColumnsPresent = true;
        for (const expectedCol of EXPECTED_SCHEMA.columns) {
            if (!finalColumnNames.includes(expectedCol.name.toLowerCase())) {
                console.log(`  ❌ Missing: ${expectedCol.name}`);
                allColumnsPresent = false;
            }
        }
        
        if (allColumnsPresent) {
            console.log('  ✅ All expected columns are present');
            
            // Show some stats
            console.log('');
            console.log('📊 Database Statistics:');
            
            await new Promise((resolve, reject) => {
                db.get("SELECT COUNT(*) as count FROM users", [], (err, row) => {
                    if (err) {
                        console.log('  ⚠️  Could not count users');
                        resolve();
                    } else {
                        console.log(`  Total users: ${row.count}`);
                        resolve();
                    }
                });
            });
        }
        
        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('✅ MIGRATION COMPLETED SUCCESSFULLY!');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('');
        console.log('📌 NEXT STEPS:');
        console.log('1. Restart the application to load the updated database');
        console.log('2. Test user creation and editing features');
        console.log('3. If any issues occur, restore from backup:', path.basename(backupPath));
        console.log('');
        
        // Close database
        db.close((err) => {
            if (err) {
                console.error('Warning: Error closing database:', err);
            }
            process.exit(0);
        });
        
    } catch (error) {
        console.error('');
        console.error('❌ MIGRATION FAILED:', error.message);
        console.error('');
        console.error('📌 TO RESTORE FROM BACKUP:');
        console.error(`1. Stop the application`);
        console.error(`2. Copy backup file back:`);
        console.error(`   copy "${backupPath}" "${dbPath}"`);
        console.error('');
        
        db.close();
        process.exit(1);
    }
}

// Run migration
migrate();
