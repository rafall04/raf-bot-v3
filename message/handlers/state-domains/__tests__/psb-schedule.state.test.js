/**
 * Header Doc
 * Purpose: Test state domain #jadwal (psb-schedule.state) — slot-filling, one-shot, BATAL, notif grup.
 * Caller: Jest.
 * Deps: ../psb-schedule.state (deps di-inject).
 * SideEffects: Tidak ada (scheduleService & sendGroupSummary di-mock).
 */
"use strict";

const { startPsbScheduleSession, handlePsbScheduleConversationState, validateSchedule } = require("../psb-schedule.state");

const PACKAGES = [{ name: "PAKET-110K", profile: "16Mbps" }];

function harness(overrides = {}) {
    let state = null;
    const createRequest = jest.fn(async (d) => ({ id: 7, ref: "PSB-7", name: d.nama, status: "menunggu" }));
    const base = {
        stateSender: "628999@s.whatsapp.net",
        reply: jest.fn(async () => {}),
        setUserState: jest.fn((k, s) => { state = s; }),
        deleteUserState: jest.fn(() => { state = null; }),
        scheduleService: { createRequest },
        sendGroupSummary: jest.fn(async () => {}),
        getConfig: () => ({ psbIntake: { groupId: "grp@g.us" } }),
        packages: PACKAGES,
        staff: { id: 3, username: "davin", name: "Davin", role: "teknisi" },
        area: "RAF NET",
        logger: { error() {}, warn() {} },
        ...overrides
    };
    return { base, getState: () => state };
}

describe("psb-schedule.state (#jadwal)", () => {
    test("slot-filling: dicicil → lengkap → buat record + notif grup 'siapa pasang'", async () => {
        const h = harness();
        const r = await startPsbScheduleSession({ ...h.base, chats: "#jadwal" });
        expect(r.started).toBe(true);
        expect(h.getState().step).toBe("PSBJADWAL_COLLECT");

        await handlePsbScheduleConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "Nama: Budi\nHP: 08123456789" });
        expect(h.base.scheduleService.createRequest).not.toHaveBeenCalled(); // belum lengkap

        await handlePsbScheduleConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "Dusun: Karang\nPaket: PAKET-110K" });
        expect(h.base.scheduleService.createRequest).toHaveBeenCalledTimes(1);
        const arg = h.base.scheduleService.createRequest.mock.calls[0][0];
        expect(arg).toMatchObject({ nama: "Budi", hp: "08123456789", dusun: "Karang", paket: "PAKET-110K", area: "RAF NET" });

        const notif = h.base.sendGroupSummary.mock.calls.map((c) => c[1]).join("\n");
        expect(notif).toMatch(/PSB BARU/);
        expect(notif).toMatch(/PSB-7/);
        expect(notif).toMatch(/belum kepasang/i);
        expect(h.getState()).toBeNull();
    });

    test("one-shot: #jadwal + semua data langsung → buat record tanpa nunggu pesan lagi", async () => {
        const h = harness();
        await startPsbScheduleSession({ ...h.base, chats: "#jadwal\nNama: Budi\nHP: 08123456789\nDusun: Karang\nPaket: PAKET-110K" });
        expect(h.base.scheduleService.createRequest).toHaveBeenCalledTimes(1);
        expect(h.getState()).toBeNull();
    });

    test("BATAL → tak buat record", async () => {
        const h = harness();
        await startPsbScheduleSession({ ...h.base, chats: "#jadwal Nama: Budi" });
        await handlePsbScheduleConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "batal" });
        expect(h.getState()).toBeNull();
        expect(h.base.scheduleService.createRequest).not.toHaveBeenCalled();
    });

    test("HP invalid → belum lengkap, tak buat record", async () => {
        const h = harness();
        await startPsbScheduleSession({ ...h.base, chats: "#jadwal\nNama: Budi\nHP: 08\nDusun: Karang\nPaket: PAKET-110K" });
        expect(h.base.scheduleService.createRequest).not.toHaveBeenCalled();
        expect(h.getState().step).toBe("PSBJADWAL_COLLECT");
    });

    test("validateSchedule: paket tak dikenal → status unknown", () => {
        const v = validateSchedule({ nama: "A", hp: "08123456789", dusun: "X", paket: "PAKET-999" }, PACKAGES);
        expect(v.ok).toBe(false);
        expect(v.status.paket).toBe("unknown");
    });
});
