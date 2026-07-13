/**
 * Header Doc
 * Purpose: Test state domain #jadwal (psb-schedule.state) — slot-filling identitas + 3 BUKTI WAJIB
 *          (KTP+rumah+lokasi), gating, BATAL, notif grup. S1: bukti wajib.
 * Caller: Jest.
 * Deps: ../psb-schedule.state (deps di-inject). SideEffects: tulis foto dummy ke tmp (dibersihkan).
 */
"use strict";

const os = require("os");
const fs = require("fs");
const path = require("path");
const { startPsbScheduleSession, handlePsbScheduleConversationState, validateSchedule } = require("../psb-schedule.state");

const TMP = path.join(os.tmpdir(), `psb-jadwal-test-${Date.now()}`);
const PACKAGES = [{ name: "PAKET-110K", profile: "16Mbps" }];

function harness(overrides = {}) {
    let state = null;
    const createRequest = jest.fn(async (d) => ({ id: 7, ref: "PSB-7", name: d.nama, status: "menunggu" }));
    const base = {
        stateSender: "628999@s.whatsapp.net",
        reply: jest.fn(async () => {}),
        setUserState: jest.fn((k, s) => { state = s; }),
        deleteUserState: jest.fn(() => { state = null; }),
        downloadMedia: jest.fn(async () => Buffer.from([1, 2, 3, 4])),
        scheduleService: { createRequest },
        sendGroupSummary: jest.fn(async () => {}),
        getConfig: () => ({ psbIntake: { groupId: "grp@g.us" } }),
        packages: PACKAGES,
        uploadsBaseDir: TMP,
        staff: { id: 3, username: "davin", name: "Davin", role: "teknisi" },
        area: "RAF NET",
        logger: { error() {}, warn() {} },
        ...overrides
    };
    return { base, getState: () => state };
}

const imageMsg = () => ({ message: { imageMessage: {} } });
const locMsg = () => ({ message: { locationMessage: { degreesLatitude: -7.1, degreesLongitude: 111.9 } } });

afterAll(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_e) { /* noop */ } });

describe("psb-schedule.state (#jadwal — 3 bukti wajib)", () => {
    test("identitas + KTP + rumah + lokasi → buat record (dgn path foto) + notif grup", async () => {
        const h = harness();
        await startPsbScheduleSession({ ...h.base, chats: "#jadwal\nNama: Budi\nHP: 08123456789\nDusun: Karang\nPaket: PAKET-110K" });
        // identitas lengkap TAPI belum ada bukti → belum buat
        expect(h.base.scheduleService.createRequest).not.toHaveBeenCalled();
        expect(h.getState().step).toBe("PSBJADWAL_COLLECT");

        // foto pertama = KTP
        await handlePsbScheduleConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "imageMessage", msg: imageMsg() });
        expect(h.getState().context.ktpPath).toBeTruthy();
        expect(h.getState().context.rumahPath).toBeFalsy();
        expect(h.base.scheduleService.createRequest).not.toHaveBeenCalled();

        // foto kedua = rumah
        await handlePsbScheduleConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "imageMessage", msg: imageMsg() });
        expect(h.getState().context.rumahPath).toBeTruthy();
        expect(h.base.scheduleService.createRequest).not.toHaveBeenCalled(); // masih kurang lokasi

        // lokasi → lengkap
        await handlePsbScheduleConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "locationMessage", msg: locMsg() });
        expect(h.base.scheduleService.createRequest).toHaveBeenCalledTimes(1);
        const arg = h.base.scheduleService.createRequest.mock.calls[0][0];
        expect(arg).toMatchObject({ nama: "Budi", dusun: "Karang", paket: "PAKET-110K" });
        expect(arg.ktpPhotoPath).toBeTruthy();
        expect(arg.housePhotoPath).toBeTruthy();
        expect(arg.latitude).toBe(-7.1);

        const notif = h.base.sendGroupSummary.mock.calls.map((c) => c[1]).join("\n");
        expect(notif).toMatch(/PSB BARU/);
        expect(notif).toMatch(/Bukti/);
        expect(h.getState()).toBeNull();
    });

    test("identitas lengkap TANPA bukti → TIDAK buat record (bukti wajib)", async () => {
        const h = harness();
        await startPsbScheduleSession({ ...h.base, chats: "#jadwal\nNama: Budi\nHP: 08123456789\nDusun: Karang\nPaket: PAKET-110K" });
        // kirim lokasi saja (belum foto)
        await handlePsbScheduleConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "locationMessage", msg: locMsg() });
        expect(h.base.scheduleService.createRequest).not.toHaveBeenCalled();
        expect(h.getState().step).toBe("PSBJADWAL_COLLECT");
    });

    test("BATAL → tak buat record", async () => {
        const h = harness();
        await startPsbScheduleSession({ ...h.base, chats: "#jadwal Nama: Budi" });
        await handlePsbScheduleConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "batal" });
        expect(h.getState()).toBeNull();
        expect(h.base.scheduleService.createRequest).not.toHaveBeenCalled();
    });

    test("validateSchedule: paket tak dikenal → status unknown", () => {
        const v = validateSchedule({ nama: "A", hp: "08123456789", dusun: "X", paket: "PAKET-999" }, PACKAGES);
        expect(v.ok).toBe(false);
        expect(v.status.paket).toBe("unknown");
    });
});
