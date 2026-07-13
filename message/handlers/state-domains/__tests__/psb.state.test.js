/**
 * Header Doc
 * Purpose: Test wizard PSB DM (psb.state) — happy path (KTP→rumah→lokasi→YA→provision+summary),
 *          TIDAK→pilih nomor, BATAL, dan gate dokumen wajib sebelum konfirmasi modem.
 * Caller: Jest.
 * Deps: ../../state-domains/psb.state (deps di-inject).
 * SideEffects: Tulis file dummy ke tmp (dibersihkan afterAll).
 */
"use strict";

const os = require("os");
const fs = require("fs");
const path = require("path");
const { startPsbSession, handlePsbConversationState, buildPppoeUsername } = require("../psb.state");

const TMP = path.join(os.tmpdir(), `psb-dm-test-${Date.now()}`);
const PACKAGES = [{ name: "PAKET-110K", profile: "16Mbps" }];
const STAFF = { id: 3, username: "davin", name: "Davin", role: "teknisi" };
const NOW = Date.parse("2026-07-04T10:20:00.000Z");
const CANDIDATES = [
    { deviceId: "dev-A", serialNumber: "48575443AAAA0001", model: "HG8145V5", currentPPPUsername: "tes@hw", registeredDate: "2026-07-04T10:05:00.000Z", registeredTimestamp: Date.parse("2026-07-04T10:05:00.000Z") },
    { deviceId: "dev-B", serialNumber: "48575443BBBB0002", model: "HS8346R5", currentPPPUsername: "old@x", registeredDate: "2026-07-04T09:40:00.000Z", registeredTimestamp: Date.parse("2026-07-04T09:40:00.000Z") }
];
const CAPTION = "#PSB\nNama: Budi Santoso\nDusun: Krajan\nPaket: PAKET-110K\nWiFi: BudiNet\nSandi: budi12345\nHP: 08123456789";

function harness(overrides = {}) {
    let state = null;
    const setUserState = jest.fn((k, s) => { state = s; });
    const deleteUserState = jest.fn(() => { state = null; });
    const upsert = jest.fn(async () => ({ status: 201, body: { data: { id: 99 }, device_config: { attempted: true, ok: true, message: "ok" } } }));
    const base = {
        stateSender: "628999@s.whatsapp.net",
        reply: jest.fn(async () => {}),
        setUserState,
        deleteUserState,
        downloadMedia: jest.fn(async () => Buffer.from([1, 2, 3, 4])),
        findRecentPsbCandidates: jest.fn(async () => ({ ok: true, data: CANDIDATES })),
        usersService: { upsertUserFromAdminPanel: upsert },
        getConfig: () => ({ psbIntake: { enabled: true, groupId: "grp@g.us", recencyWindowMinutes: 120 }, defaultBulkSSID: "1" }),
        packages: PACKAGES,
        uploadsBaseDir: TMP,
        sendGroupSummary: jest.fn(async () => {}),
        nowMs: NOW,
        logger: { error() {}, warn() {}, log() {} },
        ...overrides
    };
    return { base, getState: () => state };
}

function imageMsg(caption) { return { message: { imageMessage: caption ? { caption } : {} } }; }
function locMsg() { return { message: { locationMessage: { degreesLatitude: -7.1, degreesLongitude: 111.9 } } }; }

afterAll(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_e) { /* noop */ } });
beforeEach(() => { global.users = []; });

async function reachConfirm(h) {
    await startPsbSession({ ...h.base, type: "imageMessage", caption: CAPTION, msg: imageMsg(CAPTION), staff: STAFF });
    // foto rumah
    await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "imageMessage", msg: imageMsg() });
    // share lokasi → memicu deteksi + konfirmasi
    await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "locationMessage", msg: locMsg() });
}

