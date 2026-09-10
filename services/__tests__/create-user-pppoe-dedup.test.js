/**
 * Header Doc
 * Purpose: Guard P1 — prepareNewUser GAGAL-LOUD 409 saat pppoe_username sudah dipakai pelanggan lain
 *   (cegah duplikat massal importer VANS yang dulu hanya dijaga rekonsiliasi manual). Kosong = SAH.
 * Caller: Jest.
 * Deps: ../api-users/create-user-validate (deps di-mock).
 * SideEffects: -
 */
"use strict";

const { prepareNewUser } = require("../api-users/create-user-validate");

function mkDeps(existing = []) {
    return {
        getNextAvailableUserId: async () => 99,
        validatePhoneNumbers: async () => ({ valid: true }),
        getDb: () => ({}),
        repository: { getUsersSnapshot: () => existing },
        hashPassword: async () => "hashed",
        normalizeUserPaymentMethod: () => null,
        isMikrotikSyncEnabled: () => false,
        getConfig: () => ({}),
        assertOdpAssignable: () => {},
    };
}

test("pppoe_username sudah dipakai → 409, TIDAK dibuat", async () => {
    const deps = mkDeps([{ id: 5, name: "Budi Lama", pppoe_username: "budi@isp" }]);
    const r = await prepareNewUser(deps, { userData: { name: "Budi Baru", pppoe_username: "budi@isp" } });
    expect(r.errorResponse).toBeDefined();
    expect(r.errorResponse.status).toBe(409);
    expect(r.errorResponse.body.conflictUser).toEqual({ id: 5, name: "Budi Lama" });
    expect(r.prepared).toBeUndefined();
});

test("case-insensitive + multi-value (nilai pertama) → tetap kena", async () => {
    const deps = mkDeps([{ id: 5, name: "Budi", pppoe_username: "budi@isp|lama@isp" }]);
    const r = await prepareNewUser(deps, { userData: { name: "X", pppoe_username: "BUDI@ISP" } });
    expect(r.errorResponse && r.errorResponse.status).toBe(409);
});

test("pppoe unik → lolos (prepared)", async () => {
    const deps = mkDeps([{ id: 5, name: "Budi", pppoe_username: "budi@isp" }]);
    const r = await prepareNewUser(deps, { userData: { name: "Sari", pppoe_username: "sari@isp" } });
    expect(r.errorResponse).toBeUndefined();
    expect(r.prepared).toBeDefined();
    expect(r.prepared.newUser.pppoe_username).toBe("sari@isp");
});

test("pppoe kosong → SAH (tak diblok)", async () => {
    const deps = mkDeps([{ id: 5, name: "Budi", pppoe_username: "budi@isp" }]);
    const r = await prepareNewUser(deps, { userData: { name: "Tanpa PPPoE" } });
    expect(r.errorResponse).toBeUndefined();
    expect(r.prepared).toBeDefined();
});
