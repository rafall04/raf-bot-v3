/**
 * Header Doc
 * Purpose: Shared util untuk semua sub-modul saldo (`saldo-repository`, `balance-operations`, `transfer-operations`, `transactions-store`, `topup-store`). Berisi konstanta path DB, JID normalization, formatCurrency utility, dan singleton SQLite database connection getter (`getSaldoDb`/`initSaldoDatabase`). Connection di-share lintas modul untuk mencegah multiple sqlite3 connections (penyebab `SQLITE_BUSY` errors).
 * Caller: `lib/saldo/saldo-repository.js`, `lib/saldo/balance-operations.js`, `lib/saldo/transfer-operations.js`, `lib/saldo/transactions-store.js`, `lib/saldo/topup-store.js`, `lib/saldo-manager.js` (composer).
 * Deps: `fs`, `path`, `sqlite3`, `../env-config` (getDatabasePath), `../sqlite-pragmas` (applySqlitePragmas — di-require module-load time, bukan lazy).
 * MainFuncs: `normalizeUserJid`, `formatCurrency`, `initSaldoDatabase`, `getSaldoDb`, plus konstanta path.
 * SideEffects: `initSaldoDatabase` membuka koneksi SQLite ke `saldo.sqlite` dan create table+index `user_saldo` (idempotent via `IF NOT EXISTS`); set `busyTimeout` 5000ms untuk auto-retry pada lock.
 */
"use strict";

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const { getDatabasePath } = require('../env-config');
// Hoisted ke module-load time (BUKAN lazy require di dalam open-callback async).
// Jika di-require lazy di dalam callback `new sqlite3.Database(...)`, callback bisa
// fire SETELAH Jest tear-down module registry (suite selesai) → require kembalikan
// modul kosong → `applySqlitePragmas` undefined → throw di dalam callback sqlite3 →
// uncaught → proses crash → suite berikutnya di batch `--runInBand` gagal palsu.
const { applySqlitePragmas } = require('../sqlite-pragmas');

// Database paths
const TRANSACTIONS_DB = path.join(__dirname, '..', '..', 'database', 'saldo_transactions.json');
const TOPUP_REQUESTS_DB = path.join(__dirname, '..', '..', 'database', 'topup_requests.json');
const SALDO_DB_PATH = getDatabasePath('saldo.sqlite');

// Singleton SQLite connection. Encapsulated via getter so cross-module readers
// always observe the most recent reference (penting untuk testing/reset scenario).
let saldoDb = null;

function getSaldoDb() {
    return saldoDb;
}

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

            // Aktifkan WAL mode + synchronous=NORMAL (idempotent).
            // `applySqlitePragmas` di-resolve module-load time (lihat require di atas),
            // jadi referensi aman dipakai meski callback ini fire post-teardown.
            applySqlitePragmas(saldoDb, { busyTimeout: 5000 }).catch((pragmaErr) => {
                console.warn(`[SALDO_DB_PRAGMA_WARN] ${pragmaErr.message}`);
            });

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

/**
 * Normalize WhatsApp JID dari format aneh (`@lid`, `:0` suffix, no domain) ke format standar
 * `<digits>@s.whatsapp.net`. Idempotent — JID yang sudah benar dikembalikan apa adanya.
 * Penting: dipakai konsisten di semua write path saldo (add/deduct/transfer) untuk mencegah
 * data tertulis ke key yang salah (mis. `123:0@s.whatsapp.net` vs `123@s.whatsapp.net`).
 */
function normalizeUserJid(userId) {
    let normalizedUserId = userId;

    // PENTING: Pastikan normalizedUserId tidak mengandung :0 atau format aneh lainnya
    if (normalizedUserId && normalizedUserId.includes(':')) {
        normalizedUserId = normalizedUserId.split(':')[0];
        if (!normalizedUserId.endsWith('@s.whatsapp.net')) {
            normalizedUserId = normalizedUserId + '@s.whatsapp.net';
        }
    }

    return normalizedUserId;
}

function formatCurrency(amount) {
    return `Rp ${parseInt(amount).toLocaleString('id-ID')}`;
}

module.exports = {
    TRANSACTIONS_DB,
    TOPUP_REQUESTS_DB,
    SALDO_DB_PATH,
    initSaldoDatabase,
    getSaldoDb,
    normalizeUserJid,
    formatCurrency
};
