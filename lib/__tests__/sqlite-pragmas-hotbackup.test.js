/**
 * Header Doc
 * Purpose: Unit test `hotBackupSqlite` — backup HOT DB SQLite WAL tanpa membuka koneksi ke DB
 *          LIVE (akar bug wedge fatal: koneksi terpisah yg checkpoint/vacuum me-wedge global.db).
 *          Verifikasi: backup single-file konsisten (termasuk data yg masih di -wal) + koneksi
 *          sumber tak diganggu (masih bisa nulis setelah backup).
 * Caller: Jest.
 * Deps: `lib/sqlite-pragmas`, `sqlite3`, `fs`, `os`, `path`.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const sqlite3 = require("sqlite3");
const { applySqlitePragmas, hotBackupSqlite } = require("../sqlite-pragmas");

function openDb(p, mode) {
    return new Promise((res, rej) => {
        const db = mode != null ? new sqlite3.Database(p, mode, (e) => (e ? rej(e) : res(db)))
            : new sqlite3.Database(p, (e) => (e ? rej(e) : res(db)));
    });
}
const run = (db, sql, params = []) => new Promise((res, rej) => db.run(sql, params, function (e) { e ? rej(e) : res(this); }));
const get = (db, sql) => new Promise((res, rej) => db.get(sql, (e, r) => (e ? rej(e) : res(r))));
const close = (db) => new Promise((res) => db.close(() => res()));

describe("hotBackupSqlite", () => {
    let dir, src;
    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "hotbk-")); src = path.join(dir, "src.sqlite"); });
    afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) { /* best-effort */ } });

    test("backup single-file konsisten dari sumber WAL — termasuk data yang masih di -wal", async () => {
        const db = await openDb(src);
        await applySqlitePragmas(db); // WAL mode
        await run(db, "CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT)");
        for (let i = 1; i <= 50; i++) await run(db, "INSERT INTO t(id,v) VALUES(?,?)", [i, "x" + i]);
        // Koneksi sumber SENGAJA tetap terbuka (simulasi DB live) → 50 insert masih di -wal.

        const dest = path.join(dir, "backup.sqlite");
        await hotBackupSqlite(src, dest);

        expect(fs.existsSync(dest)).toBe(true);
        expect(fs.existsSync(dest + "-wal")).toBe(false); // sudah dikonsolidasi → single-file

        const bdb = await openDb(dest, sqlite3.OPEN_READONLY);
        const row = await get(bdb, "SELECT COUNT(*) n FROM t");
        expect(row.n).toBe(50); // seluruh data (termasuk yg tadi di -wal) tertangkap
        await close(bdb);
        await close(db);
    });

    test("tidak menutup/mengganggu koneksi sumber — sumber tetap bisa nulis setelah backup", async () => {
        const db = await openDb(src);
        await applySqlitePragmas(db);
        await run(db, "CREATE TABLE t(id INTEGER PRIMARY KEY)");
        await run(db, "INSERT INTO t VALUES(1)");

        await hotBackupSqlite(src, path.join(dir, "bk2.sqlite"));

        // hotBackup TIDAK memakai koneksi sumber → sumber masih hidup & bisa menulis.
        await run(db, "INSERT INTO t VALUES(2)");
        const row = await get(db, "SELECT COUNT(*) n FROM t");
        expect(row.n).toBe(2);
        await close(db);
    });
});
