/**
 * Header Doc
 * Purpose: Mengunci wizard COPOT PELANGGAN via WhatsApp — pencarian, pilih-nomor, penegasan KODE
 *          ACAK (bukan "YA"), eksekusi, dan pelaporan per langkah termasuk kredensial PPPoE yang
 *          gagal dihapus (akar "modem hantu").
 * Caller: Jest.
 * Deps: ../customer-removal.state (semua dep di-inject).
 * SideEffects: tidak ada.
 */
"use strict";

const {
    isCustomerRemovalTrigger,
    parseCustomerRemovalQuery,
    cariPelanggan,
    startCustomerRemoval,
    handleCustomerRemovalState
} = require("../customer-removal.state");

const USERS = [
    { id: 7, name: "Budi Santoso", phone_number: "081234567890", subscription: "PAKET-110K", pppoe_username: "budi@rafcybernet", device_id: "dev-A" },
    { id: 8, name: "Budi Raharjo", phone_number: "081999888777", subscription: "PAKET-125K", pppoe_username: "budir@rafcybernet" },
    { id: 9, name: "Sari", phone_number: "6285111222333", subscription: "PAKET-110K", pppoe_username: "sari@rafcybernet" }
];
const STAFF = { id: 2, username: "raf", name: "RAF", role: "admin" };

function harness(over = {}) {
    let state = null;
    const base = {
        stateSender: "628999@s.whatsapp.net",
        reply: jest.fn(async () => {}),
        setUserState: jest.fn((k, s) => { state = s; }),
        deleteUserState: jest.fn(() => { state = null; }),
        getUsers: () => USERS,
        staff: STAFF,
        rng: () => 0.5,                       // kode selalu 5500 → bisa diasersi
        usersService: { deleteUserById: jest.fn(async () => ({ status: 200, body: { status: 200, message: "User berhasil dihapus", langkah: { sesi_diputus: { dijalankan: true, ok: true }, secret_dihapus: { dijalankan: true, ok: true }, baris_dihapus: { dijalankan: true, ok: true }, port_odp: { dijalankan: true, ok: true } }, perlu_dibersihkan: false, pppoe_tertinggal: null } })) },
        logger: { error() {}, warn() {}, log() {} },
        ...over
    };
    return { base, getState: () => state };
}
const balasanTerakhir = (h) => h.base.reply.mock.calls.at(-1)[0];
const lanjut = (h, teks) => handleCustomerRemovalState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), chats: teks });

describe("pemicu `copot`", () => {
    test.each(["copot budi", "COPOT 0812345", "  copot  Sari  "])("'%s' memicu", (t) => {
        expect(isCustomerRemovalTrigger(t)).toBe(true);
    });

    // Pagar ketat: kalimat biasa yang memuat "copot" tak boleh membuka wizard destruktif ini.
    test.each(["copot", "modemnya sudah dicopot dari rumah", "tolong copot", "copot a"])("'%s' TIDAK memicu", (t) => {
        expect(isCustomerRemovalTrigger(t)).toBe(false);
    });

    test("kata kunci diambil apa adanya", () => {
        expect(parseCustomerRemovalQuery("copot Budi Santoso")).toBe("Budi Santoso");
    });
});

describe("pencarian pelanggan", () => {
    test("cocok lewat nama sebagian", () => {
        expect(cariPelanggan(USERS, "budi").map((u) => u.id)).toEqual([7, 8]);
    });

    // 0812… dan 62812… adalah nomor yang sama — dicocokkan lewat 9 digit terakhir.
    test("cocok lewat nomor HP walau beda format", () => {
        expect(cariPelanggan(USERS, "085111222333").map((u) => u.id)).toEqual([9]);
    });

    test("cocok lewat ID persis", () => {
        expect(cariPelanggan(USERS, "9").map((u) => u.id)).toEqual([9]);
    });
});

