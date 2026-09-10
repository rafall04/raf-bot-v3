/**
 * Header Doc
 * Purpose: Guard helper sendAdminAlarm — eskalasi terjamin ke admin (getAdminJids + sendCritical),
 *   never-throw, kirim ke semua jid. Dipakai eskalasi isolir/set-unpaid/backup gagal (anti gagal-senyap).
 * Caller: Jest.
 * Deps: ../admin-alarm (deps di-inject via opts.deps).
 * SideEffects: -
 */
"use strict";

const { sendAdminAlarm } = require("../admin-alarm");

test("kirim ke semua admin jid via sendCritical + return jumlah", async () => {
    const sendCritical = jest.fn(async () => ({ delivered: true }));
    const deps = { getAdminJids: async () => ["62a@s", "62b@s"], sendCritical };
    const r = await sendAdminAlarm("halo", { label: "x", deps });
    expect(sendCritical).toHaveBeenCalledTimes(2);
    expect(r).toEqual({ sent: 2, recipients: 2 });
    expect(sendCritical.mock.calls[0][2].label).toBe("x");
});

test("tak ada admin → sent 0, tak lempar", async () => {
    const r = await sendAdminAlarm("halo", { deps: { getAdminJids: async () => [], sendCritical: jest.fn() } });
    expect(r).toEqual({ sent: 0, recipients: 0 });
});

test("sendCritical satu jid lempar → tetap lanjut jid lain, never-throw", async () => {
    const sendCritical = jest.fn()
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValueOnce({ delivered: true });
    const r = await sendAdminAlarm("halo", { deps: { getAdminJids: async () => ["62a@s", "62b@s"], sendCritical } });
    expect(r.sent).toBe(1);
    expect(r.recipients).toBe(2);
});

test("getAdminJids lempar → never-throw, sent 0", async () => {
    const r = await sendAdminAlarm("halo", { deps: { getAdminJids: async () => { throw new Error("x"); }, sendCritical: jest.fn() } });
    expect(r).toEqual({ sent: 0, recipients: 0 });
});
