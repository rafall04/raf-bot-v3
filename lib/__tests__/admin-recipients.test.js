/**
 * Test resolver JID admin — SUMBER TUNGGAL accounts.json (role admin/owner/superadmin).
 * Sengaja TIDAK pakai config.telfon (nomor bot) / ownerNumber (placeholder prod).
 */
"use strict";

const { getAdminJids, getFirstAdminNumber } = require("../admin-recipients");

const ACCOUNTS = [
    { username: "raf", role: "admin", phone_number: "6285233047094" },
    { username: "davin", role: "teknisi", phone_number: "6287787262890" },
];

describe("getAdminJids (accounts-only)", () => {
    test("ambil admin/owner, lewati teknisi", () => {
        const jids = getAdminJids(ACCOUNTS);
        expect(jids).toEqual(["6285233047094@s.whatsapp.net"]);
        expect(jids).not.toContain("6287787262890@s.whatsapp.net");
    });

    test("normalisasi nomor lokal 08xxx → 62xxx", () => {
        const jids = getAdminJids([{ role: "owner", phone_number: "085233047094" }]);
        expect(jids).toEqual(["6285233047094@s.whatsapp.net"]);
    });

    test("dedup + buang nomor < 10 digit / non-62", () => {
        const jids = getAdminJids([
            { role: "admin", phone_number: "6285233047094" },
            { role: "admin", phone_number: "6285233047094" },
            { role: "admin", phone_number: "62" },
            { role: "admin", phone_number: "12345" },
        ]);
        expect(jids).toEqual(["6285233047094@s.whatsapp.net"]);
    });

    test("tak ada accounts / tanpa nomor → array kosong", () => {
        expect(getAdminJids([])).toEqual([]);
        expect(getAdminJids([{ role: "admin" }])).toEqual([]);
        expect(getAdminJids(null)).toEqual([]);
    });

    test("getFirstAdminNumber → digit admin pertama (untuk wa.me)", () => {
        expect(getFirstAdminNumber(ACCOUNTS)).toBe("6285233047094");
        expect(getFirstAdminNumber([])).toBe("");
    });
});
