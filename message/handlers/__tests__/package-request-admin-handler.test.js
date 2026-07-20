"use strict";

const {
    handlePackageRequestAdminDecision,
    parsePackageCommand,
    extractQuotedText,
    STEP_SELECT
} = require("../package-request-admin-handler");

const CODE = "req_pkg_1720000000000_ab12c";
const CODE2 = "req_pkg_1720000000001_xy99z";

const ADMIN = { id: 1, username: "ana", role: "admin", name: "Ana" };

function pendingReq(id = CODE, userName = "Budi", extra = {}) {
    return {
        id,
        userId: 10,
        userName,
        currentPackageName: "Paket 10Mbps",
        requestedPackageName: "Paket 20Mbps",
        requestedPackagePrice: 200000,
        requestedBy: "teknisi1",
        createdAt: "2026-07-10T03:00:00.000Z",
        status: "pending",
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
        resolveStaffAccount: () => ADMIN,
        ...overrides
    };
}

function fakeService(overrides = {}) {
    return {
        listPendingPackageChangeRequests: jest.fn(async () => ({ status: 200, data: [] })),
        approvePackageChange: jest.fn(async () => ({
            status: 200,
            action: "approve",
            request: pendingReq(),
            customerNotified: true
        })),
        ...overrides
    };
}

describe("parsePackageCommand", () => {
    test("kode eksplisit: ok / tolak (+alasan) / batalkan (+alasan)", () => {
        expect(parsePackageCommand(`ok ${CODE}`)).toEqual({ action: "approve", code: CODE });
        expect(parsePackageCommand(`TOLAK ${CODE} nominal salah`))
            .toEqual({ action: "reject", code: CODE, reason: "nominal salah" });
        expect(parsePackageCommand(`batalkan ${CODE} duplikat`))
            .toEqual({ action: "cancel", code: CODE, reason: "duplikat" });
    });

    test("daftar antrian", () => {
        expect(parsePackageCommand("request paket")).toEqual({ action: "list" });
        expect(parsePackageCommand("antrian paket")).toEqual({ action: "list" });
    });

    test("balasan ter-quote mengambil id dari pesan yang dibalas", () => {
        const quoted = `Request ID: ${CODE}\nWaktu: kemarin`;
        expect(parsePackageCommand("ok", quoted)).toEqual({ action: "approve", code: CODE });
        expect(parsePackageCommand("tolak nominal kurang", quoted))
            .toEqual({ action: "reject", code: CODE, reason: "nominal kurang" });
        expect(parsePackageCommand("batalkan", quoted)).toEqual({ action: "cancel", code: CODE, reason: "" });
    });

    test("perintah POLOS / bernomor tanpa sasaran → null (tak dibajak; biar ke bukti-bayar & batal universal)", () => {
        ["ok", "tolak", "batalkan", "batal", "ok 1", "tolak 2", "batalkan 3", ""]
            .forEach((t) => expect(parsePackageCommand(t)).toBeNull());
    });

    test("frasa sehari-hari tidak pernah cocok", () => {
        ["terima kasih", "oke besok ya", "tolak angin", "batalkan pesanan gojek"]
            .forEach((t) => expect(parsePackageCommand(t)).toBeNull());
    });

    test("balasan ke pesan bot LAIN (tanpa id req_pkg) → null", () => {
        expect(parsePackageCommand("ok", "pesan bot lain tanpa id")).toBeNull();
    });
});

describe("extractQuotedText", () => {
    test("ambil caption gambar yang di-quote", () => {
        expect(extractQuotedText(textMsg("Request ID: X"))).toBe("Request ID: X");
    });
    test("pesan biasa → string kosong", () => {
        expect(extractQuotedText(textMsg())).toBe("");
    });
});

