/**
 * Header Doc
 * Purpose: Guardrail test untuk service admin hasil decoupling package change dan reload users cache.
 * Caller: Jest test runner.
 * Deps: `../admin.service`.
 * MainFuncs: Verifikasi duplicate request ditolak dan update DB diblok saat sinkronisasi MikroTik gagal.
 * SideEffects: Tidak ada.
 */
"use strict";

jest.mock("../../repositories/admin.repository", () => ({
    createAdminRepository: jest.fn(() => ({}))
}));
jest.mock("../../lib/request-lock", () => ({
    withLock: jest.fn()
}));
jest.mock("../../lib/activity-logger", () => ({
    logActivity: jest.fn()
}));
jest.mock("../../lib/whatsapp-delivery-service", () => ({
    sendMessage: jest.fn(),
    sendMessageToMany: jest.fn()
}));
jest.mock("../../lib/whatsapp-critical-delivery", () => ({
    sendCritical: jest.fn()
}));
jest.mock("../../lib/template-service", () => ({
    renderCategoryTemplate: jest.fn(() => ({ text: "notif-msg" }))
}));
jest.mock("../../lib/mikrotik", () => ({
    updatePPPoEProfile: jest.fn(),
    deleteActivePPPoEUser: jest.fn(),
    assertMikrotikResult: jest.fn(),
    isMikrotikSyncEnabled: jest.fn()
}));

const { createAdminService } = require("../admin.service");

