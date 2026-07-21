/**
 * Header Doc
 * Purpose: Uji state domain Speed on Demand hasil port dari `speed-boost-handler.js` yang mati.
 *          Fokus pada tiga hal yang justru RUSAK di handler lama dan jadi alasan port ini:
 *            1) state di-key `stateSender` KANONIK (handler lama pakai `sender` mentah → @lid tuli),
 *            2) semua balasan lewat `reply()` (handler lama kirim ke `msg.key.remoteJid` → target @lid),
 *            3) rekening transfer dari `config.bankAccounts` (template lama hardcode rekening dummy).
 * Caller: jest.
 * Deps: `../speed-boost.state`.
 * MainFuncs: —
 * SideEffects: Menyetel `global.config` / `global.packages` / `global.speed_requests` per test.
 */
"use strict";

const state = require("../speed-boost.state");

const LID_SENDER = "123456789012345@lid";
const CANONICAL = "628123456789@s.whatsapp.net";

const USER = { id: 7, name: "Budi", phone_number: "628123456789", subscription: "Paket-10Mbps" };

const PACKAGES = [
    { name: "Paket-10Mbps", profile: "10M", price: 100000 },
    { name: "MASTER-20Mbps", profile: "20M", price: 165000, matrixPrices: { "1_day": 15000, "3_days": 40000 } }
];

function fakeHelper(over = {}) {
    return {
        loadSpeedBoostConfig: () => ({ enabled: true }),
        getAvailableSpeedBoostsFromMatrix: () => [PACKAGES[1]],
        getAvailablePaymentMethods: () => [
            { id: "transfer", label: "Transfer Bank" },
            { id: "cash", label: "Bayar Tunai" }
        ],
        calculateBoostPriceFromMatrix: () => null,
        ...over
    };
}

function makeCtx(over = {}) {
    const store = {};
    return {
        sender: LID_SENDER,
        stateSender: CANONICAL,
        pushname: "Budi",
        chats: "",
        user: USER,
        reply: jest.fn(async () => {}),
        setUserState: jest.fn((k, v) => { store[k] = v; }),
        deleteUserState: jest.fn((k) => { delete store[k]; }),
        getUserState: jest.fn((k) => store[k]),
        speedBoostMatrixHelper: fakeHelper(),
        sendCritical: jest.fn(async () => ({ delivered: true })),
        // Produksi menyuntik objek `global` yang SAMA (lihat `message/raf.js`), jadi test harus
        // memakai referensi yang sama — bukan salinan — supaya store request-nya satu.
        global,
        _store: store,
        ...over
    };
}

