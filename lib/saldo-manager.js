const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { logger } = require('./logger');
const { generateTopupRequestId } = require('./id-generator');
const { getDatabasePath } = require('./env-config');

// Database paths (untuk transactions dan topup requests masih JSON untuk sementara)
const TRANSACTIONS_DB = path.join(__dirname, '../database/saldo_transactions.json');
const TOPUP_REQUESTS_DB = path.join(__dirname, '../database/topup_requests.json');

// SQLite database connection untuk user_saldo
// Database terpisah untuk saldo management agar lebih tertata rapi
let saldoDb = null;
const SALDO_DB_PATH = getDatabasePath('saldo.sqlite');

// Load databases (hanya untuk transactions dan topup requests)
let transactions = [];
let topupRequests = [];

// Initialize SQLite database connection
function initSaldoDatabase() {
    return new Promise((resolve, reject) => {
        if (saldoDb) {
            return resolve();
        }

        // Pastikan directory database ada
        const dbDir = path.dirname(SALDO_DB_PATH);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }

        saldoDb = new sqlite3.Database(SALDO_DB_PATH, (err) => {
            if (err) {
                console.error('[SALDO-MANAGER] Error opening saldo database:', err);
                console.error('[SALDO-MANAGER] Database path:', SALDO_DB_PATH);
                return reject(err);
            }

            // Database connected silently

            // Set busy timeout untuk retry otomatis saat database locked (5000ms = 5 detik)
            saldoDb.configure('busyTimeout', 5000);

            // Pastikan tabel user_saldo ada
            // NOTE: CHECK constraint untuk saldo >= 0 hanya berlaku untuk table baru
            // Untuk table yang sudah ada, constraint tidak akan ditambahkan otomatis
            // Jika perlu, jalankan migration: ALTER TABLE user_saldo ADD CONSTRAINT check_saldo_non_negative CHECK(saldo >= 0);
            saldoDb.run(`
                CREATE TABLE IF NOT EXISTS user_saldo (
                    user_id TEXT PRIMARY KEY,
                    saldo INTEGER DEFAULT 0 NOT NULL CHECK(saldo >= 0),
                    uang INTEGER DEFAULT 0 NOT NULL,
                    pushname TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            `, (err) => {
                if (err) {
                    console.error('[SALDO-MANAGER] Error creating user_saldo table:', err);
                    console.error('[SALDO-MANAGER] Error details:', err.message, err.stack);
                    return reject(err);
                }

                // Table ready silently

                // Buat index untuk performa
                saldoDb.run("CREATE INDEX IF NOT EXISTS idx_user_saldo_user_id ON user_saldo(user_id)", (err) => {
                    if (err) {
                        console.warn('[SALDO] Index warning:', err.message);
                    }
                    // Index ready silently
                    resolve();
                });
            });
        });
    });
}

// Initialize databases
function initDatabase() {
    try {
        // Initialize SQLite untuk saldo
        initSaldoDatabase().catch(err => {
            console.error('[SALDO-MANAGER] Error initializing SQLite:', err);
        });

        // Load transactions dari JSON (masih menggunakan JSON)
        if (fs.existsSync(TRANSACTIONS_DB)) {
            transactions = JSON.parse(fs.readFileSync(TRANSACTIONS_DB, 'utf8'));
        } else {
            fs.writeFileSync(TRANSACTIONS_DB, '[]');
        }

        // Load topup requests dari JSON (masih menggunakan JSON)
        if (fs.existsSync(TOPUP_REQUESTS_DB)) {
            topupRequests = JSON.parse(fs.readFileSync(TOPUP_REQUESTS_DB, 'utf8'));
        } else {
            fs.writeFileSync(TOPUP_REQUESTS_DB, '[]');
        }
    } catch (error) {
        console.error('[SALDO-MANAGER] Error initializing database:', error);
    }
}

function saveTransactions() {
    fs.writeFileSync(TRANSACTIONS_DB, JSON.stringify(transactions, null, 2));
}

function saveTopupRequests() {
    fs.writeFileSync(TOPUP_REQUESTS_DB, JSON.stringify(topupRequests, null, 2));
}

// Reload functions - hanya dipanggil saat diperlukan (misalnya setelah perubahan manual dari luar)
// Data di memory sudah selalu up-to-date karena langsung di-update saat write operations
function reloadTransactions() {
    try {
        if (fs.existsSync(TRANSACTIONS_DB)) {
            transactions = JSON.parse(fs.readFileSync(TRANSACTIONS_DB, 'utf8'));
            console.log(`[SALDO-MANAGER] Reloaded ${transactions.length} transactions from database`);
        }
    } catch (error) {
        console.error('[SALDO-MANAGER] Error reloading transactions:', error);
    }
}

function reloadTopupRequests() {
    try {
        if (fs.existsSync(TOPUP_REQUESTS_DB)) {
            topupRequests = JSON.parse(fs.readFileSync(TOPUP_REQUESTS_DB, 'utf8'));
            console.log(`[SALDO-MANAGER] Reloaded ${topupRequests.length} topup requests from database`);
        }
    } catch (error) {
        console.error('[SALDO-MANAGER] Error reloading topup requests:', error);
    }
}

// SQLite helper functions untuk saldo
function getSaldoFromDb(userId) {
    return new Promise((resolve, reject) => {
        if (!saldoDb) {
            return initSaldoDatabase().then(() => {
                getSaldoFromDb(userId).then(resolve).catch(reject);
            }).catch(reject);
        }

        saldoDb.get("SELECT saldo FROM user_saldo WHERE user_id = ?", [userId], (err, row) => {
            if (err) {
                return reject(err);
            }
            resolve(row ? row.saldo : 0);
        });
    });
}

function getUserSaldoDataFromDb(userId) {
    return new Promise((resolve, reject) => {
        if (!saldoDb) {
            return initSaldoDatabase().then(() => {
                getUserSaldoDataFromDb(userId).then(resolve).catch(reject);
            }).catch(reject);
        }

        saldoDb.get("SELECT * FROM user_saldo WHERE user_id = ?", [userId], (err, row) => {
            if (err) {
                return reject(err);
            }
            if (!row) {
                return resolve(null);
            }
            // Transform ke format yang sama dengan JSON
            resolve({
                id: row.user_id,
                user_id: row.user_id,
                saldo: row.saldo,
                uang: row.uang,
                pushname: row.pushname,
                created_at: row.created_at,
                updated_at: row.updated_at
            });
        });
    });
}

