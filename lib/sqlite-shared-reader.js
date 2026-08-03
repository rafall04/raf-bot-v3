/**
 * Header Doc
 * Purpose: Menyediakan koneksi baca SQLite BERUMUR PANJANG (satu per file DB) supaya jalur baca
 *   tidak lagi membuka-tutup koneksi ke DB yang LIVE. Pola buka-tutup berulang pada DB live
 *   terbukti membuat file `-wal`/`-shm` jadi YATIM (ter-unlink saat koneksi persisten app masih
 *   memegangnya) → `global.db` dan koneksi baru memakai indeks WAL yang BERBEDA → `SQLITE_IOERR:
 *   disk I/O error` yang muncul acak dan senyap sampai `pm2 restart`.
 * Caller: `payment-finance-service`, `financial-ledger`, `database-reload` (semua jalur baca
 *   `users.sqlite`). Modul lain yang butuh reader terpisah WAJIB lewat sini, jangan `new
 *   sqlite3.Database()` sendiri ke DB live.
 * Deps: `sqlite3`, `./sqlite-pragmas` (applySqlitePragmas).
 * MainFuncs: `getSharedReader(dbPath)`, `dropSharedReader(dbPath)`, `closeSharedReaders()`.
 * SideEffects: Menyimpan koneksi sqlite terbuka di cache modul sampai `closeSharedReaders()`
 *   dipanggil (shutdown / teardown test).
 */
"use strict";

const sqlite3 = require("sqlite3");

// path DB -> koneksi sqlite3 yang dibiarkan HIDUP.
const readers = new Map();

/**
 * Ambil koneksi baca bersama untuk sebuah file DB. Dibuat sekali lalu dipakai ulang.
 *
 * ⚠️ JANGAN panggil `.close()` pada koneksi hasil fungsi ini — koneksi ini dipakai bersama
 * oleh semua pemanggil. Menutupnya mengembalikan bug WAL yatim yang jadi alasan modul ini ada.
 *
 * @param {string} dbPath - Path absolut file `.sqlite`.
 * @returns {import('sqlite3').Database}
 */
function getSharedReader(dbPath) {
    const existing = readers.get(dbPath);
    if (existing) {
        return existing;
    }

    const db = new sqlite3.Database(dbPath);
    // Pragma di-apply async — perintah yang menyusul tetap aman karena driver sqlite3
    // men-queue statement sampai koneksi siap.
    const { applySqlitePragmas } = require("./sqlite-pragmas");
    applySqlitePragmas(db).catch((pragmaErr) => {
        console.warn(`[SHARED_READER_PRAGMA_WARN] ${dbPath}: ${pragmaErr.message}`);
    });

    readers.set(dbPath, db);
    return db;
}

/**
 * Buang koneksi bersama dari cache lalu tutup. Dipakai sebagai jaring pengaman saat sebuah
 * query gagal dengan error tingkat-file (mis. `SQLITE_IOERR`) supaya panggilan berikutnya
 * membuka koneksi segar, alih-alih terus memakai koneksi yang sudah rusak.
 *
 * @param {string} dbPath
 */
function dropSharedReader(dbPath) {
    const db = readers.get(dbPath);
    if (!db) {
        return;
    }
    readers.delete(dbPath);
    try {
        db.close(() => {});
    } catch (_error) {
        /* koneksi sudah tak valid — tak ada yang bisa diselamatkan */
    }
}

/**
 * Tutup SEMUA koneksi bersama. Dipakai saat shutdown proses dan teardown test supaya
 * handle sqlite tidak menahan event loop.
 *
 * @returns {Promise<void>}
 */
function closeSharedReaders() {
    const pending = [];
    for (const db of readers.values()) {
        pending.push(new Promise((resolve) => {
            try {
                db.close(() => resolve());
            } catch (_error) {
                resolve();
            }
        }));
    }
    readers.clear();
    return Promise.all(pending).then(() => undefined);
}

// Method sqlite3.Database yang diteruskan apa adanya oleh `withoutClose`.
const DELEGATED_METHODS = ["get", "all", "run", "each", "exec", "prepare", "serialize", "parallelize"];

/**
 * Bungkus koneksi bersama supaya `.close()` menjadi NO-OP.
 *
 * Dipakai di route lama yang menyebar `db.close()` di banyak cabang callback: mengganti
 * koneksi per-request dengan koneksi bersama saja tidak cukup, karena `close()` pertama akan
 * mematikan koneksi untuk semua pemakai berikutnya. Membungkus jauh lebih aman daripada
 * membedah belasan cabang callback satu per satu.
 *
 * `this` di callback `run` (untuk `this.lastID` / `this.changes`) tetap utuh karena pemanggilan
 * diteruskan langsung ke driver sqlite3.
 *
 * @param {import('sqlite3').Database} db
 * @returns {object} handle dengan API sama, tapi `close()` tidak melakukan apa-apa.
 */
function withoutClose(db) {
    const handle = {
        close(callback) {
            if (typeof callback === "function") {
                callback(null);
            }
        }
    };

    for (const method of DELEGATED_METHODS) {
        handle[method] = (...args) => db[method](...args);
    }

    return handle;
}

module.exports = {
    getSharedReader,
    dropSharedReader,
    closeSharedReaders,
    withoutClose
};
