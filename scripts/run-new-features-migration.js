/**
 * Migration script for new features:
 * - Kasbon Teknisi
 * - Partial Payment
 * - Discount Pelanggan
 * - Change Package
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { getDatabasePath } = require('../lib/env-config');

const dbPath = getDatabasePath('users.sqlite');
console.log('Database path:', dbPath);

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err);
        process.exit(1);
    }
    console.log('Connected to database');
});

db.serialize(() => {
    // Create technician_kasbon table
    console.log('Creating technician_kasbon table...');
    db.run(`
        CREATE TABLE IF NOT EXISTS technician_kasbon (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            teknisi_id INTEGER NOT NULL,
            teknisi_name TEXT,
            amount INTEGER NOT NULL,
            description TEXT,
            status TEXT DEFAULT 'pending',
            approved_by INTEGER,
            approved_by_name TEXT,
            approved_at TEXT,
            paid_at TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            notes TEXT
        )
    `, (err) => {
        if (err) console.error('Error creating technician_kasbon:', err.message);
        else console.log('✓ Created technician_kasbon table');
    });

    // Create payment_history table
    console.log('Creating payment_history table...');
    db.run(`
        CREATE TABLE IF NOT EXISTS payment_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            user_name TEXT,
            request_id INTEGER,
            amount_due INTEGER NOT NULL,
            amount_paid INTEGER NOT NULL,
            amount_remaining INTEGER NOT NULL DEFAULT 0,
            payment_method TEXT DEFAULT 'CASH',
            is_partial INTEGER DEFAULT 0,
            teknisi_id INTEGER,
            teknisi_name TEXT,
            approved_by INTEGER,
            approved_by_name TEXT,
            period_month INTEGER,
            period_year INTEGER,
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    `, (err) => {
        if (err) console.error('Error creating payment_history:', err.message);
        else console.log('✓ Created payment_history table');
    });

    // Add discount fields to users table
    const discountFields = [
        { name: 'discount_amount', sql: 'discount_amount INTEGER DEFAULT 0' },
        { name: 'discount_percentage', sql: 'discount_percentage INTEGER DEFAULT 0' },
        { name: 'discount_reason', sql: 'discount_reason TEXT' },
        { name: 'discount_valid_until', sql: 'discount_valid_until TEXT' },
        { name: 'discount_months', sql: 'discount_months INTEGER DEFAULT 0' },
        { name: 'discount_months_used', sql: 'discount_months_used INTEGER DEFAULT 0' },
        { name: 'discount_created_by', sql: 'discount_created_by TEXT' },
        { name: 'discount_created_at', sql: 'discount_created_at TEXT' }
    ];

    console.log('Adding discount fields to users table...');
    discountFields.forEach(field => {
        db.run(`ALTER TABLE users ADD COLUMN ${field.sql}`, (err) => {
            if (err && err.message.includes('duplicate column')) {
                console.log(`  - Column ${field.name} already exists`);
            } else if (err) {
                console.error(`  ✗ Error adding ${field.name}:`, err.message);
            } else {
                console.log(`  ✓ Added column: ${field.name}`);
            }
        });
    });

    // Create indexes
    console.log('Creating indexes...');
    db.run('CREATE INDEX IF NOT EXISTS idx_kasbon_teknisi ON technician_kasbon(teknisi_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_kasbon_status ON technician_kasbon(status)');
    db.run('CREATE INDEX IF NOT EXISTS idx_payment_history_user ON payment_history(user_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_payment_history_period ON payment_history(period_month, period_year)');
    console.log('✓ Indexes created');
});

// Close database after all operations
setTimeout(() => {
    db.close((err) => {
        if (err) console.error('Error closing database:', err);
        else console.log('\n✓ Migration completed successfully!');
        process.exit(0);
    });
}, 2000);
