/**
 * Purpose: Guardrail test untuk repository runtime setelah domain `voucher` ditambahkan.
 * Caller: Jest test runner.
 * Deps: `../runtime-state` dan `../runtime-repositories`.
 * MainFuncs: Memverifikasi mode array/object dan write path repository.
 * SideEffects: Tidak ada.
 */
"use strict";

const { createRuntimeState } = require("../runtime-state");
const {
    createRuntimeRepositories,
    getRuntimeCollection,
    getRuntimeConfig,
    resolveRuntimeBindings
} = require("../runtime-repositories");

describe("runtime-repositories", () => {
    test("repository voucher menggunakan write path wrapper, bukan mutasi manual", () => {
        const globalScope = { voucher: [{ prof: "VC1" }] };
        const repositories = createRuntimeRepositories(createRuntimeState(globalScope));

        repositories.voucher.push({ prof: "VC2" });

        expect(repositories.voucher.getAll()).toEqual([{ prof: "VC1" }, { prof: "VC2" }]);
        expect(globalScope.voucher).toEqual([{ prof: "VC1" }, { prof: "VC2" }]);
    });

    test("repository cronConfig tetap mode object", () => {
        const globalScope = { cronConfig: { enabled: true } };
        const repositories = createRuntimeRepositories(createRuntimeState(globalScope));

        repositories.cronConfig.merge({ interval: "0 0 * * *" });

        expect(repositories.cronConfig.getAll()).toEqual({
            enabled: true,
            interval: "0 0 * * *"
        });
    });

    test("runtime binding helpers membaca config dan collection lewat runtime/global compatibility boundary", () => {
        const globalScope = {
            config: { nama: "RAFNET" },
            users: [{ id: 1, name: "Budi" }]
        };
        const repositories = createRuntimeRepositories(createRuntimeState(globalScope));
        const runtime = {
            globalScope,
            repositories,
            getConfig() {
                return globalScope.config;
            }
        };

        expect(resolveRuntimeBindings(runtime).globalScope).toBe(globalScope);
        expect(getRuntimeConfig(runtime)).toEqual({ nama: "RAFNET" });
        expect(getRuntimeCollection(runtime, "users")).toEqual([{ id: 1, name: "Budi" }]);
    });
});
