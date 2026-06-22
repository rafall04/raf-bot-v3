/**
 * Test olt-optical-resolver — verifikasi inti matching pelanggan→ONU optik
 * (buildOnuIndex, matchOnu) + ringkasan resolveByCustomer untuk skenario
 * GPON (match by pppoe/serial), EPON (match by MAC), dan offline (tak ada di
 * snapshot tapi MAC dikenal → LOS/Dying Gasp dari log scraper). Semua dependency
 * eksternal diinjeksi sehingga tidak menyentuh SNMP/FS asli.
 */
"use strict";

const {
    buildOnuIndex,
    matchOnu,
    createOpticalResolver,
} = require("../olt-optical-resolver");

// Normalizer fake: ambil hanya heksadesimal lalu uppercase (mac valid → >=12 char,
// 'N/A' → 'A' sehingga di-skip guard length>=10, sama semangatnya dgn produksi).
const fakeNormalize = (mac) => String(mac == null ? "" : mac).replace(/[^0-9a-fA-F]/g, "").toUpperCase();

const gponOnu = {
    macAddress: "N/A",
    description: "budi@isp",
    serial: "ZTEGC1234567",
    rxPower: "-22.50",
    status: "Online",
    isLos: false,
    isDyingGasp: false,
    lastDownCause: null,
    ponName: "1/1/1",
    slotId: 1,
    id: 5,
    olt_id: "olt1",
    olt_name: "OLT-ZTE",
    olt_host: "10.0.0.1",
    olt_brand: "zte",
};

const eponOnu = {
    macAddress: "AA:BB:CC:DD:EE:01",
    description: null,
    serial: null,
    rxPower: "-25.00",
    status: "Online",
    isLos: false,
    isDyingGasp: false,
    lastDownCause: null,
    ponName: null,
    slotId: 0,
    id: 2,
    olt_id: "olt2",
    olt_name: "OLT-HIOSO",
    olt_host: "10.0.0.2",
    olt_brand: "auto",
};

describe("buildOnuIndex", () => {
    test("indeks EPON by MAC-prefix, GPON by deskripsi(@) + serial; key lower-case", () => {
        const index = buildOnuIndex([gponOnu, eponOnu], { normalizeMAC: fakeNormalize });
        expect(index.oltByPppoe["budi@isp"]).toBe(gponOnu);
        expect(index.oltBySerial["ztegc1234567"]).toBe(gponOnu);
        expect(index.oltByMac["AABBCCDDEE"]).toBe(eponOnu); // 10 char prefix
    });

    test("MAC 'N/A' tidak masuk indeks MAC (guard panjang>=10)", () => {
        const index = buildOnuIndex([gponOnu], { normalizeMAC: fakeNormalize });
        expect(Object.keys(index.oltByMac)).toHaveLength(0);
    });

    test("deskripsi tanpa '@' tidak diindeks sebagai pppoe", () => {
        const onu = { ...eponOnu, description: "catatan biasa" };
        const index = buildOnuIndex([onu], { normalizeMAC: fakeNormalize });
        expect(Object.keys(index.oltByPppoe)).toHaveLength(0);
    });

    test("input non-array aman (kembalikan indeks kosong)", () => {
        const index = buildOnuIndex(null, { normalizeMAC: fakeNormalize });
        expect(index).toEqual({ oltByMac: {}, oltByPppoe: {}, oltBySerial: {} });
    });
});

describe("matchOnu", () => {
    const index = buildOnuIndex([gponOnu, eponOnu], { normalizeMAC: fakeNormalize });

    test("prioritas 1: cocok via pppoe (deskripsi)", () => {
        const r = matchOnu({ pppoe_username: "budi@isp" }, { index }, { normalizeMAC: fakeNormalize });
        expect(r).toEqual({ onu: gponOnu, source: "pppoe" });
    });

    test("prioritas 2: cocok via serial (olt_serial)", () => {
        const r = matchOnu(
            { pppoe_username: "siti@isp", olt_serial: "ZTEGC1234567" },
            { index },
            { normalizeMAC: fakeNormalize }
        );
        expect(r).toEqual({ onu: gponOnu, source: "serial" });
    });

    test("prioritas 3: cocok via MAC-prefix (EPON)", () => {
        const r = matchOnu(
            { pppoe_username: "eko@isp" },
            { index, macInfo: { mac: "AA:BB:CC:DD:EE:01", source: "cached" } },
            { normalizeMAC: fakeNormalize }
        );
        expect(r).toEqual({ onu: eponOnu, source: "mac" });
    });

    test("tidak cocok → {onu:null, source:null}", () => {
        const r = matchOnu({ pppoe_username: "xxx@isp" }, { index }, { normalizeMAC: fakeNormalize });
        expect(r).toEqual({ onu: null, source: null });
    });

    test("user tanpa pppoe_username → tidak match", () => {
        const r = matchOnu({}, { index }, { normalizeMAC: fakeNormalize });
        expect(r).toEqual({ onu: null, source: null });
    });
});

