"use strict";

const {
    handlePaymentProofAdminDecision,
    parseProofCommand,
    extractQuotedText,
    executeConfirmAll,
    STEP_SELECT,
    STEP_CONFIRM,
    STEP_CONFIRM_ALL
} = require("../payment-proof-admin-handler");

const CODE = "BP-260710-Y6PZ";
const CODE2 = "BP-260710-K3M7";

function pending(id = CODE, userName = "Budi", extra = {}) {
    return {
        id,
        userName,
        phone: "628222",
        periodMonth: 7,
        periodYear: 2026,
        amountDue: 150000,
        submittedAt: "2026-07-10T03:00:00.000Z",
        ...extra
    };
}

function textMsg(quotedCaption = null, text = "ok") {
    if (!quotedCaption) return { message: { conversation: text } };
    return {
        message: {
            extendedTextMessage: {
                text,
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
        stateSender: "628111@s.whatsapp.net",
        pushname: "Ana",
        accounts: [],
        reply: jest.fn(async () => {}),
        setUserState: jest.fn(),
        resolveStaffRole: () => "admin",
        ...overrides
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
        deleteProof: jest.fn(async () => ({ ok: true, record: pending() })),
        ...overrides
    };
}

describe("parseProofCommand", () => {
    test("kode eksplisit: terima / tolak (+alasan)", () => {
        expect(parseProofCommand(`terima ${CODE}`)).toEqual({ action: "confirm", code: CODE });
        expect(parseProofCommand(`TOLAK ${CODE.toLowerCase()} buram`))
            .toEqual({ action: "reject", code: CODE, reason: "buram" });
    });

    test("nomor antrian: terima 1 / tolak 2 <alasan>", () => {
        expect(parseProofCommand("terima 1")).toEqual({ action: "confirm", index: 1 });
        expect(parseProofCommand("tolak 2")).toEqual({ action: "reject", index: 2, reason: "" });
        expect(parseProofCommand("tolak 2 nominal kurang"))
            .toEqual({ action: "reject", index: 2, reason: "nominal kurang" });
    });

    test("daftar antrian", () => {
        expect(parseProofCommand("bukti")).toEqual({ action: "list" });
        expect(parseProofCommand("daftar bukti")).toEqual({ action: "list" });
    });

    test("balasan ter-quote mengambil kode dari pesan yang dibalas", () => {
        const quoted = `Kode: ${CODE}\nPortal: http://x`;
        expect(parseProofCommand("ok", quoted)).toEqual({ action: "confirm", code: CODE });
        expect(parseProofCommand("tolak nominal kurang", quoted))
            .toEqual({ action: "reject", code: CODE, reason: "nominal kurang" });
    });

    test("perintah POLOS tanpa sasaran → pemanggil yang memutuskan", () => {
        expect(parseProofCommand("ok")).toEqual({ action: "confirm" });
        expect(parseProofCommand("terima")).toEqual({ action: "confirm" });
        expect(parseProofCommand("tolak")).toEqual({ action: "reject", reason: "" });
        expect(parseProofCommand("hapus")).toEqual({ action: "delete", reason: "" });
    });

    test("HAPUS: kode / nomor / quoted / polos", () => {
        expect(parseProofCommand(`hapus ${CODE}`)).toEqual({ action: "delete", code: CODE, reason: "" });
        expect(parseProofCommand(`hapus ${CODE.toLowerCase()} foto keluhan`))
            .toEqual({ action: "delete", code: CODE, reason: "foto keluhan" });
        expect(parseProofCommand("hapus 2")).toEqual({ action: "delete", index: 2, reason: "" });
        expect(parseProofCommand("hapus 2 salah masuk"))
            .toEqual({ action: "delete", index: 2, reason: "salah masuk" });
        // Balasan ter-quote → ambil kode dari pesan yang dibalas.
        expect(parseProofCommand("hapus", `Kode: ${CODE}`)).toEqual({ action: "delete", code: CODE, reason: "" });
    });

    test("frasa pelanggan sehari-hari tidak pernah cocok", () => {
        ["terima kasih", "terima kasih banyak", "oke bang besok ya", "tolak angin", "hapus dulu chatnya", ""]
            .forEach((t) => expect(parseProofCommand(t)).toBeNull());
    });

    test("balasan ke pesan bot LAIN (tanpa kode) tidak dianggap perintah berkode", () => {
        expect(parseProofCommand("ok", "pesan bot lain tanpa kode")).toEqual({ action: "confirm" });
        // ...dan handler akan melepasnya bila antrian kosong (lihat test di bawah).
    });

    test("borongan: 'terima semua' / 'ok semua' / 'konfirmasi semua' → confirm_all", () => {
        expect(parseProofCommand("terima semua")).toEqual({ action: "confirm_all" });
        expect(parseProofCommand("ok semua")).toEqual({ action: "confirm_all" });
        expect(parseProofCommand("KONFIRMASI SEMUA")).toEqual({ action: "confirm_all" });
        expect(parseProofCommand("terima semuanya")).toEqual({ action: "confirm_all" });
    });

    test("balasan afirmatif ALAMI pada notif berkode → confirm (bukan cuma 'ok'/'oke')", () => {
        const quoted = `Kode: ${CODE}\nPortal: http://x`;
        ["ya", "iya", "sip", "ok mas", "oke kak", "ya betul", "lunas"].forEach((t) =>
            expect(parseProofCommand(t, quoted)).toEqual({ action: "confirm", code: CODE }));
    });

    test("balasan yang BUKAN persetujuan bersih → null (tak asal konfirmasi)", () => {
        const quoted = `Kode: ${CODE}`;
        ["cek dulu", "ok cek dulu", "nanti ya", "belum", "bisa reboot ga?", "terima kasih"].forEach((t) =>
            expect(parseProofCommand(t, quoted)).toBeNull());
    });

    test("tolak/hapus tetap menang atas afirmasi di balasan berkode", () => {
        const quoted = `Kode: ${CODE}`;
        expect(parseProofCommand("tolak nominal kurang", quoted))
            .toEqual({ action: "reject", code: CODE, reason: "nominal kurang" });
        expect(parseProofCommand("hapus", quoted)).toEqual({ action: "delete", code: CODE, reason: "" });
    });
});

describe("extractQuotedText — pembungkus (PDF & pesan menghilang)", () => {
    test("bukti PDF: documentWithCaptionMessage di-unwrap sampai captionnya", () => {
        const msg = { message: { extendedTextMessage: { text: "ok", contextInfo: { quotedMessage: {
            documentWithCaptionMessage: { message: { documentMessage: { caption: `Kode: ${CODE}` } } }
        } } } } };
        expect(extractQuotedText(msg)).toBe(`Kode: ${CODE}`);
    });

    test("chat pesan-menghilang: amplop ephemeralMessage di-unwrap", () => {
        const msg = { message: { ephemeralMessage: { message: { extendedTextMessage: {
            text: "ok", contextInfo: { quotedMessage: { imageMessage: { caption: `Kode: ${CODE}` } } }
        } } } } };
        expect(extractQuotedText(msg)).toBe(`Kode: ${CODE}`);
    });
});

describe("extractQuotedText", () => {
    test("ambil caption gambar yang di-quote", () => {
        expect(extractQuotedText(textMsg("Kode: X"))).toBe("Kode: X");
    });
    test("pesan biasa → string kosong", () => {
        expect(extractQuotedText(textMsg())).toBe("");
    });
});

describe("handlePaymentProofAdminDecision — sasaran eksplisit", () => {
    test("terima <kode> → confirmProof + balas ringkasan bernama", async () => {
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

    test("terima 1 → resolve nomor ke kode dari antrian segar", async () => {
        const service = fakeService({ listPending: jest.fn(() => [pending(CODE2, "Siti"), pending(CODE, "Budi")]) });
        const ctx = baseCtx({ chats: "terima 1", service });

        await handlePaymentProofAdminDecision(ctx);

        expect(service.confirmProof).toHaveBeenCalledWith(CODE2, { adminName: "Ana" });
    });

    test("tolak 2 <alasan> → rejectProof pada bukti kedua", async () => {
        const service = fakeService({ listPending: jest.fn(() => [pending(CODE2), pending(CODE)]) });
        const ctx = baseCtx({ chats: "tolak 2 nominal kurang", service });

        await handlePaymentProofAdminDecision(ctx);

        expect(service.rejectProof).toHaveBeenCalledWith(CODE, { adminName: "Ana", reason: "nominal kurang" });
    });

    test("nomor di luar jangkauan → pesan pilihan tidak valid, bukan eksekusi", async () => {
        const service = fakeService({ listPending: jest.fn(() => [pending()]) });
        const ctx = baseCtx({ chats: "terima 5", service });

        await handlePaymentProofAdminDecision(ctx);

        expect(service.confirmProof).not.toHaveBeenCalled();
        expect(ctx.reply.mock.calls[0][0]).toContain("tidak valid");
    });

    test("balas 'ok' ke notif bukti → confirmProof pakai kode dari quote", async () => {
        const service = fakeService();
        const ctx = baseCtx({ chats: "ok", msg: textMsg(`Kode: ${CODE}`), service });

        await handlePaymentProofAdminDecision(ctx);

        expect(service.confirmProof).toHaveBeenCalledWith(CODE, { adminName: "Ana" });
        expect(ctx.setUserState).not.toHaveBeenCalled();
    });
});

describe("handlePaymentProofAdminDecision — HAPUS (bukan tolak)", () => {
    test("hapus <kode> → deleteProof; balas 'DIHAPUS' + tegaskan pelanggan tak diberi tahu", async () => {
        const service = fakeService();
        const ctx = baseCtx({ chats: `hapus ${CODE}`, service });

        const res = await handlePaymentProofAdminDecision(ctx);

        expect(res.handled).toBe(true);
        expect(service.deleteProof).toHaveBeenCalledWith(CODE, { adminName: "Ana", reason: "" });
        // Jalur hapus TIDAK boleh menyentuh confirm/reject.
        expect(service.confirmProof).not.toHaveBeenCalled();
        expect(service.rejectProof).not.toHaveBeenCalled();
        const text = ctx.reply.mock.calls[0][0];
        expect(text).toContain("DIHAPUS");
        expect(text).toContain("tidak");
    });

    test("hapus 1 → resolve nomor dari antrian lalu deleteProof", async () => {
        const service = fakeService({ listPending: jest.fn(() => [pending(CODE2, "Siti"), pending(CODE, "Budi")]) });
        const ctx = baseCtx({ chats: "hapus 1", service });

        await handlePaymentProofAdminDecision(ctx);

        expect(service.deleteProof).toHaveBeenCalledWith(CODE2, { adminName: "Ana", reason: "" });
    });

    test("balas 'hapus' ke notif → deleteProof pakai kode dari quote (bukan reject)", async () => {
        const service = fakeService();
        const ctx = baseCtx({ chats: "hapus", msg: textMsg(`Kode: ${CODE}`), service });

        await handlePaymentProofAdminDecision(ctx);

        expect(service.deleteProof).toHaveBeenCalledWith(CODE, { adminName: "Ana", reason: "" });
        expect(service.rejectProof).not.toHaveBeenCalled();
    });

    test("'hapus' polos + antrian KOSONG → dilepas (handled:false), tak dibajak", async () => {
        const service = fakeService();
        const ctx = baseCtx({ chats: "hapus", service });

        const res = await handlePaymentProofAdminDecision(ctx);

        expect(res.handled).toBe(false);
        expect(service.deleteProof).not.toHaveBeenCalled();
        expect(ctx.reply).not.toHaveBeenCalled();
    });

    test("'hapus' polos + 1 antrian → minta penegasan 'ya' (state CONFIRM action delete), BELUM menghapus", async () => {
        const service = fakeService({ listPending: jest.fn(() => [pending()]) });
        const ctx = baseCtx({ chats: "hapus", service });

        await handlePaymentProofAdminDecision(ctx);

        expect(service.deleteProof).not.toHaveBeenCalled();
        expect(ctx.setUserState).toHaveBeenCalledWith(
            "628111@s.whatsapp.net",
            expect.objectContaining({ step: STEP_CONFIRM, action: "delete" })
        );
        expect(ctx.reply.mock.calls[0][0]).toContain("Hapus bukti");
    });
});

describe("handlePaymentProofAdminDecision — perintah polos", () => {
    test("'ok' polos + antrian KOSONG → dilepas (handled:false), pesan admin tak dibajak", async () => {
        const service = fakeService();
        const ctx = baseCtx({ chats: "ok", service });

        const res = await handlePaymentProofAdminDecision(ctx);

        expect(res.handled).toBe(false);
        expect(ctx.reply).not.toHaveBeenCalled();
        expect(service.confirmProof).not.toHaveBeenCalled();
    });

    test("'ok' polos + 1 antrian → minta penegasan 'ya', BELUM melunasi", async () => {
        const service = fakeService({ listPending: jest.fn(() => [pending()]) });
        const ctx = baseCtx({ chats: "ok", service });

        const res = await handlePaymentProofAdminDecision(ctx);

        expect(res.handled).toBe(true);
        expect(service.confirmProof).not.toHaveBeenCalled();
        expect(ctx.setUserState).toHaveBeenCalledWith(
            "628111@s.whatsapp.net",
            expect.objectContaining({ step: STEP_CONFIRM, action: "confirm", id: CODE })
        );
        const text = ctx.reply.mock.calls[0][0];
        expect(text).toContain("Budi");
        expect(text).toContain("Rp 150.000");
        expect(text).toContain("ya");
    });

    test("'tolak' polos + 1 antrian → minta penegasan tolak, BELUM menolak", async () => {
        const service = fakeService({ listPending: jest.fn(() => [pending()]) });
        const ctx = baseCtx({ chats: "tolak", service });

        await handlePaymentProofAdminDecision(ctx);

        expect(service.rejectProof).not.toHaveBeenCalled();
        expect(ctx.setUserState).toHaveBeenCalledWith(
            "628111@s.whatsapp.net",
            expect.objectContaining({ step: STEP_CONFIRM, action: "reject" })
        );
        expect(ctx.reply.mock.calls[0][0]).toContain("Tolak bukti");
    });

    test("'ok' polos + banyak antrian → daftar bernomor + state SELECT", async () => {
        const service = fakeService({ listPending: jest.fn(() => [pending(CODE2, "Siti"), pending(CODE, "Budi")]) });
        const ctx = baseCtx({ chats: "ok", service });

        await handlePaymentProofAdminDecision(ctx);

        expect(service.confirmProof).not.toHaveBeenCalled();
        expect(ctx.setUserState).toHaveBeenCalledWith(
            "628111@s.whatsapp.net",
            expect.objectContaining({ step: STEP_SELECT, action: "confirm" })
        );
        const text = ctx.reply.mock.calls[0][0];
        expect(text).toContain("*1.* Siti");
        expect(text).toContain("*2.* Budi");
    });

    test("'bukti' → daftar bernomor; kosong → pesan bersih (perintah eksplisit tetap dijawab)", async () => {
        const kosong = fakeService();
        const ctx = baseCtx({ chats: "bukti", service: kosong });
        const res = await handlePaymentProofAdminDecision(ctx);
        expect(res.handled).toBe(true);
        expect(ctx.reply.mock.calls[0][0]).toContain("Tidak ada bukti");

        const isi = fakeService({ listPending: jest.fn(() => [pending()]) });
        const ctx2 = baseCtx({ chats: "bukti", service: isi });
        await handlePaymentProofAdminDecision(ctx2);
        expect(ctx2.reply.mock.calls[0][0]).toContain("*1.* Budi");
        expect(ctx2.setUserState).toHaveBeenCalledWith(
            "628111@s.whatsapp.net",
            expect.objectContaining({ step: STEP_SELECT })
        );
    });
});

describe("handlePaymentProofAdminDecision — gate & kegagalan", () => {
    test("NON-admin dengan format benar → handled:false & service tak tersentuh", async () => {
        const service = fakeService({ listPending: jest.fn(() => [pending()]) });
        const ctx = baseCtx({ chats: `terima ${CODE}`, service, resolveStaffRole: () => "teknisi" });

        const res = await handlePaymentProofAdminDecision(ctx);

        expect(res.handled).toBe(false);
        expect(service.confirmProof).not.toHaveBeenCalled();
        expect(ctx.reply).not.toHaveBeenCalled();
    });

    test("gate nyata: role admin di accounts.json lolos, role teknisi tidak", async () => {
        const accounts = [
            { role: "teknisi", phone_number: "628999" },
            { role: "admin", phone_number: "628111" }
        ];
        const service = fakeService();
        const ctx = baseCtx({ chats: `terima ${CODE}`, service, accounts });
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

    test("reaktivasi gagal dilaporkan ke admin (jangan sukses-semu)", async () => {
        const service = fakeService({
            confirmProof: jest.fn(async () => ({
                ok: true,
                record: pending(),
                settlement: { reactivation: { attempted: true, ok: false } },
                alreadyPaid: false
            }))
        });
        const ctx = baseCtx({ chats: `terima ${CODE}`, service });

        await handlePaymentProofAdminDecision(ctx);

        expect(ctx.reply.mock.calls[0][0]).toContain("Reaktivasi MikroTik GAGAL");
    });

    test("router TAK TERBACA saat cek isolir → admin diingatkan cek manual (tidak diam)", async () => {
        const service = fakeService({
            confirmProof: jest.fn(async () => ({
                ok: true,
                record: pending(),
                settlement: { reactivation: { attempted: false, reason: "profile_read_failed" } },
                alreadyPaid: false
            }))
        });
        const ctx = baseCtx({ chats: `terima ${CODE}`, service });

        await handlePaymentProofAdminDecision(ctx);

        expect(ctx.reply.mock.calls[0][0]).toContain("Router tak terbaca");
    });

    test("reaktivasi tak dicoba karena pelanggan MEMANG tak terisolir → tidak ada peringatan (benign)", async () => {
        const service = fakeService({
            confirmProof: jest.fn(async () => ({
                ok: true,
                record: pending(),
                settlement: { reactivation: { attempted: false, reason: "not_isolated" } },
                alreadyPaid: false
            }))
        });
        const ctx = baseCtx({ chats: `terima ${CODE}`, service });

        await handlePaymentProofAdminDecision(ctx);

        const text = ctx.reply.mock.calls[0][0];
        expect(text).not.toContain("Router tak terbaca");
        expect(text).not.toContain("GAGAL");
    });

    test("sudah lunas sebelumnya → tandai terkonfirmasi tanpa klaim struk baru", async () => {
        const service = fakeService({
            confirmProof: jest.fn(async () => ({ ok: true, record: pending(), settlement: {}, alreadyPaid: true }))
        });
        const ctx = baseCtx({ chats: `terima ${CODE}`, service });

        await handlePaymentProofAdminDecision(ctx);

        expect(ctx.reply.mock.calls[0][0]).toContain("SUDAH tercatat lunas");
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

    test("service melempar → tetap handled + admin diberi tahu (never-throw)", async () => {
        const service = fakeService({ confirmProof: jest.fn(async () => { throw new Error("boom"); }) });
        const ctx = baseCtx({ chats: `terima ${CODE}`, service });

        const res = await handlePaymentProofAdminDecision(ctx);

        expect(res.handled).toBe(true);
        expect(ctx.reply).toHaveBeenCalled();
    });
});

describe("handlePaymentProofAdminDecision — borongan 'terima semua'", () => {
    test("'terima semua' + antrian isi → daftar + state CONFIRM_ALL, BELUM melunasi", async () => {
        const service = fakeService({ listPending: jest.fn(() => [pending(CODE2, "Siti"), pending(CODE, "Budi")]) });
        const ctx = baseCtx({ chats: "terima semua", service });

        const res = await handlePaymentProofAdminDecision(ctx);

        expect(res.handled).toBe(true);
        expect(service.confirmProof).not.toHaveBeenCalled();
        expect(ctx.setUserState).toHaveBeenCalledWith(
            "628111@s.whatsapp.net",
            expect.objectContaining({ step: STEP_CONFIRM_ALL, action: "confirm_all" })
        );
        const text = ctx.reply.mock.calls[0][0];
        expect(text).toContain("SEMUA");
        expect(text).toContain("Siti");
        expect(text).toContain("Budi");
    });

    test("'terima semua' + antrian KOSONG → pesan bersih, tak menyentuh service", async () => {
        const service = fakeService();
        const ctx = baseCtx({ chats: "terima semua", service });

        const res = await handlePaymentProofAdminDecision(ctx);

        expect(res.handled).toBe(true);
        expect(service.confirmProof).not.toHaveBeenCalled();
        expect(ctx.reply.mock.calls[0][0]).toContain("Tidak ada bukti");
    });
});

describe("executeConfirmAll — ringkasan borongan", () => {
    test("meringkas dikonfirmasi / dilewati / gagal dari confirmManyPending", async () => {
        const service = {
            confirmManyPending: jest.fn(async () => ({
                total: 4,
                confirmed: [
                    { id: CODE, userName: "Budi", amountDue: 150000, reactivation: { attempted: true, ok: true } },
                    { id: "BP-260710-RRRR", userName: "Rina", amountDue: 100000, reactivation: { attempted: false, reason: "profile_read_failed" } }
                ],
                alreadyPaid: [],
                skipped: [{ id: CODE2, userName: "Siti", reason: "no_outstanding" }],
                failed: [{ id: "BP-260710-XXXX", userName: "Doni" }]
            })),
            listPending: jest.fn(() => [pending()])
        };
        const ctx = baseCtx();

        await executeConfirmAll(ctx, service, "Ana");

        expect(service.confirmManyPending).toHaveBeenCalledWith({ adminName: "Ana" });
        const text = ctx.reply.mock.calls[0][0];
        expect(text).toContain("2 dikonfirmasi");
        expect(text).toContain("Budi");
        expect(text).toContain("1 dilewati");
        expect(text).toContain("GAGAL");
        // Rina lunas tapi routernya tak terbaca → harus muncul di "perlu cek isolir manual".
        expect(text).toContain("perlu cek isolir manual");
        expect(text).toContain("Rina");
    });
});