function getAllSaldoDataFromDb() {
    return new Promise((resolve, reject) => {
        if (!saldoDb) {
            return initSaldoDatabase().then(() => {
                getAllSaldoDataFromDb().then(resolve).catch(reject);
            }).catch(reject);
        }

        saldoDb.all("SELECT * FROM user_saldo ORDER BY updated_at DESC", [], (err, rows) => {
            if (err) {
                // Jika tabel belum ada, return empty array (tabel akan dibuat saat initSaldoDatabase)
                if (err.code === 'SQLITE_ERROR' && err.message.includes('no such table')) {
                    console.warn('[SALDO-MANAGER] Table user_saldo belum ada, returning empty array');
                    return resolve([]);
                }
                return reject(err);
            }
            // Transform ke format yang sama dengan JSON
            const result = rows.map(row => ({
                id: row.user_id,
                user_id: row.user_id,
                saldo: row.saldo,
                uang: row.uang,
                pushname: row.pushname,
                created_at: row.created_at,
                updated_at: row.updated_at
            }));
            resolve(result);
        });
    });
}

function createUserSaldoInDb(userId, pushname = null) {
    return new Promise((resolve, reject) => {
        if (!saldoDb) {
            return initSaldoDatabase().then(() => {
                createUserSaldoInDb(userId, pushname).then(resolve).catch(reject);
            }).catch(reject);
        }

        const now = new Date().toISOString();
        saldoDb.run(
            "INSERT OR IGNORE INTO user_saldo (user_id, saldo, uang, pushname, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            [userId, 0, 0, pushname, now, now],
            function (err) {
                if (err) {
                    return reject(err);
                }
                // Jika row tidak di-insert (sudah ada), return false
                resolve(this.changes > 0);
            }
        );
    });
}

function updateSaldoInDb(userId, newSaldo, pushname = null) {
    return new Promise((resolve, reject) => {
        if (!saldoDb) {
            return initSaldoDatabase().then(() => {
                updateSaldoInDb(userId, newSaldo, pushname).then(resolve).catch(reject);
            }).catch(reject);
        }

        const now = new Date().toISOString();
        // Update saldo dan pushname jika diberikan
        if (pushname) {
            saldoDb.run(
                "UPDATE user_saldo SET saldo = ?, pushname = ?, updated_at = ? WHERE user_id = ?",
                [newSaldo, pushname, now, userId],
                function (err) {
                    if (err) {
                        return reject(err);
                    }
                    resolve(this.changes > 0);
                }
            );
        } else {
            saldoDb.run(
                "UPDATE user_saldo SET saldo = ?, updated_at = ? WHERE user_id = ?",
                [newSaldo, now, userId],
                function (err) {
                    if (err) {
                        return reject(err);
                    }
                    resolve(this.changes > 0);
                }
            );
        }
    });
}

// User saldo management (synchronous untuk backward compatibility)
// FIXED: Menggunakan singleton saldoDb untuk prevent multiple connections dan SQLITE_BUSY errors
function getUserSaldo(userId) {
    try {
        // PENTING: Normalisasi JID dari @lid ke format standar sebelum query database
        // Karena ini sync function, normalisasi harus dilakukan di caller (handler)
        // Tapi kita tetap handle jika ada format aneh seperti :0

        let normalizedUserId = userId;

        // PENTING: Pastikan normalizedUserId tidak mengandung :0 atau format aneh lainnya
        if (normalizedUserId && normalizedUserId.includes(':')) {
            normalizedUserId = normalizedUserId.split(':')[0];
            if (!normalizedUserId.endsWith('@s.whatsapp.net')) {
                normalizedUserId = normalizedUserId + '@s.whatsapp.net';
            }
        }

        // Jika masih @lid format, log warning dan return 0
        // FIXED: Gunakan singleton saldoDb melalui getSaldoFromDb() untuk prevent multiple connections
        // Ini konsisten dengan getUserSaldoAsync() dan function lain yang menggunakan singleton connection
        return initSaldoDatabase().then(() => {
            return getSaldoFromDb(normalizedUserId);
        }).catch(err => {
            console.error('[SALDO-MANAGER] Error getting user saldo:', err);
            return 0;
        });
    } catch (error) {
        console.error('[SALDO-MANAGER] Error getting user saldo:', error);
        return Promise.resolve(0);
    }
}

async function getUserSaldoAsync(userId) {
    try {
        let normalizedUserId = userId;

        // PENTING: Pastikan normalizedUserId tidak mengandung :0 atau format aneh lainnya
        if (normalizedUserId && normalizedUserId.includes(':')) {
            normalizedUserId = normalizedUserId.split(':')[0];
            if (!normalizedUserId.endsWith('@s.whatsapp.net')) {
                normalizedUserId = normalizedUserId + '@s.whatsapp.net';
            }
        }

        await initSaldoDatabase();
        return await getSaldoFromDb(normalizedUserId);
    } catch (error) {
        console.error('[SALDO-MANAGER] Error getting user saldo:', error);
        return 0;
    }
}

async function createUserSaldo(userId, pushname = null) {
    try {
        // PENTING: Normalisasi JID dari @lid ke format standar sebelum operasi database
        // Karena ini async function, normalisasi harus dilakukan di caller (handler)

        let normalizedUserId = userId;

        // PENTING: Pastikan normalizedUserId tidak mengandung :0 atau format aneh lainnya
        if (normalizedUserId && normalizedUserId.includes(':')) {
            normalizedUserId = normalizedUserId.split(':')[0];
            if (!normalizedUserId.endsWith('@s.whatsapp.net')) {
                normalizedUserId = normalizedUserId + '@s.whatsapp.net';
            }
        }

        // Pastikan database sudah diinisialisasi
        await initSaldoDatabase();

        // Gunakan singleton connection saldoDb, bukan membuat connection baru
        return new Promise((resolve) => {
            const now = new Date().toISOString();

            saldoDb.run(
                "INSERT OR IGNORE INTO user_saldo (user_id, saldo, uang, pushname, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                [normalizedUserId, 0, 0, pushname, now, now],
                function (err) {
                    if (err) {
                        console.error('[SALDO-MANAGER] Error creating user saldo:', err);
                        resolve(false);
                    } else {
                        resolve(this.changes > 0);
                    }
                }
            );
        });
    } catch (error) {
        console.error('[SALDO-MANAGER] Error creating user saldo:', error);
        return false;
    }
}

