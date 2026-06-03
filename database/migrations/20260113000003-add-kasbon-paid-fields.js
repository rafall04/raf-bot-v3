/**
 * Migration: Add paid_by, paid_by_name, paid_notes fields to technician_kasbon table
 * Date: 2026-01-13
 */

const sqlite3 = require('sqlite3').verbose();
const { getDatabasePath } = require('../../lib/env-config');

async function up() {
    const db = new sqlite3.Database(getDatabasePath('users.sqlite'));
    
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            console.log('Adding paid fields to technician_kasbon table...');
            
            // Get existing columns
            db.all("PRAGMA table_info(technician_kasbon)", (err, columns) => {
                if (err) {
                    console.error('Error getting table info:', err);
                    db.close();
                    return reject(err);
                }
                
                const existingColumns = columns.map(col => col.name);
                const fieldsToAdd = [
                    { name: 'paid_by', type: 'INTEGER', default: 'NULL' },
                    { name: 'paid_by_name', type: 'TEXT', default: 'NULL' },
                    { name: 'paid_notes', type: 'TEXT', default: 'NULL' }
                ];
                
                let addedCount = 0;
                fieldsToAdd.forEach(field => {
                    if (!existingColumns.includes(field.name)) {
                        db.run(`ALTER TABLE technician_kasbon ADD COLUMN ${field.name} ${field.type} DEFAULT ${field.default}`, (err) => {
                            if (err) {
                                console.error(`Error adding column ${field.name}:`, err);
                            } else {
                                console.log(`✅ Added column: ${field.name}`);
                                addedCount++;
                            }
                        });
                    } else {
                        console.log(`Column ${field.name} already exists, skipping...`);
                    }
                });
                
                db.close((err) => {
                    if (err) reject(err);
                    else {
                        console.log('✅ Migration completed: add-kasbon-paid-fields');
                        resolve();
                    }
                });
            });
        });
    });
}

async function down() {
    // SQLite doesn't support DROP COLUMN easily, so we skip this
    console.log('Down migration not supported for SQLite column drops');
}

module.exports = { up, down };

// Run if called directly
if (require.main === module) {
    up()
        .then(() => process.exit(0))
        .catch(err => {
            console.error(err);
            process.exit(1);
        });
}
