/**
 * Header Doc
 * Purpose: Helper terpusat untuk pragma SQLite — WAL mode (writer tidak block reader), synchronous=NORMAL, dan busy_timeout. Plus utilitas checkpoint WAL sebelum file backup, dan cleanup file companion `-wal`/`-shm` setelah restore.
 * Caller: Setiap `new sqlite3.Database()` open path di `lib/*` (database, payment-finance-service, monitoring-service, dll). Backup pipeline (`telegram-backup`, `database-migration-manager`) panggil `hotBackupSqlite` (BUKAN lagi `walCheckpoint` pada DB live — itu me-wedge global.db). `error-recovery` panggil `cleanupWalCompanions` setelah restore.
 * Deps: lazy-require `sqlite3` (hanya di `hotBackupSqlite`); `fs`.
 * MainFuncs: `applySqlitePragmas(db, options)`, `hotBackupSqlite(srcPath, destPath)` (backup aman tanpa koneksi ke DB live), `walCheckpoint(db)` (HANYA utk koneksi app persisten), `cleanupWalCompanions(dbFilePath)`.
 * SideEffects: Set pragmas pada koneksi sqlite (idempotent), hapus file `*-wal`/`*-shm` saat cleanup.
 */
"use strict";

const fs = require("fs");

const DEFAULT_BUSY_TIMEOUT_MS = 10000;

/**
 * Apply standar pragma RAF BOT ke sebuah koneksi sqlite3.
 *
 * - `journal_mode = WAL` — Write-Ahead Logging, writer tidak block reader.
 *   Persisted di header DB file; cukup di-set sekali per file, tapi memanggil
 *   ulang di tiap koneksi aman (idempotent).
 * - `synchronous = NORMAL` — fsync lebih jarang. Di WAL mode, kombinasi ini
 *   tetap crash-safe (tidak corrupt), hanya bisa kehilangan beberapa transaksi
 *   terakhir saat power loss. Trade-off durability/performance yang sesuai
 *   untuk app monitoring/billing skala kecil.
 * - `busy_timeout = 10000` — koneksi tunggu hingga 10 detik bila ada lock,
 *   alih-alih langsung error SQLITE_BUSY.
 *
 * @param {import('sqlite3').Database} db
 * @param {{ busyTimeout?: number }} [options]
 * @returns {Promise<void>}
 */
function applySqlitePragmas(db, options = {}) {
    const busyTimeout = Number.isFinite(options.busyTimeout) ? options.busyTimeout : DEFAULT_BUSY_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run("PRAGMA journal_mode = WAL", (err) => {
                if (err) {
                    // Non-fatal: bila DB sedang dipegang exclusive oleh proses lain
                    // (mis. saat migration), pragma bisa ditolak. Log dan lanjut.
                    console.warn(`[SQLITE_PRAGMA_WARN] Gagal set journal_mode=WAL: ${err.message}`);
                }
            });
            db.run("PRAGMA synchronous = NORMAL", (err) => {
                if (err) {
                    console.warn(`[SQLITE_PRAGMA_WARN] Gagal set synchronous=NORMAL: ${err.message}`);
                }
            });
            db.run(`PRAGMA busy_timeout = ${busyTimeout}`, (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve();
            });
        });
    });
}

/**
 * Backup HOT sebuah DB SQLite (WAL mode) ke `destPath` TANPA membuka koneksi apa pun
 * ke DB LIVE — ini WAJIB untuk mencegah bug WEDGE fatal.
 *
 * AKAR BUG (terbukti 2026-07-06, node-sqlite3 5.1.7): membuka koneksi TERPISAH ke file
 * DB yang LIVE (lalu apa pun — `wal_checkpoint`/`VACUUM INTO`/dll — lalu close) me-WEDGE
 * koneksi `global.db` persisten milik app → SEMUA `db.run` berikutnya gagal DIAM-DIAM
 * (SQLITE_IOERR, tapi `db.run` tak melempar) sampai `pm2 restart`. Auto-checkpoint via
 * koneksi app SENDIRI aman; yang beracun spesifik = koneksi TERPISAH ke DB live.
 *
 * Strategi aman (terbukti tak wedge): (1) copy file `main`+`-wal`+`-shm` via `fs` MURNI
 * (tanpa koneksi → mustahil wedge); (2) konsolidasi WAL via checkpoint pada SALINAN backup
 * (file LAIN, bukan DB live → aman) → hasil single-file konsisten; (3) bersihkan companion
 * salinan. Race checkpoint-live saat copy dapat diabaikan untuk DB kecil (auto-checkpoint
 * jarang) + recovery WAL SQLite menoleransi tail tak lengkap.
 *
 * @param {string} srcPath - Path DB `.sqlite` LIVE.
 * @param {string} destPath - Path file backup tujuan (single-file).
 * @returns {Promise<void>}
 */
