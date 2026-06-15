/**
 * Header Doc
 * Purpose: Guardrail test untuk memastikan service network API menjadi owner orchestration awal read-model/import route network.
 * Caller: Jest test runner.
 * Deps: `../api-network.service`.
 * MainFuncs: Memverifikasi flow unregistered PPPoE dan devices-for-import mendelegasikan snapshot/import concern ke repository owner.
 * SideEffects: Tidak ada; dependency dimock in-memory.
 */
"use strict";

const { createApiNetworkService } = require("../api-network.service");

describe("api-network service", () => {
    test("sendManualMessage validates whatsapp target and delegates send through owner service", async () => {
        const service = createApiNetworkService({
            getSocket: jest.fn(() => ({
                onWhatsApp: jest.fn().mockResolvedValue([true])
            })),
            isReady: jest.fn(() => true),
            sendMessage: jest.fn().mockResolvedValue({ result: { key: "msg-1" } }),
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() }
        });

        const result = await service.sendManualMessage({
            id: "08123456789@s.whatsapp.net",
            text: "tes"
        });

        expect(service.deps.sendMessage).toHaveBeenCalledWith(
            "08123456789@s.whatsapp.net",
            { text: "tes" },
            { skipDuplicateCheck: true }
        );
        expect(result).toEqual({
            status: 200,
            body: {
                status: 200,
                message: "Success send message with text tes",
                result: { key: "msg-1" }
            }
        });
    });

    test("listUnregisteredPppoeSecrets enriches mikrotik secrets through repository owner", async () => {
        const service = createApiNetworkService({
            repository: {
                buildRegisteredUsernames: jest.fn(() => new Set(["cust-1"])),
                buildProfileToPackageMap: jest.fn(() => ({
                    "profile-a": { name: "Paket A", price: 150000, profile: "PROFILE-A" }
                })),
                getPackagesSnapshot: jest.fn(() => [{ name: "Paket A", profile: "PROFILE-A", price: 150000 }])
            },
            getAllPPPoESecrets: jest.fn().mockResolvedValue({
                data: {
                    secrets: [
                        { name: "cust-1", profile: "PROFILE-A" },
                        { name: "cust-2", profile: "PROFILE-A" }
                    ]
                }
            }),
            assertMikrotikResult: jest.fn(),
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() }
        });

        const result = await service.listUnregisteredPppoeSecrets();

        expect(result.status).toBe(200);
        expect(result.body.data).toEqual([
            {
                name: "cust-2",
                profile: "PROFILE-A",
                matchedPackage: { name: "Paket A", price: 150000, profile: "PROFILE-A" },
                packageName: "Paket A",
                packagePrice: 150000
            }
        ]);
        expect(result.body.stats).toEqual({ total: 2, registered: 1, unregistered: 1 });
    });

    test("listDevicesForImport delegates device identifier set to repository owner", async () => {
        const service = createApiNetworkService({
            repository: {
                buildDeviceIdSet: jest.fn(() => new Set(["DEV-1"]))
            },
            getDevicesForImport: jest.fn().mockResolvedValue({
                ok: true,
                data: [{ id: "DEV-2" }],
                stats: { total: 2, registered: 1, available: 1 }
            }),
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() }
        });

        const result = await service.listDevicesForImport();

        expect(service.deps.getDevicesForImport).toHaveBeenCalledWith(
            new Set(["DEV-1"]),
            expect.objectContaining({
                limit: 1000,
                timeoutMs: 30000,
                operation: "api.genieacs.devicesForImport"
            })
        );
        expect(result).toEqual({
            status: 200,
            body: {
                status: 200,
                message: "Ditemukan 1 device tersedia",
                data: [{ id: "DEV-2" }],
                stats: { total: 2, registered: 1, available: 1 }
            }
        });
    });
});
