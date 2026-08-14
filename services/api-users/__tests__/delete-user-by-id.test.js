/**
 * Header Doc
 * Purpose: Mengunci KEJUJURAN alur copot pelanggan — baris pelanggan tetap dihapus walau MikroTik
 *          gagal (itu disengaja), TAPI kegagalan hapus SECRET tak boleh dilaporkan sebagai sukses
 *          biasa. Secret yang tertinggal = modem terus konek atas nama pelanggan yang barisnya
 *          sudah lenyap ("modem hantu"), dan wizard PSB memvonisnya milik pelanggan tak dikenal.
 * Caller: Jest.
 * Deps: ../delete-user-by-id (semua dep di-inject).
 * SideEffects: tidak ada.
 */
"use strict";

const { deleteUserById } = require("../delete-user-by-id");

const PELANGGAN = { id: 7, name: "Budi", pppoe_username: "budi@rafcybernet", phone_number: "0812", subscription: "PAKET-110K", paid: 0 };

function makeDeps(over = {}) {
    return {
        repository: {
            findUserById: jest.fn(() => PELANGGAN),
            deleteUserRecord: jest.fn(async () => {}),
            getUsersSnapshot: jest.fn(() => [PELANGGAN]),
            replaceUsersSnapshot: jest.fn()
        },
        logActivity: jest.fn(async () => {}),
        deleteActivePPPoEUser: jest.fn(async () => ({ ok: true })),
        removePPPoESecret: jest.fn(async () => ({ ok: true })),
        syncPortUsage: jest.fn(),
        alertSystem: { sendAlert: jest.fn(async () => {}) },
        logger: { error: jest.fn(), warn: jest.fn() },
        ...over
    };
}
const jalankan = (deps) => deleteUserById(deps, { userId: 7, actor: { id: 1, username: "raf", role: "admin" }, requestMeta: {} });

describe("copot pelanggan — hasil per langkah", () => {
    test("semua langkah sukses → laporan lengkap & tak ada sisa", async () => {
        const deps = makeDeps();
        const res = await jalankan(deps);
        expect(res.status).toBe(200);
        expect(res.body.perlu_dibersihkan).toBe(false);
        expect(res.body.pppoe_tertinggal).toBeNull();
        expect(res.body.langkah.sesi_diputus).toMatchObject({ dijalankan: true, ok: true });
        expect(res.body.langkah.secret_dihapus).toMatchObject({ dijalankan: true, ok: true });
        expect(res.body.langkah.baris_dihapus).toMatchObject({ ok: true });
        expect(res.body.langkah.port_odp).toMatchObject({ dijalankan: true, ok: true });
        expect(deps.alertSystem.sendAlert).not.toHaveBeenCalled();
    });

    // INI AKAR MODEM HANTU. Sebelumnya jalur ini menjawab "User berhasil dihapus" apa adanya.
    test("secret GAGAL dihapus → JANGAN mengaku sukses biasa, sebutkan kredensial yang tertinggal", async () => {
        const deps = makeDeps({ removePPPoESecret: jest.fn(async () => ({ ok: false, message: "router tak terjangkau" })) });
        const res = await jalankan(deps);

        expect(res.status).toBe(200);                       // barisnya TETAP terhapus — disengaja
        expect(deps.repository.deleteUserRecord).toHaveBeenCalled();
        expect(res.body.perlu_dibersihkan).toBe(true);
        expect(res.body.pppoe_tertinggal).toBe("budi@rafcybernet");
        expect(res.body.langkah.secret_dihapus).toMatchObject({ dijalankan: true, ok: false, pesan: "router tak terjangkau" });
        expect(res.body.message).not.toBe("User berhasil dihapus");
        expect(res.body.message).toMatch(/masih tertinggal/i);
    });

    test("secret gagal → admin DIBANGUNKAN sekarang, bukan menunggu ketahuan sendiri", async () => {
        const deps = makeDeps({ removePPPoESecret: jest.fn(async () => { throw new Error("timeout"); }) });
        await jalankan(deps);
        expect(deps.alertSystem.sendAlert).toHaveBeenCalledTimes(1);
        const [tingkat, kode, data] = deps.alertSystem.sendAlert.mock.calls[0];
        expect(tingkat).toBe("warning");
        expect(kode).toBe("PPPOE_SECRET_TERTINGGAL");
        expect(data.pppoe).toBe("budi@rafcybernet");
    });

    test("alert yang gagal terkirim tak boleh menggagalkan pencopotan", async () => {
        const deps = makeDeps({
            removePPPoESecret: jest.fn(async () => ({ ok: false, message: "x" })),
            alertSystem: { sendAlert: jest.fn(async () => { throw new Error("wa mati"); }) }
        });
        const res = await jalankan(deps);
        expect(res.status).toBe(200);
        expect(res.body.perlu_dibersihkan).toBe(true);
    });

    test("hanya SESI yang gagal (secret tetap terhapus) → bukan sisa, modem tak bisa konek lagi", async () => {
        const deps = makeDeps({ deleteActivePPPoEUser: jest.fn(async () => ({ ok: false, message: "sesi tak ada" })) });
        const res = await jalankan(deps);
        expect(res.body.langkah.sesi_diputus).toMatchObject({ ok: false });
        expect(res.body.perlu_dibersihkan).toBe(false);
        expect(deps.alertSystem.sendAlert).not.toHaveBeenCalled();
    });

    test("pelanggan tanpa PPPoE → langkah MikroTik ditandai tak dijalankan, bukan 'gagal'", async () => {
        const deps = makeDeps({
            repository: { ...makeDeps().repository, findUserById: jest.fn(() => ({ ...PELANGGAN, pppoe_username: null })) }
        });
        const res = await jalankan(deps);
        expect(res.body.langkah.sesi_diputus.dijalankan).toBe(false);
        expect(res.body.langkah.secret_dihapus.dijalankan).toBe(false);
        expect(res.body.perlu_dibersihkan).toBe(false);
    });

    test("user tak ditemukan → 404, tak ada yang disentuh", async () => {
        const deps = makeDeps({ repository: { ...makeDeps().repository, findUserById: jest.fn(() => null) } });
        const res = await jalankan(deps);
        expect(res.status).toBe(404);
        expect(deps.deleteActivePPPoEUser).not.toHaveBeenCalled();
    });
});
