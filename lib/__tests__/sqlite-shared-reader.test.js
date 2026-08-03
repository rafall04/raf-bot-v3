/**
 * Header Doc
 * Purpose: Mengunci kontrak `lib/sqlite-shared-reader` — satu koneksi baca per file DB, dipakai
 *   ulang, dan TIDAK ditutup per operasi. Plus regresi inti insiden 03-08-2026: siklus baca
 *   berulang tidak boleh membuat file `-wal`/`-shm` DB live berganti/hilang, karena itulah yang
 *   me-yatimkan koneksi tulis app dan memunculkan `SQLITE_IOERR: disk I/O error` senyap.
 * Caller: Jest test runner.
 * Deps: `fs`, `os`, `path`, `sqlite3`, `../sqlite-shared-reader`.
 * MainFuncs: - (suite test).
 * SideEffects: Membuat DB sqlite sementara di direktori temp lalu menutup koneksi saat teardown.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const sqlite3 = require("sqlite3");

const {
    getSharedReader,
    dropSharedReader,
    closeSharedReaders
} = require("../sqlite-shared-reader");

describe("sqlite-shared-reader", () => {
    let tempDir;
    let dbPath;
    let writer;

    function run(db, sql, params = []) {
        return new Promise((resolve, reject) => {
            db.run(sql, params, function onRun(err) {
                if (err) reject(err);
                else resolve({ changes: this.changes });
            });
        });
    }

    function all(db, sql, params = []) {
        return new Promise((resolve, reject) => {
            db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
        });
    }

    function inodeOf(filePath) {
        try {
            return fs.statSync(filePath).ino;
        } catch (_e) {
            return null;
        }
    }

    beforeEach(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "raf-shared-reader-"));
        dbPath = path.join(tempDir, "users-test.sqlite");
        writer = new sqlite3.Database(dbPath);
        await run(writer, "PRAGMA journal_mode = WAL");
        await run(writer, "CREATE TABLE payment_history (id INTEGER PRIMARY KEY, amount_paid INTEGER)");
        await run(writer, "INSERT INTO payment_history (id, amount_paid) VALUES (1, 150000)");
    });

    afterEach(async () => {
        await closeSharedReaders();
        await new Promise((resolve) => writer.close(() => resolve()));
    });

    test("memakai ulang koneksi yang sama untuk path yang sama", () => {
        const a = getSharedReader(dbPath);
        const b = getSharedReader(dbPath);
        expect(b).toBe(a);
    });

    test("path berbeda mendapat koneksi berbeda", () => {
        const lain = path.join(tempDir, "lain-test.sqlite");
        expect(getSharedReader(lain)).not.toBe(getSharedReader(dbPath));
    });

    test("dropSharedReader memaksa koneksi baru pada panggilan berikutnya", () => {
        const pertama = getSharedReader(dbPath);
        dropSharedReader(dbPath);
        expect(getSharedReader(dbPath)).not.toBe(pertama);
    });

    // REGRESI INTI: sebelum perbaikan, tiap operasi baca membuka koneksi baru lalu menutupnya.
    // Churn buka-tutup itu membuat `-wal`/`-shm` ter-unlink sementara koneksi tulis app masih
    // memegangnya → tulis berikutnya gagal `SQLITE_IOERR` sampai proses direstart.
    test("siklus baca berulang tidak mengganti/menghapus -wal dan tulis tetap berhasil", async () => {
        await run(writer, "INSERT INTO payment_history (id, amount_paid) VALUES (2, 125000)");

        const walAwal = inodeOf(`${dbPath}-wal`);
        const shmAwal = inodeOf(`${dbPath}-shm`);
        expect(walAwal).not.toBeNull();

        for (let i = 0; i < 25; i += 1) {
            const reader = getSharedReader(dbPath);
            const rows = await all(reader, "SELECT id FROM payment_history");
            expect(rows.length).toBeGreaterThan(0);
        }

        expect(inodeOf(`${dbPath}-wal`)).toBe(walAwal);
        expect(inodeOf(`${dbPath}-shm`)).toBe(shmAwal);

        // Koneksi tulis app tetap sehat setelah semua siklus baca itu.
        await expect(
            run(writer, "INSERT INTO payment_history (id, amount_paid) VALUES (3, 100000)")
        ).resolves.toEqual({ changes: 1 });

        const akhir = await all(writer, "SELECT id FROM payment_history ORDER BY id");
        expect(akhir.map((r) => r.id)).toEqual([1, 2, 3]);
    });

    test("closeSharedReaders menutup semua koneksi dan aman dipanggil dua kali", async () => {
        getSharedReader(dbPath);
        getSharedReader(path.join(tempDir, "lain2-test.sqlite"));
        await expect(closeSharedReaders()).resolves.toBeUndefined();
        await expect(closeSharedReaders()).resolves.toBeUndefined();
    });
});
