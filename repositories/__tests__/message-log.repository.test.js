/**
 * Header Doc
 * Purpose: Unit test repository logger pesan masuk — pastikan simpan/baca/agregat benar dan
 *          `logInbound` tidak pernah throw walau record kosong/rusak.
 * Caller: jest (npx jest repositories/__tests__/message-log.repository.test.js).
 * Deps: `sqlite3` (in-memory), `repositories/message-log.repository`.
 * MainFuncs: -
 * SideEffects: Membuat DB SQLite in-memory sementara per test.
 */
"use strict";

const sqlite3 = require("sqlite3").verbose();
const { createMessageLogRepository } = require("../message-log.repository");

function makeRepo() {
    const db = new sqlite3.Database(":memory:");
    return createMessageLogRepository({ db });
}

describe("message-log.repository", () => {
    test("logInbound menyimpan baris dan getRecent mengembalikannya", async () => {
        const repo = makeRepo();
        const ok = await repo.logInbound({
            raw_sender: "628123@s.whatsapp.net",
            phone_number: "628123",
            pushname: "Budi",
            role: "customer",
            is_customer: true,
            message_type: "conversation",
            body: "internet saya lemot dari pagi"
        });
        expect(ok).toBe(true);

        const rows = await repo.getRecent({ limit: 10 });
        expect(rows).toHaveLength(1);
        expect(rows[0].body).toBe("internet saya lemot dari pagi");
        expect(rows[0].body_length).toBe("internet saya lemot dari pagi".length);
        expect(rows[0].is_customer).toBe(1);
        expect(rows[0].role).toBe("customer");
        await repo.close();
    });

    test("logInbound tidak throw walau record kosong/rusak", async () => {
        const repo = makeRepo();
        await expect(repo.logInbound({})).resolves.toBe(true);
        await expect(repo.logInbound({ body: { weird: true } })).resolves.toBe(true);
        await repo.close();
    });

    test("getRecent bisa difilter customerOnly", async () => {
        const repo = makeRepo();
        await repo.logInbound({ role: "customer", is_customer: true, body: "halo" });
        await repo.logInbound({ role: "owner", is_customer: false, body: "menu" });
        const customerRows = await repo.getRecent({ customerOnly: true });
        expect(customerRows).toHaveLength(1);
        expect(customerRows[0].body).toBe("halo");
        await repo.close();
    });

    test("getStats menghitung total + agregat per peran", async () => {
        const repo = makeRepo();
        await repo.logInbound({ role: "customer", is_customer: true, body: "a" });
        await repo.logInbound({ role: "customer", is_customer: true, body: "b" });
        await repo.logInbound({ role: "owner", body: "c" });
        const stats = await repo.getStats();
        expect(stats.total).toBe(3);
        const customer = stats.by_role.find((r) => r.role === "customer");
        expect(customer.count).toBe(2);
        await repo.close();
    });

    test("pruneOld membuang pesan lebih tua dari retensi, menyisakan yang baru", async () => {
        const repo = makeRepo();
        const iso = (dhariLalu) => new Date(Date.now() - dhariLalu * 24 * 60 * 60 * 1000).toISOString();
        await repo.logInbound({ received_at: iso(200), body: "lama-200hari" });
        await repo.logInbound({ received_at: iso(10), body: "baru-10hari" });
        const dihapus = await repo.pruneOld(180);
        expect(dihapus).toBe(1);
        const sisa = await repo.getRecent({ limit: 10 });
        expect(sisa).toHaveLength(1);
        expect(sisa[0].body).toBe("baru-10hari");
        await repo.close();
    });

    test("pruneOld never-throw + default 180 saat argumen tak wajar", async () => {
        const repo = makeRepo();
        await expect(repo.pruneOld("abc")).resolves.toBe(0);
        await repo.close();
    });
});
