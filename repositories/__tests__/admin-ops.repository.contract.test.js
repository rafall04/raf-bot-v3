/**
 * Header Doc
 * Purpose: Guardrail contract test untuk repository admin ops.
 * Caller: Jest test runner.
 * Deps: `../admin-ops.repository`.
 * MainFuncs: Memverifikasi repository admin ops mengekspos read/delete utility untuk `mikrotik_devices.json`.
 * SideEffects: Tidak ada; load/save JSON dimock in-memory.
 */
"use strict";

const { createAdminOpsRepository } = require("../admin-ops.repository");

describe("admin-ops repository contract", () => {
    test("admin ops repository deletes mikrotik device through JSON adapter", () => {
        const saveJSON = jest.fn();
        const repository = createAdminOpsRepository({
            loadJSON: jest.fn().mockReturnValue([
                { id: "1", name: "Mikrotik A" },
                { id: "2", name: "Mikrotik B" }
            ]),
            saveJSON
        });

        expect(repository.getMikrotikDevices).toEqual(expect.any(Function));
        expect(repository.deleteMikrotikDeviceById).toEqual(expect.any(Function));

        const result = repository.deleteMikrotikDeviceById("1");

        expect(result).toEqual({
            deleted: true,
            devices: [{ id: "2", name: "Mikrotik B" }]
        });
        expect(saveJSON).toHaveBeenCalledWith("mikrotik_devices.json", [{ id: "2", name: "Mikrotik B" }]);
    });
});
