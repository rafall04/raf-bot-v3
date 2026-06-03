/**
 * Header Doc
 * Purpose: Guardrail contract test untuk runtime cache repository bersama.
 * Caller: Jest test runner.
 * Deps: `../runtime-cache.repository`.
 * MainFuncs: Memverifikasi accessor cache utama tersedia dan dapat membaca runtime/global fallback.
 * SideEffects: Tidak ada.
 */
"use strict";

const { createRuntimeCacheRepository } = require("../runtime-cache.repository");

describe("runtime cache repository", () => {
    test("exposes user/account/catalog accessors", () => {
        const repository = createRuntimeCacheRepository({
            globalScope: {
                users: [{ id: 1, device_id: "ONT-1" }],
                accounts: [{ id: 7 }],
                statik: [{ prof: "S-1" }],
                voucher: [{ prof: "V-1" }],
                networkAssets: [],
                reports: []
            }
        });

        expect(repository.users.getById(1)).toEqual({ id: 1, device_id: "ONT-1" });
        expect(repository.users.findByDeviceId("ONT-1")).toEqual({ id: 1, device_id: "ONT-1" });
        expect(repository.accounts.getById(7)).toEqual({ id: 7 });
        expect(repository.statik.getById("S-1")).toEqual({ prof: "S-1" });
        expect(repository.voucher.getById("V-1")).toEqual({ prof: "V-1" });
    });
});
