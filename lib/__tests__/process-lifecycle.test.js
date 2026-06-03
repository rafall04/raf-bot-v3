/**
 * Header Doc
 * Purpose: Guardrail untuk memastikan bootstrap lifecycle process tetap mendaftarkan monitor hook dan handler utama tanpa mengubah crash policy.
 * Caller: Jest.
 * Deps: `../process-lifecycle`.
 * MainFuncs: Memverifikasi pendaftaran `unhandledRejection`, `uncaughtExceptionMonitor`, `uncaughtException`, `SIGTERM`, dan `SIGINT`.
 * SideEffects: Memock `process.on` selama test lalu mengembalikannya.
 */
"use strict";

describe("process lifecycle registration", () => {
    test("registers monitor hook and main process handlers", () => {
        jest.resetModules();
        const onSpy = jest.spyOn(process, "on").mockImplementation(() => process);
        const { registerProcessLifecycleHandlers } = require("../process-lifecycle");

        registerProcessLifecycleHandlers({
            runtime: { getDb: () => null },
            CustomerTrafficUsageService: null,
            closeLogsDatabase: null,
        });

        const registeredEvents = onSpy.mock.calls.map(([eventName]) => eventName);
        expect(registeredEvents).toEqual(expect.arrayContaining([
            "unhandledRejection",
            "uncaughtExceptionMonitor",
            "uncaughtException",
            "SIGTERM",
            "SIGINT",
        ]));

        onSpy.mockRestore();
    });
});