function addSaldo(userId, amount, description = 'Topup saldo', pushname = null, topupRequestId = null) {
    // PENTING: Validasi amount - jangan izinkan amount 0 atau undefined
    if (!amount || amount === 0 || isNaN(amount) || parseInt(amount) <= 0) {
        const error = new Error(`Invalid amount: ${amount}. Amount must be greater than 0.`);
        console.error('[SALDO-MANAGER]', error.message);
        return Promise.reject(error);
    }

    console.log(`[SALDO-MANAGER] Adding saldo: userId=${userId}, amount=${amount}, description=${description}, topupRequestId=${topupRequestId}`);

    return new Promise(async (resolve, reject) => {
        let normalizedUserId = userId;

        // PENTING: Pastikan normalizedUserId tidak mengandung :0 atau format aneh lainnya
        if (normalizedUserId && normalizedUserId.includes(':')) {
            normalizedUserId = normalizedUserId.split(':')[0];
            if (!normalizedUserId.endsWith('@s.whatsapp.net')) {
                normalizedUserId = normalizedUserId + '@s.whatsapp.net';
            }
        }

        // Gunakan normalizedUserId untuk operasi database
        userId = normalizedUserId;
        // Pastikan database sudah diinisialisasi dan tabel sudah dibuat
        initSaldoDatabase().then(() => {
            // Gunakan singleton connection saldoDb, bukan membuat connection baru
            // Ini mencegah SQLITE_BUSY error karena multiple connections
            saldoDb.serialize(() => {
                // Mulai transaction
                saldoDb.run("BEGIN TRANSACTION", (beginErr) => {
                    if (beginErr) {
                        // Improved error logging dengan context
                        const errorMsg = beginErr.code === 'SQLITE_BUSY' || beginErr.code === 'SQLITE_LOCKED'
                            ? `Database sedang sibuk. Silakan coba lagi dalam beberapa saat. (${beginErr.code})`
                            : `Gagal memulai transaksi: ${beginErr.message}`;
                        console.error('[SALDO-MANAGER] Error beginning transaction:', {
                            userId,
                            amount,
                            errorCode: beginErr.code,
                            errorMessage: beginErr.message,
                            userFriendlyMessage: errorMsg
                        });
                        return reject(new Error(errorMsg));
                    }

                    // Cek apakah user ada
                    saldoDb.get("SELECT saldo FROM user_saldo WHERE user_id = ?", [userId], (err, row) => {
                        if (err) {
                            saldoDb.run("ROLLBACK", () => { });
                            // Improved error logging dengan context
                            const errorMsg = err.code === 'SQLITE_BUSY' || err.code === 'SQLITE_LOCKED'
                                ? `Database sedang sibuk. Silakan coba lagi dalam beberapa saat. (${err.code})`
                                : `Gagal memeriksa data user: ${err.message}`;
                            console.error('[SALDO-MANAGER] Error checking user:', {
                                userId,
                                errorCode: err.code,
                                errorMessage: err.message,
                                userFriendlyMessage: errorMsg
                            });
                            return reject(new Error(errorMsg));
                        }

                        if (!row) {
                            // User tidak ada, buat baru
                            const now = new Date().toISOString();
                            saldoDb.run(
                                "INSERT INTO user_saldo (user_id, saldo, uang, pushname, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                                [userId, parseInt(amount), 0, pushname, now, now],
                                function (insertErr) {
                                    if (insertErr) {
                                        saldoDb.run("ROLLBACK", () => { });
                                        // Improved error logging dengan context
                                        const errorMsg = insertErr.code === 'SQLITE_BUSY' || insertErr.code === 'SQLITE_LOCKED'
                                            ? `Database sedang sibuk. Silakan coba lagi dalam beberapa saat. (${insertErr.code})`
                                            : insertErr.code === 'SQLITE_CONSTRAINT'
                                                ? `Data user sudah ada atau constraint violation: ${insertErr.message}`
                                                : `Gagal membuat data user: ${insertErr.message}`;
                                        console.error('[SALDO-MANAGER] Error creating user:', {
                                            userId,
                                            amount,
                                            errorCode: insertErr.code,
                                            errorMessage: insertErr.message,
                                            userFriendlyMessage: errorMsg
                                        });
                                        return reject(new Error(errorMsg));
                                    }

                                    const newSaldo = parseInt(amount);

                                    // PENTING: Validasi newSaldo untuk prevent integer overflow (optional, tapi good practice)
                                    if (newSaldo > Number.MAX_SAFE_INTEGER) {
                                        saldoDb.run("ROLLBACK", () => { });
                                        console.error(`[SALDO-MANAGER] Validation failed: newSaldo would exceed MAX_SAFE_INTEGER for user ${userId}`);
                                        return reject(new Error('Saldo melebihi batas maksimum yang diizinkan'));
                                    }

                                    // Update pushname jika diberikan dan belum ada
                                    if (pushname) {
                                        saldoDb.run(
                                            "UPDATE user_saldo SET pushname = ? WHERE user_id = ? AND pushname IS NULL",
                                            [pushname, userId],
                                            () => { }
                                        );
                                    }

                                    saldoDb.run("COMMIT", (commitErr) => {
                                        if (commitErr) {
                                            // Improved error logging dengan context
                                            const errorMsg = commitErr.code === 'SQLITE_BUSY' || commitErr.code === 'SQLITE_LOCKED'
                                                ? `Database sedang sibuk saat commit. Silakan coba lagi dalam beberapa saat. (${commitErr.code})`
                                                : `Gagal menyimpan perubahan saldo: ${commitErr.message}`;
                                            console.error('[SALDO-MANAGER] Error committing transaction:', {
                                                userId,
                                                amount,
                                                newSaldo,
                                                errorCode: commitErr.code,
                                                errorMessage: commitErr.message,
                                                userFriendlyMessage: errorMsg
                                            });
                                            return reject(new Error(errorMsg));
                                        }

                                        console.log(`[SALDO-MANAGER] Saldo updated: 0 -> ${newSaldo}`);

                                        // Record transaction (wrapped in try-catch untuk prevent failure dari breaking operation)
                                        // NOTE: Transaction recording adalah operation terpisah dari database transaction
                                        // Jika recording gagal, saldo tetap valid (sudah di-commit), tapi history tidak lengkap
                                        try {
                                            addTransaction(userId, 'credit', amount, description, newSaldo, topupRequestId);
                                        } catch (transactionErr) {
                                            // Log error tapi jangan reject - saldo sudah valid
                                            console.error('[SALDO-MANAGER] Error recording transaction (saldo already updated):', transactionErr);
                                            console.warn(`[SALDO-MANAGER] WARNING: Saldo updated but transaction history not recorded for user ${userId}, amount ${amount}`);
                                        }

                                        resolve(true);
                                    });
                                }
                            );
                        } else {
                            // User ada, update saldo
                            const oldSaldo = row.saldo;
                            const newSaldo = oldSaldo + parseInt(amount);

                            // PENTING: Validasi newSaldo untuk prevent integer overflow (optional, tapi good practice)
                            if (newSaldo > Number.MAX_SAFE_INTEGER) {
                                saldoDb.run("ROLLBACK", () => { });
                                console.error(`[SALDO-MANAGER] Validation failed: newSaldo would exceed MAX_SAFE_INTEGER for user ${userId}`);
                                return reject(new Error('Saldo melebihi batas maksimum yang diizinkan'));
                            }

                            const now = new Date().toISOString();

                            saldoDb.run(
                                "UPDATE user_saldo SET saldo = ?, updated_at = ? WHERE user_id = ?",
                                [newSaldo, now, userId],
                                function (updateErr) {
                                    if (updateErr) {
                                        saldoDb.run("ROLLBACK", () => { });
                                        // Improved error logging dengan context
                                        const errorMsg = updateErr.code === 'SQLITE_BUSY' || updateErr.code === 'SQLITE_LOCKED'
                                            ? `Database sedang sibuk. Silakan coba lagi dalam beberapa saat. (${updateErr.code})`
                                            : updateErr.code === 'SQLITE_CONSTRAINT'
                                                ? `Constraint violation: ${updateErr.message}`
                                                : `Gagal memperbarui saldo: ${updateErr.message}`;
                                        console.error('[SALDO-MANAGER] Error updating saldo:', {
                                            userId,
                                            oldSaldo,
                                            newSaldo,
                                            amount,
                                            errorCode: updateErr.code,
                                            errorMessage: updateErr.message,
                                            userFriendlyMessage: errorMsg
                                        });
                                        return reject(new Error(errorMsg));
                                    }

                                    // Update pushname jika diberikan dan belum ada
                                    if (pushname) {
                                        saldoDb.run(
                                            "UPDATE user_saldo SET pushname = ? WHERE user_id = ? AND pushname IS NULL",
                                            [pushname, userId],
                                            () => { }
                                        );
                                    }

                                    saldoDb.run("COMMIT", (commitErr) => {
                                        if (commitErr) {
                                            // Improved error logging dengan context
                                            const errorMsg = commitErr.code === 'SQLITE_BUSY' || commitErr.code === 'SQLITE_LOCKED'
                                                ? `Database sedang sibuk saat commit. Silakan coba lagi dalam beberapa saat. (${commitErr.code})`
                                                : `Gagal menyimpan perubahan saldo: ${commitErr.message}`;
                                            console.error('[SALDO-MANAGER] Error committing transaction:', {
                                                userId,
                                                amount,
                                                oldSaldo,
                                                newSaldo,
                                                errorCode: commitErr.code,
                                                errorMessage: commitErr.message,
                                                userFriendlyMessage: errorMsg
                                            });
                                            return reject(new Error(errorMsg));
                                        }

                                        console.log(`[SALDO-MANAGER] Saldo updated: ${oldSaldo} -> ${newSaldo}`);

                                        // Record transaction (wrapped in try-catch untuk prevent failure dari breaking operation)
                                        // NOTE: Transaction recording adalah operation terpisah dari database transaction
                                        // Jika recording gagal, saldo tetap valid (sudah di-commit), tapi history tidak lengkap
                                        try {
                                            addTransaction(userId, 'credit', amount, description, newSaldo, topupRequestId);
                                        } catch (transactionErr) {
                                            // Log error tapi jangan reject - saldo sudah valid
                                            console.error('[SALDO-MANAGER] Error recording transaction (saldo already updated):', transactionErr);
                                            console.warn(`[SALDO-MANAGER] WARNING: Saldo updated but transaction history not recorded for user ${userId}, amount ${amount}`);
                                        }

                                        resolve(true);
                                    });
                                }
                            );
                        }
                    });
                });
            });
        }).catch((error) => {
            console.error('[SALDO-MANAGER] Error initializing database:', error);
            reject(error);
        });
    });
}

