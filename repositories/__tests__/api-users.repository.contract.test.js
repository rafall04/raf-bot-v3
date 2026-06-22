/**
 * Header Doc
 * Purpose: Guardrail contract test untuk repository users/customer API.
 * Caller: Jest test runner.
 * Deps: `../api-users.repository`.
 * MainFuncs: Memverifikasi repository users API membaca snapshot users, account/network-assets snapshot, serta operasi delete/create/update path awal.
 * SideEffects: Tidak ada; runtime dan SQLite dimock in-memory.
 */
"use strict";

const { createApiUsersRepository } = require("../api-users.repository");

describe("api-users repository contract", () => {
    test("repository exposes users snapshot, user lookup, and count comparison", async () => {
        const databaseGet = jest.fn((sql, params, callback) => callback(null, { count: 2 }));
        const close = jest.fn();
        const repository = createApiUsersRepository({
            runtime: {
                repositories: {
                    users: {
                        getAll: jest.fn(() => [
                            { id: 1, name: "User 1" },
                            { id: 2, name: "User 2" }
                        ])
                    }
                }
            },
            sqlite3: {
                OPEN_READONLY: 1,
                Database: jest.fn(() => ({
                    get: databaseGet,
                    close
                }))
            },
            getDatabasePath: jest.fn(() => "users.sqlite")
        });

        expect(repository.getUsersSnapshot()).toHaveLength(2);
        expect(repository.findUserById(2)).toEqual({ id: 2, name: "User 2" });

        const comparison = await repository.getUserCountComparison();
        expect(comparison).toEqual(expect.objectContaining({
            memoryCount: 2,
            dbCount: 2,
            verificationFailed: false
        }));
        expect(databaseGet).toHaveBeenCalled();
        expect(close).toHaveBeenCalled();
    });

    test("repository exposes delete path helpers for users, accounts, and network assets", async () => {
        const run = jest.fn((sql, paramsOrCallback, callback) => {
            if (typeof paramsOrCallback === "function") {
                paramsOrCallback(null);
                return;
            }
            callback(null);
        });
        const setUsers = jest.fn();
        const setNetworkAssets = jest.fn();
        const repository = createApiUsersRepository({
            runtime: {
                getDb: jest.fn(() => ({ run })),
                repositories: {
                    users: {
                        getAll: jest.fn(() => [{ id: 1, name: "User 1" }]),
                        setAll: setUsers
                    },
                    accounts: {
                        getAll: jest.fn(() => [{ id: 9, username: "admin" }])
                    },
                    networkAssets: {
                        getAll: jest.fn(() => [{ id: "odp-1", type: "ODP" }]),
                        setAll: setNetworkAssets
                    }
                }
            },
            sqlite3: {
                OPEN_READONLY: 1,
                Database: jest.fn(() => ({
                    get: jest.fn(),
                    close: jest.fn()
                }))
            },
            getDatabasePath: jest.fn(() => "users.sqlite")
        });

        expect(repository.findAccountById(9)).toEqual({ id: 9, username: "admin" });
        expect(repository.getNetworkAssetsSnapshot()).toEqual([{ id: "odp-1", type: "ODP" }]);

        await repository.deleteUserRecord(1);
        await repository.deleteAllUserRecords();
        repository.replaceUsersSnapshot([]);
        repository.replaceNetworkAssetsSnapshot([]);

        expect(run).toHaveBeenCalledWith("DELETE FROM users WHERE id = ?", [1], expect.any(Function));
        expect(run).toHaveBeenCalledWith("DELETE FROM users", expect.any(Function));
        expect(setUsers).toHaveBeenCalledWith([]);
        expect(setNetworkAssets).toHaveBeenCalledWith([]);
    });

    test("repository builds dynamic update query for user update path", async () => {
        const run = jest.fn((sql, values, callback) => callback(null));
        const repository = createApiUsersRepository({
            runtime: {
                getDb: jest.fn(() => ({ run }))
            },
            sqlite3: {
                OPEN_READONLY: 1,
                Database: jest.fn(() => ({
                    get: jest.fn(),
                    close: jest.fn()
                }))
            },
            getDatabasePath: jest.fn(() => "users.sqlite")
        });

        const result = await repository.updateUserRecord({
            id: "u-1",
            fields: ["phone", "subscription", "paid", "bulk"],
            draftUser: {
                phone_number: "08123",
                subscription: "Premium",
                paid: true,
                bulk: ["1", "2"]
            },
            skipPaidField: true
        });

        expect(result).toEqual({
            updated: true,
            fields: ["phone_number", "subscription", "bulk"]
        });
        expect(run).toHaveBeenCalledWith(
            'UPDATE users SET "phone_number" = ?, "subscription" = ?, "bulk" = ? WHERE id = ?',
            ["08123", "Premium", JSON.stringify(["1", "2"]), "u-1"],
            expect.any(Function)
        );
    });

    test("repository inserts new user record for create path", async () => {
        const run = jest.fn((sql, values, callback) => callback(null));
        const repository = createApiUsersRepository({
            runtime: {
                getDb: jest.fn(() => ({ run }))
            },
            sqlite3: {
                OPEN_READONLY: 1,
                Database: jest.fn(() => ({
                    get: jest.fn(),
                    close: jest.fn()
                }))
            },
            getDatabasePath: jest.fn(() => "users.sqlite")
        });

        await repository.insertUserRecord({
            id: 7,
            name: "User 7",
            phone_number: "081",
            subscription: "Basic",
            device_id: "dev-1",
            paid: false,
            pppoe_username: "ppp-7",
            pppoe_password: "secret",
            connected_odp_id: "odp-1",
            send_invoice: true,
            is_corporate: false,
            bulk: ["1"]
        });

        expect(run).toHaveBeenCalledWith(
            expect.stringContaining("INSERT INTO users"),
            [7, "User 7", "081", "Basic", "dev-1", 0, "ppp-7", "secret", "odp-1", 1, 0, null, null, null, null, null, null, JSON.stringify(["1"]), 1, "pelanggan"],
            expect.any(Function)
        );
    });
});
