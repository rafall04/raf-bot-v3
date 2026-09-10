/**
 * Header Doc
 * Purpose: Guard BAGIAN 1 — cron rollover ganti paket tertunda. Kunci: hanya proses status 'scheduled'
 *   yang sudah JATUH TEMPO; apply → status 'approved'+applied_at + notif; belum due → dilewati; gagal
 *   MikroTik → tetap 'scheduled' (retry); user/paket hilang → 'cancelled_by_system'.
 * Caller: Jest.
 * Deps: ../package-change-rollover (runRolloverTick); template-helper/admin-recipients/shared di-mock.
 * SideEffects: -
 */
"use strict";

jest.mock("../../../response-template-helper", () => ({ renderResponseTemplate: (_k, fb) => fb }));
jest.mock("../../../admin-recipients", () => ({ getAdminJids: () => [] }));
jest.mock("../../shared", () => ({ safeSendMessage: jest.fn(async () => ({ sent: true })) }));

const { runRolloverTick } = require("../package-change-rollover");

const PAST = "2026-09-01T00:00:00.000Z";     // sudah lewat
const FUTURE = "2099-01-01T00:00:00.000Z";   // belum
const NOW = Date.parse("2026-09-10T03:00:00Z");

function mkRepo(store) {
    return {
        getPackageChangeRequests: () => store,
        getUserById: (id) => ({ id, name: "User " + id, pppoe_username: "ppp" + id, subscription: "PAKET-125K", phone_number: "08123" }),
        getPackageByName: (n) => ({ name: n, profile: "prof", price: 110000 }),
        getAccountById: () => ({ id: 9, name: "Teknisi", phone_number: "08999" }),
        replacePackageChangeRequest: (i, r) => { store[i] = r; },
        persistPackageChangeRequests: jest.fn(),
    };
}

test("scheduled + due → apply + status approved + notif pelanggan & teknisi", async () => {
    const store = [{ id: "RQ1", userId: 7, requestedPackageName: "PAKET-110K", requestedById: 9, status: "scheduled", effective_date: PAST }];
    const apply = jest.fn(async () => ({ mikrotikSync: { status: "applied", message: "ok" }, oldPackage: "PAKET-125K" }));
    const send = jest.fn(async () => ({ sent: true }));
    const res = await runRolloverTick({ repository: mkRepo(store), applyApprovedPackageChange: apply, safeSendMessage: send, now: () => NOW });
    expect(res).toMatchObject({ processed: 1, applied: 1, failed: 0 });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(store[0].status).toBe("approved");
    expect(store[0].apply_mode).toBe("applied");
    expect(typeof store[0].applied_at).toBe("string");
    expect(send).toHaveBeenCalled(); // pelanggan + teknisi
});

test("scheduled + BELUM due → dilewati (apply tak dipanggil)", async () => {
    const store = [{ id: "RQ2", userId: 7, requestedPackageName: "PAKET-110K", requestedById: 9, status: "scheduled", effective_date: FUTURE }];
    const apply = jest.fn();
    const res = await runRolloverTick({ repository: mkRepo(store), applyApprovedPackageChange: apply, safeSendMessage: jest.fn(), now: () => NOW });
    expect(res.processed).toBe(0);
    expect(apply).not.toHaveBeenCalled();
    expect(store[0].status).toBe("scheduled");
});

test("gagal MikroTik → tetap 'scheduled' (retry tick berikutnya)", async () => {
    const store = [{ id: "RQ3", userId: 7, requestedPackageName: "PAKET-110K", requestedById: 9, status: "scheduled", effective_date: PAST }];
    const apply = jest.fn(async () => { throw new Error("router down"); });
    const res = await runRolloverTick({ repository: mkRepo(store), applyApprovedPackageChange: apply, safeSendMessage: jest.fn(), now: () => NOW });
    expect(res).toMatchObject({ processed: 1, applied: 0, failed: 1 });
    expect(store[0].status).toBe("scheduled"); // TIDAK berubah → akan dicoba lagi
});

test("user/paket hilang → cancelled_by_system (tak menggantung)", async () => {
    const store = [{ id: "RQ4", userId: 7, requestedPackageName: "PAKET-110K", requestedById: 9, status: "scheduled", effective_date: PAST }];
    const repo = mkRepo(store);
    repo.getUserById = () => null;
    const apply = jest.fn();
    const res = await runRolloverTick({ repository: repo, applyApprovedPackageChange: apply, safeSendMessage: jest.fn(), now: () => NOW });
    expect(apply).not.toHaveBeenCalled();
    expect(store[0].status).toBe("cancelled_by_system");
    expect(res.failed).toBe(1);
});
