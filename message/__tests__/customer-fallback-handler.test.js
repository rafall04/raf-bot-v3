/**
 * Header Doc
 * Purpose: Uji gate fallback anti-diam: default mati, hanya pelanggan terdaftar, diam untuk
 *          ack/staf/chat yang sedang ditangani admin, keluhan bergejala → intent CEK_KONEKSI,
 *          teks bebas → menu ber-cooldown, dan tidak pernah throw.
 * Caller: jest.
 * Deps: `../handlers/customer-fallback-handler`, `../../lib/chat-activity-tracker`.
 * MainFuncs: —
 * SideEffects: Tidak ada (tracker di-reset per test).
 */
"use strict";

const { evaluateCustomerFallback } = require("../handlers/customer-fallback-handler");
const {
    noteAdminOutbound,
    resetChatActivityForTest
} = require("../../lib/chat-activity-tracker");

const SENDER = "628123456789@s.whatsapp.net";

function makeArgs(overrides = {}) {
    return {
        chats: "caranya gimana ya kak",
        sender: SENDER,
        stateSender: SENDER,
        pushname: "Tes",
        customer: { id: 1, name: "Tes" },
        isOwner: false,
        isTeknisi: false,
        isAgent: false,
        reply: jest.fn(async () => {}),
        globalConfig: { customerAssist: { fallback: { enabled: true } } },
        ...overrides
    };
}

describe("evaluateCustomerFallback", () => {
    beforeEach(() => {
        resetChatActivityForTest();
    });

    test("default MATI: tanpa config → skip tanpa balasan", async () => {
        const args = makeArgs({ globalConfig: {} });
        const result = await evaluateCustomerFallback(args);
        expect(result.action).toBe("skip");
        expect(args.reply).not.toHaveBeenCalled();
    });

    test("enabled=false → skip", async () => {
        const args = makeArgs({ globalConfig: { customerAssist: { fallback: { enabled: false } } } });
        const result = await evaluateCustomerFallback(args);
        expect(result.action).toBe("skip");
        expect(args.reply).not.toHaveBeenCalled();
    });

    test("staf (teknisi) → skip", async () => {
        const args = makeArgs({ isTeknisi: true });
        const result = await evaluateCustomerFallback(args);
        expect(result).toEqual({ action: "skip", reason: "staf" });
    });

    test("bukan pelanggan terdaftar → skip (tetap diam ke nomor asing)", async () => {
        const args = makeArgs({ customer: null });
        const result = await evaluateCustomerFallback(args);
        expect(result).toEqual({ action: "skip", reason: "bukan-pelanggan" });
        expect(args.reply).not.toHaveBeenCalled();
    });

    test.each(["oke makasi kak", "iya mas", "Ok mas", "Siap", "p"])(
        "ack pendek tetap diam: %s",
        async (chats) => {
            const args = makeArgs({ chats });
            const result = await evaluateCustomerFallback(args);
            expect(result.action).toBe("skip");
            expect(args.reply).not.toHaveBeenCalled();
        }
    );

    test("keluhan bergejala tanpa kata konteks → dialihkan ke CEK_KONEKSI tanpa balasan sendiri", async () => {
        const args = makeArgs({ chats: "lemot banget dari siang" });
        const result = await evaluateCustomerFallback(args);
        expect(result).toEqual({ action: "intent", intent: "CEK_KONEKSI" });
        expect(args.reply).not.toHaveBeenCalled();
    });

    test("teks bebas → balas menu sekali, lalu cooldown menahan balasan kedua", async () => {
        const args = makeArgs();
        const pertama = await evaluateCustomerFallback(args);
        expect(pertama.action).toBe("replied");
        expect(args.reply).toHaveBeenCalledTimes(1);
        const [teks, opsi] = args.reply.mock.calls[0];
        expect(typeof teks).toBe("string");
        expect(teks.toLowerCase()).toContain("cek koneksi");
        expect(opsi).toEqual({ skipDuplicateCheck: true });

        const kedua = await evaluateCustomerFallback(makeArgs({ reply: args.reply }));
        expect(kedua).toEqual({ action: "skip", reason: "cooldown" });
        expect(args.reply).toHaveBeenCalledTimes(1);
    });

    test("admin baru saja balas manual di chat ini → bot tidak menyela", async () => {
        noteAdminOutbound(SENDER);
        const args = makeArgs();
        const result = await evaluateCustomerFallback(args);
        expect(result).toEqual({ action: "skip", reason: "admin-aktif" });
        expect(args.reply).not.toHaveBeenCalled();
    });

    test("reply melempar error → ditelan, kembali skip (tidak pernah throw)", async () => {
        const args = makeArgs({
            reply: jest.fn(async () => {
                throw new Error("koneksi WA putus");
            })
        });
        await expect(evaluateCustomerFallback(args)).resolves.toEqual({
            action: "skip",
            reason: "error"
        });
    });
});
