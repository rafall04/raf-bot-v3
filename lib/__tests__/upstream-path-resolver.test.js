/**
 * Header Doc
 * Purpose: Uji pemetaan IP PPPoE pelanggan → jalur upstream (CIDR pool, default recon DANDER).
 * Caller: jest.
 * Deps: `../upstream-path-resolver`.
 * MainFuncs: —
 * SideEffects: Tidak ada.
 */
"use strict";

const { resolvePathForIp, ipInCidr } = require("../upstream-path-resolver");

describe("ipInCidr", () => {
    test.each([
        ["192.168.61.5", "192.168.61.0/24", true],
        ["192.168.62.254", "192.168.62.0/24", true],
        ["192.168.63.1", "192.168.61.0/24", false],
        ["10.10.3.7", "10.10.0.0/20", true],   // /20 mencakup 10.10.0-15.x
        ["10.10.16.1", "10.10.0.0/20", false],
        ["abc", "192.168.61.0/24", false],
        ["192.168.61.5", "bukan-cidr", false]
    ])("%s dalam %s → %s", (ip, cidr, expected) => {
        expect(ipInCidr(ip, cidr)).toBe(expected);
    });
});

describe("resolvePathForIp — default pool recon DANDER", () => {
    test("pool 110k (192.168.61.x) → mni", () => {
        expect(resolvePathForIp("192.168.61.23", {})).toEqual({ path: "mni", cidr: "192.168.61.0/24" });
    });
    test("pool 125k (192.168.62.x) → mni", () => {
        expect(resolvePathForIp("192.168.62.9", {}).path).toBe("mni");
    });
    test("pool reguler (192.168.70.x) → gmdp", () => {
        expect(resolvePathForIp("192.168.70.100", {}).path).toBe("gmdp");
    });
    test("pool hotspot 10.10.x (dlm /20) → gmdp", () => {
        expect(resolvePathForIp("10.10.4.2", {}).path).toBe("gmdp");
    });
    test("pool 10.10.50.x → mni (freedns)", () => {
        expect(resolvePathForIp("10.10.50.14", {}).path).toBe("mni");
    });
    test("IP di luar semua pool → null", () => {
        expect(resolvePathForIp("172.16.99.1", {})).toBeNull();
    });
    test("IP kosong/rusak → null", () => {
        expect(resolvePathForIp("", {})).toBeNull();
        expect(resolvePathForIp(null, {})).toBeNull();
    });
    test("config pathPools override menang atas default", () => {
        const cfg = { pathPools: [{ path: "khusus", cidrs: ["192.168.61.0/24"] }] };
        expect(resolvePathForIp("192.168.61.5", cfg).path).toBe("khusus");
        // di override, pool 70.x tidak terdaftar → null (bukan fallback default)
        expect(resolvePathForIp("192.168.70.5", cfg)).toBeNull();
    });
});
