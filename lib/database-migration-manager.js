/**
 * Database Migration Manager
 * 
 * Sistem migrasi database yang aman dan otomatis:
 * - Auto-detect schema changes
 * - Auto-migrate saat startup
 * - Version tracking untuk setiap database
 * - Rollback support
 * - Backup sebelum migration
 */

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { getDatabasePath } = require('./env-config');

// Buka koneksi sqlite dengan busy_timeout agar menunggu lock (mis. koneksi
// utama global.db) alih-alih langsung gagal SQLITE_BUSY saat migrasi startup.
const SQLITE_BUSY_TIMEOUT_MS = 10000;
function openSqlite(dbPath, cb) {
    const db = new sqlite3.Database(dbPath, cb);
    db.configure('busyTimeout', SQLITE_BUSY_TIMEOUT_MS);
    return db;
}

class DatabaseMigrationManager {
    constructor() {
        this.migrationsDir = path.join(__dirname, '..', 'database', 'migrations');
        this.versionTable = 'schema_version';
        this.ensureMigrationsDir();
    }

    ensureMigrationsDir() {
        if (!fs.existsSync(this.migrationsDir)) {
            fs.mkdirSync(this.migrationsDir, { recursive: true });
        }
    }

    /**
     * Get current schema version dari database
     */
    async getCurrentVersion(dbPath) {
        return new Promise((resolve, reject) => {
            if (!fs.existsSync(dbPath)) {
                resolve(0); // New database, version 0
                return;
            }

            const db = openSqlite(dbPath, (err) => {
                if (err) {
                    reject(err);
                    return;
                }
            });

            // Create version table if not exists
            db.run(`
                CREATE TABLE IF NOT EXISTS ${this.versionTable} (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    version INTEGER NOT NULL,
                    applied_at TEXT NOT NULL,
                    description TEXT
                )
            `, (err) => {
                if (err) {
                    db.close();
                    reject(err);
                    return;
                }

                // Get latest version
                db.get(`SELECT MAX(version) as version FROM ${this.versionTable}`, [], (err, row) => {
                    db.close();
                    if (err) {
                        reject(err);
                    } else {
                        resolve(row?.version || 0);
                    }
                });
            });
        });
    }

    /**
     * Record migration ke version table
     */
    async recordMigration(dbPath, version, description) {
        return new Promise((resolve, reject) => {
            const db = openSqlite(dbPath, (err) => {
                if (err) {
                    reject(err);
                    return;
                }
            });

            db.run(
                `INSERT INTO ${this.versionTable} (version, applied_at, description) VALUES (?, ?, ?)`,
                [version, new Date().toISOString(), description],
                (err) => {
                    db.close();
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                }
            );
        });
    }

    /**
     * Create backup sebelum migration
     */
    async createBackup(dbPath) {
        const backupDir = path.join(__dirname, '..', 'backups');
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0] + '_' +
                         new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
        const dbName = path.basename(dbPath, path.extname(dbPath));
        const backupName = `${dbName}_backup_${timestamp}${path.extname(dbPath)}`;
        const backupPath = path.join(backupDir, backupName);