describe("handlePackageRequestAdminDecision — sasaran eksplisit", () => {
    test("ok <kode> → approvePackageChange(approve) + balas ringkasan bernama", async () => {
        const service = fakeService();
        const ctx = baseCtx({ chats: `ok ${CODE}`, service });

        const res = await handlePackageRequestAdminDecision(ctx);

        expect(res.handled).toBe(true);
        expect(service.approvePackageChange).toHaveBeenCalledWith(
            { requestId: CODE, action: "approve", notes: "" },
            expect.objectContaining({ role: "admin", username: "ana" })
        );
        const [text, opts] = ctx.reply.mock.calls[0];
        expect(text).toContain("Budi");
        expect(text).toContain("Paket 20Mbps");
        expect(opts).toEqual({ skipDuplicateCheck: true });
    });

    test("tolak <kode> <alasan> → approvePackageChange(reject, notes)", async () => {
        const service = fakeService({
            approvePackageChange: jest.fn(async () => ({ action: "reject", request: pendingReq() }))
        });
        const ctx = baseCtx({ chats: `tolak ${CODE} harga terlalu mahal`, service });

        await handlePackageRequestAdminDecision(ctx);

        expect(service.approvePackageChange).toHaveBeenCalledWith(
            { requestId: CODE, action: "reject", notes: "harga terlalu mahal" },
            expect.any(Object)
        );
        expect(ctx.reply.mock.calls[0][0]).toContain("ditolak");
    });

    test("batalkan <kode> → approvePackageChange(cancel); balas 'dibatalkan' + pelanggan tak diberi tahu", async () => {
        const service = fakeService({
            approvePackageChange: jest.fn(async () => ({ action: "cancel", request: pendingReq(), customerNotified: false }))
        });
        const ctx = baseCtx({ chats: `batalkan ${CODE}`, service });

        const res = await handlePackageRequestAdminDecision(ctx);

        expect(res.handled).toBe(true);
        expect(service.approvePackageChange).toHaveBeenCalledWith(
            { requestId: CODE, action: "cancel", notes: "" },
            expect.any(Object)
        );
        const text = ctx.reply.mock.calls[0][0];
        expect(text).toContain("dibatalkan");
        expect(text).toContain("TIDAK");
    });

    test("balas 'ok' ke notif request → approve pakai id dari quote (tanpa state)", async () => {
        const service = fakeService();
        const ctx = baseCtx({ chats: "ok", msg: textMsg(`Request ID: ${CODE}`), service });

        await handlePackageRequestAdminDecision(ctx);

        expect(service.approvePackageChange).toHaveBeenCalledWith(
            { requestId: CODE, action: "approve", notes: "" },
            expect.any(Object)
        );
        expect(ctx.setUserState).not.toHaveBeenCalled();
    });

    test("balas 'batalkan' ke notif → cancel pakai id dari quote (bukan reject)", async () => {
        const service = fakeService({
            approvePackageChange: jest.fn(async () => ({ action: "cancel", request: pendingReq() }))
        });
        const ctx = baseCtx({ chats: "batalkan", msg: textMsg(`Request ID: ${CODE}`), service });

        await handlePackageRequestAdminDecision(ctx);

        expect(service.approvePackageChange).toHaveBeenCalledWith(
            expect.objectContaining({ requestId: CODE, action: "cancel" }),
            expect.any(Object)
        );
    });
});

describe("handlePackageRequestAdminDecision — daftar & pelepasan", () => {
    test("'request paket' → daftar bernomor + state SELECT", async () => {
        const service = fakeService({
            listPendingPackageChangeRequests: jest.fn(async () => ({
                data: [pendingReq(CODE2, "Siti"), pendingReq(CODE, "Budi")]
            }))
        });
        const ctx = baseCtx({ chats: "request paket", service });

        await handlePackageRequestAdminDecision(ctx);

        expect(service.approvePackageChange).not.toHaveBeenCalled();
        expect(ctx.setUserState).toHaveBeenCalledWith(
            "628111@s.whatsapp.net",
            expect.objectContaining({ step: STEP_SELECT, action: "approve" })
        );
        const text = ctx.reply.mock.calls[0][0];
        expect(text).toContain("*1.* Siti");
        expect(text).toContain("*2.* Budi");
    });

    test("'request paket' + antrian kosong → pesan bersih", async () => {
        const ctx = baseCtx({ chats: "request paket", service: fakeService() });
        const res = await handlePackageRequestAdminDecision(ctx);
        expect(res.handled).toBe(true);
        expect(ctx.reply.mock.calls[0][0]).toContain("Tidak ada");
    });

    test("'ok' polos tanpa quote → dilepas (handled:false), tak menyentuh service", async () => {
        const service = fakeService({ listPendingPackageChangeRequests: jest.fn(async () => ({ data: [pendingReq()] })) });
        const ctx = baseCtx({ chats: "ok", service });

        const res = await handlePackageRequestAdminDecision(ctx);

        expect(res.handled).toBe(false);
        expect(service.approvePackageChange).not.toHaveBeenCalled();
        expect(ctx.reply).not.toHaveBeenCalled();
    });
});

