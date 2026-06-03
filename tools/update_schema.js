const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(process.cwd(), 'database', 'database.sqlite');
console.log(`Attempting to connect to database at: ${dbPath}`);

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
        return;
    }
    console.log('Connected to the SQLite database for migration.');

    // This is the single source of truth for the users table schema.
    // It includes all columns, old and new.
    const createTableSql = `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        name TEXT,
        phone_number TEXT,
        address TEXT,
        subscription TEXT,
        pppoe_username TEXT,
        device_id TEXT,
        paid INTEGER,
        username TEXT,
        password TEXT,
        otp TEXT,
        otpTimestamp INTEGER,
        bulk TEXT,
        connected_odp_id TEXT,
        latitude REAL,
        longitude REAL,
        pppoe_password TEXT
    )`;

    db.run(createTableSql, (createErr) => {
        if (createErr) {
            console.error('Error ensuring users table exists:', createErr.message);
            db.close();
            return;
        }
        console.log("'users' table is present or was created successfully.");

        // Now that the table is guaranteed to exist, proceed with checking and adding columns.
        runMigration();
    });
});

function addColumnIfNotExists(columnName, columnType) {
    return new Promise((resolve, reject) => {
        db.all(`PRAGMA table_info(users)`, (err, columns) => {
            if (err) {
                return reject(new Error(`Failed to get table info for "users": ${err.message}`));
            }
            const columnExists = columns.some(col => col.name === columnName);
            if (columnExists) {
                console.log(`Column "${columnName}" already exists. Skipping.`);
                resolve();
            } else {
                console.log(`Column "${columnName}" does not exist. Adding it...`);
                db.run(`ALTER TABLE users ADD COLUMN ${columnName} ${columnType}`, (alterErr) => {
                    if (alterErr) {
                        return reject(new Error(`Failed to add column "${columnName}": ${alterErr.message}`));
                    }
                    console.log(`Column "${columnName}" added successfully.`);
                    resolve();
                });
            }
        });
    });
}

function dropColumnIfExists(columnName) {
    return new Promise((resolve, reject) => {
        db.all(`PRAGMA table_info(users)`, (err, columns) => {
            if (err) {
                return reject(new Error(`Failed to get table info for "users": ${err.message}`));
            }
            const columnExists = columns.some(col => col.name === columnName);
            if (!columnExists) {
                console.log(`Column "${columnName}" does not exist. Skipping drop.`);
                resolve();
            } else {
                console.log(`Column "${columnName}" exists. Dropping it...`);
                db.run(`ALTER TABLE users DROP COLUMN ${columnName}`, (alterErr) => {
                    if (alterErr) {
                        return reject(new Error(`Failed to drop column "${columnName}": ${alterErr.message}`));
                    }
                    console.log(`Column "${columnName}" dropped successfully.`);
                    resolve();
                });
            }
        });
    });
}

function runMigration() {
    db.serialize(async () => {
        try {
            console.log("Starting comprehensive schema alteration check...");
            // Drop obsolete columns first
            await dropColumnIfExists('pppoe_profile');

            // Check and add all columns that might be missing from older schemas.
            await addColumnIfNotExists('latitude', 'REAL');
            await addColumnIfNotExists('longitude', 'REAL');
            await addColumnIfNotExists('pppoe_password', 'TEXT');
            await addColumnIfNotExists('bulk', 'TEXT');
            await addColumnIfNotExists('send_invoice', 'INTEGER DEFAULT 0');

            console.log("Schema alteration check completed successfully.");
        } catch (error) {
            console.error("An error occurred during migration:", error.message);
        } finally {
            db.close((err) => {
                if (err) {
                    console.error('Error closing the database connection.', err.message);
                } else {
                    console.log('Database connection closed.');
                }
            });
        }
    });
}