async function deductSaldo(userId, amount, description = 'Pembelian') {
    try {
        // PENTING: Validasi amount - jangan izinkan amount 0 atau undefined
        if (!amount || amount === 0 || isNaN(amount) || parseInt(amount) <= 0) {
            console.error('[SALDO-MANAGER] Invalid amount for deductSaldo:', amount);
            return false;
        }

        // PENTING: Normalisasi JID dari @lid ke format standar sebelum operasi database
        let normalizedUserId = userId;

        // PENTING: Pastikan normalizedUserId tidak mengandung :0 atau format aneh lainnya
        if (normalizedUserId && normalizedUserId.includes(':')) {
            normalizedUserId = normalizedUserId.split(':')[0];
            if (!normalizedUserId.endsWith('@s.whatsapp.net')) {
                normalizedUserId = normalizedUserId + '@s.whatsapp.net';
            }
        }

        // Pastikan database sudah diinisialisasi
        await initSaldoDatabase();

        // Gunakan singleton connection saldoDb, bukan membuat connection baru
        return new Promise((resolve) => {
            saldoDb.serialize(() => {
                saldoDb.run("BEGIN TRANSACTION", (beginErr) => {
                    if (beginErr) {
                        console.error('[SALDO-MANAGER] Error beginning transaction:', beginErr);
                        return resolve(false);
                    }

                    saldoDb.get("SELECT saldo FROM user_saldo WHERE user_id = ?", [normalizedUserId], (err, row) => {
                        if (err) {
                            saldoDb.run("ROLLBACK", () => { });
                            // Improved error logging dengan context
                            const errorMsg = err.code === 'SQLITE_BUSY' || err.code === 'SQLITE_LOCKED'
                                ? `Database sedang sibuk. Silakan coba lagi dalam beberapa saat. (${err.code})`
                                : `Gagal memeriksa saldo: ${err.message}`;
                            console.error('[SALDO-MANAGER] Error checking saldo:', {
                                userId: normalizedUserId,
                                amount,
                                errorCode: err.code,
                                errorMessage: err.message,
                                userFriendlyMessage: errorMsg
                            });
                            return resolve(false);
                        }

                        if (!row || row.saldo < amount) {
                            saldoDb.run("ROLLBACK", () => { });
                            console.warn(`[SALDO-MANAGER] Insufficient saldo for user ${normalizedUserId}: current=${row?.saldo || 0}, requested=${amount}`);
                            return resolve(false);
                        }

                        const newSaldo = row.saldo - parseInt(amount);

                        // PENTING: Validasi newSaldo tidak boleh negative (double-check setelah calculation)
                        if (newSaldo < 0) {
                            saldoDb.run("ROLLBACK", () => { });
                            console.error(`[SALDO-MANAGER] Validation failed: newSaldo would be negative (${newSaldo}) for user ${normalizedUserId}`);
                            return resolve(false);
                        }

                        const now = new Date().toISOString();

                        saldoDb.run(
                            "UPDATE user_saldo SET saldo = ?, updated_at = ? WHERE user_id = ?",
                            [newSaldo, now, normalizedUserId],
                            function (updateErr) {
                                if (updateErr) {
                                    saldoDb.run("ROLLBACK", () => { });
                                    // Improved error logging dengan context
                                    const errorMsg = updateErr.code === 'SQLITE_BUSY' || updateErr.code === 'SQLITE_LOCKED'
                                        ? `Database sedang sibuk. Silakan coba lagi dalam beberapa saat. (${updateErr.code})`
                                        : updateErr.code === 'SQLITE_CONSTRAINT'
                                            ? `Constraint violation: ${updateErr.message}`
                                            : `Gagal memperbarui saldo: ${updateErr.message}`;
                                    console.error('[SALDO-MANAGER] Error updating saldo:', {
                                        userId: normalizedUserId,
                                        amount,
                                        newSaldo,
                                        errorCode: updateErr.code,
                                        errorMessage: updateErr.message,
                                        userFriendlyMessage: errorMsg
                                    });
                                    return resolve(false);
                                }

                                saldoDb.run("COMMIT", (commitErr) => {
                                    if (commitErr) {
                                        // Improved error logging dengan context
                                        const errorMsg = commitErr.code === 'SQLITE_BUSY' || commitErr.code === 'SQLITE_LOCKED'
                                            ? `Database sedang sibuk saat commit. Silakan coba lagi dalam beberapa saat. (${commitErr.code})`
                                            : `Gagal menyimpan perubahan saldo: ${commitErr.message}`;
                                        console.error('[SALDO-MANAGER] Error committing transaction:', {
                                            userId: normalizedUserId,
                                            amount,
                                            errorCode: commitErr.code,
                                            errorMessage: commitErr.message,
                                            userFriendlyMessage: errorMsg
                                        });
                                        return resolve(false);
                                    }

                                    // Record transaction (wrapped in try-catch untuk prevent failure dari breaking operation)
                                    // NOTE: Transaction recording adalah operation terpisah dari database transaction
                                    // Jika recording gagal, saldo tetap valid (sudah di-commit), tapi history tidak lengkap
                                    try {
                                        addTransaction(normalizedUserId, 'debit', amount, description, newSaldo);
                                    } catch (transactionErr) {
                                        // Log error tapi jangan reject - saldo sudah valid
                                        console.error('[SALDO-MANAGER] Error recording transaction (saldo already updated):', transactionErr);
                                        console.warn(`[SALDO-MANAGER] WARNING: Saldo updated but transaction history not recorded for user ${normalizedUserId}, amount ${amount}`);
                                    }

                                    resolve(true);
                                });
                            }
                        );
                    });
                });
            });
        });
    } catch (error) {
        console.error('[SALDO-MANAGER] Error deducting saldo:', error);
        return false;
    }
}

