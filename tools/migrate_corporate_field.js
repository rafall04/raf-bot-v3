#!/usr/bin/env node

/**
 * Database Migration Script
 * Adds is_corporate field to users table
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../database/database.sqlite');

function runMigration() {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error('Error opening database:', err.message);
                return reject(err);
            }
            console.log('Connected to SQLite database');
        });

        // Check if is_corporate column already exists
        db.all("PRAGMA table_info(users)", (err, columns) => {
            if (err) {
                console.error('Error checking table info:', err.message);
                db.close();
                return reject(err);
            }

            const corporateColumnExists = columns.some(col => col.name === 'is_corporate');
            
            if (corporateColumnExists) {
                console.log('✅ is_corporate column already exists in users table');
                db.close();
                return resolve();
            }

            // Add is_corporate column
            console.log('Adding is_corporate column to users table...');
            db.run("ALTER TABLE users ADD COLUMN is_corporate INTEGER DEFAULT 0", (err) => {
                if (err) {
                    console.error('Error adding is_corporate column:', err.message);
                    db.close();
                    return reject(err);
                }

                console.log('✅ Successfully added is_corporate column');

                // Auto-detect corporate customers based on subscription names
                const corporateKeywords = ['corporate', 'bisnis', 'business', 'enterprise', 'dedicated'];
                const corporateQuery = corporateKeywords.map(() => 'subscription LIKE ?').join(' OR ');
                const corporateParams = corporateKeywords.map(keyword => `%${keyword}%`);

                db.run(`UPDATE users SET is_corporate = 1 WHERE ${corporateQuery}`, corporateParams, function(err) {
                    if (err) {
                        console.error('Error auto-detecting corporate customers:', err.message);
                    } else {
                        console.log(`✅ Auto-detected ${this.changes} corporate customers based on subscription names`);
                    }

                    db.close((err) => {
                        if (err) {
                            console.error('Error closing database:', err.message);
                            return reject(err);
                        }
                        console.log('Database connection closed');
                        resolve();
                    });
                });
            });
        });
    });
}

// Run migration if called directly
if (require.main === module) {
    console.log('🚀 Starting database migration for is_corporate field...');
    runMigration()
        .then(() => {
            console.log('✅ Migration completed successfully');
            process.exit(0);
        })
        .catch((err) => {
            console.error('❌ Migration failed:', err.message);
            process.exit(1);
        });
}

module.exports = { runMigration };
