/**
 * Header Doc
 * Purpose: Guardrail test untuk memastikan service broadcast admin mempertahankan validasi WA session, target selection, dan placeholder legacy.
 * Caller: Jest test runner.
 * Deps: `../admin-broadcast.service`.
 * MainFuncs: Memverifikasi accepted path, target kosong, dan placeholder formatting.
 * SideEffects: Tidak ada.
 */
"use strict";

const { createAdminBroadcastService } = require("../admin-broadcast.service");

describe("admin-broadcast.service", () => {
    test("queueBroadcast mengirim accepted dan mempertahankan placeholder user", async () => {
        const sendMessageToMany = jest.fn(() => Promise.resolve({ ok: true }));
        const service = createAdminBroadcastService({
            hasAuthenticatedSession: jest.fn(() => true),
            sendMessageToMany,
            normalizePhoneNumber: jest.fn((value) => value)
        });

        const result = await service.queueBroadcast({
            text: "Halo ${nama} paket ${paket}",
            sendToAll: false,
            selectedUsers: [{ id: 1, name: "Raf", subscription: "20Mbps", phone_number: "08123" }]
        });

        await new Promise((resolve) => setImmediate(resolve));

        expect(result.status).toBe(202);
        expect(sendMessageToMany).toHaveBeenCalledWith(["08123"], { text: "Halo Raf paket 20Mbps" });
    });

    test("queueBroadcast menolak saat whatsapp offline atau target kosong", async () => {
        const offlineService = createAdminBroadcastService({
            hasAuthenticatedSession: jest.fn(() => false)
        });
        await expect(offlineService.queueBroadcast({ text: "x", sendToAll: true, allUsers: [{}] }))
            .rejects.toMatchObject({ statusCode: 500 });

        const emptyTargetService = createAdminBroadcastService({
            hasAuthenticatedSession: jest.fn(() => true)
        });
        await expect(emptyTargetService.queueBroadcast({ text: "x", sendToAll: false, selectedUsers: [] }))
            .rejects.toMatchObject({ statusCode: 400 });
    });
});
