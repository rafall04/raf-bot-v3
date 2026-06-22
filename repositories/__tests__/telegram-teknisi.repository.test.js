/**
 * Test telegram-teknisi.repository — CRUD whitelist chat_id dengan load/save in-memory
 * (tidak menyentuh disk). Verifikasi idempotensi add, remove, setEnabled, normalisasi id,
 * dan koherensi cache antar operasi.
 */
"use strict";

const { createTelegramTeknisiRepository } = require("../telegram-teknisi.repository");

function makeRepo(initial = []) {
    let store = JSON.parse(JSON.stringify(initial));
    const repo = createTelegramTeknisiRepository({
        load: () => store,
        save: (data) => {
            store = data;
        },
        now: () => "2026-06-22T00:00:00.000Z",
    });
    return { repo, getStore: () => store };
}

describe("telegram-teknisi.repository", () => {
    test("add baru → tersimpan, isWhitelisted true, addedAt terstempel", () => {
        const { repo } = makeRepo();
        const entry = repo.add({ chatId: 12345, name: "Budi", addedBy: "admin" });
        expect(entry).toMatchObject({ chatId: "12345", name: "Budi", addedBy: "admin", enabled: true });
        expect(entry.addedAt).toBe("2026-06-22T00:00:00.000Z");
        expect(repo.isWhitelisted("12345")).toBe(true);
        expect(repo.isWhitelisted(12345)).toBe(true); // normalisasi number→string
        expect(repo.list()).toHaveLength(1);
    });

    test("add chat_id yang sama → idempoten (update nama, tanpa duplikat)", () => {
        const { repo } = makeRepo();
        repo.add({ chatId: "1", name: "Lama", addedBy: "admin" });
        repo.add({ chatId: "1", name: "Baru", addedBy: "admin2" });
        const all = repo.list();
        expect(all).toHaveLength(1);
        expect(all[0].name).toBe("Baru");
    });

    test("add tanpa chatId → throw", () => {
        const { repo } = makeRepo();
        expect(() => repo.add({ name: "x" })).toThrow();
    });

    test("remove → terhapus, isWhitelisted false", () => {
        const { repo } = makeRepo([{ chatId: "9", name: "X", enabled: true }]);
        expect(repo.remove("9")).toBe(true);
        expect(repo.isWhitelisted("9")).toBe(false);
        expect(repo.list()).toHaveLength(0);
    });

    test("remove id tak ada → false", () => {
        const { repo } = makeRepo([{ chatId: "9", enabled: true }]);
        expect(repo.remove("404")).toBe(false);
    });

    test("setEnabled false → tetap ada tapi tidak whitelisted", () => {
        const { repo } = makeRepo([{ chatId: "7", name: "Eko", enabled: true }]);
        const updated = repo.setEnabled("7", false);
        expect(updated.enabled).toBe(false);
        expect(repo.isWhitelisted("7")).toBe(false);
        expect(repo.find("7")).not.toBeNull(); // masih terdaftar
    });

    test("entri tanpa flag enabled dianggap aktif (default true)", () => {
        const { repo } = makeRepo([{ chatId: "5" }]);
        expect(repo.isWhitelisted("5")).toBe(true);
    });

    test("perubahan langsung tercermin tanpa reload (cache koheren)", () => {
        const { repo, getStore } = makeRepo();
        repo.add({ chatId: "1", name: "A" });
        expect(repo.isWhitelisted("1")).toBe(true);
        repo.remove("1");
        expect(repo.isWhitelisted("1")).toBe(false);
        expect(getStore()).toHaveLength(0);
    });

    test("list mengembalikan salinan (mutasi pemanggil tak merusak cache)", () => {
        const { repo } = makeRepo();
        repo.add({ chatId: "1", name: "A" });
        const snapshot = repo.list();
        snapshot[0].name = "DIUBAH";
        expect(repo.find("1").name).toBe("A");
    });
});