describe("alur copot", () => {
    test("tak ada yang cocok → tidak membuka sesi apa pun", async () => {
        const h = harness();
        await startCustomerRemoval({ ...h.base, chats: "copot zzzz" });
        expect(h.base.setUserState).not.toHaveBeenCalled();
        expect(balasanTerakhir(h)).toMatch(/Tak ada pelanggan cocok/i);
    });

    test("banyak yang cocok → daftar bernomor dulu, belum ada yang dihapus", async () => {
        const h = harness();
        await startCustomerRemoval({ ...h.base, chats: "copot budi" });
        expect(h.getState().step).toBe("COPOT_PILIH");
        expect(balasanTerakhir(h)).toMatch(/Budi Santoso/);
        expect(h.base.usersService.deleteUserById).not.toHaveBeenCalled();
    });

    test("satu yang cocok → layar rincian + KODE, bukan langsung eksekusi", async () => {
        const h = harness();
        await startCustomerRemoval({ ...h.base, chats: "copot sari" });
        expect(h.getState().step).toBe("COPOT_KODE");
        const teks = balasanTerakhir(h);
        expect(teks).toMatch(/COPOT PELANGGAN/);
        expect(teks).toMatch(/sari@rafcybernet/);      // kredensial disebut supaya salah-sasaran kelihatan
        expect(teks).toMatch(/5500/);                   // kode acak (rng dipatok)
        expect(h.base.usersService.deleteUserById).not.toHaveBeenCalled();
    });

    // Inti pengamannya: penegasan tak boleh bisa dijawab dengan kata yang dipakai layar lain.
    test.each(["ya", "YA", "ok", "oke", "y"])("'%s' TIDAK dianggap penegasan", async (kata) => {
        const h = harness();
        await startCustomerRemoval({ ...h.base, chats: "copot sari" });
        await lanjut(h, kata);
        expect(h.base.usersService.deleteUserById).not.toHaveBeenCalled();
        expect(balasanTerakhir(h)).toMatch(/Kode tidak cocok/i);
    });

    test("kode benar → dieksekusi pada pelanggan yang SAMA dengan yang ditampilkan", async () => {
        const h = harness();
        await startCustomerRemoval({ ...h.base, chats: "copot sari" });
        await lanjut(h, "5500");
        expect(h.base.usersService.deleteUserById).toHaveBeenCalledTimes(1);
        expect(h.base.usersService.deleteUserById.mock.calls[0][0].userId).toBe(9);
        expect(balasanTerakhir(h)).toMatch(/Sari dicopot/i);
    });

    test("BATAL di layar kode → tak ada yang dihapus", async () => {
        const h = harness();
        await startCustomerRemoval({ ...h.base, chats: "copot sari" });
        await lanjut(h, "batal");
        expect(h.base.usersService.deleteUserById).not.toHaveBeenCalled();
        expect(balasanTerakhir(h)).toMatch(/Dibatalkan/i);
    });

    test("pilih nomor dari daftar → lanjut ke layar kode pelanggan itu", async () => {
        const h = harness();
        await startCustomerRemoval({ ...h.base, chats: "copot budi" });
        await lanjut(h, "2");
        expect(h.getState().step).toBe("COPOT_KODE");
        expect(balasanTerakhir(h)).toMatch(/Budi Raharjo/);
    });

    // AKAR MODEM HANTU — kegagalan hapus kredensial tak boleh lewat sebagai sukses.
    test("kredensial PPPoE gagal dihapus → admin diberi tahu modemnya MASIH bisa konek", async () => {
        const h = harness({
            usersService: {
                deleteUserById: jest.fn(async () => ({
                    status: 200,
                    body: {
                        status: 200, message: "…",
                        langkah: { sesi_diputus: { dijalankan: true, ok: true }, secret_dihapus: { dijalankan: true, ok: false, pesan: "router tak terjangkau" }, baris_dihapus: { dijalankan: true, ok: true }, port_odp: { dijalankan: true, ok: true } },
                        perlu_dibersihkan: true, pppoe_tertinggal: "sari@rafcybernet"
                    }
                }))
            }
        });
        await startCustomerRemoval({ ...h.base, chats: "copot sari" });
        await lanjut(h, "5500");
        const teks = balasanTerakhir(h);
        expect(teks).toMatch(/belum tuntas/i);
        expect(teks).toMatch(/masih bisa konek/i);
        expect(teks).toMatch(/sari@rafcybernet/);
        expect(teks).toMatch(/Sisa PPPoE/);
        expect(teks).toMatch(/router tak terjangkau/);   // sebabnya ikut disebut
    });

    test("service tak tersedia → gagal dengan jelas, tak menggantung", async () => {
        const h = harness({ usersService: null });
        await startCustomerRemoval({ ...h.base, chats: "copot sari" });
        await lanjut(h, "5500");
        expect(balasanTerakhir(h)).toMatch(/tak tersedia/i);
        expect(h.base.deleteUserState).toHaveBeenCalled();
    });
});
