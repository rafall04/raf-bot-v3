const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(process.cwd(), 'database', 'database.sqlite');
console.log(`Fixing ID column in database at: ${dbPath}`);

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
        return;
    }
    console.log('Connected to the SQLite database.');

    db.serialize(() => {
        // Step 1: Create new table with correct schema
        const createNewTableSql = `
            CREATE TABLE IF NOT EXISTS users_new (
                id TEXT PRIMARY KEY,
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
                pppoe_password TEXT,
                send_invoice INTEGER DEFAULT 0,
                is_corporate INTEGER DEFAULT 0,
                corporate_name TEXT,
                corporate_address TEXT,
                corporate_npwp TEXT,
                corporate_pic_name TEXT,
                corporate_pic_phone TEXT,
                corporate_pic_email TEXT
            )
        `;

        db.run(createNewTableSql, (err) => {
            if (err) {
                console.error('Error creating new table:', err.message);
                db.close();
                return;
            }
            console.log('New table created successfully.');

            // Step 2: Copy data from old table to new table
            const copyDataSql = `
                INSERT INTO users_new 
                SELECT 
                    CAST(id AS TEXT) as id,
                    name,
                    phone_number,
                    address,
                    subscription,
                    pppoe_username,
                    device_id,
                    paid,
                    username,
                    password,
                    otp,
                    otpTimestamp,
                    bulk,
                    connected_odp_id,
                    latitude,
                    longitude,
                    pppoe_password,
                    send_invoice,
                    is_corporate,
                    corporate_name,
                    corporate_address,
                    corporate_npwp,
                    corporate_pic_name,
                    corporate_pic_phone,
                    corporate_pic_email
                FROM users
            `;

            db.run(copyDataSql, (err) => {
                if (err && err.message.includes('no such table: users')) {
                    console.log('No existing users table found. Skipping data copy.');
                } else if (err) {
                    console.error('Error copying data:', err.message);
                    db.close();
                    return;
                } else {
                    console.log('Data copied successfully.');
                }

                // Step 3: Drop old table
                db.run('DROP TABLE IF EXISTS users', (err) => {
                    if (err) {
                        console.error('Error dropping old table:', err.message);
                        db.close();
                        return;
                    }
                    console.log('Old table dropped.');

                    // Step 4: Rename new table to users
                    db.run('ALTER TABLE users_new RENAME TO users', (err) => {
                        if (err) {
                            console.error('Error renaming table:', err.message);
                            db.close();
                            return;
                        }
                        console.log('Table renamed successfully.');
                        console.log('Migration completed successfully!');
                        
                        // Verify the new structure
                        db.all("PRAGMA table_info(users)", [], (err, rows) => {
                            if (err) {
                                console.error('Error checking table structure:', err.message);
                            } else {
                                console.log('\nNew table structure:');
                                rows.forEach(row => {
                                    console.log(`  ${row.name}: ${row.type}`);
                                });
                            }
                            db.close();
                        });
                    });
                });
            });
        });
    });
});
