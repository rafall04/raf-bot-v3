/**
 * Header Doc
 * Purpose: Smoke test kontrak repository auto outage sebelum logic persistence ditulis.
 * Caller: Jest targeted test Task 1 auto outage skeleton.
 * Deps: `repositories/auto-outage.repository.js`.
 * MainFuncs: Memverifikasi export `createAutoOutageRepository` dan method skeleton.
 * SideEffects: Tidak ada; belum membuka DB nyata karena method masih stub.
 */
"use strict";

const { createAutoOutageRepository } = require("../auto-outage.repository");

describe("auto-outage.repository skeleton", () => {
    test("exports repository contract with sentinel methods", async () => {
        const repository = createAutoOutageRepository({ sqlite3: { verbose: () => ({}) }, getDatabasePath: () => ":memory:" });
        expect(typeof repository.ensureSchema).toBe("function");
        expect(typeof repository.upsertRule).toBe("function");
        expect(typeof repository.listStates).toBe("function");
        await expect(repository.ensureSchema()).rejects.toThrow("AUTO_OUTAGE_REPOSITORY_NOT_IMPLEMENTED");
    });
});
