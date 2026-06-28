/**
 * Guardrail akses menu: menu PELANGGAN khusus pelanggan terdaftar, menu TEKNISI khusus staf.
 * Non-pelanggan/non-staf harus DITOLAK (langsung error), bukan ditampilkan menunya.
 */
"use strict";

const { handleMenuPelangganIntent, handleMenuTeknisiIntent } = require("../menu-intents");

describe("menu access guards", () => {
    test("menupelanggan: non-pelanggan ditolak (menu TIDAK ditampilkan)", async () => {
        const reply = jest.fn();
        const handleMenuPelanggan = jest.fn();
        await handleMenuPelangganIntent({
            handleMenuPelanggan, findUserWithLidSupport: jest.fn().mockResolvedValue(null),
            global: { users: [], config: {} }, msg: {}, plainSenderNumber: "628", raf: {},
            reply, pushname: "X", sender: "628@s.whatsapp.net", mess: { userNotRegister: "TIDAK TERDAFTAR" },
        });
        expect(handleMenuPelanggan).not.toHaveBeenCalled();
        expect(reply).toHaveBeenCalledWith("TIDAK TERDAFTAR");
    });

    test("menupelanggan: pelanggan terdaftar → menu tampil", async () => {
        const reply = jest.fn();
        const handleMenuPelanggan = jest.fn();
        await handleMenuPelangganIntent({
            handleMenuPelanggan, findUserWithLidSupport: jest.fn().mockResolvedValue({ id: 1, name: "Budi" }),
            global: { users: [], config: {} }, msg: {}, plainSenderNumber: "628", raf: {},
            reply, pushname: "X", sender: "628@s.whatsapp.net", mess: {},
        });
        expect(handleMenuPelanggan).toHaveBeenCalled();
    });

    test("menuteknisi: non-staf ditolak (tooling internal tak diekspos)", async () => {
        const reply = jest.fn();
        const handleMenuTeknisi = jest.fn();
        await handleMenuTeknisiIntent({
            handleMenuTeknisi, global: { config: {} }, isOwner: false, isTeknisi: false,
            reply, pushname: "X", sender: "x", mess: { teknisiOrOwnerOnly: "KHUSUS TEKNISI" },
        });
        expect(handleMenuTeknisi).not.toHaveBeenCalled();
        expect(reply).toHaveBeenCalledWith("KHUSUS TEKNISI");
    });

    test("menuteknisi: teknisi → menu tampil; owner → menu tampil", async () => {
        for (const role of [{ isTeknisi: true, isOwner: false }, { isTeknisi: false, isOwner: true }]) {
            const reply = jest.fn();
            const handleMenuTeknisi = jest.fn();
            await handleMenuTeknisiIntent({
                handleMenuTeknisi, global: { config: {} }, ...role, reply, pushname: "X", sender: "x", mess: {},
            });
            expect(handleMenuTeknisi).toHaveBeenCalled();
        }
    });
});
