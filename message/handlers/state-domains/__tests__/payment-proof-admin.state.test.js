"use strict";

const { handlePaymentProofAdminState, STEP_SELECT, STEP_CONFIRM } = require("../payment-proof-admin.state");
const { resolveConversationStateOwner } = require("../../conversation-state-owner-map");

const CODE = "BP-260710-Y6PZ";
const CODE2 = "BP-260710-K3M7";

function pending(id = CODE, userName = "Budi") {
    return {
        id,
        userName,
        phone: "628222",
        periodMonth: 7,
        periodYear: 2026,
        amountDue: 150000,
        submittedAt: "2026-07-10T03:00:00.000Z"
    };
}

function fakeService(overrides = {}) {
    return {
        listPending: jest.fn(() => []),
        confirmProof: jest.fn(async () => ({
            ok: true,
            record: pending(),
            settlement: { reactivation: { attempted: false } },
            alreadyPaid: false
        })),
        rejectProof: jest.fn(async () => ({ ok: true, record: pending() })),
        ...overrides
    };
}

function ctxWith(userState, overrides = {}) {
    return {
        chats: "",
        userState,
        stateStep: userState.step,
        stateSender: "628111@s.whatsapp.net",
        sender: "628111@s.whatsapp.net",
        plainSenderNumber: "628111",
        pushname: "Ana",
        isGlobalCommand: false,
        reply: jest.fn(async () => {}),
        setUserState: jest.fn(),
        deleteUserState: jest.fn(),
        resolveStaffRole: () => "admin",
        service: fakeService(),
        ...overrides
    };
}

describe("owner map", () => {
    test("step PAYPROOF_* dimiliki domain payment-proof", () => {
        expect(resolveConversationStateOwner(STEP_SELECT)).toBe("payment-proof");
        expect(resolveConversationStateOwner(STEP_CONFIRM)).toBe("payment-proof");
    });
});

describe("PAYPROOF_CONFIRM", () => {
    const state = () => ({ step: STEP_CONFIRM, action: "confirm", id: CODE, userName: "Budi", amountDue: 150000, periodMonth: 7, periodYear: 2026 });

    test("'ya' → eksekusi lunas + state dibersihkan", async () => {
        const ctx = ctxWith(state(), { chats: "ya" });
        const res = await handlePaymentProofAdminState(ctx);

        expect(res.handled).toBe(true);
        expect(ctx.service.confirmProof).toHaveBeenCalledWith(CODE, { adminName: "Ana" });
        expect(ctx.deleteUserState).toHaveBeenCalledWith("628111@s.whatsapp.net");
    });

    test.each(["ya", "iya", "oke", "gas", "betul"])("kata setuju '%s' diterima", async (word) => {
        const ctx = ctxWith(state(), { chats: word });
        await handlePaymentProofAdminState(ctx);
        expect(ctx.service.confirmProof).toHaveBeenCalled();
    });

    test("'tolak <alasan>' saat menunggu ya → berbelok jadi penolakan", async () => {
        const ctx = ctxWith(state(), { chats: "tolak nominal kurang" });
        await handlePaymentProofAdminState(ctx);

        expect(ctx.service.confirmProof).not.toHaveBeenCalled();
        expect(ctx.service.rejectProof).toHaveBeenCalledWith(CODE, { adminName: "Ana", reason: "nominal kurang" });
    });

    test("teks ngawur pada alur KONFIRMASI → minta 'ya', tidak melunasi", async () => {
        const ctx = ctxWith(state(), { chats: "hmm bentar" });
        await handlePaymentProofAdminState(ctx);

        expect(ctx.service.confirmProof).not.toHaveBeenCalled();
        expect(ctx.reply.mock.calls[0][0]).toContain("ya");
    });

    test("alur TOLAK: teks bebas dipakai sebagai ALASAN", async () => {
        const ctx = ctxWith({ ...state(), action: "reject" }, { chats: "fotonya buram" });
        await handlePaymentProofAdminState(ctx);

        expect(ctx.service.rejectProof).toHaveBeenCalledWith(CODE, { adminName: "Ana", reason: "fotonya buram" });
    });

    test("alur TOLAK: 'ya' menolak dengan alasan kosong", async () => {
        const ctx = ctxWith({ ...state(), action: "reject" }, { chats: "ya" });
        await handlePaymentProofAdminState(ctx);

        expect(ctx.service.rejectProof).toHaveBeenCalledWith(CODE, { adminName: "Ana", reason: "" });
    });

    test("pesan tanpa teks (foto) tidak dibajak — dan tak dibaca sebagai alasan", async () => {
        const ctx = ctxWith({ ...state(), action: "reject" }, { chats: "" });
        const res = await handlePaymentProofAdminState(ctx);

        expect(res.handled).toBe(false);
        expect(ctx.service.rejectProof).not.toHaveBeenCalled();
        expect(ctx.reply).not.toHaveBeenCalled();
    });

    test("perintah global (menu) menembus alur, tak dianggap alasan", async () => {
        const ctx = ctxWith({ ...state(), action: "reject" }, { chats: "menu", isGlobalCommand: true });
        const res = await handlePaymentProofAdminState(ctx);

        expect(res.handled).toBe(false);
        expect(ctx.service.rejectProof).not.toHaveBeenCalled();
    });
});

