/**
 * Header Doc
 * Purpose: Guardrail test untuk memastikan service admin-ops memakai repository/runtime deps alih-alih cache global langsung.
 * Caller: Jest test runner.
 * Deps: `../admin-ops.service`.
 * MainFuncs: Memverifikasi jalur delete memakai repository injection untuk cache users/accounts/catalog.
 * SideEffects: Tidak ada.
 */
"use strict";

const { createAdminOpsService } = require("../admin-ops.service");

describe("admin-ops.service runtime boundary", () => {
    test("deleteEntityByCategory membaca cache users melalui repository injection", async () => {
        const userRepository = {
            getAll: jest.fn(() => [{ id: 1, name: "User 1", connected_odp_id: null }]),
            findIndexById: jest.fn(() => 0),
            removeById: jest.fn(() => [])
        };
        const service = createAdminOpsService({
            userRepository,
            networkAssetsRepository: {
                getAll: jest.fn(() => []),
                setAll: jest.fn()
            },
            runDb: jest.fn().mockResolvedValue({ changes: 1 }),
            saveNetworkAssets: jest.fn()
        });

        const result = await service.deleteEntityByCategory(
            { category: "users", id: 1 },
            { id: 99, username: "admin", role: "owner" },
            {}
        );

        expect(userRepository.findIndexById).toHaveBeenCalledWith(1);
        expect(userRepository.removeById).toHaveBeenCalledWith(1);
        expect(result.status).toBe(200);
    });

    test("deleteEntityByCategory mendelegasikan delete mikrotik device ke admin ops repository", async () => {
        const adminOpsRepository = {
            deleteMikrotikDeviceById: jest.fn(() => ({ deleted: true, devices: [] }))
        };
        const service = createAdminOpsService({
            adminOpsRepository
        });

        const result = await service.deleteEntityByCategory(
            { category: "mikrotik-devices", id: "MT-1" },
            { id: 99, username: "admin", role: "owner" },
            {}
        );

        expect(adminOpsRepository.deleteMikrotikDeviceById).toHaveBeenCalledWith("MT-1");
        expect(result.status).toBe(200);
    });

    test("deleteEntityByCategory mengembalikan pola flat { status, message } tanpa wrapper body", async () => {
        const adminOpsRepository = {
            deleteMikrotikDeviceById: jest.fn(() => ({ deleted: true, devices: [] }))
        };
        const service = createAdminOpsService({
            adminOpsRepository
        });

        const result = await service.deleteEntityByCategory(
            { category: "mikrotik-devices", id: "MT-1" },
            { id: 99, username: "admin", role: "owner" },
            {}
        );

        // Guardrail: pastikan pola flat, bukan { status, body: {...} }
        expect(result).toHaveProperty("status");
        expect(result).toHaveProperty("message");
        expect(result).not.toHaveProperty("body");
        expect(typeof result.message).toBe("string");
    });
});
