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

// Database paths — lewat getDatabasePath supaya di NODE_ENV=test menulis ke *_test.json, BUKAN
// menimpa ledger transaksi & topup pending PRODUKSI saat `npm test` (getDatabasePath kini menjaga
// ekstensi .json). Prod tetap database/saldo_transactions.json & topup_requests.json.
const TRANSACTIONS_DB = getDatabasePath('saldo_transactions.json');
const TOPUP_REQUESTS_DB = getDatabasePath('topup_requests.json');
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

                // Migrasi idempoten: pastikan tabel LAMA punya CHECK(saldo >= 0). Tabel baru
                // sudah punya dari CREATE di atas; tabel lama (dibuat sebelum constraint ada)
                // di-rebuild SEKALI oleh ensureSaldoCheckConstraint (atomik via transaksi + backup).
                ensureSaldoCheckConstraint(saldoDb, SALDO_DB_PATH).then(() => {
                    // Buat index untuk performa (re-create — tabel mungkin baru saja di-rebuild).
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
    });
}

/**
 * (C) Migrasi idempoten: pastikan tabel `user_saldo` punya CHECK(saldo >= 0) sebagai backstop DB
 * terakhir terhadap saldo negatif. SQLite tidak bisa `ALTER TABLE ADD CONSTRAINT`, jadi tabel lama
 * (dibuat sebelum constraint ada) di-rebuild: backup (VACUUM INTO, best-effort) → transaksi atomik
 * (BEGIN IMMEDIATE → create tabel baru ber-CHECK → copy data, clamp saldo negatif ke 0 → drop →
 * rename → COMMIT). Idempotent: kalau constraint sudah ada, langsung return tanpa rebuild.
 * Fail-safe: bila skema tak terbaca / migrasi error → rollback dan biarkan startup lanjut.
 * @param {sqlite3.Database} db
 * @param {string} [dbPath] path file DB (untuk lokasi backup VACUUM INTO)
 */
function ensureSaldoCheckConstraint(db, dbPath) {
    const runAsync = (sql) => new Promise((res, rej) => db.run(sql, (e) => (e ? rej(e) : res())));
    const getAsync = (sql) => new Promise((res, rej) => db.get(sql, (e, r) => (e ? rej(e) : res(r))));
    const allAsync = (sql) => new Promise((res, rej) => db.all(sql, (e, r) => (e ? rej(e) : res(r))));

    return (async () => {
        let row;
        try {
            row = await getAsync("SELECT sql FROM sqlite_master WHERE type='table' AND name='user_saldo'");
        } catch (e) {
            console.warn('[SALDO_MIGRATION] Gagal baca skema user_saldo (skip migrasi):', e.message);
            return;
        }
        if (!row || !row.sql) return;
        if (/CHECK\s*\(\s*saldo\s*>=\s*0\s*\)/i.test(String(row.sql))) {
            return; // Constraint sudah ada → idempotent, tidak perlu rebuild.
        }

        console.log('[SALDO_MIGRATION] user_saldo belum punya CHECK(saldo>=0); menjalankan migrasi rebuild...');

        // Backup best-effort: snapshot konsisten DB live (VACUUM INTO butuh file target belum ada).
        if (dbPath) {
            const backupPath = `${dbPath}.pre-check-migration.bak`;
            try { if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath); } catch (_e) { /* ignore */ }
            try {
                await runAsync(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
                console.log(`[SALDO_MIGRATION] Backup dibuat: ${backupPath}`);
            } catch (e) {
                console.warn('[SALDO_MIGRATION] Backup VACUUM INTO gagal (lanjut — migrasi tetap atomik via transaksi):', e.message);
            }
        }

        try {
            await runAsync("BEGIN IMMEDIATE TRANSACTION");
            const negRows = await allAsync("SELECT user_id, saldo FROM user_saldo WHERE saldo < 0");
            if (negRows && negRows.length) {
                console.warn(`[SALDO_MIGRATION] ${negRows.length} baris saldo NEGATIF (invalid) di-clamp ke 0 saat migrasi:`, negRows);
            }
            await runAsync("DROP TABLE IF EXISTS user_saldo_checkmig");
            await runAsync(`CREATE TABLE user_saldo_checkmig (
                user_id TEXT PRIMARY KEY,
                saldo INTEGER DEFAULT 0 NOT NULL CHECK(saldo >= 0),
                uang INTEGER DEFAULT 0 NOT NULL,
                pushname TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )`);
            await runAsync(`INSERT INTO user_saldo_checkmig (user_id, saldo, uang, pushname, created_at, updated_at)
                SELECT user_id, CASE WHEN saldo < 0 THEN 0 ELSE saldo END, uang, pushname, created_at, updated_at FROM user_saldo`);
            await runAsync("DROP TABLE user_saldo");
            await runAsync("ALTER TABLE user_saldo_checkmig RENAME TO user_saldo");
            await runAsync("COMMIT");
            console.log('[SALDO_MIGRATION] ✅ CHECK(saldo>=0) berhasil diterapkan ke user_saldo.');
        } catch (e) {
            console.error('[SALDO_MIGRATION] Migrasi GAGAL — rollback, tabel tidak berubah:', e.message);
            try { await runAsync("ROLLBACK"); } catch (_e) { /* ignore */ }
        }
    })();
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

// ===== H3: Serializer global untuk semua MUTASI saldo (anti race read-modify-write) =====
// Semua write saldo (addSaldo/deductSaldo/transferSaldo) berbagi SATU koneksi SQLite singleton.
// Tanpa serialisasi, operasi konkuren bisa: (a) saling baca saldo basi lalu menulis hasil basi →
// double-spend, (b) `BEGIN` bersarang ("cannot start a transaction within a transaction"),
// (c) statement single dari satu operasi tersapu ke dalam transaksi operasi lain di koneksi sama.
// Mutex promise-chain ini menjamin setiap mutasi saldo berjalan satu-per-satu (serial).
let saldoWriteChain = Promise.resolve();
function withSaldoWriteLock(fn) {
    const result = saldoWriteChain.then(() => fn());
    // Rantai HARUS tetap hidup walau fn gagal — telan hasil/eror agar lock berikutnya tidak
    // ikut ter-reject dan antrian tidak macet.
    saldoWriteChain = result.then(() => undefined, () => undefined);
    return result;
}

module.exports = {
    TRANSACTIONS_DB,
    TOPUP_REQUESTS_DB,
    SALDO_DB_PATH,
    initSaldoDatabase,
    ensureSaldoCheckConstraint,
    getSaldoDb,
    normalizeUserJid,
    formatCurrency,
    withSaldoWriteLock
};
