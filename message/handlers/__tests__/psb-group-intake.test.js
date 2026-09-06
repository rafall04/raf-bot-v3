/**
 * Header Doc
 * Purpose: Test handler intake PSB grup — happy path (create + reply PPPoE), auth reject, parse error, non-image.
 * Caller: Jest.
 * Deps: ../psb-group-intake (deps di-mock).
 * SideEffects: Tulis file KTP ke dir tmp (dibersihkan di afterAll).
 */
"use strict";

const os = require("os");
const fs = require("fs");
const path = require("path");
const { handlePsbGroupIntake } = require("../psb-group-intake");

const TMP = path.join(os.tmpdir(), `psb-test-${Date.now()}`);
const ACCOUNTS = [{ id: 3, username: "davin", name: "Davin", role: "teknisi", phone_number: "628999" }];
const PACKAGES = [{ name: "PAKET-110K", profile: "16Mbps" }];

function baseDeps(overrides = {}) {
    return {
        msg: { message: { imageMessage: {} } },
        type: "imageMessage",
        caption: "#PSB\nNama: Budi\nPaket: PAKET-110K\nWiFi: BudiNet\nSandi: budi12345\nHP: 08123456789",
        participant: "628999@s.whatsapp.net",
        plainPhone: "628999",
        accounts: ACCOUNTS,
        allowedRoles: ["teknisi", "admin", "owner"],
        usersService: { upsertUserFromAdminPanel: jest.fn(async () => ({ status: 201, body: { data: { id: 77 }, sync_message: "PPPoE ok" } })) },
        reply: jest.fn(async () => {}),
        downloadMedia: jest.fn(async () => Buffer.from([1, 2, 3, 4])),
        packages: PACKAGES,
        uploadsBaseDir: TMP,
        generateRandomPassword: () => "genpass123",
        isProcessing: () => false,
        setProcessing: jest.fn(),
        clearProcessing: jest.fn(),
        logger: { error: () => {}, warn: () => {}, log: () => {} },
        ...overrides
    };
}

afterAll(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_e) { /* noop */ } });
beforeEach(() => { global.users = []; global.packages = PACKAGES; });

describe("handlePsbGroupIntake", () => {
    test("teknisi + caption valid → create dipanggil + balas kredensial PPPoE", async () => {
        const deps = baseDeps();
        const r = await handlePsbGroupIntake(deps);
        expect(r.handled).toBe(true);
        expect(deps.usersService.upsertUserFromAdminPanel).toHaveBeenCalledTimes(1);
        const arg = deps.usersService.upsertUserFromAdminPanel.mock.calls[0][0];
        expect(arg.userData).toMatchObject({
            name: "Budi", phone_number: "08123456789", subscription: "PAKET-110K",
            wifi_ssid: "BudiNet", wifi_password: "budi12345", registration_mode: "new"
        });
        expect(arg.userData.pppoe_username).toBe("budi");
        expect(arg.actor.role).toBe("teknisi");
        const replyText = deps.reply.mock.calls[0][0];
        expect(replyText).toMatch(/PSB berhasil/);
        expect(replyText).toMatch(/budi/);
        expect(replyText).toMatch(/genpass123/);
        expect(deps.clearProcessing).toHaveBeenCalled();
    });

    test("#b327 welcome terkirim → balas jujur 'sudah dikirim'", async () => {
        const deps = baseDeps({ usersService: { upsertUserFromAdminPanel: jest.fn(async () => ({ status: 201, body: { data: { id: 77 }, welcome: { dispatched: true } } })) } });
        await handlePsbGroupIntake(deps);
        const replyText = deps.reply.mock.calls[0][0];
        expect(replyText).toMatch(/sudah dikirim ke pelanggan/i);
        expect(replyText).not.toMatch(/BELUM/i);
    });

    test("#b327 welcome GAGAL (WA putus) → peringatan JUJUR, bukan sukses-semu 'Welcome dikirim'", async () => {
        const deps = baseDeps({ usersService: { upsertUserFromAdminPanel: jest.fn(async () => ({ status: 201, body: { data: { id: 77 }, welcome: { dispatched: false, reason: "whatsapp_tidak_tersambung" } } })) } });
        await handlePsbGroupIntake(deps);
        const replyText = deps.reply.mock.calls[0][0];
        expect(replyText).toMatch(/BELUM/);
        expect(replyText).toMatch(/tidak tersambung ke WhatsApp/i);
    });

    test("freeInstallMonth ON (deps) → PSB grup baru bebas tagihan bulan pemasangan", async () => {
        const deps = baseDeps({ freeInstallMonth: true });
        await handlePsbGroupIntake(deps);
        const arg = deps.usersService.upsertUserFromAdminPanel.mock.calls[0][0];
        expect(arg.userData.free_first_month).toBe(true);
    });

    test("freeInstallMonth OFF (deps) → tidak diaktifkan", async () => {
        const deps = baseDeps({ freeInstallMonth: false });
        await handlePsbGroupIntake(deps);
        const arg = deps.usersService.upsertUserFromAdminPanel.mock.calls[0][0];
        expect(arg.userData.free_first_month).toBe(false);
    });

    test("pengirim bukan staf → diabaikan, create TIDAK dipanggil", async () => {
        const deps = baseDeps({ participant: "628000@s.whatsapp.net", plainPhone: "628000" });
        const r = await handlePsbGroupIntake(deps);
        expect(r.handled).toBe(false);
        expect(deps.usersService.upsertUserFromAdminPanel).not.toHaveBeenCalled();
        expect(deps.reply).not.toHaveBeenCalled();
    });

    test("caption tak lengkap → balas error, create TIDAK dipanggil", async () => {
        const deps = baseDeps({ caption: "#PSB\nNama: Budi\nPaket: PAKET-110K" });
        const r = await handlePsbGroupIntake(deps);
        expect(r.handled).toBe(true);
        expect(deps.usersService.upsertUserFromAdminPanel).not.toHaveBeenCalled();
        expect(deps.reply.mock.calls[0][0]).toMatch(/belum lengkap/);
    });

    test("bukan gambar / bukan #PSB → tak ditangani", async () => {
        expect((await handlePsbGroupIntake(baseDeps({ type: "conversation" }))).handled).toBe(false);
        expect((await handlePsbGroupIntake(baseDeps({ caption: "halo grup" }))).handled).toBe(false);
    });
});
