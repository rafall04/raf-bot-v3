/**
 * Header Doc
 * Purpose: Uji `getAffectedSet` — himpunan pelanggan terdampak LIVE per jalur: hitung dari sesi
 *          PPPoE aktif × resolver live; FAIL-CLOSED saat router tak terbaca (snapshot throw /
 *          sesi gagal) → confidence 'unknown' count null; jalur invalid; count 0; batas sample;
 *          never-throw.
 * Caller: jest.
 * Deps: `../upstream-affected-service` (deps di-inject penuh — tanpa MikroTik/PHP nyata).
 */
"use strict";

const svc = require("../upstream-affected-service");

function makeDeps(over = {}) {
    return {
        getSteeringSnapshot: jest.fn(async () => ({ overrides: [], profiles: { freedns: [], lokaldns: [] } })),
        getActivePPPoEUsers: jest.fn(async () => ({
            ok: true,
            data: [
                { name: "andik@rafcybernet", address: "192.168.61.6" },
                { name: "budi@rafcybernet", address: "192.168.61.7" },
                { name: "amel@rafcybernet", address: "192.168.62.10" },
                { name: "cctv@rafcybernet", address: "192.168.70.5" }
            ]
        })),
        // Live: 61.x → mni, 62.x/70.x → gmdp (meniru pool 62 sudah dipindah ke gmdp).
        resolveCustomerPath: jest.fn(async (ip) => (String(ip).startsWith("192.168.61.") ? "mni" : "gmdp")),
        ...over
    };
}

describe("upstream-affected-service.getAffectedSet", () => {
    test("live: hitung pelanggan yang jalur-nya = path (mni)", async () => {
        const res = await svc.getAffectedSet("mni", {}, makeDeps());
        expect(res.confidence).toBe("live");
        expect(res.count).toBe(2);
        expect(res.customers.map((c) => c.name)).toEqual(["andik@rafcybernet", "budi@rafcybernet"]);
        expect(res.customers[0]).toEqual({ name: "andik@rafcybernet", ip: "192.168.61.6" });
    });

    test("live: gmdp menampung pool 62 (yang sudah dipindah) + 70", async () => {
        const res = await svc.getAffectedSet("gmdp", {}, makeDeps());
        expect(res.confidence).toBe("live");
        expect(res.count).toBe(2); // amel(62) + cctv(70)
    });

    test("FAIL-CLOSED: snapshot throw (router tak terbaca) → unknown, count null", async () => {
        const res = await svc.getAffectedSet("mni", {}, makeDeps({
            getSteeringSnapshot: jest.fn(async () => { throw new Error("router down"); })
        }));
        expect(res.confidence).toBe("unknown");
        expect(res.count).toBeNull();
        expect(res.customers).toEqual([]);
    });

    test("FAIL-CLOSED: sesi PPPoE gagal ({ok:false}) → unknown, BUKAN 0", async () => {
        const res = await svc.getAffectedSet("mni", {}, makeDeps({
            getActivePPPoEUsers: jest.fn(async () => ({ ok: false, message: "timeout" }))
        }));
        expect(res.confidence).toBe("unknown");
        expect(res.count).toBeNull();
    });

    test("jalur invalid → unknown, count null (tanpa nembak router)", async () => {
        const deps = makeDeps();
        const res = await svc.getAffectedSet("tiktok", {}, deps);
        expect(res.confidence).toBe("unknown");
        expect(res.count).toBeNull();
        expect(deps.getSteeringSnapshot).not.toHaveBeenCalled();
    });

    test("count 0: tak ada sesi yang cocok jalur → 0 pelanggan, confidence live", async () => {
        const res = await svc.getAffectedSet("sf", {}, makeDeps());
        expect(res.confidence).toBe("live");
        expect(res.count).toBe(0);
        expect(res.customers).toEqual([]);
    });

    test("opts.sample membatasi daftar nama tapi count tetap total", async () => {
        const res = await svc.getAffectedSet("mni", { sample: 1 }, makeDeps());
        expect(res.count).toBe(2);
        expect(res.customers).toHaveLength(1);
    });

    test("never-throw: resolver melempar per-IP → dilewati, tidak throw", async () => {
        const res = await svc.getAffectedSet("mni", {}, makeDeps({
            resolveCustomerPath: jest.fn(async (ip) => {
                if (ip === "192.168.61.7") throw new Error("boom");
                return ip.startsWith("192.168.61.") ? "mni" : "gmdp";
            })
        }));
        expect(res.confidence).toBe("live");
        expect(res.count).toBe(1); // andik masuk, budi (61.7) dilewati karena error
    });
});
