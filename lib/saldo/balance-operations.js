/**
 * Header Doc
 * Purpose: Operasi mutasi saldo SQLite high-level — getUserSaldo (sync wrapper), getUserSaldoAsync (internal), createUserSaldo, addSaldo, deductSaldo, updatePushname, plus statistik (`getSaldoStatistics`, `getAllSaldoData`). Semua write operation menggunakan SQLite transaction (BEGIN/COMMIT/ROLLBACK) dengan singleton connection dari `shared.getSaldoDb()` agar tidak men-trigger SQLITE_BUSY error. Setelah COMMIT sukses, ledger transaction di-record via `transactions-store.addTransaction` (best-effort, kegagalan recording tidak meng-rollback saldo).
 * Caller: `lib/saldo-manager.js` (composer re-export public API), `lib/saldo/topup-store.js` (lazy-require addSaldo + getUserSaldo dari verifyTopupRequest + processAgentConfirmation).
 * Deps: `./shared` (initSaldoDatabase, getSaldoDb, normalizeUserJid), `./saldo-repository` (getSaldoFromDb, getAllSaldoDataFromDb), `./transactions-store` (addTransaction).
 * MainFuncs: `getUserSaldo`, `getUserSaldoAsync`, `createUserSaldo`, `addSaldo`, `deductSaldo`, `updatePushname`, `getSaldoStatistics`, `getAllSaldoData`.
 * SideEffects: SQLite write (user_saldo table); JSON write (saldo_transactions.json via transactions-store); console.log untuk audit trail. NOTE: `addTransaction` recording dilakukan setelah COMMIT — error recording di-log tapi tidak meng-rollback saldo (karena saldo sudah valid di DB).
 */
"use strict";

const { initSaldoDatabase, getSaldoDb, normalizeUserJid } = require('./shared');
const { getSaldoFromDb, getUserSaldoDataFromDb, getAllSaldoDataFromDb } = require('./saldo-repository');
const { addTransaction } = require('./transactions-store');

// User saldo management (synchronous untuk backward compatibility)
// FIXED: Menggunakan singleton saldoDb untuk prevent multiple connections dan SQLITE_BUSY errors
function getUserSaldo(userId) {
    try {
        // PENTING: Normalisasi JID dari @lid ke format standar sebelum query database
        // Karena ini sync function, normalisasi harus dilakukan di caller (handler)
        // Tapi kita tetap handle jika ada format aneh seperti :0
        const normalizedUserId = normalizeUserJid(userId);

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
        const normalizedUserId = normalizeUserJid(userId);

        await initSaldoDatabase();
        return await getSaldoFromDb(normalizedUserId);
    } catch (error) {
        console.error('[SALDO-MANAGER] Error getting user saldo:', error);
        return 0;
    }
}

// Ambil row data saldo user (atau null jika belum terdaftar) — untuk cek eksistensi yang benar.
// Berbeda dari getUserSaldo yang mengembalikan 0 untuk user tak ada, fungsi ini mengembalikan null.
async function getUserSaldoData(userId) {
    try {
        const normalizedUserId = normalizeUserJid(userId);
        await initSaldoDatabase();
        return await getUserSaldoDataFromDb(normalizedUserId);
    } catch (error) {
        console.error('[SALDO-MANAGER] Error getting user saldo data:', error);
        return null;
    }
}

async function createUserSaldo(userId, pushname = null) {
    try {
        // PENTING: Normalisasi JID dari @lid ke format standar sebelum operasi database
        // Karena ini async function, normalisasi harus dilakukan di caller (handler)
        const normalizedUserId = normalizeUserJid(userId);

        // Pastikan database sudah diinisialisasi
        await initSaldoDatabase();

        // Gunakan singleton connection saldoDb, bukan membuat connection baru
        return new Promise((resolve) => {
            const saldoDb = getSaldoDb();
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
        // Gunakan normalizedUserId untuk operasi database
        userId = normalizeUserJid(userId);
        // FAIL-CLOSED: JANGAN menulis saldo ke key @lid yang belum ter-resolve ke JID kanonik.
        // Menulis ke @lid membuat saldo nyangkut di key palsu → uang hilang dari akun asli.
        // Caller wajib menormalkan ke 628xxx@s.whatsapp.net (mis. via normalizeJidForSaldo) dulu.
        if (typeof userId === 'string' && userId.endsWith('@lid')) {
            console.error('[SALDO-MANAGER] TOLAK addSaldo: userId masih @lid (belum kanonik), saldo TIDAK ditambahkan', { userId, amount });
            return resolve(false);
        }
        // Pastikan database sudah diinisialisasi dan tabel sudah dibuat
        initSaldoDatabase().then(() => {
            const saldoDb = getSaldoDb();
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
        const normalizedUserId = normalizeUserJid(userId);

        // FAIL-CLOSED: jangan deduct terhadap key @lid yang belum kanonik — hasilnya selalu
        // salah (saldo nyata ada di key 628xxx@s.whatsapp.net). Tolak dengan jelas.
        if (typeof normalizedUserId === 'string' && normalizedUserId.endsWith('@lid')) {
            console.error('[SALDO-MANAGER] TOLAK deductSaldo: userId masih @lid (belum kanonik)', { userId, amount });
            return false;
        }

        // Pastikan database sudah diinisialisasi
        await initSaldoDatabase();
        const saldoDb = getSaldoDb();

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
        const saldoDb = getSaldoDb();

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

// Statistics
function getSaldoStatistics() {
    return new Promise((resolve, reject) => {
        const saldoDb = getSaldoDb();
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

module.exports = {
    getUserSaldo,
    getUserSaldoAsync,
    getUserSaldoData,
    createUserSaldo,
    addSaldo,
    deductSaldo,
    updatePushname,
    getSaldoStatistics,
    getAllSaldoData
};
