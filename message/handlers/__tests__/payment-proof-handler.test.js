"use strict";

const { handleIncomingPaymentProof } = require("../payment-proof-handler");

function imgMsg(caption = "") {
    return { message: { imageMessage: caption ? { caption } : {} }, key: { remoteJid: "628222@s.whatsapp.net" } };
}

describe("payment-proof-handler", () => {
    test("unduh media → service → balas ackText ke pelanggan", async () => {
        const reply = jest.fn(async () => {});
        const downloadMedia = jest.fn(async () => Buffer.from("img"));
        const service = { handleIncomingProof: jest.fn(async () => ({ ackText: "terima kasih", record: { id: "BP-9" } })) };

        const res = await handleIncomingPaymentProof({
            msg: imgMsg("c"),
            user: { id: 1 },
            canonicalSender: "628222@s.whatsapp.net",
            pushname: "B",
            messageType: "imageMessage",
            reply,
            downloadMedia,
            service
        });

        expect(res.handled).toBe(true);
        expect(downloadMedia).toHaveBeenCalled();
        expect(service.handleIncomingProof).toHaveBeenCalledWith(
            expect.objectContaining({ messageType: "imageMessage", caption: "c", buffer: expect.any(Buffer) })
        );
        expect(reply).toHaveBeenCalledWith("terima kasih", { skipDuplicateCheck: true });
    });

    test("tanpa user terdaftar → tidak di-handle", async () => {
        const res = await handleIncomingPaymentProof({ user: null, downloadMedia: jest.fn(), reply: jest.fn() });
        expect(res.handled).toBe(false);
    });

    test("buffer kosong → tidak di-handle (biarkan jatuh ke jalur lain)", async () => {
        const res = await handleIncomingPaymentProof({
            user: { id: 1 },
            messageType: "imageMessage",
            msg: imgMsg(),
            downloadMedia: jest.fn(async () => Buffer.alloc(0)),
            reply: jest.fn()
        });
        expect(res.handled).toBe(false);
    });

    test("service melempar → tetap handled + balas fallback lembut", async () => {
        const reply = jest.fn(async () => {});
        const service = { handleIncomingProof: jest.fn(async () => { throw new Error("boom"); }) };
        const res = await handleIncomingPaymentProof({
            msg: imgMsg(),
            user: { id: 1 },
            messageType: "imageMessage",
            reply,
            downloadMedia: jest.fn(async () => Buffer.from("x")),
            service
        });
        expect(res.handled).toBe(true);
        expect(reply).toHaveBeenCalled();
    });
});
