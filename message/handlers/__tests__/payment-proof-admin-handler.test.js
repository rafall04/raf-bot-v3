"use strict";

const {
    handlePaymentProofAdminDecision,
    parseProofCommand,
    extractQuotedText
} = require("../payment-proof-admin-handler");

const CODE = "BP-260710-Y6PZ";

function textMsg(quotedCaption = null) {
    if (!quotedCaption) return { message: { conversation: "ok" } };
    return {
        message: {
            extendedTextMessage: {
                text: "ok",
                contextInfo: { quotedMessage: { imageMessage: { caption: quotedCaption } } }
            }
        }
    };
}

function baseCtx(overrides = {}) {
    return {
        chats: "",
        msg: textMsg(),
        sender: "628111@s.whatsapp.net",
        plainSenderNumber: "628111",
        pushname: "Ana",
        global: { accounts: [] },
        reply: jest.fn(async () => {}),
        resolveStaffRole: () => "admin",
        ...overrides
    };
}

function fakeService(overrides = {}) {
    return {
        listPending: jest.fn(() => []),
        confirmProof: jest.fn(async () => ({
            ok: true,
            record: { id: CODE, userName: "Budi", amountDue: 150000, periodMonth: 7, periodYear: 2026 },
            settlement: { reactivation: { attempted: false } },
            alreadyPaid: false
        })),
        rejectProof: jest.fn(async () => ({ ok: true, record: { id: CODE, userName: "Budi" } })),
        ...overrides
    };
}

describe("parseProofCommand", () => {
    test("perintah berkode: terima / tolak (+alasan) / daftar", () => {
        expect(parseProofCommand(`terima ${CODE}`)).toEqual({ action: "confirm", code: CODE });
        expect(parseProofCommand(`TOLAK ${CODE.toLowerCase()} buram`))
            .toEqual({ action: "reject", code: CODE, reason: "buram" });
        expect(parseProofCommand(`tolak ${CODE}`)).toEqual({ action: "reject", code: CODE, reason: "" });
        expect(parseProofCommand("bukti")).toEqual({ action: "list" });
        expect(parseProofCommand("daftar bukti")).toEqual({ action: "list" });
    });

    test("balasan ter-quote mengambil kode dari pesan yang dibalas", () => {
        const quoted = `Kode: *${CODE}*\nKonfirmasi di: http://x`;
        expect(parseProofCommand("ok", quoted)).toEqual({ action: "confirm", code: CODE });
        expect(parseProofCommand("tolak nominal kurang", quoted))
            .toEqual({ action: "reject", code: CODE, reason: "nominal kurang" });
    });

    test("kata setuju/tolak TANPA kode & tanpa quote berkode → bukan perintah", () => {
        expect(parseProofCommand("ok")).toBeNull();
        expect(parseProofCommand("tolak")).toBeNull();
        expect(parseProofCommand("ok", "pesan bot lain tanpa kode")).toBeNull();
    });

    test("frasa pelanggan sehari-hari tidak pernah cocok", () => {
        ["terima kasih", "terima kasih banyak", "oke bang besok ya", "tolak angin", ""]
            .forEach((t) => expect(parseProofCommand(t)).toBeNull());
    });
});

describe("extractQuotedText", () => {
    test("ambil caption gambar yang di-quote", () => {
        expect(extractQuotedText(textMsg("Kode: *X*"))).toBe("Kode: *X*");
    });
    test("pesan biasa → string kosong", () => {
        expect(extractQuotedText(textMsg())).toBe("");
    });
});

