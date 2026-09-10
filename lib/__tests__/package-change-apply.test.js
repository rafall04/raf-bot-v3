/**
 * Header Doc
 * Purpose: Guard BAGIAN 1 — applyApprovedPackageChange (langkah apply bersama). Kunci: sync MikroTik
 *   (profil + putus sesi) lalu tulis users.subscription; gagal MikroTik => THROW (DB tak diubah);
 *   sync disabled => tetap tulis subscription (lokal).
 * Caller: Jest.
 * Deps: ../package-change-apply (deps di-inject).
 * SideEffects: -
 */
"use strict";

const { applyApprovedPackageChange } = require("../package-change-apply");

function mkDeps(over = {}) {
    return {
        isMikrotikSyncEnabled: jest.fn(() => true),
        updatePPPoEProfile: jest.fn(async () => ({ ok: true })),
        deleteActivePPPoEUser: jest.fn(async () => ({ ok: true })),
        assertMikrotikResult: jest.fn((v) => v),
        repository: {
            getConfig: jest.fn(() => ({})),
            updateUserSubscription: jest.fn(async () => {}),
            syncUserSubscriptionCache: jest.fn(),
        },
        ...over,
    };
}
const USER = { id: 7, name: "Budi", pppoe_username: "budi@isp", subscription: "PAKET-125K" };
const PKG = { name: "PAKET-110K", profile: "prof-110", price: 110000 };

test("sync ON → update profil + putus sesi + tulis subscription (nama paket baru)", async () => {
    const deps = mkDeps();
    const res = await applyApprovedPackageChange({ user: USER, requestedPackage: PKG, deps });
    expect(deps.updatePPPoEProfile).toHaveBeenCalledWith("budi@isp", "prof-110", expect.any(Object));
    expect(deps.deleteActivePPPoEUser).toHaveBeenCalled();
    expect(deps.repository.updateUserSubscription).toHaveBeenCalledWith(7, "PAKET-110K");
    expect(res.mikrotikSync.status).toBe("applied");
    expect(res.oldPackage).toBe("PAKET-125K");
});

test("gagal update profil MikroTik → THROW, subscription TIDAK ditulis", async () => {
    const deps = mkDeps({ updatePPPoEProfile: jest.fn(async () => { throw new Error("router down"); }) });
    await expect(applyApprovedPackageChange({ user: USER, requestedPackage: PKG, deps })).rejects.toThrow(/router down/);
    expect(deps.repository.updateUserSubscription).not.toHaveBeenCalled();
});

test("sync OFF → tetap tulis subscription, MikroTik tak disentuh", async () => {
    const deps = mkDeps({ isMikrotikSyncEnabled: jest.fn(() => false) });
    const res = await applyApprovedPackageChange({ user: USER, requestedPackage: PKG, deps });
    expect(deps.updatePPPoEProfile).not.toHaveBeenCalled();
    expect(deps.repository.updateUserSubscription).toHaveBeenCalledWith(7, "PAKET-110K");
    expect(res.mikrotikSync.status).toBe("applied_locally_sync_disabled");
});
