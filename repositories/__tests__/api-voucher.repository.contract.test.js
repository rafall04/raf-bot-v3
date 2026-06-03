/**
 * Header Doc
 * Purpose: Guardrail contract test untuk repository voucher API.
 * Caller: Jest test runner.
 * Deps: `../api-voucher.repository`.
 * MainFuncs: Memverifikasi repository voucher API membaca profil voucher runtime/file, history/statistik legacy, dan lookup user/package owner.
 * SideEffects: Tidak ada; dependency dimock in-memory.
 */
"use strict";

const { createApiVoucherRepository } = require("../api-voucher.repository");

describe("api-voucher repository contract", () => {
    test("repository exposes voucher profiles from runtime and history helpers", () => {
        const loadVoucherSentHistory = jest.fn(() => [{ id: "H-1", created_at: "2026-04-23T10:00:00.000Z" }]);
        const appendVoucherSentHistory = jest.fn();
        const findVoucherHistoryByReference = jest.fn(() => [{ id: "H-1" }]);
        const getVoucherSentStats = jest.fn(() => ({ total: 1, sent: 1 }));
        const repository = createApiVoucherRepository({
            runtime: {
                repositories: {
                    voucher: {
                        getAll: jest.fn(() => [{ prof: "P1", namavc: "Voucher 1" }])
                    },
                    users: {
                        getAll: jest.fn(() => [{ id: 9, pppoe: "ppp-9", name: "User 9" }])
                    }
                }
            },
            loadVoucherSentHistory,
            appendVoucherSentHistory,
            findVoucherHistoryByReference,
            getVoucherSentStats
        });

        expect(repository.getVoucherProfiles()).toEqual([{ prof: "P1", namavc: "Voucher 1" }]);
        expect(repository.getVoucherProfileById("P1")).toEqual({ prof: "P1", namavc: "Voucher 1" });
        expect(repository.loadSentHistory()).toEqual([{ id: "H-1", created_at: "2026-04-23T10:00:00.000Z" }]);
        expect(repository.findHistoryByReference([], "REF-1")).toEqual([{ id: "H-1" }]);
        expect(repository.getSentStats([])).toEqual({ total: 1, sent: 1 });
        return repository.findUserById(9).then((user) => {
            expect(user).toEqual({ id: 9, pppoe: "ppp-9", name: "User 9" });
            expect(repository.findPackageByName("Paket A")).toBeNull();

            repository.appendSentHistory([{ id: "H-2" }]);
            expect(appendVoucherSentHistory).toHaveBeenCalledWith([{ id: "H-2" }]);
        });
    });

    test("repository falls back to sqlite lookup when runtime user is absent", async () => {
        const get = jest.fn((sql, params, callback) => callback(null, { id: 11, pppoe: "ppp-11", nama: "User 11" }));
        const close = jest.fn();
        const repository = createApiVoucherRepository({
            runtime: {
                repositories: {
                    users: {
                        getAll: jest.fn(() => [])
                    },
                    packages: {
                        getAll: jest.fn(() => [{ nama: "Paket A", profile: "PA" }])
                    }
                }
            },
            sqlite3: {
                Database: jest.fn(() => ({ get, close }))
            },
            loadVoucherSentHistory: jest.fn(() => []),
            appendVoucherSentHistory: jest.fn(),
            findVoucherHistoryByReference: jest.fn(() => []),
            getVoucherSentStats: jest.fn(() => ({}))
        });

        const user = await repository.findUserById(11);
        expect(user).toEqual({ id: 11, pppoe: "ppp-11", nama: "User 11" });
        expect(repository.findPackageByName("Paket A")).toEqual({ nama: "Paket A", profile: "PA" });
        expect(get).toHaveBeenCalled();
        expect(close).toHaveBeenCalled();
    });
});