describe("handlePackageRequestAdminDecision — gate & kegagalan", () => {
    test("NON-admin dengan format benar → handled:false & service tak tersentuh", async () => {
        const service = fakeService();
        const ctx = baseCtx({ chats: `ok ${CODE}`, service, resolveStaffAccount: () => ({ role: "teknisi" }) });

        const res = await handlePackageRequestAdminDecision(ctx);

        expect(res.handled).toBe(false);
        expect(service.approvePackageChange).not.toHaveBeenCalled();
        expect(ctx.reply).not.toHaveBeenCalled();
    });

    test("gate nyata via accounts.json: admin lolos, teknisi tidak", async () => {
        const accounts = [
            { role: "teknisi", phone_number: "628999" },
            { role: "admin", phone_number: "628111", username: "ana", id: 1, name: "Ana" }
        ];
        const service = fakeService();
        const ctx = baseCtx({ chats: `ok ${CODE}`, service, accounts });
        delete ctx.resolveStaffAccount;

        expect((await handlePackageRequestAdminDecision(ctx)).handled).toBe(true);
        expect(service.approvePackageChange).toHaveBeenCalled();

        const svc2 = fakeService();
        const teknisiCtx = baseCtx({
            chats: `ok ${CODE}`,
            service: svc2,
            accounts,
            sender: "628999@s.whatsapp.net",
            plainSenderNumber: "628999"
        });
        delete teknisiCtx.resolveStaffAccount;

        expect((await handlePackageRequestAdminDecision(teknisiCtx)).handled).toBe(false);
        expect(svc2.approvePackageChange).not.toHaveBeenCalled();
    });

    test("gagal MikroTik → pesan khusus 'gagal menerapkan ke MikroTik', paket TIDAK diubah", async () => {
        const service = fakeService({
            approvePackageChange: jest.fn(async () => {
                throw new Error("Gagal mengupdate profil di MikroTik: timeout. Database tidak di-update.");
            })
        });
        const ctx = baseCtx({ chats: `ok ${CODE}`, service });

        const res = await handlePackageRequestAdminDecision(ctx);

        expect(res.handled).toBe(true);
        const text = ctx.reply.mock.calls[0][0];
        expect(text).toContain("MikroTik");
        expect(text).toContain("TIDAK diubah");
    });

    test("request sudah diproses → pesan 'sudah diproses'", async () => {
        const service = fakeService({
            approvePackageChange: jest.fn(async () => {
                throw new Error("Permintaan ini sudah dalam status 'approved' dan tidak dapat diubah lagi.");
            })
        });
        const ctx = baseCtx({ chats: `ok ${CODE}`, service });

        await handlePackageRequestAdminDecision(ctx);

        expect(ctx.reply.mock.calls[0][0]).toContain("sudah diproses");
    });

    test("service melempar generik → tetap handled + admin diberi tahu (never-throw)", async () => {
        const service = fakeService({
            approvePackageChange: jest.fn(async () => { throw new Error("boom"); })
        });
        const ctx = baseCtx({ chats: `ok ${CODE}`, service });

        const res = await handlePackageRequestAdminDecision(ctx);

        expect(res.handled).toBe(true);
        expect(ctx.reply.mock.calls[0][0]).toContain("Gagal memproses");
    });
});