describe("PAYPROOF_SELECT", () => {
    const items = [pending(CODE2, "Siti"), pending(CODE, "Budi")];
    const state = (action = "confirm") => ({ step: STEP_SELECT, action, items });

    test("angka polos → penegasan, belum eksekusi", async () => {
        const ctx = ctxWith(state(), { chats: "2" });
        await handlePaymentProofAdminState(ctx);

        expect(ctx.service.confirmProof).not.toHaveBeenCalled();
        expect(ctx.setUserState).toHaveBeenCalledWith(
            "628111@s.whatsapp.net",
            expect.objectContaining({ step: STEP_CONFIRM, action: "confirm", id: CODE })
        );
        expect(ctx.reply.mock.calls[0][0]).toContain("Budi");
    });

    test("'terima 1' → eksekusi langsung dari SNAPSHOT (penomoran stabil)", async () => {
        // Antrian segar sengaja berbeda urutan — snapshot state yang harus menang.
        const service = fakeService({ listPending: jest.fn(() => [pending("BP-260710-ZZZZ", "Orang Lain")]) });
        const ctx = ctxWith(state(), { chats: "terima 1", service });

        await handlePaymentProofAdminState(ctx);

        expect(service.confirmProof).toHaveBeenCalledWith(CODE2, { adminName: "Ana" });
        expect(ctx.deleteUserState).toHaveBeenCalled();
    });

    test("'tolak 2 <alasan>' → eksekusi penolakan dari snapshot", async () => {
        const ctx = ctxWith(state(), { chats: "tolak 2 bukan bukti transfer" });
        await handlePaymentProofAdminState(ctx);

        expect(ctx.service.rejectProof).toHaveBeenCalledWith(CODE, { adminName: "Ana", reason: "bukan bukti transfer" });
    });

    test("angka di luar jangkauan → pilihan tidak valid", async () => {
        const ctx = ctxWith(state(), { chats: "9" });
        await handlePaymentProofAdminState(ctx);

        expect(ctx.service.confirmProof).not.toHaveBeenCalled();
        expect(ctx.reply.mock.calls[0][0]).toContain("tidak valid");
    });

    test("'bukti' → muat ulang daftar", async () => {
        const service = fakeService({ listPending: jest.fn(() => items) });
        const ctx = ctxWith(state(), { chats: "bukti", service });
        await handlePaymentProofAdminState(ctx);

        expect(ctx.reply.mock.calls[0][0]).toContain("ANTRIAN BUKTI BAYAR");
    });

    test("aksi 'reject' pada daftar → angka membuka penegasan TOLAK", async () => {
        const ctx = ctxWith(state("reject"), { chats: "1" });
        await handlePaymentProofAdminState(ctx);

        expect(ctx.setUserState).toHaveBeenCalledWith(
            "628111@s.whatsapp.net",
            expect.objectContaining({ step: STEP_CONFIRM, action: "reject", id: CODE2 })
        );
        expect(ctx.reply.mock.calls[0][0]).toContain("Tolak bukti");
    });

    test("perintah global menembus daftar", async () => {
        const ctx = ctxWith(state(), { chats: "menu", isGlobalCommand: true });
        const res = await handlePaymentProofAdminState(ctx);
        expect(res.handled).toBe(false);
    });

    test("pesan tanpa teks (foto) saat memilih → dilepas", async () => {
        const ctx = ctxWith(state(), { chats: "" });
        const res = await handlePaymentProofAdminState(ctx);
        expect(res.handled).toBe(false);
        expect(ctx.reply).not.toHaveBeenCalled();
    });

    test("bukan admin lagi → berhenti senyap", async () => {
        const ctx = ctxWith(state(), { chats: "1", resolveStaffRole: () => "teknisi" });
        const res = await handlePaymentProofAdminState(ctx);

        expect(res.handled).toBe(false);
        expect(ctx.reply).not.toHaveBeenCalled();
    });

    test("service melempar → handled + state dibersihkan (never-throw)", async () => {
        const service = fakeService({ confirmProof: jest.fn(async () => { throw new Error("boom"); }) });
        const ctx = ctxWith(state(), { chats: "terima 1", service });

        const res = await handlePaymentProofAdminState(ctx);

        expect(res.handled).toBe(true);
        expect(ctx.deleteUserState).toHaveBeenCalled();
        expect(ctx.reply).toHaveBeenCalled();
    });
});
