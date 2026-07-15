/**
 * Header Doc
 * Purpose: Guardrail repo riwayat broadcast — pastikan daftar penerima SUKSES & GAGAL tersimpan &
 *          ter-parse balik, dan migrasi kolom `sent_user_ids_json` aman untuk DB lama.
 * Caller: Jest.
 * Deps: `../broadcast.repository`, `sqlite3` (in-memory).
 * MainFuncs: round-trip insert/list; migrasi ADD COLUMN idempoten.
 * SideEffects: Membuat DB SQLite in-memory per test.
 */
"use strict";

const sqlite3 = require("sqlite3").verbose();
const { createBroadcastRepository } = require("../broadcast.repository");

function runOn(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function onRun(err) {
            if (err) reject(err); else resolve(this);
        });
    });
}

function makeRepo(db) {
    return createBroadcastRepository({ db, getDatabasePath: () => ":memory:" });
}

describe("broadcast.repository — daftar penerima", () => {
    test("round-trip: sent_user_ids & failed_user_ids tersimpan dan ter-parse balik", async () => {
        const db = new sqlite3.Database(":memory:");
        const repo = makeRepo(db);

        await repo.insertHistory({
            mode: "manual",
            operator: "raf",
            template_key: "broadcast_tagihan",
            total_targets: 2,
            total_sent: 1,
            total_failed: 1,
            sent_user_ids_json: [{ user_id: 1, name: "Budi", recipients: ["08111"] }],
            failed_user_ids_json: [{ user_id: 2, name: "Sinta", reason: "missing_phone_number" }]
        });

        const { items } = await repo.listHistory();
        expect(items).toHaveLength(1);
        expect(items[0].total_sent).toBe(1);
        expect(items[0].sent_user_ids).toEqual([{ user_id: 1, name: "Budi", recipients: ["08111"] }]);
        expect(items[0].failed_user_ids).toEqual([{ user_id: 2, name: "Sinta", reason: "missing_phone_number" }]);
        await repo.close();
    });

    test("migrasi: DB lama tanpa kolom sent_user_ids_json → ensureSchema menambah kolom, insert tetap jalan", async () => {
        const db = new sqlite3.Database(":memory:");
        // Skema LAMA (sebelum fitur daftar penerima sukses) — tanpa sent_user_ids_json.
        await runOn(db, `
            CREATE TABLE broadcast_history (
                id TEXT PRIMARY KEY,
                started_at TEXT NOT NULL,
                finished_at TEXT,
                mode TEXT NOT NULL,
                filter TEXT,
                template_key TEXT,
                message_preview TEXT,
                total_targets INTEGER NOT NULL DEFAULT 0,
                total_sent INTEGER NOT NULL DEFAULT 0,
                total_failed INTEGER NOT NULL DEFAULT 0,
                force_include_opt_out INTEGER NOT NULL DEFAULT 0,
                operator TEXT,
                failed_user_ids_json TEXT NOT NULL DEFAULT '[]'
            )
        `);
        // Baris lama (belum ada kolom sent) — harus tetap terbaca dgn sent_user_ids default [].
        await runOn(db, `INSERT INTO broadcast_history (id, started_at, mode, total_sent) VALUES ('old1','2026-07-01T00:00:00Z','manual',3)`);

        const repo = makeRepo(db);
        await repo.ensureSchema(); // memicu ALTER TABLE ADD COLUMN sent_user_ids_json

        await repo.insertHistory({
            id: "new1",
            mode: "manual",
            total_sent: 1,
            sent_user_ids_json: [{ user_id: 9, name: "Andi" }]
        });

        const { items } = await repo.listHistory();
        const byId = Object.fromEntries(items.map((r) => [r.id, r]));
        expect(byId.old1.sent_user_ids).toEqual([]);          // baris lama: default aman
        expect(byId.new1.sent_user_ids).toEqual([{ user_id: 9, name: "Andi" }]);
        await repo.close();
    });
});