describe("handlePaymentProofAdminDecision", () => {
    test("admin: terima <kode> → confirmProof + balas ringkasan", async () => {
        const service = fakeService();
        const ctx = baseCtx({ chats: `terima ${CODE}`, service });

        const res = await handlePaymentProofAdminDecision(ctx);

        expect(res.handled).toBe(true);
        expect(service.confirmProof).toHaveBeenCalledWith(CODE, { adminName: "Ana" });
        const [text, opts] = ctx.reply.mock.calls[0];
        expect(text).toContain("Budi");
        expect(text).toContain("LUNAS");
        expect(opts).toEqual({ skipDuplicateCheck: true });
    });

    test("admin: balas 'ok' ke notif bukti → confirmProof pakai kode dari quote", async () => {
        const service = fakeService();
        const ctx = baseCtx({ chats: "ok", msg: textMsg(`Kode: *${CODE}*`), service });

        const res = await handlePaymentProofAdminDecision(ctx);

        expect(res.handled).toBe(true);
        expect(service.confirmProof).toHaveBeenCalledWith(CODE, { adminName: "Ana" });
    });

    test("reaktivasi gagal dilaporkan ke admin (jangan sukses-semu)", async () => {
        const service = fakeService({
            confirmProof: jest.fn(async () => ({
                ok: true,
                record: { id: CODE, userName: "Budi", amountDue: 150000, periodMonth: 7, periodYear: 2026 },
                settlement: { reactivation: { attempted: true, ok: false } },
                alreadyPaid: false
            }))
        });
        const ctx = baseCtx({ chats: `terima ${CODE}`, service });

        await handlePaymentProofAdminDecision(ctx);

        expect(ctx.reply.mock.calls[0][0]).toContain("Reaktivasi MikroTik GAGAL");
    });

    test("sudah lunas sebelumnya → tandai terkonfirmasi tanpa klaim struk baru", async () => {
        const service = fakeService({
            confirmProof: jest.fn(async () => ({
                ok: true,
                record: { id: CODE, userName: "Budi", periodMonth: 7, periodYear: 2026 },
                settlement: {},
                alreadyPaid: true
            }))
        });
        const ctx = baseCtx({ chats: `terima ${CODE}`, service });

        await handlePaymentProofAdminDecision(ctx);

        expect(ctx.reply.mock.calls[0][0]).toContain("SUDAH tercatat lunas");
    });

    test("admin: tolak <kode> <alasan> → rejectProof dengan alasan", async () => {
        const service = fakeService();
        const ctx = baseCtx({ chats: `tolak ${CODE} nominal kurang`, service });

        await handlePaymentProofAdminDecision(ctx);

        expect(service.rejectProof).toHaveBeenCalledWith(CODE, { adminName: "Ana", reason: "nominal kurang" });
        expect(ctx.reply.mock.calls[0][0]).toContain("ditolak");
    });

    test("admin: 'bukti' → daftar antrian; kosong → pesan bersih", async () => {
        const service = fakeService();
        const ctx = baseCtx({ chats: "bukti", service });
        await handlePaymentProofAdminDecision(ctx);
        expect(ctx.reply.mock.calls[0][0]).toContain("Tidak ada bukti");

        const isi = fakeService({
            listPending: jest.fn(() => [
                { id: CODE, userName: "Budi", phone: "628222", periodMonth: 7, periodYear: 2026, amountDue: 150000, submittedAt: "2026-07-10T03:00:00.000Z" }
            ])
        });
        const ctx2 = baseCtx({ chats: "bukti", service: isi });
        await handlePaymentProofAdminDecision(ctx2);
        expect(ctx2.reply.mock.calls[0][0]).toContain(CODE);
        expect(ctx2.reply.mock.calls[0][0]).toContain("Budi");
    });

    test("NON-admin dengan format benar → handled:false & service tak tersentuh (fitur tak bocor)", async () => {
        const service = fakeService();
        const ctx = baseCtx({ chats: `terima ${CODE}`, service, resolveStaffRole: () => "teknisi" });

        const res = await handlePaymentProofAdminDecision(ctx);

        expect(res.handled).toBe(false);
        expect(service.confirmProof).not.toHaveBeenCalled();
        expect(ctx.reply).not.toHaveBeenCalled();
    });

    test("pelanggan (tanpa akun staf) menulis 'terima kasih' → tidak di-handle", async () => {
        const service = fakeService();
        const ctx = baseCtx({ chats: "terima kasih", service, resolveStaffRole: () => null });

        const res = await handlePaymentProofAdminDecision(ctx);

        expect(res.handled).toBe(false);
        expect(service.confirmProof).not.toHaveBeenCalled();
    });

    test("kode tak ditemukan → pesan jelas, bukan diam", async () => {
        const service = fakeService({ confirmProof: jest.fn(async () => ({ ok: false, reason: "not_found" })) });
        const ctx = baseCtx({ chats: `terima ${CODE}`, service });

        await handlePaymentProofAdminDecision(ctx);

        expect(ctx.reply.mock.calls[0][0]).toContain("tidak ditemukan");
    });

    test("settle gagal → beri tahu admin bukti TETAP menunggu (fail-closed)", async () => {
        const service = fakeService({
            confirmProof: jest.fn(async () => ({ ok: false, reason: "settle_failed", error: "db down" }))
        });
        const ctx = baseCtx({ chats: `terima ${CODE}`, service });

        await handlePaymentProofAdminDecision(ctx);

        const text = ctx.reply.mock.calls[0][0];
        expect(text).toContain("db down");
        expect(text).toContain("TETAP menunggu");
    });

    // Gate peran ASLI (tanpa override) — memastikan sumbernya accounts.json, bukan isOwner/isTeknisi.
    test("gate nyata: role admin di accounts.json lolos, role teknisi tidak", async () => {
        const accounts = [
            { role: "teknisi", phone_number: "628999" },
            { role: "admin", phone_number: "628111" }
        ];
        const service = fakeService();
        const ctx = baseCtx({ chats: `terima ${CODE}`, service, accounts, resolveStaffRole: undefined });
        delete ctx.resolveStaffRole;

        expect((await handlePaymentProofAdminDecision(ctx)).handled).toBe(true);
        expect(service.confirmProof).toHaveBeenCalled();

        const svc2 = fakeService();
        const teknisiCtx = baseCtx({
            chats: `terima ${CODE}`,
            service: svc2,
            accounts,
            sender: "628999@s.whatsapp.net",
            plainSenderNumber: "628999"
        });
        delete teknisiCtx.resolveStaffRole;

        expect((await handlePaymentProofAdminDecision(teknisiCtx)).handled).toBe(false);
        expect(svc2.confirmProof).not.toHaveBeenCalled();
    });

    test("service melempar → tetap handled + admin diberi tahu (never-throw)", async () => {
        const service = fakeService({ confirmProof: jest.fn(async () => { throw new Error("boom"); }) });
        const ctx = baseCtx({ chats: `terima ${CODE}`, service });

        const res = await handlePaymentProofAdminDecision(ctx);

        expect(res.handled).toBe(true);
        expect(ctx.reply).toHaveBeenCalled();
    });
});