beforeEach(() => {
    global.config = { bankAccounts: [{ bank: "BCA", number: "8640824914", name: "RAF" }], ownerNumber: [] };
    global.packages = PACKAGES;
    global.speed_requests = [];
    jest.spyOn(require("../../../../lib/database"), "saveSpeedRequests").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe("gate fitur", () => {
    test("config.enabled=false → tolak sopan dan JANGAN pasang state", async () => {
        const ctx = makeCtx({ speedBoostMatrixHelper: fakeHelper({ loadSpeedBoostConfig: () => ({ enabled: false }) }) });
        await state.startSpeedBoost(ctx);
        expect(ctx.reply).toHaveBeenCalledTimes(1);
        expect(ctx.setUserState).not.toHaveBeenCalled();
    });
});

describe("state di-key stateSender kanonik, bukan @lid", () => {
    test("startSpeedBoost menyimpan state pada JID kanonik", async () => {
        const ctx = makeCtx();
        await state.startSpeedBoost(ctx);
        expect(ctx.setUserState).toHaveBeenCalledWith(CANONICAL, expect.objectContaining({ step: "SODB_SELECT_PACKAGE" }));
        // Justru inilah bug handler lama: state tersimpan di key `sender` mentah (@lid).
        expect(ctx.setUserState).not.toHaveBeenCalledWith(LID_SENDER, expect.anything());
        expect(ctx._store[LID_SENDER]).toBeUndefined();
    });
});

describe("alur lengkap sampai pesanan tercatat", () => {
    async function runToConfirm(confirmText) {
        const ctx = makeCtx();
        await state.startSpeedBoost(ctx);

        ctx.chats = "1";
        await state.handleSpeedBoostConversationState({ ...ctx, userState: ctx._store[CANONICAL] });

        ctx.chats = "1"; // durasi 1 Hari
        await state.handleSpeedBoostConversationState({ ...ctx, userState: ctx._store[CANONICAL] });

        ctx.chats = "1"; // metode transfer
        await state.handleSpeedBoostConversationState({ ...ctx, userState: ctx._store[CANONICAL] });

        ctx.chats = confirmText;
        await state.handleSpeedBoostConversationState({ ...ctx, userState: ctx._store[CANONICAL] });
        return ctx;
    }

    test("konfirmasi 'ya' membuat request dengan bentuk yang dibaca speed-status-handler", async () => {
        await runToConfirm("ya");
        expect(global.speed_requests).toHaveLength(1);
        const req = global.speed_requests[0];
        // Kontrak dengan pembaca LIVE (`speed-status-handler.js`) — jangan diubah diam-diam.
        expect(req).toEqual(expect.objectContaining({
            requestedPackageName: "MASTER-20Mbps",
            durationLabel: "1 Hari",
            price: 15000,
            paymentMethod: "transfer",
            paymentStatus: "unpaid",
            status: "pending"
        }));
        expect(req.userId).toBe(USER.id);
    });

    test("menerima bahasa pelanggan sungguhan ('Ok mas')", async () => {
        await runToConfirm("Ok mas");
        expect(global.speed_requests).toHaveLength(1);
    });

    // Alur berbayar: afirmasi yang menumpang kalimat lain TIDAK boleh memesan.
    test("'ya tapi tagihanku berapa?' TIDAK membuat pesanan", async () => {
        await runToConfirm("ya tapi tagihanku berapa?");
        expect(global.speed_requests).toHaveLength(0);
    });

    test("penolakan membatalkan tanpa membuat pesanan", async () => {
        const ctx = await runToConfirm("ga jadi");
        expect(global.speed_requests).toHaveLength(0);
        expect(ctx.deleteUserState).toHaveBeenCalledWith(CANONICAL);
    });
});

describe("instruksi transfer memakai rekening config, bukan hardcode", () => {
    test("nomor rekening yang dikirim berasal dari config.bankAccounts", async () => {
        const ctx = makeCtx();
        await state.startSpeedBoost(ctx);
        ctx.chats = "1";
        await state.handleSpeedBoostConversationState({ ...ctx, userState: ctx._store[CANONICAL] });
        ctx.chats = "1";
        await state.handleSpeedBoostConversationState({ ...ctx, userState: ctx._store[CANONICAL] });
        ctx.chats = "1";
        await state.handleSpeedBoostConversationState({ ...ctx, userState: ctx._store[CANONICAL] });
        ctx.chats = "ya";
        await state.handleSpeedBoostConversationState({ ...ctx, userState: ctx._store[CANONICAL] });

        const sent = ctx.reply.mock.calls.map((c) => String(c[0])).join("\n");
        expect(sent).toContain("8640824914");
        // Regresi rekening dummy dari template lama `other_sod_payment_success`.
        expect(sent).not.toContain("1234567890");
        expect(sent).not.toContain("9876543210");
    });
});

describe("tidak pernah mengirim di luar reply()", () => {
    test("seluruh teks pelanggan keluar lewat reply, admin lewat sendCritical", async () => {
        const ctx = makeCtx();
        await state.startSpeedBoost(ctx);
        ctx.chats = "1";
        await state.handleSpeedBoostConversationState({ ...ctx, userState: ctx._store[CANONICAL] });
        ctx.chats = "1";
        await state.handleSpeedBoostConversationState({ ...ctx, userState: ctx._store[CANONICAL] });
        ctx.chats = "1";
        await state.handleSpeedBoostConversationState({ ...ctx, userState: ctx._store[CANONICAL] });
        ctx.chats = "ya";
        await state.handleSpeedBoostConversationState({ ...ctx, userState: ctx._store[CANONICAL] });

        expect(ctx.reply).toHaveBeenCalled();
        // Tak ada penerima @lid pada jalur admin.
        for (const call of ctx.sendCritical.mock.calls) {
            expect(String(call[0])).not.toContain("@lid");
        }
    });
});

describe("pilihan tidak valid", () => {
    test("angka di luar rentang tidak memajukan langkah", async () => {
        const ctx = makeCtx();
        await state.startSpeedBoost(ctx);
        ctx.setUserState.mockClear();
        ctx.chats = "99";
        await state.handleSpeedBoostConversationState({ ...ctx, userState: ctx._store[CANONICAL] });
        expect(ctx.setUserState).not.toHaveBeenCalled();
        expect(ctx._store[CANONICAL].step).toBe("SODB_SELECT_PACKAGE");
    });
});
