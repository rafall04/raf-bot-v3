/**
 * Header Doc
 * Purpose: Guardrail contract test untuk repository network API.
 * Caller: Jest test runner.
 * Deps: `../api-network.repository`.
 * MainFuncs: Memverifikasi repository network API membaca snapshot runtime/global dan membangun read-model import yang stabil.
 * SideEffects: Tidak ada; dependency dimock in-memory.
 */
"use strict";

const { createApiNetworkRepository } = require("../api-network.repository");

describe("api-network repository contract", () => {
    test("repository reads users, packages, and config from runtime repositories", () => {
        const repository = createApiNetworkRepository({
            runtime: {
                getConfig: jest.fn(() => ({ site_url_bot: "http://localhost" })),
                repositories: {
                    users: {
                        getAll: jest.fn(() => [
                            { id: 1, pppoe_username: "cust-1", device_id: "DEV-1" },
                            { id: 2, pppoe_username: "cust-2", device_id: null }
                        ])
                    },
                    packages: {
                        getAll: jest.fn(() => [
                            { name: "Paket A", profile: "PROFILE-A", price: 150000 },
                            { nama: "Paket B", profile: "PROFILE-B", harga: 175000 }
                        ])
                    }
                }
            }
        });

        expect(repository.getUsersSnapshot()).toHaveLength(2);
        expect(repository.getPackagesSnapshot()).toHaveLength(2);
        expect(repository.getConfigSnapshot()).toEqual({ site_url_bot: "http://localhost" });
        expect([...repository.buildRegisteredUsernames()]).toEqual(["cust-1", "cust-2"]);
        expect(repository.buildProfileToPackageMap()).toEqual({
            "profile-a": { name: "Paket A", price: 150000, profile: "PROFILE-A" },
            "profile-b": { name: "Paket B", price: 175000, profile: "PROFILE-B" }
        });
        expect([...repository.buildDeviceIdSet()]).toEqual(["DEV-1"]);
    });

    test("repository falls back to runtime state and globals when repositories are absent", () => {
        global.users = [{ id: 10, pppoe_username: "legacy-user", device_id: "LEG-1" }];
        global.packages = [{ nama: "Legacy Paket", profile: "LEGACY", harga: 99000 }];
        global.config = { nama_wifi: "RAF NET" };

        const repository = createApiNetworkRepository({
            runtime: {
                state: new Map()
            }
        });

        expect(repository.getUsersSnapshot()).toEqual(global.users);
        expect(repository.getPackagesSnapshot()).toEqual(global.packages);
        expect(repository.getConfigSnapshot()).toEqual(global.config);
        expect([...repository.buildRegisteredUsernames()]).toEqual(["legacy-user"]);
        expect(repository.buildProfileToPackageMap()).toEqual({
            legacy: { name: "Legacy Paket", price: 99000, profile: "LEGACY" }
        });
        expect([...repository.buildDeviceIdSet()]).toEqual(["LEG-1"]);

        delete global.users;
        delete global.packages;
        delete global.config;
    });
});
