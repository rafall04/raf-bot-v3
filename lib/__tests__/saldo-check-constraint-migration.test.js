"use strict";

/**
 * Header Doc
 * Purpose: Regresi (C) — ensureSaldoCheckConstraint: tabel user_saldo LAMA tanpa CHECK(saldo>=0)
 *   di-rebuild dengan constraint (data dipertahankan, saldo negatif di-clamp ke 0), idempoten,
 *   dan constraint benar-benar aktif (UPDATE ke negatif ditolak DB).
 * Caller: Jest test runner (`npx jest lib/__tests__/saldo-check-constraint-migration.test.js`).
 * Deps: `sqlite3`, `fs`, `os`, `path`, `../saldo/shared` (ensureSaldoCheckConstraint).
 * MainFuncs: -
 * SideEffects: Membuat & menghapus file SQLite temporer di os.tmpdir().
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const { ensureSaldoCheckConstraint } = require("../saldo/shared");

const run = (db, sql, params = []) => new Promise((res, rej) => db.run(sql, params, function (e) { return e ? rej(e) : res(this); }));
const get = (db, sql, params = []) => new Promise((res, rej) => db.get(sql, params, (e, r) => (e ? rej(e) : res(r))));

describe("(C) ensureSaldoCheckConstraint — migrasi CHECK(saldo>=0) tabel lama", () => {
    let dbPath;
    let db;

    beforeEach(async () => {
        dbPath = path.join(os.tmpdir(), `saldo_checkmig_${Date.now()}_${Math.random().toString(36).slice(2)}.sqlite`);
        db = new sqlite3.Database(dbPath);
        // Skema LAMA: TANPA CHECK constraint.
        await run(db, `CREATE TABLE user_saldo (
            user_id TEXT PRIMARY KEY,
            saldo INTEGER DEFAULT 0 NOT NULL,
            uang INTEGER DEFAULT 0 NOT NULL,
            pushname TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )`);
        await run(db, "INSERT INTO user_saldo VALUES ('a@s.whatsapp.net', 5000, 10, 'A', 'c1', 'u1')");
        await run(db, "INSERT INTO user_saldo VALUES ('neg@s.whatsapp.net', -300, 0, 'Neg', 'c2', 'u2')");
    });

    afterEach(async () => {
        await new Promise((res) => db.close(() => res()));
        for (const suffix of ["", "-wal", "-shm", ".pre-check-migration.bak"]) {
            try { fs.unlinkSync(dbPath + suffix); } catch (_e) { /* ignore */ }
        }
    });

    test("rebuild: constraint ditambahkan, data dipertahankan, saldo negatif di-clamp ke 0, constraint aktif", async () => {
        const before = await get(db, "SELECT sql FROM sqlite_master WHERE type='table' AND name='user_saldo'");
        expect(before.sql).not.toMatch(/CHECK/i);

        await ensureSaldoCheckConstraint(db, dbPath);

        const after = await get(db, "SELECT sql FROM sqlite_master WHERE type='table' AND name='user_saldo'");
        expect(after.sql).toMatch(/CHECK\s*\(\s*saldo\s*>=\s*0\s*\)/i);

        // Data normal dipertahankan utuh.
        const a = await get(db, "SELECT saldo, uang, pushname, created_at FROM user_saldo WHERE user_id='a@s.whatsapp.net'");
        expect(a).toMatchObject({ saldo: 5000, uang: 10, pushname: "A", created_at: "c1" });

        // Saldo negatif (invalid) di-clamp ke 0.
        const neg = await get(db, "SELECT saldo FROM user_saldo WHERE user_id='neg@s.whatsapp.net'");
        expect(neg.saldo).toBe(0);

        // Constraint AKTIF: update ke negatif ditolak oleh DB.
        await expect(run(db, "UPDATE user_saldo SET saldo = -1 WHERE user_id='a@s.whatsapp.net'")).rejects.toBeTruthy();
    });

    test("idempotent: pemanggilan kedua tidak rebuild ulang / error, constraint tetap ada", async () => {
        await ensureSaldoCheckConstraint(db, dbPath);
        // Jalan kedua kali — harus no-op (constraint sudah terdeteksi), tidak melempar.
        await ensureSaldoCheckConstraint(db, dbPath);

        const after = await get(db, "SELECT sql FROM sqlite_master WHERE type='table' AND name='user_saldo'");
        expect(after.sql).toMatch(/CHECK\s*\(\s*saldo\s*>=\s*0\s*\)/i);
        // Tidak ada sisa tabel kerja migrasi.
        const leftover = await get(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='user_saldo_checkmig'");
        expect(leftover).toBeFalsy();
        // Data tetap utuh.
        const a = await get(db, "SELECT saldo FROM user_saldo WHERE user_id='a@s.whatsapp.net'");
        expect(a.saldo).toBe(5000);
    });
});