async function updatePushname(userId, pushname) {
    try {
        // Pastikan database sudah diinisialisasi
        await initSaldoDatabase();

        // Gunakan singleton connection saldoDb, bukan membuat connection baru
        return new Promise((resolve) => {
            const now = new Date().toISOString();

            saldoDb.run(
                "UPDATE user_saldo SET pushname = ?, updated_at = ? WHERE user_id = ?",
                [pushname, now, userId],
                function (err) {
                    if (err) {
                        console.error('[SALDO-MANAGER] Error updating pushname:', err);
                        resolve(false);
                    } else {
                        resolve(this.changes > 0);
                    }
                }
            );
        });
    } catch (error) {
        console.error('[SALDO-MANAGER] Error updating pushname:', error);
        return false;
    }
}

// Transaction management (masih menggunakan JSON)
function addTransaction(userId, type, amount, description, balance, topupRequestId = null) {
    const transaction = {
        id: `TRX${Date.now()}${Math.random().toString(36).substr(2, 5)}`.toUpperCase(),
        userId: userId,
        type: type,
        amount: parseInt(amount),
        description: description,
        balance_after: balance,
        topupRequestId: topupRequestId,
        status: 'completed',
        created_at: new Date().toISOString()
    };

    // Log sederhana: hanya informasi penting
    const shortUserId = userId.replace('@s.whatsapp.net', '');
    const amountFormatted = `Rp ${parseInt(amount).toLocaleString('id-ID')}`;
    const balanceFormatted = `Rp ${parseInt(balance).toLocaleString('id-ID')}`;
    console.log(`[TRANSACTION] ${type.toUpperCase()} ${amountFormatted} → ${shortUserId} | Saldo: ${balanceFormatted}`);

    transactions.push(transaction);
    saveTransactions();

    return transaction;
}

function getUserTransactions(userId, limit = 10) {
    return transactions
        .filter(t => t.userId === userId)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, limit);
}

// Topup request management (masih menggunakan JSON)
function createTopupRequest(userId, amount, paymentMethod, agentId = null, customerName = 'Customer') {
    const request = {
        id: generateTopupRequestId(),
        userId: userId,
        customerName: customerName,
        amount: parseInt(amount),
        paymentMethod: paymentMethod,
        agentId: agentId,
        agentTransactionId: null,
        paymentProof: null,
        status: 'pending',
        verifiedBy: null,
        verifiedAt: null,
        notes: null,
        created_at: new Date().toISOString()
    };

    topupRequests.push(request);
    saveTopupRequests();

    // If agent is specified, create agent transaction
    if (agentId) {
        try {
            const agentTransactionManager = require('./agent-transaction-manager');
            const agentManager = require('./agent-manager');

            const agent = agentManager.getAgentById(agentId);
            if (agent) {
                const agentTransaction = agentTransactionManager.createAgentTransaction({
                    topupRequestId: request.id,
                    customerId: userId,
                    customerName: customerName,
                    agentId: agentId,
                    agentName: agent.name,
                    amount: parseInt(amount),
                    transactionType: 'topup'
                });

                const index = topupRequests.findIndex(r => r.id === request.id);
                if (index !== -1) {
                    topupRequests[index].agentTransactionId = agentTransaction.id;
                    saveTopupRequests();
                }

                console.log('[SALDO-MANAGER] Agent transaction created:', agentTransaction.id);
            }
        } catch (error) {
            console.error('[SALDO-MANAGER] Failed to create agent transaction:', error);
        }
    }

    return request;
}

function getTopupRequest(requestId) {
    return topupRequests.find(r => r.id === requestId);
}

