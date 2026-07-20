"use strict";

const { handlePackageRequestAdminState, STEP_SELECT, STEP_CONFIRM } = require("../package-request-admin.state");

const CODE = "req_pkg_1720000000000_ab12c";
const CODE2 = "req_pkg_1720000000001_xy99z";

const ADMIN = { id: 1, username: "ana", role: "admin", name: "Ana" };

function snap(id, userName) {
    return {
        id,
        userName,
        currentPackageName: "Paket 10Mbps",
        requestedPackageName: "Paket 20Mbps",
        requestedPackagePrice: 200000,
        requestedBy: "teknisi1",
        createdAt: "2026-07-10T03:00:00.000Z"
    };
}

function fakeService(overrides = {}) {
    return {
        listPendingPackageChangeRequests: jest.fn(async () => ({ data: [] })),
        approvePackageChange: jest.fn(async () => ({ action: "approve", request: snap(CODE, "Budi") })),
        ...overrides
    };
}

function baseCtx(userState, overrides = {}) {
    return {
        chats: "",
        userState,
        stateSender: "628111@s.whatsapp.net",
        sender: "628111@s.whatsapp.net",
        plainSenderNumber: "628111",
        pushname: "Ana",
        accounts: [],
        isGlobalCommand: false,
        reply: jest.fn(async () => {}),
        setUserState: jest.fn(),
        deleteUserState: jest.fn(),
        resolveStaffAccount: () => ADMIN,
        ...overrides
    };
}

const SELECT_STATE = { step: STEP_SELECT, action: "approve", items: [snap(CODE2, "Siti"), snap(CODE, "Budi")] };

describe("PKGREQ_SELECT", () => {
    test("angka polos '1' → prompt penegasan (state CONFIRM), belum eksekusi", async () => {
        const service = fakeService();
        const ctx = baseCtx(SELECT_STATE, { chats: "1", service });

        const res = await handlePackageRequestAdminState(ctx);

        expect(res.handled).toBe(true);
        expect(service.approvePackageChange).not.toHaveBeenCalled();
        expect(ctx.setUserState).toHaveBeenCalledWith(
            "628111@s.whatsapp.net",
            expect.objectContaining({ step: STEP_CONFIRM, action: "approve", id: CODE2 })
        );
    });

    test("'ok 1' → resolve nomor ke id lalu approve", async () => {
        const service = fakeService();
        const ctx = baseCtx(SELECT_STATE, { chats: "ok 1", service });

        await handlePackageRequestAdminState(ctx);

        expect(service.approvePackageChange).toHaveBeenCalledWith(
            { requestId: CODE2, action: "approve", notes: "" },
            expect.any(Object)
        );
        expect(ctx.deleteUserState).toHaveBeenCalled();
    });

    test("'tolak 2 <alasan>' → reject pada request kedua dengan alasan", async () => {
        const service = fakeService({ approvePackageChange: jest.fn(async () => ({ action: "reject", request: snap(CODE, "Budi") })) });
        const ctx = baseCtx(SELECT_STATE, { chats: "tolak 2 harga kemahalan", service });

        await handlePackageRequestAdminState(ctx);

        expect(service.approvePackageChange).toHaveBeenCalledWith(
            { requestId: CODE, action: "reject", notes: "harga kemahalan" },
            expect.any(Object)
        );
    });

    test("'batalkan 1' → cancel pada request pertama", async () => {
        const service = fakeService({ approvePackageChange: jest.fn(async () => ({ action: "cancel", request: snap(CODE2, "Siti") })) });
        const ctx = baseCtx(SELECT_STATE, { chats: "batalkan 1", service });

        await handlePackageRequestAdminState(ctx);

        expect(service.approvePackageChange).toHaveBeenCalledWith(
            { requestId: CODE2, action: "cancel", notes: "" },
            expect.any(Object)
        );
    });

    test("nomor di luar jangkauan → pesan tidak valid, bukan eksekusi", async () => {
        const service = fakeService();
        const ctx = baseCtx(SELECT_STATE, { chats: "9", service });

        await handlePackageRequestAdminState(ctx);

        expect(service.approvePackageChange).not.toHaveBeenCalled();
        expect(ctx.reply.mock.calls[0][0]).toContain("tidak valid");
    });

    test("perintah global (menu) → dilepas (handled:false) agar admin bisa keluar", async () => {
        const service = fakeService();
        const ctx = baseCtx(SELECT_STATE, { chats: "menu", service, isGlobalCommand: true });

        const res = await handlePackageRequestAdminState(ctx);

        expect(res.handled).toBe(false);
        expect(service.approvePackageChange).not.toHaveBeenCalled();
    });
});

