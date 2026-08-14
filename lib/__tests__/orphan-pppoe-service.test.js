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
        const r = await listOrphanSecrets({ getAllPPPoESecrets: async () => balasan(SECRETS), getActivePPPoEUsers: async () => balasan([]), getUsers: () => USERS });
        expect(r.ok).toBe(true);
        expect(r.data.map((s) => s.username)).toEqual(["wimpi@rafcybernet"]);
        expect(r.totalSecret).toBe(3);
    });

    test("kredensial bawaan `tes@hw` TIDAK pernah dianggap sisa — itu pintu masuk PSB", async () => {
        const r = await listOrphanSecrets({ getAllPPPoESecrets: async () => balasan(SECRETS), getActivePPPoEUsers: async () => balasan([]), getUsers: () => [] });
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
        getActivePPPoEUsers: async () => balasan([]),
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

// Diukur di produksi: dari 6 secret "tanpa baris pelanggan", TIGA sedang memegang sesi hidup dan
// satu lagi adalah VPN operator sendiri (`laptop-aldi`, profil "vpn monitor"). Tak punya baris
// pelanggan TIDAK sama dengan sampah — VPN, monitoring, dan akun gratis memang begitu.
describe("sisa yang sedang DIPAKAI tak boleh disodorkan sebagai sampah", () => {
    const SECRETS2 = [
        { name: "wiwit@rafcybernet", profile: "FREE-30Mbps" },
        { name: "laptop-aldi", profile: "vpn monitor" },
        { name: "wimpi@rafcybernet", profile: "16Mbps" }
    ];
    const deps = (over = {}) => ({
        getAllPPPoESecrets: async () => balasan(SECRETS2),
        getActivePPPoEUsers: async () => balasan([{ name: "wiwit@rafcybernet" }]),
        getUsers: () => [],
        removePPPoESecret: jest.fn(async () => ({ ok: true })),
        ...over
    });

    test("yang bersesi hidup ditandai & TIDAK dianggap aman dihapus", async () => {
        const r = await listOrphanSecrets(deps());
        const wiwit = r.data.find((s) => s.username === "wiwit@rafcybernet");
        expect(wiwit.sedangAktif).toBe(true);
        expect(wiwit.aman_dihapus).toBe(false);
        expect(wiwit.catatan).toMatch(/SEDANG DIPAKAI/);
        // `laptop-aldi` TIDAK ikut terhitung aman walau tak bersesi — profilnya "vpn monitor".
        // Hanya `wimpi@rafcybernet` (profil pelanggan biasa, tanpa sesi) yang lolos.
        expect(r.jumlahAmanDihapus).toBe(1);
        expect(r.data[0].aman_dihapus).toBe(true);   // yang aman diurutkan di atas
        expect(r.data[0].username).toBe("wimpi@rafcybernet");
    });

    test("menghapus yang bersesi hidup DITOLAK", async () => {
        const d = deps();
        const r = await removeOrphanSecret("wiwit@rafcybernet", d);
        expect(r.ok).toBe(false);
        expect(d.removePPPoESecret).not.toHaveBeenCalled();
    });

    test("sesi tak terbaca → menahan penghapusan, bukan menganggap bebas", async () => {
        const d = deps({ getActivePPPoEUsers: async () => ({ ok: false, message: "timeout" }) });
        const r = await listOrphanSecrets(d);
        expect(r.sesiTerbaca).toBe(false);
        expect(r.data.every((s) => s.sedangAktif === null && s.aman_dihapus === false)).toBe(true);
        const hapus = await removeOrphanSecret("wimpi@rafcybernet", d);
        expect(hapus.ok).toBe(false);
        expect(d.removePPPoESecret).not.toHaveBeenCalled();
    });
});

// Terukur di produksi: `laptop-aldi` (profil "vpn monitor") kebetulan sedang tak tersambung,
// sehingga status sesi saja meloloskannya sebagai "aman dihapus" — tombol hapus menyala untuk
// VPN operator sendiri. Status sesi bercerita tentang SEKARANG; profil bercerita tentang
// PERUNTUKAN. Keduanya harus dipakai bersama.
describe("profil VPN/monitoring tak pernah dianggap sisa pelanggan", () => {
    const SECRETS3 = [
        { name: "laptop-aldi", profile: "vpn monitor" },
        { name: "kastur-rt11@rafcybernet", profile: "PPP-Monitor" },
        { name: "wimpi@rafcybernet", profile: "16Mbps" }
    ];
    const deps = (over = {}) => ({
        getAllPPPoESecrets: async () => balasan(SECRETS3),
        getActivePPPoEUsers: async () => balasan([]),   // TAK ADA yang bersesi — sengaja
        getUsers: () => [],
        removePPPoESecret: jest.fn(async () => ({ ok: true })),
        ...over
    });

    test("walau tak bersesi, profil VPN/monitor TIDAK aman dihapus", async () => {
        const r = await listOrphanSecrets(deps());
        const vpn = r.data.find((s) => s.username === "laptop-aldi");
        const mon = r.data.find((s) => s.username === "kastur-rt11@rafcybernet");
        expect(vpn.sedangAktif).toBe(false);        // memang tak bersesi…
        expect(vpn.aman_dihapus).toBe(false);       // …tapi tetap tak boleh dihapus
        expect(vpn.bukanPelanggan).toBe(true);
        expect(mon.aman_dihapus).toBe(false);
        expect(vpn.catatan).toMatch(/BUKAN kredensial pelanggan/);
        // Hanya profil pelanggan biasa yang lolos.
        expect(r.jumlahAmanDihapus).toBe(1);
        expect(r.data.find((s) => s.username === "wimpi@rafcybernet").aman_dihapus).toBe(true);
    });

    test("menghapus kredensial VPN DITOLAK, router tak disentuh", async () => {
        const d = deps();
        const r = await removeOrphanSecret("laptop-aldi", d);
        expect(r.ok).toBe(false);
        expect(r.message).toMatch(/VPN\/monitoring/);
        expect(d.removePPPoESecret).not.toHaveBeenCalled();
    });
});