async function hotBackupSqlite(srcPath, destPath) {
    const sqlite3 = require("sqlite3");
    // 1) Copy file live TANPA koneksi (mustahil wedge). Companion opsional.
    fs.copyFileSync(srcPath, destPath);
    for (const suffix of ["-wal", "-shm"]) {
        try {
            if (fs.existsSync(`${srcPath}${suffix}`)) {
                fs.copyFileSync(`${srcPath}${suffix}`, `${destPath}${suffix}`);
            }
        } catch (e) {
            console.warn(`[HOT_BACKUP_WARN] Gagal copy companion ${suffix}: ${e.message}`);
        }
    }
    // 2) Konsolidasi WAL pada SALINAN backup (BUKAN DB live) → aman, single-file.
    await new Promise((resolve) => {
        const db = new sqlite3.Database(destPath, (err) => {
            if (err) {
                console.warn(`[HOT_BACKUP_WARN] Tidak bisa open salinan untuk konsolidasi: ${err.message}`);
                resolve();
                return;
            }
            db.run("PRAGMA wal_checkpoint(TRUNCATE)", () => db.close(() => resolve()));
        });
    });
    // 3) Bersihkan companion salinan (sudah ter-konsolidasi ke main).
    cleanupWalCompanions(destPath);
}

/**
 * Flush semua data dari file `-wal` ke file `.sqlite` utama, lalu truncate WAL.
 *
 * ⚠️ PERINGATAN FATAL: panggil HANYA pada koneksi APP PERSISTEN (mis. `global.db`).
 * JANGAN membuka koneksi BARU ke DB LIVE lalu memanggil ini — koneksi terpisah yang
 * checkpoint me-WEDGE `global.db` (SQLITE_IOERR senyap sampai restart; lihat
 * `hotBackupSqlite` untuk akar & solusi). Untuk backup, pakai `hotBackupSqlite`.
 *
 * @param {import('sqlite3').Database} db
 * @returns {Promise<void>}
 */
function walCheckpoint(db) {
    return new Promise((resolve) => {
        // TRUNCATE mode: setelah checkpoint, file WAL di-truncate ke 0 byte.
        // Backup hasil copy file .sqlite akan berisi state terkini.
        db.run("PRAGMA wal_checkpoint(TRUNCATE)", (err) => {
            if (err) {
                console.warn(`[SQLITE_WAL_CHECKPOINT_WARN] ${err.message}`);
            }
            resolve();
        });
    });
}

/**
 * Hapus file companion WAL/SHM yang masih nyangkut setelah restore DB dari
 * backup. Setelah restore via `fs.copyFile`, file `-wal`/`-shm` lama bisa
 * mengandung header tidak konsisten yang membuat SQLite menolak open atau
 * recovery jadi aneh. Hapus saja — file akan dibuat ulang kosong di open
 * berikutnya.
 *
 * @param {string} dbFilePath - Path absolute ke file `.sqlite` utama.
 */
function cleanupWalCompanions(dbFilePath) {
    for (const suffix of ["-wal", "-shm"]) {
        const companionPath = `${dbFilePath}${suffix}`;
        try {
            if (fs.existsSync(companionPath)) {
                fs.unlinkSync(companionPath);
            }
        } catch (e) {
            console.warn(`[SQLITE_WAL_CLEANUP_WARN] Gagal hapus ${companionPath}: ${e.message}`);
        }
    }
}

module.exports = {
    applySqlitePragmas,
    walCheckpoint,
    hotBackupSqlite,
    cleanupWalCompanions,
    DEFAULT_BUSY_TIMEOUT_MS
};
