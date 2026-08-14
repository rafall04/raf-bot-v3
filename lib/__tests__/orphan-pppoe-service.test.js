/**
 * Header Doc
 * Purpose: Mengunci alat pembersih "modem hantu" — secret PPPoE yang tak lagi punya baris pelanggan.
 *          Dua bahaya yang dijaga: (1) router tak terbaca TIDAK boleh menyamar jadi "tak ada sisa",
 *          (2) kredensial bawaan modem polos `tes@hw` tak boleh ikut terhapus (itu pintu masuk PSB).
 * Caller: Jest.
 * Deps: ../orphan-pppoe-service (semua dep di-inject).
 * SideEffects: tidak ada.
 */
"use strict";

const { listOrphanSecrets, removeOrphanSecret } = require("../orphan-pppoe-service");

// Bentuk balasan bridge PHP: {ok, data:{count, secrets:[]}} — BUKAN array langsung.
const balasan = (secrets) => ({ ok: true, data: { count: secrets.length, secrets } });
const SECRETS = [
    { name: "budi@rafcybernet", profile: "16Mbps" },
    { name: "wimpi@rafcybernet", profile: "16Mbps", last_logged_out: "aug/01/2026" },
    { name: "tes@hw", profile: "12Mbps" }
];
const USERS = [{ id: 1, name: "Budi", pppoe_username: "budi@rafcybernet" }];

describe("listOrphanSecrets", () => {
    test("secret tanpa pelanggan → muncul sebagai sisa", async () => {
        const r = await listOrphanSecrets({ getAllPPPoESecrets: async () => balasan(SECRETS), getUsers: () => USERS });
        expect(r.ok).toBe(true);
        expect(r.data.map((s) => s.username)).toEqual(["wimpi@rafcybernet"]);
        expect(r.totalSecret).toBe(3);
    });

    test("kredensial bawaan `tes@hw` TIDAK pernah dianggap sisa — itu pintu masuk PSB", async () => {
        const r = await listOrphanSecrets({ getAllPPPoESecrets: async () => balasan(SECRETS), getUsers: () => [] });
        expect(r.data.map((s) => s.username)).not.toContain("tes@hw");
    });

    // Daftar kosong yang lahir dari kegagalan baca adalah kabar baik palsu: admin menutup halaman
    // dengan tenang padahal pemeriksaannya sendiri tak pernah terjadi.
    test("router tak terbaca → ok:false, BUKAN daftar kosong", async () => {
        const r = await listOrphanSecrets({ getAllPPPoESecrets: async () => ({ ok: false, message: "timeout" }), getUsers: () => USERS });
        expect(r.ok).toBe(false);
        expect(r.data).toBeUndefined();
    });

    test("bentuk balasan tak dikenal juga ok:false (jangan tebak isinya)", async () => {
        const r = await listOrphanSecrets({ getAllPPPoESecrets: async () => ({ ok: true, data: { jumlah: 3 } }), getUsers: () => USERS });
        expect(r.ok).toBe(false);
    });
});

describe("removeOrphanSecret", () => {
    const deps = (over = {}) => ({
        getAllPPPoESecrets: async () => balasan(SECRETS),
        getUsers: () => USERS,
        removePPPoESecret: jest.fn(async () => ({ ok: true })),
        ...over
    });

    test("sisa sejati → dihapus", async () => {
        const d = deps();
        const r = await removeOrphanSecret("wimpi@rafcybernet", d);
        expect(r.ok).toBe(true);
        expect(d.removePPPoESecret).toHaveBeenCalledWith("wimpi@rafcybernet", expect.anything());
    });

    // Daftar yang dilihat admin bisa basi: pelanggan baru bisa memakai username itu di antara
    // "buka halaman" dan "klik hapus".
    test("username ternyata sudah dipakai pelanggan → DITOLAK, router tak disentuh", async () => {
        const d = deps({ getUsers: () => [...USERS, { id: 9, name: "Sari", pppoe_username: "wimpi@rafcybernet" }] });
        const r = await removeOrphanSecret("wimpi@rafcybernet", d);
        expect(r.ok).toBe(false);
        expect(r.message).toMatch(/Sari/);
        expect(d.removePPPoESecret).not.toHaveBeenCalled();
    });

    test("`tes@hw` ditolak mentah-mentah", async () => {
        const d = deps({ getUsers: () => [] });
        const r = await removeOrphanSecret("tes@hw", d);
        expect(r.ok).toBe(false);
        expect(d.removePPPoESecret).not.toHaveBeenCalled();
    });

    test("router tak terbaca saat verifikasi ulang → tidak menghapus apa pun", async () => {
        const d = deps({ getAllPPPoESecrets: async () => ({ ok: false, message: "timeout" }) });
        const r = await removeOrphanSecret("wimpi@rafcybernet", d);
        expect(r.ok).toBe(false);
        expect(d.removePPPoESecret).not.toHaveBeenCalled();
    });
});
