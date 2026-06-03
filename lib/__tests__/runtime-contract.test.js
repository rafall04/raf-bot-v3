/**
 * Header Doc
 * Purpose: Guardrail test untuk memastikan runtime aplikasi mengekspose registry dependency eksplisit bagi phase runtime-boundary.
 * Caller: Jest test runner.
 * Deps: `../app-runtime`.
 * MainFuncs: Memverifikasi shape dasar `createAppRuntime` untuk config, services, repositories, dan gateways.
 * SideEffects: Memodifikasi `global.__appRuntime` selama test lalu membersihkannya.
 */
"use strict";

const { createAppRuntime } = require("../app-runtime");

describe("runtime contract", () => {
    afterEach(() => {
        delete global.__appRuntime;
    });

    test("runtime exposes explicit registries for config, services, repositories, and gateways", () => {
        const runtime = createAppRuntime({
            globalScope: {},
            dbInitPromise: Promise.resolve()
        });

        expect(runtime).toHaveProperty("config");
        expect(runtime.services).toEqual(expect.any(Object));
        expect(runtime.repositories).toEqual(expect.any(Object));
        expect(runtime.gateways).toEqual(expect.any(Object));
        expect(runtime.adapters).toEqual(expect.any(Object));
        expect(runtime.caches).toEqual(expect.any(Object));
    });
});
