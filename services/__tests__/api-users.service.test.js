/**
 * Header Doc
 * Purpose: Guardrail test untuk memastikan service users/customer API menjadi owner orchestration awal untuk list users dan update payment status.
 * Caller: Jest test runner.
 * Deps: `../api-users.service`.
 * MainFuncs: Memverifikasi hasil list users, update payment status, create/delete path, dan update user detail memakai repository + boundary domain terinjeksi.
 * SideEffects: Tidak ada; dependency dimock in-memory.
 */
"use strict";

const { createApiUsersService } = require("../api-users.service");

describe("api-users service", () => {
    test("listUsersWithIntegrityCheck returns warning payload when db verification fails", async () => {
        const service = createApiUsersService({
            repository: {
                getUserCountComparison: jest.fn().mockResolvedValue({
                    users: [{ id: 1, name: "User 1" }],
                    memoryCount: 1,
                    dbCount: null,
                    verificationFailed: true,
                    error: new Error("db failed")
                })
            },
            logger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() }
        });

        const result = await service.listUsersWithIntegrityCheck();

        expect(result).toEqual({
            status: 200,
            body: {
                status: 200,
                message: "Data pengguna berhasil dimuat",
                data: [{ id: 1, name: "User 1" }],
                warning: "Database verification failed"
            }
        });
    });

    test("updateUserPaymentStatus validates input and calls finance boundary for paid status", async () => {
        const applyPaymentStatusChange = jest.fn().mockResolvedValue({ action: "paid" });
        const handlePaidStatusChange = jest.fn().mockResolvedValue(undefined);
        const service = createApiUsersService({
            repository: {
                findUserById: jest.fn(() => ({ id: 1, name: "User 1", paid: false }))
            },
            applyPaymentStatusChange,
            handlePaidStatusChange,
            getPeriodParts: jest.fn(() => ({ periodMonth: 4, periodYear: 2026 })),
            getEffectivePrice: jest.fn(() => 10000),
            normalizeUserPaymentMethod: jest.fn(() => "CASH"),
            logger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() }
        });

        const result = await service.updateUserPaymentStatus({
            id: 1,
            paid: true,
            paymentMethodInput: "cash",
            username: "admin"
        });

        expect(applyPaymentStatusChange).toHaveBeenCalled();
        expect(result.status).toBe(200);
        expect(result.body.message).toBe("Status pembayaran berhasil diperbarui");
        const financePayload = applyPaymentStatusChange.mock.calls[0][0];
        await financePayload.onFinalPaid();
        expect(handlePaidStatusChange).toHaveBeenCalled();
    });

    test("deleteUserById removes runtime/db user while keeping pppoe cleanup best-effort", async () => {
        const deleteUserRecord = jest.fn().mockResolvedValue(undefined);
        const replaceUsersSnapshot = jest.fn();
        const logActivity = jest.fn().mockResolvedValue(undefined);
        const deleteActivePPPoEUser = jest.fn().mockResolvedValue({ ok: true });
        const removePPPoESecret = jest.fn().mockResolvedValue({ ok: true });
        const updateOdpPortUsage = jest.fn();
        const repository = {
            findUserById: jest.fn(() => ({
                id: "u-1",
                name: "User 1",
                phone_number: "08",
                subscription: "Basic",
                paid: false,
                pppoe_username: "pppoe-1",
                odp_id: "odp-1",
                odp_port: 3
            })),
            getUsersSnapshot: jest.fn(() => [
                { id: "u-1", name: "User 1" },
                { id: "u-2", name: "User 2" }
            ]),
            deleteUserRecord,
            replaceUsersSnapshot
        };
        const service = createApiUsersService({
            repository,
            logActivity,
            deleteActivePPPoEUser,
            removePPPoESecret,
            updateOdpPortUsage,
            logger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() }
        });

        const result = await service.deleteUserById({
            userId: "u-1",
            actor: { id: 9, username: "admin", role: "admin" },
            requestMeta: { ipAddress: "127.0.0.1", userAgent: "jest" }
        });

        expect(deleteUserRecord).toHaveBeenCalledWith("u-1");
        expect(replaceUsersSnapshot).toHaveBeenCalledWith([{ id: "u-2", name: "User 2" }]);
        expect(deleteActivePPPoEUser).toHaveBeenCalledWith("pppoe-1", { caller: "api.user-delete" });
        expect(removePPPoESecret).toHaveBeenCalledWith("pppoe-1", { caller: "api.user-delete" });
        expect(updateOdpPortUsage).toHaveBeenCalledWith("odp-1", 3, false);
        expect(logActivity).toHaveBeenCalled();
        expect(result).toEqual({
            status: 200,
            body: {
                status: 200,
                message: "User berhasil dihapus"
            }
        });
    });

    test("deleteAllUsers validates admin password, clears users, and resets network assets", async () => {
        const comparePassword = jest.fn().mockResolvedValue(true);
        const deleteAllUserRecords = jest.fn().mockResolvedValue(undefined);
        const replaceUsersSnapshot = jest.fn();
        const replaceNetworkAssetsSnapshot = jest.fn();
        const saveNetworkAssets = jest.fn();
        const deleteActivePPPoEUser = jest.fn().mockResolvedValue({ ok: true });
        const repository = {
            findAccountById: jest.fn(() => ({ id: 9, username: "admin", password: "hashed" })),
            getUsersSnapshot: jest.fn(() => [
                { id: "u-1", pppoe_username: "pppoe-1" },
                { id: "u-2", pppoe_username: null }
            ]),
            deleteAllUserRecords,
            replaceUsersSnapshot,
            getNetworkAssetsSnapshot: jest.fn(() => [
                {
                    id: "odp-1",
                    type: "ODP",
                    ports_used: 1,
                    ports: [{ id: 1, used: true, userId: "u-1" }]
                },
                { id: "router-1", type: "ROUTER" }
            ]),
            replaceNetworkAssetsSnapshot
        };
        const service = createApiUsersService({
            repository,
            comparePassword,
            deleteActivePPPoEUser,
            saveNetworkAssets,
            logger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() }
        });

        const result = await service.deleteAllUsers({
            password: "secret",
            actor: { id: 9, username: "admin" }
        });

        expect(comparePassword).toHaveBeenCalledWith("secret", "hashed");
        expect(deleteActivePPPoEUser).toHaveBeenCalledWith("pppoe-1", { caller: "api.delete-all-users" });
        expect(deleteAllUserRecords).toHaveBeenCalled();
        expect(replaceUsersSnapshot).toHaveBeenCalledWith([]);
        expect(replaceNetworkAssetsSnapshot).toHaveBeenCalledWith([
            {
                id: "odp-1",
                type: "ODP",
                ports_used: 0,
                ports: [{ id: 1, used: false, userId: null }]
            },
            { id: "router-1", type: "ROUTER" }
        ]);
        expect(saveNetworkAssets).toHaveBeenCalled();
        expect(result).toEqual({
            status: 200,
            body: {
                status: 200,
                message: "Semua pengguna berhasil dihapus"
            }
        });
    });

    test("updateUserById updates user detail through repository owner and returns sync metadata", async () => {
        const updateUserRecord = jest.fn().mockResolvedValue({ updated: true, fields: ["phone_number", "subscription"] });
        const replaceUsersSnapshot = jest.fn();
        const applyPaymentStatusChange = jest.fn().mockResolvedValue({ action: "reversed" });
        const logActivity = jest.fn().mockResolvedValue(undefined);
        const service = createApiUsersService({
            repository: {
                findUserById: jest.fn(() => ({
                    id: "u-1",
                    name: "User 1",
                    phone_number: "081",
                    subscription: "Basic",
                    paid: true,
                    pppoe_username: "ppp-1"
                })),
                updateUserRecord,
                getUsersSnapshot: jest.fn(() => [{ id: "u-1", name: "User 1" }]),
                replaceUsersSnapshot
            },
            normalizeUserPaymentMethod: jest.fn(() => "CASH"),
            validatePhoneNumbers: jest.fn().mockResolvedValue({ valid: true }),
            getDb: jest.fn(() => ({ run: jest.fn() })),
            isMikrotikSyncEnabled: jest.fn(() => false),
            buildMikrotikSyncResult: jest.fn((status, message, extra = {}) => ({ status, message, ...extra })),
            applyPaymentStatusChange,
            getPeriodParts: jest.fn(() => ({ periodMonth: 4, periodYear: 2026 })),
            getEffectivePrice: jest.fn(() => 10000),
            logActivity,
            logger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() }
        });

        const result = await service.updateUserById({
            id: "u-1",
            userData: {
                phone: "08222",
                subscription: "Premium",
                paid: false
            },
            actor: { id: 9, username: "admin", role: "admin" },
            requestMeta: { ipAddress: "127.0.0.1", userAgent: "jest" }
        });

        expect(updateUserRecord).toHaveBeenCalled();
        expect(replaceUsersSnapshot).toHaveBeenCalledWith([
            expect.objectContaining({
                id: "u-1",
                phone_number: "08222",
                subscription: "Premium",
                paid: false
            })
        ]);
        expect(logActivity).toHaveBeenCalled();
        expect(result.status).toBe(200);
        expect(result.body.message).toBe("User berhasil diperbarui");
        expect(result.body.sync_status).toBe("applied_locally_sync_disabled");
    });

    test("updateUserById tidak menolak saat halaman edit mengirim ulang pppoe_password kosong (pelanggan tanpa PPPoE)", async () => {
        // Regresi: pelanggan dengan pppoe_password null. Halaman edit (field readonly) tetap
        // mengirim pppoe_username/pppoe_password lewat FormData → nilai display "" masuk ke request.
        // Guard lama membandingkan strict ("" !== null) sehingga edit tak berkaitan (mis. tambah No HP)
        // ikut terblokir 400 "PPPoE password tidak dapat diubah". Sekarang harus lolos 200.
        const updateUserRecord = jest.fn().mockResolvedValue({ updated: true, fields: ["phone_number"] });
        const replaceUsersSnapshot = jest.fn();
        const service = createApiUsersService({
            repository: {
                findUserById: jest.fn(() => ({
                    id: "u-1",
                    name: "Nur Toyibah",
                    phone_number: "",
                    subscription: "PAKET-110K",
                    paid: false,
                    pppoe_username: "ppp-1",
                    pppoe_password: null
                })),
                updateUserRecord,
                getUsersSnapshot: jest.fn(() => [{ id: "u-1", name: "Nur Toyibah" }]),
                replaceUsersSnapshot
            },
            normalizeUserPaymentMethod: jest.fn(() => null),
            validatePhoneNumbers: jest.fn().mockResolvedValue({ valid: true }),
            getDb: jest.fn(() => ({ run: jest.fn() })),
            isMikrotikSyncEnabled: jest.fn(() => false),
            buildMikrotikSyncResult: jest.fn((status, message, extra = {}) => ({ status, message, ...extra })),
            getPeriodParts: jest.fn(() => ({ periodMonth: 7, periodYear: 2026 })),
            getEffectivePrice: jest.fn(() => 110000),
            logActivity: jest.fn().mockResolvedValue(undefined),
            logger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() }
        });

        const result = await service.updateUserById({
            id: "u-1",
            userData: {
                phone: "628123456789",
                subscription: "PAKET-110K",
                paid: false,
                // Nilai display yang dikirim ulang oleh halaman edit:
                pppoe_username: "ppp-1",
                pppoe_password: ""
            },
            actor: { id: 9, username: "admin", role: "admin" },
            requestMeta: { ipAddress: "127.0.0.1", userAgent: "jest" }
        });

        expect(result.status).toBe(200);
        expect(result.body.message).toBe("User berhasil diperbarui");
        // No HP baru tersimpan; kredensial PPPoE tidak ikut terklobber jadi "" (tetap null).
        expect(replaceUsersSnapshot).toHaveBeenCalledWith([
            expect.objectContaining({ id: "u-1", phone_number: "628123456789", pppoe_password: null })
        ]);
    });

    test("upsertUserFromAdminPanel creates new user through repository owner and returns generated credentials", async () => {
        const insertUserRecord = jest.fn().mockResolvedValue(undefined);
        const replaceUsersSnapshot = jest.fn();
        const applyPaymentStatusChange = jest.fn().mockResolvedValue({ action: "paid" });
        const handlePaidStatusChange = jest.fn().mockResolvedValue(undefined);
        const logActivity = jest.fn().mockResolvedValue(undefined);
        const sendMessage = jest.fn().mockResolvedValue({ sent: true });
        const service = createApiUsersService({
            repository: {
                getUsersSnapshot: jest.fn(() => []),
                insertUserRecord,
                replaceUsersSnapshot,
                deleteUserRecord: jest.fn().mockResolvedValue(undefined)
            },
            getNextAvailableUserId: jest.fn().mockResolvedValue(7),
            validatePhoneNumbers: jest.fn().mockResolvedValue({ valid: true }),
            getDb: jest.fn(() => ({ run: jest.fn() })),
            hashPassword: jest.fn().mockResolvedValue("hashed"),
            isMikrotikSyncEnabled: jest.fn(() => false),
            buildMikrotikSyncResult: jest.fn((status, message, extra = {}) => ({ status, message, ...extra })),
            normalizeUserPaymentMethod: jest.fn(() => "CASH"),
            applyPaymentStatusChange,
            handlePaidStatusChange,
            getPeriodParts: jest.fn(() => ({ periodMonth: 4, periodYear: 2026 })),
            getEffectivePrice: jest.fn(() => 10000),
            logActivity,
            getConfig: jest.fn(() => ({ welcomeMessage: { enabled: false } })),
            getPackages: jest.fn(() => []),
            renderTemplate: jest.fn(),
            sendMessage,
            getStatusSnapshot: jest.fn(() => ({ connectionState: "close" })),
            logger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() }
        });

        const result = await service.upsertUserFromAdminPanel({
            userData: {
                name: "User Baru",
                phone_number: "081",
                subscription: "Basic",
                paid: true
            },
            actor: { id: 9, username: "admin", role: "admin" },
            requestMeta: { ipAddress: "127.0.0.1", userAgent: "jest" }
        });

        expect(insertUserRecord).toHaveBeenCalled();
        expect(replaceUsersSnapshot).toHaveBeenCalledWith([
            expect.objectContaining({
                id: 7,
                name: "User Baru"
            })
        ]);
        expect(applyPaymentStatusChange).toHaveBeenCalled();
        const financePayload = applyPaymentStatusChange.mock.calls[0][0];
        await financePayload.onFinalPaid();
        expect(handlePaidStatusChange).toHaveBeenCalled();
        expect(logActivity).toHaveBeenCalled();
        expect(result.status).toBe(201);
        expect(result.body.generated_credentials.username).toBeTruthy();
        expect(result.body.generated_credentials.password).toBeTruthy();
    });
});
