/**
 * Header Doc
 * Purpose: Menguji dua langkah percakapan reboot berbantu memakai kalimat pelanggan NYATA:
 *          izin ("Ok mas") tidak boleh ditolak, dan "Sudah tp masih lemot" tidak boleh dibaca beres.
 * Caller: jest.
 * Deps: `message/handlers/states/reboot-followup-state-handler` (dengan service & state di-mock).
 * MainFuncs: -
 * SideEffects: Tidak ada (semua boundary di-mock).
 */
"use strict";

jest.mock("../../conversation-handler", () => ({ deleteUserState: jest.fn() }));
jest.mock("../../template-helpers", () => ({
    // Kembalikan key-nya saja supaya assertion menguji PILIHAN template, bukan teksnya.
    renderResponseTemplate: (key) => key
}));
jest.mock("../../../../lib/reboot-followup-service", () => ({
    executeRebootAndSchedule: jest.fn(),
    runDeepCheck: jest.fn(),
    closeJob: jest.fn(),
    notifyAdmins: jest.fn().mockResolvedValue(undefined)
}));
jest.mock("../../../../lib/reboot-followup-store", () => ({
    STATUS: { CLOSED: "closed", ESCALATED: "escalated" },
    loadJobs: jest.fn(() => []),
    findJobByJid: jest.fn()
}));

const { deleteUserState } = require("../../conversation-handler");
const service = require("../../../../lib/reboot-followup-service");
const store = require("../../../../lib/reboot-followup-store");
const { handleRebootOffer, handleRebootFollowupAnswer } = require("../reboot-followup-state-handler");

const SENDER = "628123@s.whatsapp.net";
const USER = { id: 1, name: "Widya", device_id: "DEV-1" };

beforeEach(() => {
    jest.clearAllMocks();
    service.executeRebootAndSchedule.mockResolvedValue({ ok: true, job: { id: "RFU-1" } });
});

describe("REBOOTFU_OFFER — izin reboot", () => {
    test.each(["ok mas", "ya ka", "iya kk", "siap", "boleh kak"])("'%s' → reboot dijalankan", async (jawaban) => {
        const reply = jest.fn();
        await handleRebootOffer({ targetUser: USER, reason: "PPPOE_HANG" }, jawaban, reply, SENDER);

        expect(service.executeRebootAndSchedule).toHaveBeenCalledWith(
            expect.objectContaining({ user: USER, jid: SENDER })
        );
        expect(reply).toHaveBeenCalledWith("rebootfu_started");
    });

    test.each(["nanti saja mas", "gausah kak"])("'%s' → tidak mereboot", async (jawaban) => {
        const reply = jest.fn();
        await handleRebootOffer({ targetUser: USER }, jawaban, reply, SENDER);

        expect(service.executeRebootAndSchedule).not.toHaveBeenCalled();
        expect(reply).toHaveBeenCalledWith("rebootfu_offer_declined");
        expect(deleteUserState).toHaveBeenCalledWith(SENDER);
    });

    test("state dihapus SEBELUM reboot — kelanjutan dipegang store durabel", async () => {
        const order = [];
        deleteUserState.mockImplementation(() => order.push("deleteState"));
        service.executeRebootAndSchedule.mockImplementation(async () => {
            order.push("reboot");
            return { ok: true, job: { id: "RFU-1" } };
        });

        await handleRebootOffer({ targetUser: USER }, "ya", jest.fn(), SENDER);
        expect(order).toEqual(["deleteState", "reboot"]);
    });
});

describe("REBOOTFU_ASK — jawaban pasca-verifikasi", () => {
    const JOB = { id: "RFU-1", jid: SENDER, name: "Widya", deviceId: "DEV-1" };

    beforeEach(() => store.findJobByJid.mockReturnValue(JOB));

    test("'Sudah stabil kk' → ditutup sebagai beres", async () => {
        const reply = jest.fn();
        await handleRebootFollowupAnswer({}, "sudah stabil kk", reply, SENDER);

        expect(service.closeJob).toHaveBeenCalledWith("RFU-1", "closed");
        expect(service.runDeepCheck).not.toHaveBeenCalled();
        expect(reply).toHaveBeenCalledWith("rebootfu_resolved");
    });

    test("'Sudah tp masih lemot' → diagnosa dalam, BUKAN dianggap beres", async () => {
        service.runDeepCheck.mockResolvedValue({ verdict: "SEMUA_HIJAU", detail: "normal" });
        const reply = jest.fn();
        await handleRebootFollowupAnswer({}, "sudah tp masih lemot apa di ganti kata sandi saja", reply, SENDER);

        expect(service.runDeepCheck).toHaveBeenCalledWith(JOB);
        expect(reply).toHaveBeenCalledWith("rebootfu_deep_check");
        expect(reply).toHaveBeenCalledWith("rebootfu_deep_all_green");
        expect(service.notifyAdmins).toHaveBeenCalled();
    });

    test("masih bermasalah + jalur sakit → jujurkan sisi jaringan kami", async () => {
        service.runDeepCheck.mockResolvedValue({ verdict: "UPSTREAM_SAKIT", detail: "DEGRADASI" });
        const reply = jest.fn();
        await handleRebootFollowupAnswer({}, "masih lemot kk", reply, SENDER);

        expect(reply).toHaveBeenCalledWith("rebootfu_deep_found_issue");
    });

    test("jawaban tak terbaca → tanya ulang, state tidak dihapus", async () => {
        const reply = jest.fn();
        await handleRebootFollowupAnswer({}, "hmm apa ya", reply, SENDER);

        expect(reply).toHaveBeenCalledWith("rebootfu_ask_invalid");
        expect(deleteUserState).not.toHaveBeenCalled();
    });
});
