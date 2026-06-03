/**
 * Migration: Fix teknisi_id type in technician_kasbon table
 * Ensures all teknisi_id values are stored as integers
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

async function runMigration() {
    const dbPath = process.env.DATABASE_PATH 
        ? path.join(process.env.DATABASE_PATH, 'users.sqlite')
        : path.join(__dirname, '..', 'users.sqlite');
    
    console.log(`[MIGRATION] Opening database: ${dbPath}`);
    const db = new sqlite3.Database(dbPath);
    
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // Check if table exists
            db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='technician_kasbon'", (err, row) => {
                if (err) {
                    console.error('[MIGRATION] Error checking table:', err);
                    db.close();
                    return reject(err);
                }
                
                if (!row) {
                    console.log('[MIGRATION] Table technician_kasbon does not exist, skipping migration');
                    db.close();
                    return resolve();
                }
                
                // Get all kasbon records to check teknisi_id types
                db.all('SELECT id, teknisi_id, typeof(teknisi_id) as id_type FROM technician_kasbon', (err, rows) => {
                    if (err) {
                        console.error('[MIGRATION] Error reading kasbon:', err);
                        db.close();
                        return reject(err);
                    }
                    
                    console.log(`[MIGRATION] Found ${rows?.length || 0} kasbon records`);
                    
                    if (!rows || rows.length === 0) {
                        console.log('[MIGRATION] No kasbon records to fix');
                        db.close();
                        return resolve();
                    }
                    
                    // Log current state
                    rows.forEach(row => {
                        console.log(`[MIGRATION] Kasbon #${row.id}: teknisi_id=${row.teknisi_id} (type: ${row.id_type})`);
                    });
                    
                    // Update any text teknisi_id to integer
                    const textIds = rows.filter(r => r.id_type === 'text');
                    if (textIds.length > 0) {
                        console.log(`[MIGRATION] Found ${textIds.length} records with text teknisi_id, converting to integer...`);
                        
                        db.run(`
                            UPDATE technician_kasbon 
                            SET teknisi_id = CAST(teknisi_id AS INTEGER) 
                            WHERE typeof(teknisi_id) = 'text'
                        `, function(err) {
                            if (err) {
                                console.error('[MIGRATION] Error updating teknisi_id:', err);
                                db.close();
                                return reject(err);
                            }
                            
                            console.log(`[MIGRATION] Updated ${this.changes} records`);
                            db.close();
                            resolve();
                        });
                    } else {
                        console.log('[MIGRATION] All teknisi_id values are already integers');
                        db.close();
                        resolve();
                    }
                });
            });
        });
    });
}

// Run if called directly
if (require.main === module) {
    runMigration()
        .then(() => {
            console.log('[MIGRATION] Completed successfully');
            process.exit(0);
        })
        .catch(err => {
            console.error('[MIGRATION] Failed:', err);
            process.exit(1);
        });
}

module.exports = { runMigration };
