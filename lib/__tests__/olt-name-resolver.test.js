"use strict";

const { resolveOltDisplay } = require("../olt-name-resolver");

function withConfig(cfg, fn) {
    const prev = global.config;
    global.config = cfg;
    try { return fn(); } finally { global.config = prev; }
}

describe("olt-name-resolver", () => {
    test("match device by host/id (event scraper — OLT asli)", () => {
        withConfig({ olt: { devices: [
            { id: "olt1", name: "OLT Server", host: "192.168.11.2" },
            { id: "olt2", name: "OLT Icak", host: "192.168.0.88" },
        ] } }, () => {
            expect(resolveOltDisplay("192.168.11.2")).toEqual({ name: "OLT Server", ip: "192.168.11.2" });
            expect(resolveOltDisplay("olt2")).toEqual({ name: "OLT Icak", ip: "192.168.0.88" });
        });
    });

    test("bot 1-OLT (syslog ke-NAT) → label dari config.oltSyslog", () => {
        withConfig({ olt: { enabled: false }, oltSyslog: { oltName: "OLT Tanjungharjo", oltHost: "192.168.15.2" } }, () => {
            expect(resolveOltDisplay("172.17.11.1")).toEqual({ name: "OLT Tanjungharjo", ip: "192.168.15.2" });
        });
    });

    test("registry 1 device → dipakai apapun sumbernya", () => {
        withConfig({ olt: { devices: [{ name: "OLT X", host: "10.0.0.1" }] } }, () => {
            expect(resolveOltDisplay("172.17.11.1")).toEqual({ name: "OLT X", ip: "10.0.0.1" });
        });
    });

    test("multi-OLT ambigu (NAT, tak match, tanpa oltSyslog) → tampil apa adanya", () => {
        withConfig({ olt: { devices: [{ name: "A", host: "1.1.1.1" }, { name: "B", host: "2.2.2.2" }] } }, () => {
            expect(resolveOltDisplay("172.17.11.1")).toEqual({ name: null, ip: "172.17.11.1" });
        });
    });

    test("config kosong → apa adanya", () => {
        withConfig({}, () => {
            expect(resolveOltDisplay("172.17.11.1")).toEqual({ name: null, ip: "172.17.11.1" });
        });
    });
});