function getUserTopupRequests(userId) {
    return topupRequests
        .filter(r => r.userId === userId)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function getPendingTopupRequests() {
    return topupRequests
        .filter(r => r.status === 'pending')
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}

async function verifyTopupRequest(requestId, adminId, approved = true, notes = null) {
    console.log('[VERIFY_TOPUP] Starting verification:', { requestId, adminId, approved });

    const requestIndex = topupRequests.findIndex(r => r.id === requestId);
    if (requestIndex === -1) {
        console.log('[VERIFY_TOPUP] Request not found:', requestId);
        return false;
    }

    const request = topupRequests[requestIndex];
    console.log('[VERIFY_TOPUP] Found request:', { id: request.id, status: request.status, amount: request.amount });

    if (request.status !== 'pending') {
        console.log('[VERIFY_TOPUP] Request status not pending:', request.status);
        return false;
    }

    request.status = approved ? 'verified' : 'rejected';
    request.verifiedBy = adminId;
    request.verifiedAt = new Date().toISOString();
    request.notes = notes;

    saveTopupRequests();
    console.log('[VERIFY_TOPUP] Request updated in database');

    if (approved) {
        console.log('[VERIFY_TOPUP] Calling addSaldo with requestId:', requestId);
        try {
            await addSaldo(request.userId, request.amount, `Topup verified - ${request.paymentMethod}`, null, requestId);
            console.log('[VERIFY_TOPUP] addSaldo completed');
        } catch (error) {
            console.error('[VERIFY_TOPUP] Error adding saldo:', error);
            // Tetap return request meskipun addSaldo gagal (sudah di-update status)
        }
    }

    return request;
}

function purchaseVoucher(userId, voucherProfile) {
    return {
        success: false,
        message: 'Please use voucher-manager.js for voucher purchases'
    };
}

function formatCurrency(amount) {
    return `Rp ${parseInt(amount).toLocaleString('id-ID')}`;
}

// Statistics
function getSaldoStatistics() {
    return new Promise((resolve, reject) => {
        if (!saldoDb) {
            return initSaldoDatabase().then(() => {
                getSaldoStatistics().then(resolve).catch(reject);
            }).catch(reject);
        }

        saldoDb.all("SELECT COUNT(*) as totalUsers, SUM(saldo) as totalSaldo, COUNT(CASE WHEN saldo > 0 THEN 1 END) as activeUsers FROM user_saldo", [], (err, rows) => {
            if (err) {
                return reject(err);
            }

            const row = rows[0] || { totalUsers: 0, totalSaldo: 0, activeUsers: 0 };
            resolve({
                totalUsers: row.totalUsers || 0,
                activeUsers: row.activeUsers || 0,
                totalSaldo: row.totalSaldo || 0,
                averageSaldo: row.totalUsers > 0 ? Math.floor((row.totalSaldo || 0) / row.totalUsers) : 0
            });
        });
    });
}

function getTransactionStatistics(startDate = null, endDate = null) {
    let filteredTransactions = transactions;

    if (startDate) {
        filteredTransactions = filteredTransactions.filter(t =>
            new Date(t.created_at) >= new Date(startDate)
        );
    }

    if (endDate) {
        filteredTransactions = filteredTransactions.filter(t =>
            new Date(t.created_at) <= new Date(endDate)
        );
    }

    const totalTransactions = filteredTransactions.length;
    const totalCredit = filteredTransactions
        .filter(t => t.type === 'credit')
        .reduce((sum, t) => sum + t.amount, 0);
    const totalDebit = filteredTransactions
        .filter(t => t.type === 'debit')
        .reduce((sum, t) => sum + t.amount, 0);

    return {
        totalTransactions,
        totalCredit,
        totalDebit,
        netFlow: totalCredit - totalDebit
    };
}

function cancelTopupRequest(requestId) {
    const index = topupRequests.findIndex(r => r.id === requestId);
    if (index === -1) return false;

    topupRequests[index].status = 'cancelled';
    topupRequests[index].cancelled_at = new Date().toISOString();
    saveTopupRequests();
    return true;
}

async function transferSaldo(fromUserId, toUserId, amount, description = 'Transfer saldo') {
    return new Promise(async (resolve, reject) => {
        try {
            // PENTING: Validasi amount - jangan izinkan amount 0 atau undefined
            if (!amount || amount === 0 || isNaN(amount) || parseInt(amount) <= 0) {
                console.error('[SALDO-MANAGER] Invalid amount for transferSaldo:', amount);
                return resolve(false);
            }

            // PENTING: Normalisasi JID dari @lid ke format standar sebelum operasi database
            // Karena ini async function, normalisasi harus dilakukan di caller (handler)

            let normalizedFromUserId = fromUserId;
            let normalizedToUserId = toUserId;

            // PENTING: Pastikan normalizedUserId tidak mengandung :0 atau format aneh lainnya
            if (normalizedFromUserId && normalizedFromUserId.includes(':')) {
                normalizedFromUserId = normalizedFromUserId.split(':')[0];
                if (!normalizedFromUserId.endsWith('@s.whatsapp.net')) {
                    normalizedFromUserId = normalizedFromUserId + '@s.whatsapp.net';
                }
            }

            if (normalizedToUserId && normalizedToUserId.includes(':')) {
                normalizedToUserId = normalizedToUserId.split(':')[0];
                if (!normalizedToUserId.endsWith('@s.whatsapp.net')) {
                    normalizedToUserId = normalizedToUserId + '@s.whatsapp.net';
                }
            }

            // Jika masih @lid format, log warning dan return false
            // Caller seharusnya sudah normalize sebelum memanggil ini
            if ((normalizedFromUserId && normalizedFromUserId.endsWith('@lid')) ||
                (normalizedToUserId && normalizedToUserId.endsWith('@lid'))) {
                console.warn(`[SALDO-MANAGER] transferSaldo called with @lid format: from=${fromUserId}, to=${toUserId}. Normalize JID before calling this function.`);
                return resolve(false);
            }

            // Pastikan database sudah diinisialisasi
            await initSaldoDatabase();

            if (!saldoDb) {
                console.error('[SALDO-MANAGER] Database not initialized');
                return resolve(false);
            }

            // Gunakan singleton saldoDb connection
            saldoDb.serialize(() => {
                saldoDb.run("BEGIN TRANSACTION", (beginErr) => {
                    if (beginErr) {
                        // Improved error logging dengan context
                        const errorMsg = beginErr.code === 'SQLITE_BUSY' || beginErr.code === 'SQLITE_LOCKED'
                            ? `Database sedang sibuk. Silakan coba lagi dalam beberapa saat. (${beginErr.code})`
                            : `Gagal memulai transaksi transfer: ${beginErr.message}`;
                        console.error('[SALDO-MANAGER] Error beginning transaction:', {
                            fromUserId: normalizedFromUserId,
                            toUserId: normalizedToUserId,
                            amount,
                            errorCode: beginErr.code,
                            errorMessage: beginErr.message,
                            userFriendlyMessage: errorMsg
                        });
                        return resolve(false);
                    }

                    // Cek saldo sender
                    saldoDb.get("SELECT saldo FROM user_saldo WHERE user_id = ?", [normalizedFromUserId], (err, senderRow) => {
                        if (err) {
                            saldoDb.run("ROLLBACK");
                            // Improved error logging dengan context
                            const errorMsg = err.code === 'SQLITE_BUSY' || err.code === 'SQLITE_LOCKED'
                                ? `Database sedang sibuk. Silakan coba lagi dalam beberapa saat. (${err.code})`
                                : `Gagal memeriksa saldo pengirim: ${err.message}`;
                            console.error('[SALDO-MANAGER] Error checking sender saldo:', {
                                fromUserId: normalizedFromUserId,
                                toUserId: normalizedToUserId,
                                amount,
                                errorCode: err.code,
                                errorMessage: err.message,
                                userFriendlyMessage: errorMsg
                            });
                            return resolve(false);
                        }

                        if (!senderRow || senderRow.saldo < amount) {
                            saldoDb.run("ROLLBACK");
                            console.warn(`[SALDO-MANAGER] Insufficient saldo for transfer: sender=${normalizedFromUserId}, current=${senderRow?.saldo || 0}, requested=${amount}`);
                            return resolve(false);
                        }

                        const senderOldSaldo = senderRow.saldo;
                        const senderNewSaldo = senderOldSaldo - amount;

                        // PENTING: Validasi senderNewSaldo tidak boleh negative (double-check setelah calculation)
                        if (senderNewSaldo < 0) {
                            saldoDb.run("ROLLBACK");
                            console.error(`[SALDO-MANAGER] Validation failed: senderNewSaldo would be negative (${senderNewSaldo}) for user ${normalizedFromUserId}`);
                            return resolve(false);
                        }

                        // Update sender
                        saldoDb.run(
                            "UPDATE user_saldo SET saldo = ?, updated_at = ? WHERE user_id = ?",
                            [senderNewSaldo, new Date().toISOString(), normalizedFromUserId],
                            function (updateErr) {
                                if (updateErr) {
                                    saldoDb.run("ROLLBACK");
                                    // Improved error logging dengan context
                                    const errorMsg = updateErr.code === 'SQLITE_BUSY' || updateErr.code === 'SQLITE_LOCKED'
                                        ? `Database sedang sibuk. Silakan coba lagi dalam beberapa saat. (${updateErr.code})`
                                        : updateErr.code === 'SQLITE_CONSTRAINT'
                                            ? `Constraint violation: ${updateErr.message}`
                                            : `Gagal memperbarui saldo pengirim: ${updateErr.message}`;
                                    console.error('[SALDO-MANAGER] Error updating sender saldo:', {
                                        fromUserId: normalizedFromUserId,
                                        toUserId: normalizedToUserId,
                                        amount,
                                        senderNewSaldo,
                                        errorCode: updateErr.code,
                                        errorMessage: updateErr.message,
                                        userFriendlyMessage: errorMsg
                                    });
                                    return resolve(false);
                                }

                                // Pastikan recipient ada
                                saldoDb.run(
                                    "INSERT OR IGNORE INTO user_saldo (user_id, saldo, uang, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                                    [normalizedToUserId, 0, 0, new Date().toISOString(), new Date().toISOString()],
                                    () => {
                                        // Update recipient
                                        saldoDb.get("SELECT saldo FROM user_saldo WHERE user_id = ?", [normalizedToUserId], (err, recipientRow) => {
                                            if (err) {
                                                saldoDb.run("ROLLBACK");
                                                // Improved error logging dengan context
                                                const errorMsg = err.code === 'SQLITE_BUSY' || err.code === 'SQLITE_LOCKED'
                                                    ? `Database sedang sibuk. Silakan coba lagi dalam beberapa saat. (${err.code})`
                                                    : `Gagal memeriksa saldo penerima: ${err.message}`;
                                                console.error('[SALDO-MANAGER] Error checking recipient saldo:', {
                                                    fromUserId: normalizedFromUserId,
                                                    toUserId: normalizedToUserId,
                                                    amount,
                                                    errorCode: err.code,
                                                    errorMessage: err.message,
                                                    userFriendlyMessage: errorMsg
                                                });
                                                return resolve(false);
                                            }

                                            const recipientOldSaldo = recipientRow ? recipientRow.saldo : 0;
                                            const recipientNewSaldo = recipientOldSaldo + amount;

                                            // PENTING: Validasi recipientNewSaldo untuk prevent integer overflow (optional, tapi good practice)
                                            if (recipientNewSaldo > Number.MAX_SAFE_INTEGER) {
                                                saldoDb.run("ROLLBACK");
                                                console.error(`[SALDO-MANAGER] Validation failed: recipientNewSaldo would exceed MAX_SAFE_INTEGER for user ${normalizedToUserId}`);
                                                return resolve(false);
                                            }

                                            saldoDb.run(
                                                "UPDATE user_saldo SET saldo = ?, updated_at = ? WHERE user_id = ?",
                                                [recipientNewSaldo, new Date().toISOString(), normalizedToUserId],
                                                function (updateErr2) {
                                                    if (updateErr2) {
                                                        saldoDb.run("ROLLBACK");
                                                        // Improved error logging dengan context
                                                        const errorMsg = updateErr2.code === 'SQLITE_BUSY' || updateErr2.code === 'SQLITE_LOCKED'
                                                            ? `Database sedang sibuk. Silakan coba lagi dalam beberapa saat. (${updateErr2.code})`
                                                            : updateErr2.code === 'SQLITE_CONSTRAINT'
                                                                ? `Constraint violation: ${updateErr2.message}`
                                                                : `Gagal memperbarui saldo penerima: ${updateErr2.message}`;
                                                        console.error('[SALDO-MANAGER] Error updating recipient saldo:', {
                                                            fromUserId: normalizedFromUserId,
                                                            toUserId: normalizedToUserId,
                                                            amount,
                                                            recipientNewSaldo,
                                                            errorCode: updateErr2.code,
                                                            errorMessage: updateErr2.message,
                                                            userFriendlyMessage: errorMsg
                                                        });
                                                        return resolve(false);
                                                    }

                                                    saldoDb.run("COMMIT", (commitErr) => {
                                                        if (commitErr) {
                                                            console.error('[SALDO-MANAGER] Error committing transaction:', commitErr);
                                                            return resolve(false);
                                                        }

                                                        // Record transactions (wrapped in try-catch untuk prevent failure dari breaking operation)
                                                        // NOTE: Transaction recording adalah operation terpisah dari database transaction
                                                        // Jika recording gagal, saldo tetap valid (sudah di-commit), tapi history tidak lengkap
                                                        try {
                                                            const timestamp = new Date().toISOString();
                                                            transactions.push({
                                                                id: `TX${Date.now()}_1`,
                                                                userId: normalizedFromUserId,
                                                                type: 'debit',
                                                                amount: amount,
                                                                description: `${description} ke ${normalizedToUserId.replace('@s.whatsapp.net', '')}`,
                                                                balance_before: senderOldSaldo,
                                                                balance_after: senderNewSaldo,
                                                                created_at: timestamp
                                                            });
                                                            transactions.push({
                                                                id: `TX${Date.now()}_2`,
                                                                userId: normalizedToUserId,
                                                                type: 'credit',
                                                                amount: amount,
                                                                description: `${description} dari ${normalizedFromUserId.replace('@s.whatsapp.net', '')}`,
                                                                balance_before: recipientOldSaldo,
                                                                balance_after: recipientNewSaldo,
                                                                created_at: timestamp
                                                            });
                                                            saveTransactions();
                                                        } catch (transactionErr) {
                                                            // Log error tapi jangan reject - saldo sudah valid
                                                            console.error('[SALDO-MANAGER] Error recording transactions (saldo already updated):', transactionErr);
                                                            console.warn(`[SALDO-MANAGER] WARNING: Transfer completed but transaction history not recorded: ${normalizedFromUserId} -> ${normalizedToUserId}, amount ${amount}`);
                                                        }

                                                        resolve(true);
                                                    });
                                                }
                                            );
                                        });
                                    }
                                );
                            }
                        );
                    });
                });
            });
        } catch (error) {
            console.error('[SALDO-MANAGER] Error transferring saldo:', error);
            resolve(false);
        }
    });
}

async function processAgentConfirmation(agentTransactionId) {
    console.log('[SALDO-MANAGER] Processing agent confirmation:', agentTransactionId);

    try {
        const agentTransactionManager = require('./agent-transaction-manager');

        const agentTransaction = agentTransactionManager.getTransactionById(agentTransactionId);

        if (!agentTransaction) {
            return {
                success: false,
                message: 'Agent transaction not found'
            };
        }

        if (agentTransaction.status !== 'confirmed') {
            return {
                success: false,
                message: `Agent transaction status is ${agentTransaction.status}, expected confirmed`
            };
        }

        const topupRequest = topupRequests.find(r =>
            r.id === agentTransaction.topupRequestId
        );

        if (!topupRequest) {
            return {
                success: false,
                message: 'Topup request not found'
            };
        }

        const requestIndex = topupRequests.findIndex(r => r.id === topupRequest.id);
        topupRequests[requestIndex].status = 'verified';
        topupRequests[requestIndex].verifiedBy = `agent_${agentTransaction.agentId}`;
        topupRequests[requestIndex].verifiedAt = new Date().toISOString();
        topupRequests[requestIndex].notes = `Confirmed by agent via WhatsApp`;
        saveTopupRequests();

        console.log('[SALDO-MANAGER] Topup request verified:', topupRequest.id);

        try {
            const saldoAdded = await addSaldo(
                agentTransaction.customerId,
                agentTransaction.amount,
                `Topup via agent ${agentTransaction.agentName}`
            );

            if (!saldoAdded) {
                return {
                    success: false,
                    message: 'Failed to add saldo to customer'
                };
            }
        } catch (error) {
            console.error('[SALDO-MANAGER] Error adding saldo:', error);
            return {
                success: false,
                message: 'Failed to add saldo to customer',
                error: error.message
            };
        }

        console.log('[SALDO-MANAGER] Saldo added to customer:', agentTransaction.customerId);

        const completed = agentTransactionManager.completeTransaction(agentTransactionId);

        if (!completed) {
            console.warn('[SALDO-MANAGER] Failed to complete agent transaction, but saldo already added');
        }

        const newSaldo = getUserSaldo(agentTransaction.customerId);

        return {
            success: true,
            topupRequest: topupRequests[requestIndex],
            agentTransaction: agentTransaction,
            newSaldo: newSaldo,
            message: 'Agent confirmation processed successfully'
        };

    } catch (error) {
        console.error('[SALDO-MANAGER] Error processing agent confirmation:', error);
        return {
            success: false,
            message: 'Internal error processing confirmation',
            error: error.message
        };
    }
}

// Get all saldo data (untuk API endpoint)
async function getAllSaldoData() {
    try {
        // Pastikan database dan tabel sudah diinisialisasi
        await initSaldoDatabase();
        // Tunggu sebentar untuk memastikan tabel sudah dibuat
        await new Promise(resolve => setTimeout(resolve, 100));
        return await getAllSaldoDataFromDb();
    } catch (error) {
        // Jika error karena tabel belum ada, return empty array
        if (error.code === 'SQLITE_ERROR' && error.message.includes('no such table')) {
            console.warn('[SALDO-MANAGER] Table belum ada, returning empty array');
            return [];
        }
        console.error('[SALDO-MANAGER] Error getting all saldo data:', error.message);
        return [];
    }
}

// Initialize on load
initDatabase();

module.exports = {
    // Database initialization
    initSaldoDatabase,

    // User saldo
    getUserSaldo,
    getSaldo: getUserSaldo, // Alias for compatibility
    createUserSaldo,
    addSaldo,
    deductSaldo,
    transferSaldo,
    cancelTopupRequest,
    updatePushname,

    // Transactions
    getUserTransactions,

    // Topup requests
    createTopupRequest,
    getTopupRequest,
    getUserTopupRequests,
    getPendingTopupRequests,
    verifyTopupRequest,
    saveTopupRequests,

    // Agent transaction processing
    processAgentConfirmation,

    // Voucher
    purchaseVoucher,

    // Statistics
    getSaldoStatistics,
    getTransactionStatistics,

    // Helpers
    formatCurrency,

    // Reload functions
    reloadTransactions,
    reloadTopupRequests,

    // Get raw data accessors
    getAllSaldoData,
    getAllTransactions: function getAllTransactions() {
        return transactions;
    },
    getAllTopupRequests: function getAllTopupRequests() {
        // Return data dari memory - sudah selalu up-to-date karena langsung di-update saat write operations
        // Tidak perlu reload dari file setiap kali karena ini read operation
        return topupRequests;
    }
};