describe("psb.state wizard DM", () => {
    test("happy path: KTP→rumah→lokasi→YA → provision modem terpilih + ringkasan grup", async () => {
        const h = harness();
        await reachConfirm(h);
        expect(h.getState().step).toBe("PSB_CONFIRM_MODEM");
        expect(h.getState().context.candidate.deviceId).toBe("dev-A");
        expect(h.base.findRecentPsbCandidates).toHaveBeenCalled();

        // Layar verifikasi menampilkan username rakitan + recap sebelum eksekusi.
        const recap = h.base.reply.mock.calls.map((c) => c[0]).join("\n---\n");
        expect(recap).toMatch(/CEK DULU/);
        expect(recap).toContain("budi_santoso-krajan@rafcybernet");

        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "YA" });

        expect(h.base.usersService.upsertUserFromAdminPanel).toHaveBeenCalledTimes(1);
        const arg = h.base.usersService.upsertUserFromAdminPanel.mock.calls[0][0];
        expect(arg.userData).toMatchObject({ name: "Budi Santoso", phone_number: "08123456789", subscription: "PAKET-110K", device_id: "dev-A", registration_mode: "new" });
        expect(arg.userData.ssid_indices).toEqual(["1"]);
        // Username dirakit dari Nama+Dusun; password pakai default (harness tak set → fallback rafnet123), BUKAN acak.
        expect(arg.userData.pppoe_username).toBe("budi_santoso-krajan@rafcybernet");
        expect(arg.userData.pppoe_password).toBe("rafnet123");
        // Push modem OK (device_config.ok) → reply boleh klaim "online".
        expect(h.base.reply.mock.calls.map((c) => c[0]).join("\n---\n")).toMatch(/online/i);
        expect(h.base.sendGroupSummary).toHaveBeenCalledTimes(1);
        expect(h.getState()).toBeNull(); // state dibersihkan setelah selesai
    });

    test("dokumen WAJIB: sebelum rumah+lokasi lengkap, modem TIDAK dibaca & TIDAK provision", async () => {
        const h = harness();
        await startPsbSession({ ...h.base, type: "imageMessage", caption: CAPTION, msg: imageMsg(CAPTION), staff: STAFF });
        // hanya kirim lokasi (belum foto rumah)
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "locationMessage", msg: locMsg() });
        expect(h.getState().step).toBe("PSB_COLLECT_DOCS");
        expect(h.base.findRecentPsbCandidates).not.toHaveBeenCalled();
        expect(h.base.usersService.upsertUserFromAdminPanel).not.toHaveBeenCalled();
    });

    test("TIDAK → daftar bernomor → pilih 2 → provision dev-B", async () => {
        const h = harness();
        await reachConfirm(h);
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "TIDAK" });
        expect(h.getState().step).toBe("PSB_PICK_MODEM");

        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "2" });
        const arg = h.base.usersService.upsertUserFromAdminPanel.mock.calls[0][0];
        expect(arg.userData.device_id).toBe("dev-B");
    });

    test("BATAL saat konfirmasi → state dihapus, TANPA provision", async () => {
        const h = harness();
        await reachConfirm(h);
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "batal" });
        expect(h.getState()).toBeNull();
        expect(h.base.usersService.upsertUserFromAdminPanel).not.toHaveBeenCalled();
    });

    test("caption ngawur → sesi tak dibuka", async () => {
        const h = harness();
        const r = await startPsbSession({ ...h.base, type: "imageMessage", caption: "#PSB\nNama: Budi", msg: imageMsg("#PSB\nNama: Budi"), staff: STAFF });
        expect(r.started).toBe(false);
        expect(h.getState()).toBeNull();
    });

    test("dusun kosong → sesi tak dibuka (wajib untuk username PPPoE)", async () => {
        const h = harness();
        const cap = "#PSB\nNama: Budi Santoso\nPaket: PAKET-110K\nWiFi: BudiNet\nSandi: budi12345\nHP: 08123456789";
        const r = await startPsbSession({ ...h.base, type: "imageMessage", caption: cap, msg: imageMsg(cap), staff: STAFF });
        expect(r.started).toBe(false);
        expect(h.getState()).toBeNull();
        expect(h.base.reply.mock.calls.map((c) => c[0]).join("\n")).toMatch(/Dusun/);
    });

    test("realm & password default dari config dipakai untuk username/secret", async () => {
        const h = harness({ getConfig: () => ({ psbIntake: { enabled: true, groupId: "grp@g.us", recencyWindowMinutes: 120, pppoeRealm: "@myisp" }, defaultBulkSSID: "1", defaultPPPoEPassword: "sandi999" }) });
        await reachConfirm(h);
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "YA" });
        const arg = h.base.usersService.upsertUserFromAdminPanel.mock.calls[0][0];
        expect(arg.userData.pppoe_username).toBe("budi_santoso-krajan@myisp");
        expect(arg.userData.pppoe_password).toBe("sandi999");
    });

    test("push modem GAGAL (device_config_failed) → reply JUJUR (bukan 'online!') + grup minta tindak lanjut", async () => {
        const failUpsert = jest.fn(async () => ({
            status: 201,
            body: { data: { id: 99 }, device_config: { attempted: true, ok: false, message: "timeout ACS" }, warning: "device_config_failed" }
        }));
        const h = harness({ usersService: { upsertUserFromAdminPanel: failUpsert } });
        await reachConfirm(h);
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "YA" });

        const allReplies = h.base.reply.mock.calls.map((c) => c[0]).join("\n---\n");
        expect(allReplies).toMatch(/GAGAL/);
        expect(allReplies).toMatch(/manual/i);
        expect(allReplies).not.toContain("online!"); // anti sukses-semu
        const summary = h.base.sendGroupSummary.mock.calls.map((c) => c[1]).join("\n");
        expect(summary).toMatch(/tindak lanjut/i);
        expect(h.getState()).toBeNull(); // pelanggan tetap terdaftar, sesi ditutup
    });
});

describe("buildPppoeUsername", () => {
    test("rakit baku: nama(spasi→_) - dusun @ realm, semua huruf kecil", () => {
        expect(buildPppoeUsername("Agus Suprihono", "Tanjungharjo", "rafcybernet", [])).toBe("agus_suprihono-tanjungharjo@rafcybernet");
    });
    test("realm boleh diawali @ (ditoleransi, tak dobel)", () => {
        expect(buildPppoeUsername("Budi", "Krajan", "@rafcybernet", [])).toBe("budi-krajan@rafcybernet");
    });
    test("realm default rafcybernet bila tak diberikan", () => {
        expect(buildPppoeUsername("Budi", "Krajan", undefined, [])).toBe("budi-krajan@rafcybernet");
    });
    test("dedup angka bila bentrok dgn user existing", () => {
        const existing = [{ pppoe_username: "budi-krajan@rafcybernet" }];
        expect(buildPppoeUsername("Budi", "Krajan", "rafcybernet", existing)).toBe("budi-krajan2@rafcybernet");
    });
    test("dusun kosong → jatuh ke nama saja (graceful; wizard mewajibkan dusun di depan)", () => {
        expect(buildPppoeUsername("Putri", "", "rafcybernet", [])).toBe("putri@rafcybernet");
    });
});