        try {
            // Flush WAL ke DB utama sebelum copy supaya backup berisi state terkini.
            await this.#checkpointWalBeforeBackup(dbPath);
            fs.copyFileSync(dbPath, backupPath);
            console.log(`[MIGRATION] Backup created: ${backupName}`);
            return backupPath;
        } catch (error) {
            console.error(`[MIGRATION] Failed to create backup: ${error.message}`);
            throw error;
        }
    }

    async #checkpointWalBeforeBackup(dbPath) {
        if (!fs.existsSync(dbPath)) return;
        const { walCheckpoint } = require('./sqlite-pragmas');
        await new Promise((resolve) => {
            const db = openSqlite(dbPath, (err) => {
                if (err) {
                    console.warn(`[MIGRATION] Tidak bisa open untuk checkpoint: ${err.message}`);
                    resolve();
                    return;
                }
                walCheckpoint(db).finally(() => db.close(() => resolve()));
            });
        });
    }

    /**
     * Get current schema dari database
     */
    async getCurrentSchema(dbPath, tableName) {
        if (!tableName) {
            return {};
        }
        return new Promise((resolve, reject) => {
            if (!fs.existsSync(dbPath)) {
                resolve({});
                return;
            }

            const db = openSqlite(dbPath, (err) => {
                if (err) {
                    reject(err);
                    return;
                }
            });

            db.all(`PRAGMA table_info(${tableName})`, [], (err, columns) => {
                db.close();
                if (err) {
                    reject(err);
                } else {
                    const schema = {};
                    columns.forEach(col => {
                        schema[col.name] = {
                            type: col.type,
                            notnull: col.notnull,
                            default: col.dvalue,
                            pk: col.pk
                        };
                    });
                    resolve(schema);
                }
            });
        });
    }

    /**
     * Add column safely (jika belum ada)
     */
    async addColumn(dbPath, tableName, columnName, columnType, defaultValue = null) {
        return new Promise(async (resolve, reject) => {
            if (!tableName) {
                return resolve(false);
            }

            const schema = await this.getCurrentSchema(dbPath, tableName);
            
            if (schema[columnName]) {
                resolve(false); // Column already exists
                return;
            }

            const db = openSqlite(dbPath, (err) => {
                if (err) {
                    reject(err);
                    return;
                }
            });

            let sql = `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`;
            if (defaultValue !== null) {
                sql += ` DEFAULT ${defaultValue}`;
            }

            db.run(sql, (err) => {
                db.close();
                if (err) {
                    reject(err);
                } else {
                    console.log(`[MIGRATION] Added column: ${tableName}.${columnName}`);
                    resolve(true);
                }
            });
        });
    }

    /**
     * Run migration untuk database tertentu
     */
    async migrateDatabase(dbName, targetVersion = null) {
        const dbPath = getDatabasePath(dbName);
        
        // Skip jika database tidak ada (akan dibuat saat pertama kali digunakan)
        if (!fs.existsSync(dbPath)) {
            console.log(`[MIGRATION] Database ${dbName} not found, will be created on first use`);
            return { success: true, skipped: true };
        }

        // Create backup
        const backupPath = await this.createBackup(dbPath);

        try {
            const currentVersion = await this.getCurrentVersion(dbPath);
            console.log(`[MIGRATION] Current version for ${dbName}: ${currentVersion}`);

            // Get expected schema version (dari code)
            const expectedVersion = targetVersion || this.getExpectedVersion();

            if (currentVersion >= expectedVersion) {
                console.log(`[MIGRATION] ${dbName} already at version ${currentVersion}, no migration needed`);
                return { success: true, currentVersion, targetVersion: expectedVersion, migrated: false };
            }

            // Run migrations dari currentVersion + 1 sampai expectedVersion
            let migrated = false;
            for (let version = currentVersion + 1; version <= expectedVersion; version++) {
                const migrationResult = await this.runMigrationStep(dbPath, dbName, version);
                if (migrationResult.success) {
                    await this.recordMigration(dbPath, version, migrationResult.description);
                    migrated = true;
                    console.log(`[MIGRATION] ${dbName} migrated to version ${version}`);
                } else {
                    throw new Error(`Migration to version ${version} failed: ${migrationResult.error}`);
                }
            }

            return {
                success: true,
                currentVersion,
                targetVersion: expectedVersion,
                migrated,
                backupPath
            };

        } catch (error) {
            console.error(`[MIGRATION] Migration failed for ${dbName}:`, error.message);
            console.error(`[MIGRATION] Backup available at: ${backupPath}`);
            return {
                success: false,
                error: error.message,
                backupPath
            };
        }
    }

    /**
     * Get table name untuk database tertentu
     */
    getTableNameForDatabase(dbName) {
        const tableMap = {
            'users.sqlite': 'users',
            'saldo.sqlite': 'user_saldo',
            'activity_logs.sqlite': 'activity_logs', // Primary table untuk activity_logs.sqlite
            'psb_database.sqlite': 'psb_records'
        };
        return tableMap[dbName] || null;
    }

    /**
     * Get all table names untuk database tertentu (untuk multi-table databases)
     */
    getTableNamesForDatabase(dbName) {
        const tablesMap = {
            'users.sqlite': ['users'],
            'saldo.sqlite': ['user_saldo'],
            'activity_logs.sqlite': ['login_logs', 'activity_logs'],
            'psb_database.sqlite': ['psb_records']
        };
        return tablesMap[dbName] || [];
    }

    /**
     * Run single migration step
     */
    async runMigrationStep(dbPath, dbName, version) {
        const tableName = this.getTableNameForDatabase(dbName);
        const tableNames = this.getTableNamesForDatabase(dbName);

        if (!tableName && tableNames.length === 0) {
            return { success: false, error: `Unknown database: ${dbName}` };
        }

        // Define migration steps untuk setiap version
        const migrations = {
            1: async (dbPath, dbName, tableName, tableNames) => {
                // Migration untuk version 1: Add common columns jika belum ada
                const columns = [
                    { name: 'created_at', type: 'TEXT', default: 'NULL' },
                    { name: 'updated_at', type: 'TEXT', default: 'NULL' }
                ];

                // Untuk activity_logs.sqlite, skip migration karena tabel sudah punya timestamp
                if (dbName === 'activity_logs.sqlite') {
                    return { description: 'Skip migration - activity_logs tables already have timestamp columns' };
                }

                // Untuk database dengan single table
                if (tableName) {
                    for (const col of columns) {
                        await this.addColumn(dbPath, tableName, col.name, col.type, col.default);
                    }
                }

                return { description: `Add created_at and updated_at columns to ${tableName || tableNames.join(', ')}` };
            },
            2: async (dbPath, dbName, _tableName, _tableNames) => {
                // Migration untuk version 2: Add indexes
                const db = openSqlite(dbPath);
                const indexes = [];

                // Define indexes berdasarkan database
                if (dbName === 'users.sqlite') {
                    indexes.push(
                        'CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone_number)',
                        'CREATE INDEX IF NOT EXISTS idx_users_status ON users(status)'
                    );
                } else if (dbName === 'saldo.sqlite') {
                    indexes.push(
                        'CREATE INDEX IF NOT EXISTS idx_user_saldo_user_id ON user_saldo(user_id)'
                    );
                } else if (dbName === 'activity_logs.sqlite') {
                    // Indexes sudah dibuat saat table creation, skip
                    db.close();
                    return { description: 'Skip migration - activity_logs indexes already exist' };
                } else if (dbName === 'psb_database.sqlite') {
                    // Indexes sudah dibuat saat table creation, skip
                    db.close();
                    return { description: 'Skip migration - psb_database indexes already exist' };
                }

                for (const indexSql of indexes) {
                    await new Promise((resolve, reject) => {
                        db.run(indexSql, (err) => {
                            if (err) reject(err);
                            else resolve();
                        });
                    });
                }
                db.close();

                return { description: `Add database indexes for ${dbName}` };
            },
            3: async (dbPath, dbName) => {
                if (dbName !== 'users.sqlite') {
                    return { description: `Skip payment_history schema sync for ${dbName}` };
                }

                const db = openSqlite(dbPath);
                const run = (sql) => new Promise((resolve, reject) => {
                    db.run(sql, (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                });
                const all = (sql) => new Promise((resolve, reject) => {
                    db.all(sql, (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows || []);
                    });
                });

                await run(`
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
                        created_by TEXT,
                        created_at TEXT NOT NULL DEFAULT (datetime('now')),
                        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                    )
                `);

                const columns = await all('PRAGMA table_info(payment_history)');
                const columnNames = new Set(columns.map((column) => column.name));
                if (!columnNames.has('created_by')) {
                    await run('ALTER TABLE payment_history ADD COLUMN created_by TEXT');
                }
                await run('CREATE INDEX IF NOT EXISTS idx_payment_history_user ON payment_history(user_id)');
                await run('CREATE INDEX IF NOT EXISTS idx_payment_history_period ON payment_history(period_month, period_year)');
                await run('CREATE INDEX IF NOT EXISTS idx_payment_history_teknisi ON payment_history(teknisi_id)');
                db.close();

                return { description: 'Sync payment_history schema with created_by and indexes' };
            },
            4: async (dbPath, dbName, tableName) => {
                // Migration version 4: tandai pelanggan yang ingin menerima info gangguan (GAMAS).
                // Default 1 (butuh info) agar pelanggan existing tetap menerima broadcast gangguan.
                if (dbName !== 'users.sqlite' || !tableName) {
                    return { description: `Skip notify_outage column for ${dbName}` };
                }
                await this.addColumn(dbPath, tableName, 'notify_outage', 'INTEGER', '1');
                return { description: 'Add notify_outage column to users (default 1 = terima info gangguan)' };
            }
            // Tambahkan migration steps baru di sini untuk version berikutnya
        };

        const migration = migrations[version];
        if (!migration) {
            return { success: false, error: `No migration defined for version ${version}` };
        }

        try {
            const result = await migration(dbPath, dbName, tableName, tableNames);
            return { success: true, description: result.description };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Get expected schema version dari code
     * Update ini setiap kali ada schema change
     */
    getExpectedVersion() {
        // Current schema version - UPDATE INI SETIAP KALI ADA SCHEMA CHANGE
        return 4; // Update ini ke version terbaru
    }

    /**
     * Migrate all databases
     */
    async migrateAll() {
        const databases = [
            'users.sqlite',
            'saldo.sqlite',
            'activity_logs.sqlite',
            'psb_database.sqlite'
        ];

        const results = {};
        for (const dbName of databases) {
            try {
                results[dbName] = await this.migrateDatabase(dbName);
            } catch (error) {
                results[dbName] = {
                    success: false,
                    error: error.message
                };
            }
        }

        return results;
    }
}

module.exports = DatabaseMigrationManager;

