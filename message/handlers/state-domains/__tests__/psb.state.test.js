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
const { startPsbSession, handlePsbConversationState } = require("../psb.state");

const TMP = path.join(os.tmpdir(), `psb-dm-test-${Date.now()}`);
const PACKAGES = [{ name: "PAKET-110K", profile: "16Mbps" }];
const STAFF = { id: 3, username: "davin", name: "Davin", role: "teknisi" };
const NOW = Date.parse("2026-07-04T10:20:00.000Z");
const CANDIDATES = [
    { deviceId: "dev-A", serialNumber: "48575443AAAA0001", model: "HG8145V5", currentPPPUsername: "tes@hw", registeredDate: "2026-07-04T10:05:00.000Z", registeredTimestamp: Date.parse("2026-07-04T10:05:00.000Z") },
    { deviceId: "dev-B", serialNumber: "48575443BBBB0002", model: "HS8346R5", currentPPPUsername: "old@x", registeredDate: "2026-07-04T09:40:00.000Z", registeredTimestamp: Date.parse("2026-07-04T09:40:00.000Z") }
];
const CAPTION = "#PSB\nNama: Budi Santoso\nPaket: PAKET-110K\nWiFi: BudiNet\nSandi: budi12345\nHP: 08123456789";

function harness(overrides = {}) {
    let state = null;
    const setUserState = jest.fn((k, s) => { state = s; });
    const deleteUserState = jest.fn(() => { state = null; });
    const upsert = jest.fn(async () => ({ status: 201, body: { data: { id: 99 } } }));
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

        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "YA" });

        expect(h.base.usersService.upsertUserFromAdminPanel).toHaveBeenCalledTimes(1);
        const arg = h.base.usersService.upsertUserFromAdminPanel.mock.calls[0][0];
        expect(arg.userData).toMatchObject({ name: "Budi Santoso", phone_number: "08123456789", subscription: "PAKET-110K", device_id: "dev-A", registration_mode: "new" });
        expect(arg.userData.ssid_indices).toEqual(["1"]);
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
});
