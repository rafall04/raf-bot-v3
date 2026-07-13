/**
 * Header Doc
 * Purpose: Uji agregator sinyal komplain — gate enabled, resolusi jalur via addr / PPP active,
 *          dedup per pelanggan, ambang pelanggan-distinct per jalur, cooldown alert per jalur,
 *          skip lineStatus offline, klaster jalur 'unknown', payload WA {text} + insiden.
 * Caller: jest.
 * Deps: `../complaint-signal-service`.
 * SideEffects: Mutasi global.config di-restore per test; state modul di-reset per test.
 */
"use strict";

const svc = require("../complaint-signal-service");

const NOW = 1_800_000_000_000;

function makeDeps(over = {}) {
    const send = jest.fn(async () => ({ delivered: true }));
    const addIncident = jest.fn(async () => {});
    const deps = {
        send,
        addIncident,
        getAdminJids: () => ["6285233047094@s.whatsapp.net"],
        renderResponseTemplate: (key, fallback) => `[${key}] ${fallback}`,
        getActivePPPoEUsers: jest.fn(async () => []),
        // Resolver LIVE (mock): 192.168.61.x → mni, selain itu null (router tak terbaca / tak
        // terpetakan) → "unknown". Meniru lib/customer-path-resolver.resolveCustomerPath.
        resolveCustomerPath: jest.fn(async (ip) => (String(ip).startsWith("192.168.61.") ? "mni" : null)),
        getStatusReport: jest.fn(async () => ({ paths: [] })),
        nowMs: () => NOW,
        getComplaintConfig: () => ({
            enabled: true,
            windowMinutes: 15,
            minDistinctCustomers: 3,
            perCustomerCooldownMinutes: 30,
            alertCooldownMinutes: 30,
            notifyAdmins: true,
            recipients: []
        }),
        ...over
    };
    return { deps, send, addIncident };
}

// Resolver live (mock di makeDeps): 192.168.61.0/24 → mni; IP lain → null → "unknown".
const user = (id, name) => ({ id, name, pppoe_username: `pppoe${id}` });
const ADDR_MNI = "192.168.61.10";

const origConfig = global.config;
beforeEach(() => {
    svc.resetForTest();
    global.config = { nama: "RAF NET" };
});
afterEach(() => { global.config = origConfig; });

test("gate: config disabled → tidak merekam", async () => {
    const { deps, send } = makeDeps({
        getComplaintConfig: () => ({ enabled: false })
    });
    const res = await svc.recordComplaint({ user: user(1, "A"), source: "cek_koneksi", addr: ADDR_MNI }, deps);
    expect(res).toEqual({ recorded: false, reason: "disabled" });
    expect(send).not.toHaveBeenCalled();
});

test("lineStatus offline dilewati (bukan domain agregator lemot)", async () => {
    const { deps } = makeDeps();
    const res = await svc.recordComplaint({ user: user(1, "A"), source: "cek_koneksi", addr: ADDR_MNI, lineStatus: "offline" }, deps);
    expect(res.reason).toBe("offline");
});

test("di bawah ambang → terekam tapi tidak alert", async () => {
    const { deps, send } = makeDeps();
    const r1 = await svc.recordComplaint({ user: user(1, "A"), source: "cek_koneksi", addr: ADDR_MNI }, deps);
    const r2 = await svc.recordComplaint({ user: user(2, "B"), source: "cek_koneksi", addr: ADDR_MNI }, deps);
    expect(r1).toMatchObject({ recorded: true, path: "mni", clustered: false, count: 1 });
    expect(r2).toMatchObject({ recorded: true, path: "mni", clustered: false, count: 2 });
    expect(send).not.toHaveBeenCalled();
});

test("pelanggan sama bolak-balik dalam cooldown = 1 sinyal", async () => {
    const { deps, send } = makeDeps();
    await svc.recordComplaint({ user: user(1, "A"), source: "cek_koneksi", addr: ADDR_MNI }, deps);
    const dup = await svc.recordComplaint({ user: user(1, "A"), source: "tiket_lemot" }, deps);
    expect(dup).toEqual({ recorded: false, reason: "user-cooldown" });
    await svc.recordComplaint({ user: user(2, "B"), source: "cek_koneksi", addr: ADDR_MNI }, deps);
    expect(send).not.toHaveBeenCalled(); // masih 2 distinct, ambang 3
});

test("3 pelanggan BERBEDA pada jalur sama → 1 alert WA {text} + insiden", async () => {
    const { deps, send, addIncident } = makeDeps();
    await svc.recordComplaint({ user: user(1, "A"), source: "cek_koneksi", addr: ADDR_MNI }, deps);
    await svc.recordComplaint({ user: user(2, "B"), source: "tiket_lemot", addr: ADDR_MNI }, deps);
    const r3 = await svc.recordComplaint({ user: user(3, "C"), source: "cek_koneksi", addr: ADDR_MNI }, deps);
    expect(r3).toMatchObject({ clustered: true, alerted: true });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1]).toEqual({ text: expect.stringContaining("complaint_cluster_alert") });
    expect(addIncident).toHaveBeenCalledWith(expect.objectContaining({
        kind: "complaint_cluster",
        path: "mni",
        detail: expect.objectContaining({ count: 3 })
    }));
});

test("alert kedua pada jalur sama dalam cooldown → ditahan", async () => {
    const { deps, send } = makeDeps();
    for (let i = 1; i <= 3; i += 1) {
        await svc.recordComplaint({ user: user(i, `U${i}`), source: "cek_koneksi", addr: ADDR_MNI }, deps);
    }
    expect(send).toHaveBeenCalledTimes(1);
    const r4 = await svc.recordComplaint({ user: user(4, "D"), source: "cek_koneksi", addr: ADDR_MNI }, deps);
    expect(r4).toMatchObject({ clustered: true, alerted: false, reason: "alert-cooldown" });
    expect(send).toHaveBeenCalledTimes(1);
});

test("tanpa addr → resolusi via PPP active (fallback), IP pool MNI", async () => {
    const { deps } = makeDeps({
        getActivePPPoEUsers: jest.fn(async () => [{ name: "pppoe7", address: ADDR_MNI }])
    });
    const res = await svc.recordComplaint({ user: user(7, "G"), source: "tiket_lemot" }, deps);
    expect(res).toMatchObject({ recorded: true, path: "mni" });
});

test("resolver null (tak terpetakan / router tak terbaca) → klaster 'unknown' tetap bisa alert", async () => {
    const { deps, send } = makeDeps();
    for (let i = 1; i <= 3; i += 1) {
        await svc.recordComplaint({ user: user(i, `U${i}`), source: "cek_koneksi", addr: "8.8.8.8" }, deps);
    }
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1].text).toContain("belum teridentifikasi");
});

test("recordComplaint tidak pernah throw (deps rusak)", async () => {
    const { deps } = makeDeps({
        getComplaintConfig: () => { throw new Error("boom"); }
    });
    const res = await svc.recordComplaint({ user: user(1, "A"), source: "x" }, deps);
    expect(res.recorded).toBe(false);
});
