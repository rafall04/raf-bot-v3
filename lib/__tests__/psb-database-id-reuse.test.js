/**
 * Header Doc
 * Purpose: Uji #b327 — getNextAvailableUserId TIDAK pernah mengalokasikan ulang id yang masih punya
 *   JEJAK FINANSIAL (payment_history/reversals/waivers) — kalau reuse, pelanggan baru mewarisi status
 *   lunas/tunggakan pelanggan lama. Alokasi = MAX+1 lintas union (bukan isi-gap).
 * Caller: Jest.
 * Deps: sqlite3 in-memory sebagai global.db.
 * SideEffects: set global.db/global.users sementara.
 */
'use strict';
const sqlite3 = require('sqlite3').verbose();
const { getNextAvailableUserId } = require('../psb-database');

function run(db, sql, params = []) {
    return new Promise((res, rej) => db.run(sql, params, function (e) { e ? rej(e) : res(this); }));
}

describe('getNextAvailableUserId anti reuse id ber-jejak finansial (#b327)', () => {
    let db;
    beforeEach(async () => {
        db = new sqlite3.Database(':memory:');
        global.db = db;
        global.users = [];
        await run(db, 'CREATE TABLE users (id INTEGER PRIMARY KEY)');
        await run(db, 'CREATE TABLE payment_history (id INTEGER PRIMARY KEY, user_id INTEGER)');
    });
    afterEach((done) => { global.db = null; db.close(done); });

    test('id dengan payment_history TIDAK dipakai ulang (MAX+1 lintas union)', async () => {
        // users 1,2 tersisa; pelanggan 5 sudah dihapus dari users TAPI payment_history-nya tertinggal.
        await run(db, 'INSERT INTO users (id) VALUES (1),(2)');
        await run(db, 'INSERT INTO payment_history (user_id) VALUES (5),(5)');
        expect(await getNextAvailableUserId()).toBe(6); // BUKAN 3 (yang lama-lama mencapai & reuse 5)
    });

    test('tak isi-gap: users 1,3 → next 4 (bukan 2)', async () => {
        await run(db, 'INSERT INTO users (id) VALUES (1),(3)');
        expect(await getNextAvailableUserId()).toBe(4);
    });

    test('tabel finansial belum ada (fresh install) → tetap jalan, MAX+1 users', async () => {
        await run(db, 'DROP TABLE payment_history');
        await run(db, 'INSERT INTO users (id) VALUES (1),(2)');
        expect(await getNextAvailableUserId()).toBe(3);
    });

    test('kosong total → 1', async () => {
        expect(await getNextAvailableUserId()).toBe(1);
    });
});
