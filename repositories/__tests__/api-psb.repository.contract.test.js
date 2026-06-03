/**
 * Header Doc
 * Purpose: Guardrail contract test untuk repository PSB API.
 * Caller: Jest test runner.
 * Deps: `../api-psb.repository`.
 * MainFuncs: Memverifikasi repository PSB API membaca snapshot runtime/global dan mengelola write-path snapshot/DB PSB secara konsisten.
 * SideEffects: Tidak ada; dependency dimock in-memory.
 */
"use strict";

const { createApiPsbRepository } = require("../api-psb.repository");

describe("api-psb repository contract", () => {
    test("repository reads runtime snapshots and updates psb records via repositories", () => {
        const users = [{ id: 1, name: "User 1" }];
        const psbRecords = [{ id: 10, name: "PSB 1", psb_status: "phase1_completed" }];
        const run = jest.fn(function runDelete(_sql, callback) {
            callback.call({ changes: 2 }, null);
        });
        const repository = createApiPsbRepository({
            runtime: {
                getDb: jest.fn(() => ({ tag: "db" })),
                getConfig: jest.fn(() => ({ defaultPPPoEPassword: "secret" })),
                repositories: {
                    psbDb: { get: jest.fn(() => ({ tag: "psbDb", run })) },
                    users: {
                        getAll: jest.fn(() => users),
                        update: jest.fn((updater) => updater(users))
                    },
                    packages: { getAll: jest.fn(() => [{ profile: "PROFILE-A" }]) },
                    accounts: { getAll: jest.fn(() => [{ username: "admin" }]) },
                    cronConfig: { get: jest.fn(() => ({ accessLimit: 5 })) },
                    psbRecords: {
                        getAll: jest.fn(() => psbRecords),
                        setAll: jest.fn((next) => next),
                        update: jest.fn((updater) => updater(psbRecords))
                    }
                }
            }
        });

        expect(repository.getDb()).toEqual({ tag: "db" });
        expect(repository.getPsbDb()).toEqual({ tag: "psbDb", run });
        expect(repository.getUsersSnapshot()).toEqual(users);
        expect(repository.getPackagesSnapshot()).toEqual([{ profile: "PROFILE-A" }]);
        expect(repository.getAccountsSnapshot()).toEqual([{ username: "admin" }]);
        expect(repository.getConfigSnapshot()).toEqual({ defaultPPPoEPassword: "secret" });
        expect(repository.getCronConfigSnapshot()).toEqual({ accessLimit: 5 });
        expect(repository.getPsbRecordsSnapshot()).toEqual(psbRecords);
        expect(repository.setPsbRecordsSnapshot([{ id: 11 }])).toEqual([{ id: 11 }]);
        expect(repository.updatePsbRecordsSnapshot((current) => [...current, { id: 12 }])).toEqual([
            { id: 10, name: "PSB 1", psb_status: "phase1_completed" },
            { id: 12 }
        ]);
        expect(repository.updateUsers((current) => [...current, { id: 2 }])).toEqual([
            { id: 1, name: "User 1" },
            { id: 2 }
        ]);
        return expect(repository.deleteAllPsbRecords()).resolves.toBe(2);
    });

    test("repository falls back to globals when runtime repositories are absent", () => {
        global.db = { tag: "globalDb" };
        global.psbDb = { tag: "globalPsbDb" };
        global.users = [{ id: 2, name: "Legacy User" }];
        global.packages = [{ profile: "LEGACY" }];
        global.accounts = [{ username: "legacy-admin" }];
        global.config = { nama_wifi: "RAF NET" };
        global.cronConfig = { accessLimit: 3 };
        global.psbRecords = [{ id: 20, name: "Legacy PSB" }];

        const repository = createApiPsbRepository({
            runtime: {
                state: new Map()
            }
        });

        expect(repository.getDb()).toEqual({ tag: "globalDb" });
        expect(repository.getPsbDb()).toEqual({ tag: "globalPsbDb" });
        expect(repository.getUsersSnapshot()).toEqual(global.users);
        expect(repository.getPackagesSnapshot()).toEqual(global.packages);
        expect(repository.getAccountsSnapshot()).toEqual(global.accounts);
        expect(repository.getConfigSnapshot()).toEqual(global.config);
        expect(repository.getCronConfigSnapshot()).toEqual(global.cronConfig);
        expect(repository.getPsbRecordsSnapshot()).toEqual(global.psbRecords);
        expect(repository.setPsbRecordsSnapshot([{ id: 21 }])).toEqual([{ id: 21 }]);
        expect(global.psbRecords).toEqual([{ id: 21 }]);

        delete global.db;
        delete global.psbDb;
        delete global.users;
        delete global.packages;
        delete global.accounts;
        delete global.config;
        delete global.cronConfig;
        delete global.psbRecords;
    });
});
