/**
 * Header Doc
 * Purpose: Helper terpusat untuk pragma SQLite — WAL mode (writer tidak block reader), synchronous=NORMAL, dan busy_timeout. Plus utilitas checkpoint WAL sebelum file backup, dan cleanup file companion `-wal`/`-shm` setelah restore.
 * Caller: Setiap `new sqlite3.Database()` open path di `lib/*` (database, payment-finance-service, monitoring-service, dll). Backup pipeline (`telegram-backup`, `database-migration-manager`) panggil `walCheckpoint` sebelum `copyFileSync`. `error-recovery` panggil `cleanupWalCompanions` setelah restore.
 * Deps: Tidak ada (pure helper untuk sqlite3 instance yang sudah dibuka).
 * MainFuncs: `applySqlitePragmas(db, options)`, `walCheckpoint(db)`, `cleanupWalCompanions(dbFilePath)`.
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
 * Flush semua data dari file `-wal` ke file `.sqlite` utama, lalu truncate WAL.
 * WAJIB dipanggil sebelum melakukan file-level backup (`fs.copyFileSync`) ke
 * DB yang aktif di WAL mode — kalau tidak, backup bisa kehilangan transaksi
 * terbaru yang masih nyangkut di WAL.
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
    cleanupWalCompanions,
    DEFAULT_BUSY_TIMEOUT_MS
};
