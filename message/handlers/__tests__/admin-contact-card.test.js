/**
 * Guardrail: kartu kontak "admin" pakai nomor VALID (config.adminPhone/telfon), bukan
 * ownerNumber placeholder "62xxxxxxxxxx" yang bikin vCard rusak jadi "+62".
 */
"use strict";

const { handleAdminContact } = require("../utility-handler");

describe("handleAdminContact", () => {
    test("pakai config.adminPhone, abaikan ownerNumber placeholder", () => {
        const sendContact = jest.fn();
        const reply = jest.fn();
        handleAdminContact("cust@s.whatsapp.net", ["62xxxxxxxxxx@s.whatsapp.net"],
            { adminPhone: "6289685645956", nama: "RAF NET" }, {}, sendContact, reply);
        expect(sendContact).toHaveBeenCalledWith("cust@s.whatsapp.net", "6289685645956", "Admin RAF NET", {});
        expect(reply).not.toHaveBeenCalled();
    });

    test("fallback ke telfon bila adminPhone kosong", () => {
        const sendContact = jest.fn();
        handleAdminContact("c", [], { telfon: "6289685645956", nama: "RAF" }, {}, sendContact, jest.fn());
        expect(sendContact).toHaveBeenCalledWith("c", "6289685645956", "Admin RAF", {});
    });

    test("tak ada nomor valid → reply pesan 'tidak tersedia', tak kirim kartu", () => {
        const sendContact = jest.fn();
        const reply = jest.fn();
        handleAdminContact("c", ["62xxxxxxxxxx@s.whatsapp.net"], { nama: "RAF" }, {}, sendContact, reply);
        expect(sendContact).not.toHaveBeenCalled();
        expect(reply).toHaveBeenCalled();
    });
});
