/**
 * Header Doc
 * Purpose: Repository SQLite low-level untuk tabel `user_saldo` — read helpers (`getSaldoFromDb`, `getUserSaldoDataFromDb`, `getAllSaldoDataFromDb`) dan write helpers tanpa transaction wrapping (`createUserSaldoInDb`, `updateSaldoInDb`). Berfungsi sebagai thin wrapper di atas `saldoDb.run/get/all` agar caller di operations layer tidak duplikasi pola init+lazy-init+promise.
 * Caller: `lib/saldo/balance-operations.js` (read + lazy createUserSaldo path), `lib/saldo/transfer-operations.js` (tidak langsung — pakai SQL inline karena perlu transaction wrapping). Tidak dipakai handler/service eksternal langsung.
 * Deps: `./shared` (initSaldoDatabase, getSaldoDb).
 * MainFuncs: `getSaldoFromDb(userId)`, `getUserSaldoDataFromDb(userId)`, `getAllSaldoDataFromDb()`, `createUserSaldoInDb(userId, pushname)`, `updateSaldoInDb(userId, newSaldo, pushname)`.
 * SideEffects: Auto-trigger `initSaldoDatabase()` jika `saldoDb` belum ada (lazy bootstrap pattern). Tidak melakukan BEGIN/COMMIT — atomic transaction wrapping adalah tanggung jawab caller (operations layer).
 */
"use strict";

const { initSaldoDatabase, getSaldoDb } = require('./shared');

// SQLite helper functions untuk saldo
function getSaldoFromDb(userId) {
    return new Promise((resolve, reject) => {
        const saldoDb = getSaldoDb();
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
        const saldoDb = getSaldoDb();
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
        const saldoDb = getSaldoDb();
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
        const saldoDb = getSaldoDb();
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
        const saldoDb = getSaldoDb();
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

module.exports = {
    getSaldoFromDb,
    getUserSaldoDataFromDb,
    getAllSaldoDataFromDb,
    createUserSaldoInDb,
    updateSaldoInDb
};