describe("admin.service", () => {
    test("mengembalikan payload seragam untuk daftar package change request", async () => {
        const repository = {
            getPackageChangeRequests: jest.fn().mockReturnValue([
                { id: "REQ-OLD", createdAt: "2026-04-20T10:00:00.000Z" },
                { id: "REQ-NEW", createdAt: "2026-04-21T10:00:00.000Z" }
            ])
        };
        const service = createAdminService({ repository });

        await expect(service.listPackageChangeRequests({
            id: 1,
            username: "owner",
            role: "owner"
        })).resolves.toEqual({
            status: 200,
            message: "Package change requests fetched.",
            data: [
                { id: "REQ-NEW", createdAt: "2026-04-21T10:00:00.000Z" },
                { id: "REQ-OLD", createdAt: "2026-04-20T10:00:00.000Z" }
            ]
        });
    });

    test("menolak duplicate pending package change request", async () => {
        const repository = {
            getUserById: jest.fn().mockReturnValue({ id: 10, subscription: "Basic" }),
            getPackageByName: jest.fn().mockReturnValue({ name: "Pro", price: 100000 }),
            cancelExpiredPackageChangeRequests: jest.fn().mockReturnValue(false),
            findPendingPackageChangeRequestByUserId: jest.fn().mockReturnValue({ id: "REQ-1", status: "pending" })
        };
        const service = createAdminService({
            repository,
            withLock: jest.fn(async (_key, handler) => handler()),
            sendMessageToMany: jest.fn()
        });

        await expect(service.requestPackageChange(
            { userId: 10, newPackageName: "Pro", notes: "" },
            { id: 1, username: "admin", role: "admin", name: "Admin" }
        )).rejects.toMatchObject({ statusCode: 400 });
    });

    test("tidak mengubah DB ketika sinkronisasi MikroTik gagal", async () => {
        const request = {
            id: "REQ-2",
            userId: 20,
            requestedPackageName: "Biz",
            requestedById: 30,
            currentPackageName: "Basic",
            status: "pending"
        };
        const repository = {
            findPackageChangeRequestIndexById: jest.fn().mockReturnValue(0),
            getPackageChangeRequests: jest.fn().mockReturnValue([request]),
            getUserById: jest.fn().mockReturnValue({ id: 20, name: "User A", pppoe_username: "ppp-a", subscription: "Basic" }),
            getPackageByName: jest.fn().mockReturnValue({ name: "Biz", profile: "biz-20m" }),
            getConfig: jest.fn().mockReturnValue({}),
            updateUserSubscription: jest.fn(),
            syncUserSubscriptionCache: jest.fn(),
            replacePackageChangeRequest: jest.fn(),
            persistPackageChangeRequests: jest.fn(),
            getAccountById: jest.fn().mockReturnValue(null)
        };
        const service = createAdminService({
            repository,
            withLock: jest.fn(async (_key, handler) => handler()),
            isMikrotikSyncEnabled: jest.fn().mockReturnValue(true),
            updatePPPoEProfile: jest.fn().mockRejectedValue(new Error("router down")),
            assertMikrotikResult: jest.fn((value) => value),
            deleteActivePPPoEUser: jest.fn(),
            sendMessageToMany: jest.fn(),
            sendMessage: jest.fn()
        });

        await expect(service.approvePackageChange(
            { requestId: "REQ-2", action: "approve", notes: "" },
            { id: 1, username: "admin", role: "admin" }
        )).rejects.toMatchObject({ statusCode: 502 });

        expect(repository.updateUserSubscription).not.toHaveBeenCalled();
    });

    test("approve sukses → notifikasi customer + teknisi lewat sendCritical (guaranteed)", async () => {
        const request = {
            id: "REQ-3",
            userId: 20,
            requestedPackageName: "Biz",
            requestedById: 30,
            currentPackageName: "Basic",
            status: "pending"
        };
        const repository = {
            findPackageChangeRequestIndexById: jest.fn().mockReturnValue(0),
            getPackageChangeRequests: jest.fn().mockReturnValue([request]),
            getUserById: jest.fn().mockReturnValue({ id: 20, name: "User A", pppoe_username: "ppp-a", subscription: "Basic", phone_number: "08123" }),
            getPackageByName: jest.fn().mockReturnValue({ name: "Biz", profile: "biz-20m" }),
            getConfig: jest.fn().mockReturnValue({}),
            updateUserSubscription: jest.fn(),
            syncUserSubscriptionCache: jest.fn(),
            replacePackageChangeRequest: jest.fn(),
            persistPackageChangeRequests: jest.fn(),
            getAccountById: jest.fn().mockReturnValue({ id: 30, name: "Teknisi B", phone_number: "08999" })
        };
        const sendCritical = jest.fn().mockResolvedValue({ delivered: true, attempts: 1 });
        const sendMessageToMany = jest.fn();
        const sendMessage = jest.fn();
        const service = createAdminService({
            repository,
            withLock: jest.fn(async (_key, handler) => handler()),
            isMikrotikSyncEnabled: jest.fn().mockReturnValue(false), // skip MikroTik → fokus notifikasi
            logActivity: jest.fn().mockResolvedValue(true),
            sendCritical,
            sendMessageToMany,
            sendMessage
        });

        const result = await service.approvePackageChange(
            { requestId: "REQ-3", action: "approve", notes: "" },
            { id: 1, username: "admin", role: "admin" }
        );

        expect(result.status).toBe(200);
        expect(repository.updateUserSubscription).toHaveBeenCalledWith(20, "Biz");
        // Customer + teknisi notif lewat sendCritical (BUKAN sendMessageToMany/sendMessage lama).
        expect(sendCritical).toHaveBeenCalledTimes(2);
        const labels = sendCritical.mock.calls.map((c) => c[2].label);
        expect(labels).toContain("package_change_approval");
        expect(labels).toContain("package_change_approval_teknisi");
        expect(sendMessageToMany).not.toHaveBeenCalled();
    });

    test("approve sukses tetap berhasil walau notifikasi gagal (best-effort)", async () => {
        const request = {
            id: "REQ-4", userId: 21, requestedPackageName: "Biz", requestedById: 31,
            currentPackageName: "Basic", status: "pending"
        };
        const repository = {
            findPackageChangeRequestIndexById: jest.fn().mockReturnValue(0),
            getPackageChangeRequests: jest.fn().mockReturnValue([request]),
            getUserById: jest.fn().mockReturnValue({ id: 21, name: "User C", pppoe_username: "ppp-c", subscription: "Basic", phone_number: "08123" }),
            getPackageByName: jest.fn().mockReturnValue({ name: "Biz", profile: "biz-20m" }),
            getConfig: jest.fn().mockReturnValue({}),
            updateUserSubscription: jest.fn(),
            syncUserSubscriptionCache: jest.fn(),
            replacePackageChangeRequest: jest.fn(),
            persistPackageChangeRequests: jest.fn(),
            getAccountById: jest.fn().mockReturnValue(null)
        };
        // sendCritical menolak (throw) → deliverCritical harus menelan, approval tetap 200.
        const sendCritical = jest.fn().mockRejectedValue(new Error("gateway boom"));
        const service = createAdminService({
            repository,
            withLock: jest.fn(async (_key, handler) => handler()),
            isMikrotikSyncEnabled: jest.fn().mockReturnValue(false),
            logActivity: jest.fn().mockResolvedValue(true),
            sendCritical
        });

        const result = await service.approvePackageChange(
            { requestId: "REQ-4", action: "approve", notes: "" },
            { id: 1, username: "admin", role: "admin" }
        );

        expect(result.status).toBe(200);
        expect(repository.updateUserSubscription).toHaveBeenCalledWith(21, "Biz");
    });
});
