/**
 * Header Doc
 * Purpose: Test notifier grup perbaikan — post saat tiket baru & selesai, guard enabled/groupId/flag.
 * Caller: Jest.
 * Deps: ../repair-group-notifier (gateway + delivery di-mock).
 * SideEffects: Tidak ada (delivery di-mock).
 */
"use strict";

jest.mock("../whatsapp-gateway", () => ({ isReady: () => true }));
const mockSend = jest.fn(async () => ({ sent: true }));
jest.mock("../whatsapp-delivery-service", () => ({ sendMessage: (...a) => mockSend(...a) }));

const notifier = require("../repair-group-notifier");

beforeEach(() => {
    mockSend.mockClear();
    global.config = { repairNotif: { enabled: true, groupId: "grp@g.us", notifyNewTicket: true, notifyCompleted: true } };
});

describe("repair-group-notifier", () => {
    test("tiket baru → posting ke grup + isi benar", async () => {
        await notifier.notifyRepairGroupNewTicket({ ticketId: "TK123", pelangganName: "Budi", pelangganAddress: "Jl. X", issueType: "Mati Total", priority: "HIGH" });
        expect(mockSend).toHaveBeenCalledTimes(1);
        const [gid, payload] = mockSend.mock.calls[0];
        expect(gid).toBe("grp@g.us");
        expect(payload.text).toMatch(/TIKET PERBAIKAN BARU/);
        expect(payload.text).toMatch(/Budi/);
        expect(payload.text).toMatch(/TK123/);
        expect(payload.text).toMatch(/Mati Total/);
        expect(payload.text).toMatch(/proses TK123/);
    });

    test("tiket selesai → posting dgn teknisi + durasi + catatan", async () => {
        await notifier.notifyRepairGroupCompleted({ ticketId: "TK9", pelangganName: "Siti" }, { durationMinutes: 45, teknisiName: "Davin", resolutionNotes: "Ganti kabel drop" });
        expect(mockSend).toHaveBeenCalledTimes(1);
        const [, payload] = mockSend.mock.calls[0];
        expect(payload.text).toMatch(/TIKET SELESAI/);
        expect(payload.text).toMatch(/Davin/);
        expect(payload.text).toMatch(/45 mnt/);
        expect(payload.text).toMatch(/Ganti kabel drop/);
    });

    test("enabled=false → tidak posting", async () => {
        global.config.repairNotif.enabled = false;
        await notifier.notifyRepairGroupNewTicket({ ticketId: "X" });
        await notifier.notifyRepairGroupCompleted({ ticketId: "X" }, {});
        expect(mockSend).not.toHaveBeenCalled();
    });

    test("notifyCompleted=false → skip selesai (tapi baru tetap jalan)", async () => {
        global.config.repairNotif.notifyCompleted = false;
        await notifier.notifyRepairGroupCompleted({ ticketId: "X" }, {});
        expect(mockSend).not.toHaveBeenCalled();
        await notifier.notifyRepairGroupNewTicket({ ticketId: "Y", pelangganName: "A" });
        expect(mockSend).toHaveBeenCalledTimes(1);
    });

    test("groupId kosong → tidak posting (aman)", async () => {
        global.config.repairNotif.groupId = "";
        await notifier.notifyRepairGroupNewTicket({ ticketId: "X" });
        expect(mockSend).not.toHaveBeenCalled();
    });
});
