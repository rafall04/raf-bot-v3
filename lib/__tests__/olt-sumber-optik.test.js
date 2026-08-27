/**
 * Header Doc
 * Purpose : Menjaga SATU pemilik keputusan sumber optik (#b275): `getOltSnapshot` memakai
 *           pembaca WEB secara bawaan, dan SNMP hanya bila diminta eksplisit.
 *           SNMP membuat OLT hang — kalau bawaannya kembali ke SNMP lewat refactor,
 *           kerusakannya baru terasa setelah OLT tak menjawab.
 * Caller  : jest
 * Deps    : lib/olt-optical-resolver (olt-web-optical & olt-hioso di-mock)
 * MainFuncs: -
 * SideEffects: menyetel global.config selama tes
 */
const fs = require("fs");
const path = require("path");

const SNAPSHOT_WEB = {
    status: "success",
    onus: [{ macAddress: "aa:bb:cc:dd:ee:ff", status: "Online", rxPower: -20.1, sumber: "web" }],
    failedOlts: [],
};
const SNAPSHOT_SNMP = {
    status: "success",
    onus: [{ macAddress: "11:22:33:44:55:66", status: "Online", rxPower: -21.2, sumber: "snmp" }],
    failedOlts: [],
};

function muatResolver() {
    jest.resetModules();
    jest.doMock("../olt-web-optical", () => ({
        getWebOpticalSnapshot: jest.fn(async () => SNAPSHOT_WEB),
    }));
    jest.doMock("../olt-hioso", () => ({
        getMultipleOltData: jest.fn(async () => SNAPSHOT_SNMP),
        normalizeMAC: (m) => String(m || "").replace(/[^0-9a-f]/gi, "").toLowerCase(),
    }));
    return {
        resolver: require("../olt-optical-resolver"),
        web: require("../olt-web-optical"),
        snmp: require("../olt-hioso"),
    };
}

describe("#b275 — sumber optik: WEB bawaan, SNMP hanya bila diminta", () => {
    afterEach(() => { delete global.config; jest.resetModules(); });

    test("tanpa config → pembaca WEB dipakai, SNMP TIDAK disentuh", async () => {
        global.config = {};
        const { resolver, web, snmp } = muatResolver();
        const snap = await resolver.getOltSnapshot({ forceRefresh: true, getDevices: () => [] });
        expect(web.getWebOpticalSnapshot).toHaveBeenCalled();
        expect(snmp.getMultipleOltData).not.toHaveBeenCalled();
        expect(snap.onus[0].sumber).toBe("web");
    });

    test("olt.sumberOptik tak dikenal → tetap WEB (gagal ke sisi aman)", async () => {
        global.config = { olt: { sumberOptik: "entah" } };
        const { resolver, web, snmp } = muatResolver();
        await resolver.getOltSnapshot({ forceRefresh: true, getDevices: () => [] });
        expect(web.getWebOpticalSnapshot).toHaveBeenCalled();
        expect(snmp.getMultipleOltData).not.toHaveBeenCalled();
    });

    test("olt.sumberOptik = 'snmp' → SNMP dipakai, itu pilihan SADAR", async () => {
        global.config = { olt: { sumberOptik: "snmp" } };
        const { resolver, web, snmp } = muatResolver();
        const snap = await resolver.getOltSnapshot({ forceRefresh: true, getDevices: () => [] });
        expect(snmp.getMultipleOltData).toHaveBeenCalled();
        expect(web.getWebOpticalSnapshot).not.toHaveBeenCalled();
        expect(snap.onus[0].sumber).toBe("snmp");
    });

    test("getOltData yang disuntik tetap menang (tes lain bergantung padanya)", async () => {
        global.config = {};
        const { resolver, web, snmp } = muatResolver();
        const snap = await resolver.getOltSnapshot({
            forceRefresh: true,
            getDevices: () => [],
            getOltData: async () => ({ status: "success", onus: [{ macAddress: "x", sumber: "suntik" }] }),
        });
        expect(snap.onus[0].sumber).toBe("suntik");
        expect(web.getWebOpticalSnapshot).not.toHaveBeenCalled();
        expect(snmp.getMultipleOltData).not.toHaveBeenCalled();
    });

    test("!! pembaca web mengisi medan lama secara EKSPLISIT, bukan undefined", async () => {
        // Modul ASLI — tes di atas sempat men-doMock namanya.
        const web = jest.requireActual("../olt-web-optical");
        const snap = await web.getWebOpticalSnapshot({
            getDevices: () => [{ id: "o", name: "O", host: "1.1.1.1", webUsername: "u", webPassword: "p" }],
            deps: {
                jedaMs: 0,
                wait: async () => {},
                fetchPage: async (_d, p) =>
                    p.includes("PonList")
                        ? { ok: true, body: "var ponListTable=new Array('0/1/1','x');" }
                        : { ok: true, body: "var ponOnuTable=new Array('0/1/1:1','NA','aa:bb','Up','1','2','3','4','5','6','7','-20.10','100');" },
            },
        });
        const o = snap.onus[0];
        // SNMP Hioso pun tak pernah bisa membedakan LOS/dying-gasp — pemiliknya log web.
        expect(o.isDyingGasp).toBe(false);
        expect(o.isLos).toBe(false);
        expect(o.lastDownCause).toBeNull();
        expect(o.serial).toBeNull();
        expect(o.description).toBeNull();
        for (const k of ["systemInfo", "incompleteWalks", "failedWalks", "oltResults"]) {
            expect(snap[k]).toBeDefined();
        }
    });

    test("resolver tidak mengimpor net-snmp secara langsung", () => {
        const src = fs.readFileSync(path.join(__dirname, "..", "olt-optical-resolver.js"), "utf8");
        expect(src).not.toMatch(/net-snmp/);
    });
});
