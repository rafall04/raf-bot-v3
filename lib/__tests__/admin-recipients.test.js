/**
 * Test resolver JID admin — fokus: BUANG nomor placeholder/invalid (mis. 62xxxxxxxxxx)
 * supaya alert operasional benar-benar sampai, bukan terkirim ke JID hantu.
 */
"use strict";

const { getAdminJids } = require("../admin-recipients");

describe("getAdminJids", () => {
    test("buang placeholder ownerNumber, pakai telfon valid", () => {
        const jids = getAdminJids({ ownerNumber: ["62xxxxxxxxxx@s.whatsapp.net"], telfon: "6289685645956" }, []);
        expect(jids).toEqual(["6289685645956@s.whatsapp.net"]);
    });

    test("ambil admin/owner dari accounts, lewati non-admin", () => {
        const jids = getAdminJids({ ownerNumber: [] }, [
            { role: "owner", phone_number: "6281234567890" },
            { role: "teknisi", phone_number: "6280000000000" },
        ]);
        expect(jids).toContain("6281234567890@s.whatsapp.net");
        expect(jids).not.toContain("6280000000000@s.whatsapp.net");
    });

    test("dedup + buang nomor < 10 digit", () => {
        const jids = getAdminJids({ ownerNumber: ["6285233047094"], telfon: "6285233047094", nomor_admin: "62" }, []);
        expect(jids).toEqual(["6285233047094@s.whatsapp.net"]);
    });

    test("normalisasi nomor lokal 08xxx → 62xxx (JID valid)", () => {
        const jids = getAdminJids({ ownerNumber: [], telfon: "085233047094" }, []);
        expect(jids).toEqual(["6285233047094@s.whatsapp.net"]);
    });

    test("admin raf (6285233047094) + telfon → keduanya masuk, teknisi dikecualikan", () => {
        const jids = getAdminJids(
            { ownerNumber: ["62xxxxxxxxxx@s.whatsapp.net"], telfon: "6289685645956" },
            [{ username: "raf", role: "admin", phone_number: "6285233047094" }, { username: "davin", role: "teknisi", phone_number: "6287787262890" }]
        );
        expect(jids).toContain("6285233047094@s.whatsapp.net");
        expect(jids).toContain("6289685645956@s.whatsapp.net");
        expect(jids).not.toContain("6287787262890@s.whatsapp.net");
    });

    test("config kosong → array kosong (alert akan log 'tidak ada admin')", () => {
        expect(getAdminJids({}, [])).toEqual([]);
    });
});
