/**
 * Migration: Migrate atm.json to SQLite user_saldo table
 * Tanggal: 2024-11-26
 * Deskripsi: Memindahkan data saldo dari JSON ke SQLite untuk performa dan konsistensi yang lebih baik
 */

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { getDatabasePath } = require('../../lib/env-config');

async function migrateAtmToSqlite() {
    return new Promise((resolve, reject) => {
        console.log('[MIGRATION] Memulai migrasi atm.json ke SQLite...');
        
        const atmJsonPath = path.join(__dirname, '../user/atm.json');
        const dbPath = getDatabasePath('saldo.sqlite'); // Database terpisah untuk saldo
        
        // Cek apakah file atm.json ada
        if (!fs.existsSync(atmJsonPath)) {
            console.log('[MIGRATION] File atm.json tidak ditemukan, skip migrasi');
            return resolve({ migrated: 0, skipped: true });
        }
        
        // Baca data dari atm.json
        let atmData = [];
        try {
            const jsonContent = fs.readFileSync(atmJsonPath, 'utf8');
            atmData = JSON.parse(jsonContent);
            console.log(`[MIGRATION] Ditemukan ${atmData.length} record di atm.json`);
        } catch (error) {
            console.error('[MIGRATION] Error membaca atm.json:', error);
            return reject(error);
        }
        
        if (!Array.isArray(atmData) || atmData.length === 0) {
            console.log('[MIGRATION] atm.json kosong atau tidak valid, skip migrasi');
            return resolve({ migrated: 0, skipped: true });
        }
        
        // Buka koneksi database
        const db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error('[MIGRATION] Error membuka database:', err);
                return reject(err);
            }
            
            console.log('[MIGRATION] Terhubung ke database:', dbPath);
            
            db.serialize(() => {
                // Buat tabel user_saldo jika belum ada
                const createTableSql = `
                    CREATE TABLE IF NOT EXISTS user_saldo (
                        user_id TEXT PRIMARY KEY,
                        saldo INTEGER DEFAULT 0 NOT NULL,
                        uang INTEGER DEFAULT 0 NOT NULL,
                        pushname TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                `;
                
                db.run(createTableSql, (err) => {
                    if (err) {
                        console.error('[MIGRATION] Error membuat tabel user_saldo:', err);
                        db.close();
                        return reject(err);
                    }
                    
                    console.log('[MIGRATION] Tabel user_saldo sudah siap');
                    
                    // Cek apakah sudah ada data di tabel
                    db.get("SELECT COUNT(*) as count FROM user_saldo", (err, row) => {
                        if (err) {
                            console.error('[MIGRATION] Error mengecek data existing:', err);
                            db.close();
                            return reject(err);
                        }
                        
                        const existingCount = row.count;
                        if (existingCount > 0) {
                            console.log(`[MIGRATION] Tabel user_saldo sudah memiliki ${existingCount} record`);
                            console.log('[MIGRATION] Skip migrasi karena data sudah ada');
                            db.close();
                            return resolve({ migrated: 0, skipped: true, existing: existingCount });
                        }
                        
                        // Mulai migrasi data
                        console.log('[MIGRATION] Memulai migrasi data...');
                        const insertSql = `
                            INSERT OR REPLACE INTO user_saldo 
                            (user_id, saldo, uang, pushname, created_at, updated_at)
                            VALUES (?, ?, ?, ?, ?, ?)
                        `;
                        
                        let migrated = 0;
                        let errors = 0;
                        const total = atmData.length;
                        
                        // Gunakan transaction untuk memastikan atomicity
                        db.run("BEGIN TRANSACTION", (err) => {
                            if (err) {
                                console.error('[MIGRATION] Error memulai transaction:', err);
                                db.close();
                                return reject(err);
                            }
                            
                            // Insert data satu per satu
                            let completed = 0;
                            atmData.forEach((item, index) => {
                                const userId = item.id || item.user_id;
                                const saldo = parseInt(item.saldo || 0);
                                const uang = parseInt(item.uang || 0);
                                const pushname = item.pushname || null;
                                const createdAt = item.created_at || new Date().toISOString();
                                const updatedAt = item.updated_at || new Date().toISOString();
                                
                                if (!userId) {
                                    console.warn(`[MIGRATION] Skip record ${index + 1}: user_id tidak valid`);
                                    errors++;
                                    completed++;
                                    if (completed === total) {
                                        finalizeMigration();
                                    }
                                    return;
                                }
                                
                                db.run(insertSql, [userId, saldo, uang, pushname, createdAt, updatedAt], (err) => {
                                    completed++;
                                    
                                    if (err) {
                                        console.error(`[MIGRATION] Error insert record ${index + 1} (${userId}):`, err.message);
                                        errors++;
                                    } else {
                                        migrated++;
                                        if (migrated % 100 === 0) {
                                            console.log(`[MIGRATION] Progress: ${migrated}/${total} records migrated`);
                                        }
                                    }
                                    
                                    if (completed === total) {
                                        finalizeMigration();
                                    }
                                });
                            });
                            
                            function finalizeMigration() {
                                db.run("COMMIT", (err) => {
                                    if (err) {
                                        console.error('[MIGRATION] Error commit transaction:', err);
                                        db.run("ROLLBACK", () => {
                                            db.close();
                                            return reject(err);
                                        });
                                        return;
                                    }
                                    
                                    console.log(`[MIGRATION] Migrasi selesai!`);
                                    console.log(`[MIGRATION] Total migrated: ${migrated}`);
                                    console.log(`[MIGRATION] Total errors: ${errors}`);
                                    
                                    // Verifikasi data
                                    db.get("SELECT COUNT(*) as count FROM user_saldo", (err, row) => {
                                        if (err) {
                                            console.error('[MIGRATION] Error verifikasi:', err);
                                        } else {
                                            console.log(`[MIGRATION] Verifikasi: ${row.count} records di database`);
                                        }
                                        
                                        db.close();
                                        resolve({
                                            migrated,
                                            errors,
                                            total,
                                            verified: row ? row.count : 0
                                        });
                                    });
                                });
                            }
                        });
                    });
                });
            });
        });
    });
}

// Jalankan migrasi jika dipanggil langsung
if (require.main === module) {
    migrateAtmToSqlite()
        .then((result) => {
            console.log('[MIGRATION] Hasil migrasi:', result);
            process.exit(0);
        })
        .catch((error) => {
            console.error('[MIGRATION] Error:', error);
            process.exit(1);
        });
}

module.exports = { migrateAtmToSqlite };