describe("resolveByCustomer", () => {
    function makeResolver(overrides = {}) {
        return createOpticalResolver({
            normalizeMAC: fakeNormalize,
            normalizeForEvent: fakeNormalize,
            getMacForUser: () => null,
            getCachedInfo: () => null,
            getEventByMAC: () => null,
            getOltFromMac: () => null,
            loadCallerIdCache: () => ({}),
            ...overrides,
        }).resolveByCustomer;
    }

    test("GPON online via pppoe → matched, rxPower & identitas terisi", () => {
        const resolve = makeResolver();
        const res = resolve({ pppoe_username: "budi@isp", name: "Budi" }, { oltSnapshot: { onus: [gponOnu] } });
        expect(res.matched).toBe(true);
        expect(res.source).toBe("pppoe");
        expect(res.rxPower).toBe("-22.50");
        expect(res.status).toBe("Online");
        expect(res.ponName).toBe("1/1/1");
        expect(res.oltName).toBe("OLT-ZTE");
        expect(res.serial).toBe("ZTEGC1234567");
    });

    test("EPON online via MAC → matched, source 'mac'", () => {
        const resolve = makeResolver({
            getMacForUser: () => ({ mac: "AA:BB:CC:DD:EE:01", source: "active" }),
        });
        const res = resolve({ pppoe_username: "eko@isp" }, { oltSnapshot: { onus: [eponOnu] } });
        expect(res.matched).toBe(true);
        expect(res.source).toBe("mac");
        expect(res.macOlt).toBe("AA:BB:CC:DD:EE:01");
        expect(res.rxPower).toBe("-25.00");
    });

    test("matched tapi offline + event dying-gasp → status di-upgrade ke 'Dying Gasp'", () => {
        const offlineEpon = { ...eponOnu, macAddress: "AA:BB:CC:DD:EE:02", status: "Offline", id: 3 };
        const resolve = makeResolver({
            getMacForUser: () => ({ mac: "AA:BB:CC:DD:EE:02", source: "cached" }),
            getEventByMAC: (mac) => (fakeNormalize(mac) === "AABBCCDDEE02" ? { event_type: "dying-gasp", timestamp: 111 } : null),
        });
        const res = resolve({ pppoe_username: "rudi@isp" }, { oltSnapshot: { onus: [offlineEpon] } });
        expect(res.matched).toBe(true);
        expect(res.status).toBe("Dying Gasp");
        expect(res.isDyingGasp).toBe(true);
        expect(res.isLos).toBe(false);
        expect(res.logEvent).toBe("dying-gasp");
    });

    test("tak ada di snapshot tapi MAC dikenal → cabang offline (LOS dari log + olt/slot dari cache)", () => {
        const resolve = makeResolver({
            getMacForUser: () => ({ mac: "AA:BB:CC:DD:EE:99", source: "cached" }),
            getEventByMAC: (mac) => (fakeNormalize(mac) === "AABBCCDDEE99" ? { event_type: "los", timestamp: 222 } : null),
            getOltFromMac: () => ({ oltId: "olt2", oltName: "OLT-HIOSO", oltHost: "10.0.0.2" }),
            getCachedInfo: () => ({ slot_id: 0, onu_id: 2, mac: "AA:BB:CC:DD:EE:99" }),
        });
        const res = resolve({ pppoe_username: "eko@isp" }, { oltSnapshot: { onus: [gponOnu] } });
        expect(res.matched).toBe(false);
        expect(res.identifiable).toBe(true);
        expect(res.status).toBe("LOS");
        expect(res.isLos).toBe(true);
        expect(res.rxPower).toBe("N/A");
        expect(res.macOlt).toBe("N/A");
        expect(res.oltId).toBe("olt2");
        expect(res.slotId).toBe(0);
        expect(res.onuId).toBe(2);
    });

    test("tak ada ONU & tak ada MAC → tidak teridentifikasi", () => {
        const resolve = makeResolver();
        const res = resolve({ pppoe_username: "ghost@isp" }, { oltSnapshot: { onus: [gponOnu] } });
        expect(res.matched).toBe(false);
        expect(res.identifiable).toBe(false);
        expect(res.status).toBe("unknown");
    });

    test("user tanpa pppoe_username → emptyResult tidak teridentifikasi", () => {
        const resolve = makeResolver();
        const res = resolve({ name: "Tanpa PPPoE" }, { oltSnapshot: { onus: [gponOnu] } });
        expect(res.identifiable).toBe(false);
    });
});