describe("PKGREQ_CONFIRM", () => {
    test("action approve + 'ya' → approve", async () => {
        const service = fakeService();
        const ctx = baseCtx({ step: STEP_CONFIRM, action: "approve", id: CODE }, { chats: "ya", service });

        await handlePackageRequestAdminState(ctx);

        expect(service.approvePackageChange).toHaveBeenCalledWith(
            { requestId: CODE, action: "approve", notes: "" },
            expect.any(Object)
        );
        expect(ctx.deleteUserState).toHaveBeenCalled();
    });

    test("action cancel + 'ya' → cancel", async () => {
        const service = fakeService({ approvePackageChange: jest.fn(async () => ({ action: "cancel", request: snap(CODE, "Budi") })) });
        const ctx = baseCtx({ step: STEP_CONFIRM, action: "cancel", id: CODE }, { chats: "ya", service });

        await handlePackageRequestAdminState(ctx);

        expect(service.approvePackageChange).toHaveBeenCalledWith(
            { requestId: CODE, action: "cancel", notes: "" },
            expect.any(Object)
        );
    });

    test("action reject + teks bebas → dipakai sebagai alasan", async () => {
        const service = fakeService({ approvePackageChange: jest.fn(async () => ({ action: "reject", request: snap(CODE, "Budi") })) });
        const ctx = baseCtx({ step: STEP_CONFIRM, action: "reject", id: CODE }, { chats: "salah paket", service });

        await handlePackageRequestAdminState(ctx);

        expect(service.approvePackageChange).toHaveBeenCalledWith(
            { requestId: CODE, action: "reject", notes: "salah paket" },
            expect.any(Object)
        );
    });

    test("override: prompt approve lalu ketik 'batalkan' → cancel", async () => {
        const service = fakeService({ approvePackageChange: jest.fn(async () => ({ action: "cancel", request: snap(CODE, "Budi") })) });
        const ctx = baseCtx({ step: STEP_CONFIRM, action: "approve", id: CODE }, { chats: "batalkan", service });

        await handlePackageRequestAdminState(ctx);

        expect(service.approvePackageChange).toHaveBeenCalledWith(
            expect.objectContaining({ requestId: CODE, action: "cancel" }),
            expect.any(Object)
        );
    });

    test("action approve + teks ngawur → minta 'ya', belum eksekusi", async () => {
        const service = fakeService();
        const ctx = baseCtx({ step: STEP_CONFIRM, action: "approve", id: CODE }, { chats: "hmm gimana ya", service });

        await handlePackageRequestAdminState(ctx);

        expect(service.approvePackageChange).not.toHaveBeenCalled();
        expect(ctx.reply).toHaveBeenCalled();
    });

    test("NON-admin → handled:false (state hanya milik admin)", async () => {
        const service = fakeService();
        const ctx = baseCtx({ step: STEP_CONFIRM, action: "approve", id: CODE }, {
            chats: "ya",
            service,
            resolveStaffAccount: () => ({ role: "teknisi" })
        });

        const res = await handlePackageRequestAdminState(ctx);

        expect(res.handled).toBe(false);
        expect(service.approvePackageChange).not.toHaveBeenCalled();
    });
});
