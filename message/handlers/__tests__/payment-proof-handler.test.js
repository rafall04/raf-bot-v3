/**
 * Header Doc
 * Purpose: Mengunci kontrak handler foto pelanggan: TANYA GERBANG dulu (evaluateIntake), baru unduh
 *          media. Yang dijaga di sini terutama hal-hal yang TIDAK boleh terjadi lagi —
 *          (a) media diunduh & bukti disimpan untuk foto yang bukan bukti bayar,
 *          (b) balasan berbingkai "pembayaran" ke pelanggan yang tak pernah mengaku bayar,
 *          (c) bot menyela chat yang sedang ditangani admin.
 * Caller: jest.
 * Deps: `../payment-proof-handler`.
 * MainFuncs: —
 * SideEffects: Tidak ada (service & reply di-mock).
 */
"use strict";

const { handleIncomingPaymentProof } = require("../payment-proof-handler");

function imgMsg(caption = "") {
    return { message: { imageMessage: caption ? { caption } : {} }, key: { remoteJid: "628222@s.whatsapp.net" } };
}

/** Service palsu; `intake` menentukan keputusan gerbang. */
function makeService(intake, over = {}) {
    return {
        evaluateIntake: jest.fn(async () => intake),
        handleIncomingProof: jest.fn(async () => ({ ackText: "terima kasih", record: { id: "BP-9" } })),
        ...over
    };
}

function callHandler(service, over = {}) {
    return handleIncomingPaymentProof({
        msg: imgMsg(over.caption || ""),
        user: { id: 1, name: "Budi", status: "aktif" },
        canonicalSender: "628222@s.whatsapp.net",
        pushname: "B",
        messageType: "imageMessage",
        reply: over.reply || jest.fn(async () => {}),
        downloadMedia: over.downloadMedia || jest.fn(async () => Buffer.from("img")),
        service,
        ...over
    });
}

describe("payment-proof-handler — jalur CAPTURE (bukti bayar sah)", () => {
    test("gerbang lolos → unduh media → simpan bukti → balas ack", async () => {
        const reply = jest.fn(async () => {});
        const downloadMedia = jest.fn(async () => Buffer.from("img"));
        const service = makeService({
            action: "capture",
            reason: "ada-tagihan",
            advance: false,
            billing: { outstanding: 125000 },
            ackText: null
        });

        const res = await callHandler(service, { reply, downloadMedia, caption: "c" });

        expect(res.handled).toBe(true);
        expect(downloadMedia).toHaveBeenCalled();
        expect(service.handleIncomingProof).toHaveBeenCalledWith(
            expect.objectContaining({
                messageType: "imageMessage",
                caption: "c",
                buffer: expect.any(Buffer),
                // Snapshot tagihan dari gerbang dipakai ulang — keputusan & isi record harus berdiri
                // di atas angka yang PERSIS SAMA (jangan query dua kali & berisiko beda).
                billing: { outstanding: 125000 },
                intakeReason: "ada-tagihan"
            })
        );
        expect(reply).toHaveBeenCalledWith("terima kasih", { skipDuplicateCheck: true });
    });

    test("buffer kosong → tidak di-handle (biarkan jatuh ke jalur lain)", async () => {
        const service = makeService({ action: "capture", reason: "ada-tagihan", advance: false, billing: {}, ackText: null });
        const res = await callHandler(service, { downloadMedia: jest.fn(async () => Buffer.alloc(0)) });
        expect(res.handled).toBe(false);
        expect(service.handleIncomingProof).not.toHaveBeenCalled();
    });
});

describe("payment-proof-handler — jalur BUKAN bukti bayar", () => {
    test("tak ada tagihan → balas NETRAL, TIDAK unduh media, TIDAK simpan bukti", async () => {
        const reply = jest.fn(async () => {});
        const downloadMedia = jest.fn(async () => Buffer.from("img"));
        const service = makeService({
            action: "neutral",
            reason: "tak-ada-tagihan",
            advance: false,
            billing: { outstanding: 0 },
            ackText: "Foto kamu sudah kami terima 🙏"
        });

        const res = await callHandler(service, { reply, downloadMedia });

        expect(res.handled).toBe(true);
        // INTI PERBAIKAN: tak ada unduhan, tak ada record, tak ada notif admin.
        expect(downloadMedia).not.toHaveBeenCalled();
        expect(service.handleIncomingProof).not.toHaveBeenCalled();
        // Dan yang paling penting: balasannya TIDAK menyebut pembayaran sama sekali.
        expect(reply).toHaveBeenCalledTimes(1);
        expect(reply.mock.calls[0][0]).not.toMatch(/bayar|pembayaran/i);
    });

    test("foto keluhan → arahkan ke lapor, tanpa unduh & tanpa record", async () => {
        const reply = jest.fn(async () => {});
        const downloadMedia = jest.fn(async () => Buffer.from("img"));
        const service = makeService({
            action: "complaint",
            reason: "caption-keluhan",
            advance: false,
            billing: { outstanding: 125000 },
            ackText: "Foto kamu sudah kami terima 🙏 ketik *lapor* ya"
        });

        const res = await callHandler(service, { reply, downloadMedia, caption: "lemot" });

        expect(res.handled).toBe(true);
        expect(downloadMedia).not.toHaveBeenCalled();
        expect(service.handleIncomingProof).not.toHaveBeenCalled();
        expect(reply.mock.calls[0][0]).toMatch(/lapor/i);
    });

    test("admin sedang menangani chat → BUNGKAM total (tak balas, tak handled)", async () => {
        const reply = jest.fn(async () => {});
        const downloadMedia = jest.fn(async () => Buffer.from("img"));
        const service = makeService({ action: "silent", reason: "admin-aktif", advance: false, billing: null, ackText: null });

        const res = await callHandler(service, { reply, downloadMedia });

        // handled:false → pesan jatuh persis seperti sebelum fitur ini ada (guard chats-kosong raf.js).
        expect(res.handled).toBe(false);
        expect(reply).not.toHaveBeenCalled();
        expect(downloadMedia).not.toHaveBeenCalled();
        expect(service.handleIncomingProof).not.toHaveBeenCalled();
    });
});

describe("payment-proof-handler — sinyal & ketahanan", () => {
    test("sinyal chat diteruskan apa adanya ke gerbang", async () => {
        const service = makeService({ action: "silent", reason: "admin-aktif", advance: false, billing: null, ackText: null });
        await callHandler(service, { adminActive: true, signalReady: false, recentComplaint: true, caption: "x" });

        expect(service.evaluateIntake).toHaveBeenCalledWith(
            expect.objectContaining({ adminActive: true, signalReady: false, recentComplaint: true, caption: "x" })
        );
    });

    test("tanpa user terdaftar → tidak di-handle", async () => {
        const res = await handleIncomingPaymentProof({ user: null, downloadMedia: jest.fn(), reply: jest.fn() });
        expect(res.handled).toBe(false);
    });

    test("gerbang melempar → tetap handled + balas NETRAL (tak menyebut pembayaran)", async () => {
        const reply = jest.fn(async () => {});
        const service = makeService(null, {
            evaluateIntake: jest.fn(async () => { throw new Error("boom"); })
        });

        const res = await callHandler(service, { reply });

        expect(res.handled).toBe(true);
        expect(reply).toHaveBeenCalled();
        // Saat gerbang gagal kita tidak tahu ini foto apa → jangan menebak "pembayaran".
        expect(reply.mock.calls[0][0]).not.toMatch(/pembayaran/i);
    });
});
