"use strict";

jest.mock("../genieacs", () => ({ queryDevices: jest.fn().mockResolvedValue({ ok: false, data: [] }) }));
const genieacs = require("../genieacs");
const resolver = require("../olt-genieacs-resolver");

// Bentuk device GenieACS nyata (HG8145V5, dari ACS Tanjung): MAC ...EB:82, pppoe rafcybernet.
const DEVICE = {
    _id: "00259E-HG8145V5-4857544358DB41B2",
    InternetGatewayDevice: {
        LANDevice: { "1": { LANEthernetInterfaceConfig: { "1": { MACAddress: { _value: "AC:5E:14:96:EB:82" } } } } },
        WANDevice: { "1": { WANConnectionDevice: { "1": { WANPPPConnection: { "1": { Username: { _value: "ahmad_ali_afandi@rafcybernet" } } } } } } },
    },
};

describe("olt-genieacs-resolver", () => {
    beforeEach(() => {
        genieacs.queryDevices.mockResolvedValue({ ok: false, data: [] });
        resolver._setIndexForTest([]);
    });

    test("buildIndexFromDevices ekstrak mac + deviceId + pppoe", () => {
        const idx = resolver.buildIndexFromDevices([DEVICE]);
        expect(idx).toContainEqual({
            mac: "ac5e1496eb82",
            deviceId: "00259E-HG8145V5-4857544358DB41B2",
            pppoe: "ahmad_ali_afandi@rafcybernet",
        });
    });

    test("resolveByMacSync cocok walau OLT beda 1 oktet (matchMAC ±2)", () => {
        resolver._setIndexForTest([
            { mac: "ac5e1496eb82", deviceId: "00259E-HG8145V5-4857544358DB41B2", pppoe: "ahmad_ali_afandi@rafcybernet" },
        ]);
        // OLT lapor ...EB81, GenieACS punya ...EB82 → harus tetap resolve.
        const r = resolver.resolveByMacSync("AC5E1496EB81");
        expect(r).toEqual({ deviceId: "00259E-HG8145V5-4857544358DB41B2", pppoe: "ahmad_ali_afandi@rafcybernet" });
    });

    test("resolveByMacSync MAC jauh beda → null", () => {
        resolver._setIndexForTest([{ mac: "ac5e1496eb82", deviceId: "D1", pppoe: "p1@x" }]);
        expect(resolver.resolveByMacSync("001122334455")).toBeNull();
    });

    test("index kosong → null (tidak throw)", () => {
        resolver._setIndexForTest([]);
        expect(resolver.resolveByMacSync("AC5E1496EB81")).toBeNull();
    });

    test("refreshIndex membangun index dari queryDevices", async () => {
        genieacs.queryDevices.mockResolvedValue({ ok: true, data: [DEVICE] });
        await resolver.refreshIndex();
        const r = resolver.resolveByMacSync("AC:5E:14:96:EB:81");
        expect(r && r.pppoe).toBe("ahmad_ali_afandi@rafcybernet");
        expect(r && r.deviceId).toBe("00259E-HG8145V5-4857544358DB41B2");
    });
});
