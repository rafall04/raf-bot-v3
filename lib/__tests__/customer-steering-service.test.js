/**
 * Header Doc
 * Purpose: Uji steering pelanggan — resolusi jalur intended (override > freedns > lokaldns >
 *          default, entri disabled/dynamic diabaikan, /32 polos), jalur actual dari route
 *          snapshot (MNI menumpang SF, main dialihkan ke IH), spec rule setup, steerCustomer
 *          (gate config/user/path, intent + reconcile + audit, unsteer), reconcileOnce (IP
 *          drift → ganti entri, entri yatim dibersihkan, offline dilewati), dan allowlist pool.
 * Caller: jest.
 * Deps: `../customer-steering-service` (bridge/users/actives/intents di-inject penuh).
 * SideEffects: Mutasi global.config/global.users di-restore per test.
 */
"use strict";

const svc = require("../customer-steering-service");

const { resolveIntendedPath, resolveActualPath, buildSetupRules } = svc._internal;

const NOW = Date.parse("2026-07-08T02:00:00.000Z");

function baseConfig(over = {}) {
    return {
        customerSteering: { enabled: true, ...over },
        upstreamMonitor: { host: "172.17.11.1", port: 8799, user: "claude", password: "x" }
    };
}

function steerCfg() {
    // Ambil hasil getSteeringConfig() dengan global.config test aktif.
    return svc.getSteeringConfig();
}

const origConfig = global.config;
const origUsers = global.users;
afterEach(() => { global.config = origConfig; global.users = origUsers; });

describe("resolveIntendedPath", () => {
    beforeEach(() => { global.config = baseConfig(); });

    const LISTS = {
        freedns: [
            { id: "*1", address: "192.168.71.0/24", disabled: 0, dynamic: 0, comment: "" },
            { id: "*2", address: "192.168.61.0/24", disabled: 1, dynamic: 0, comment: "" } // OFF
        ],
        lokaldns: [
            { id: "*3", address: "192.168.70.0/24", disabled: 0, dynamic: 0, comment: "" },
            { id: "*4", address: "192.168.61.0/24", disabled: 0, dynamic: 0, comment: "" }
        ],
        "RAF-STEER-IH": [{ id: "*5", address: "192.168.70.99", disabled: 0, dynamic: 0, comment: "RAF-STEER uid=7 budi" }]
    };

    test("override RAF-STEER menang mutlak (entri /32 polos)", () => {
        const r = resolveIntendedPath("192.168.70.99", LISTS, steerCfg());
        expect(r.intended).toBe("ih");
        expect(r.source).toBe("steer:RAF-STEER-IH");
    });

    test("freedns aktif → mni; entri freedns DISABLED tidak dihitung (61.x jatuh ke lokaldns → gmdp)", () => {
        expect(resolveIntendedPath("192.168.71.10", LISTS, steerCfg()).intended).toBe("mni");
        const r61 = resolveIntendedPath("192.168.61.10", LISTS, steerCfg());
        expect(r61.intended).toBe("gmdp");
        expect(r61.source).toBe("pool:lokaldns");
    });

    test("tanpa list mana pun → default gmdp (main)", () => {
        const r = resolveIntendedPath("192.168.62.10", LISTS, steerCfg());
        expect(r.intended).toBe("gmdp");
        expect(r.source).toBe("default");
    });
});

describe("resolveActualPath", () => {
    beforeEach(() => { global.config = baseConfig(); });

    test("mark MNI menumpang SF; main dialihkan ke IH; normal apa adanya", () => {
        const snapshot = [
            { mark: "MNI", gateway: "SF", active: 1, disabled: 0 },
            { mark: "main", gateway: "192.168.102.1", active: 1, disabled: 0 },
            { mark: "FREE", gateway: "192.168.102.1", active: 1, disabled: 0 }
        ];
        expect(resolveActualPath("mni", snapshot, steerCfg())).toEqual({ actual: "sf", via: "SF" });
        expect(resolveActualPath("gmdp", snapshot, steerCfg())).toEqual({ actual: "ih", via: "192.168.102.1" });
        expect(resolveActualPath("ih", snapshot, steerCfg())).toEqual({ actual: "ih", via: "192.168.102.1" });
        // Snapshot kosong → intended dipertahankan.
        expect(resolveActualPath("mni", [], steerCfg()).actual).toBe("mni");
    });
});

describe("buildSetupRules", () => {
    test("gmdp=accept (jatuh ke main), lainnya mark-routing sesuai tabel", () => {
        global.config = baseConfig();
        const rules = buildSetupRules(steerCfg());
        expect(rules).toEqual([
            { comment: "RAF-CUSTSTEER-GMDP", srcList: "RAF-STEER-GMDP", kind: "accept" },
            { comment: "RAF-CUSTSTEER-IH", srcList: "RAF-STEER-IH", kind: "mark", mark: "FREE" },
            { comment: "RAF-CUSTSTEER-MNI", srcList: "RAF-STEER-MNI", kind: "mark", mark: "MNI" },
            { comment: "RAF-CUSTSTEER-SF", srcList: "RAF-STEER-SF", kind: "mark", mark: "SF-PROBE" }
        ]);
    });
});

function makeDeps({ lists = {}, actives = [], intents = [] } = {}) {
    const state = { intents: JSON.parse(JSON.stringify(intents)), bridgeCalls: [], incidents: [] };
    const deps = {
        runBridge: jest.fn(async (spec) => {
            state.bridgeCalls.push(spec);
            if (spec.mode === "list") {
                const out = {};
                (spec.lists || []).forEach((n) => { out[n] = lists[n] || []; });
                return { status: "success", data: { lists: out } };
            }
            if (spec.mode === "entry-add") {
                (lists[spec.list] = lists[spec.list] || []).push({
                    id: `*N${state.bridgeCalls.length}`, address: spec.address,
                    disabled: 0, dynamic: 0, comment: spec.comment || ""
                });
                return { status: "success", data: { entries: lists[spec.list] } };
            }
            if (spec.mode === "entry-remove") {
                lists[spec.list] = (lists[spec.list] || []).filter((e) => e.id !== spec.id);
                return { status: "success", data: { entries: lists[spec.list] } };
            }
            if (spec.mode === "entry-toggle") return { status: "success", data: { entries: lists[spec.list] || [] } };
            if (spec.mode === "setup") return { status: "success", data: { rules: [], anchor: "*200" } };
            return { status: "error", message: "mode?" };
        }),
        getUsers: () => global.users || [],
        getActives: async () => actives,
        getStatusReport: async () => ({ route_snapshot: [] }),
        readIntents: () => state.intents,
        writeIntents: (l) => { state.intents = l; },
        addIncident: async (p) => { state.incidents.push(p); },
        nowMs: () => NOW
    };
    return { deps, state, lists };
}

describe("steerCustomer + reconcileOnce", () => {
    beforeEach(() => {
        global.config = baseConfig();
        global.users = [
            { id: 7, name: "Budi", pppoe_username: "budi7", subscription: "110k" },
            { id: 9, name: "Tanpa PPPoE" }
        ];
    });

    test("gate: config nonaktif / user tak ada / path asing / tanpa pppoe", async () => {
        global.config = baseConfig({ enabled: false });
        expect((await svc.steerCustomer({ userId: 7, path: "ih" }, makeDeps().deps)).ok).toBe(false);
        global.config = baseConfig();
        expect((await svc.steerCustomer({ userId: 99, path: "ih" }, makeDeps().deps)).error).toContain("tidak ditemukan");
        expect((await svc.steerCustomer({ userId: 7, path: "xx" }, makeDeps().deps)).error).toContain("tidak dikenal");
        expect((await svc.steerCustomer({ userId: 9, path: "ih" }, makeDeps().deps)).error).toContain("pppoe_username");
    });

    test("steer online: intent tersimpan + entri /32 dibuat di list tujuan + insiden", async () => {
        const { deps, state, lists } = makeDeps({
            actives: [{ name: "budi7", address: "192.168.61.44" }]
        });
        const r = await svc.steerCustomer({ userId: 7, path: "ih", actor: "admin:raf" }, deps);
        expect(r.ok).toBe(true);
        expect(r.appliedNow).toBe(true);
        expect(r.message).toContain("192.168.61.44");
        expect(state.intents).toHaveLength(1);
        expect(state.intents[0]).toMatchObject({ userId: 7, pppoe: "budi7", path: "ih", addedIp: "192.168.61.44" });
        expect((lists["RAF-STEER-IH"] || []).some((e) => e.address === "192.168.61.44" && e.comment.indexOf("RAF-STEER uid=7") === 0)).toBe(true);
        expect(state.incidents.some((i) => i.kind === "steer")).toBe(true);
    });

    test("steer offline: intent tersimpan, pesan 'dijadwalkan', tanpa entri", async () => {
        const { deps, state } = makeDeps({ actives: [] });
        const r = await svc.steerCustomer({ userId: 7, path: "mni" }, deps);
        expect(r.ok).toBe(true);
        expect(r.appliedNow).toBe(false);
        expect(r.message).toContain("dijadwalkan");
        expect(state.intents[0].path).toBe("mni");
    });

    test("reconcile: IP berganti → entri lama dihapus, entri baru IP terkini", async () => {
        const lists = {
            "RAF-STEER-IH": [{ id: "*A", address: "192.168.61.44", disabled: 0, dynamic: 0, comment: "RAF-STEER uid=7 budi7" }]
        };
        const { deps, state } = makeDeps({
            lists,
            actives: [{ name: "budi7", address: "192.168.61.77" }],
            intents: [{ userId: 7, pppoe: "budi7", path: "ih", addedIp: "192.168.61.44" }]
        });
        const r = await svc.reconcileOnce(deps);
        expect(r.skipped).toBe(false);
        expect(lists["RAF-STEER-IH"].some((e) => e.address === "192.168.61.77")).toBe(true);
        expect(lists["RAF-STEER-IH"].some((e) => e.address === "192.168.61.44")).toBe(false);
        expect(state.intents[0].addedIp).toBe("192.168.61.77");
    });

    test("reconcile: entri yatim (intent dihapus) dibersihkan; offline dibiarkan", async () => {
        const lists = {
            "RAF-STEER-MNI": [{ id: "*B", address: "192.168.61.50", disabled: 0, dynamic: 0, comment: "RAF-STEER uid=42 lama" }],
            "RAF-STEER-IH": [{ id: "*C", address: "192.168.61.44", disabled: 0, dynamic: 0, comment: "RAF-STEER uid=7 budi7" }]
        };
        const { deps } = makeDeps({
            lists,
            actives: [], // budi offline → entrinya DIBIARKAN
            intents: [{ userId: 7, pppoe: "budi7", path: "ih", addedIp: "192.168.61.44" }]
        });
        await svc.reconcileOnce(deps);
        expect(lists["RAF-STEER-MNI"]).toHaveLength(0); // yatim dibersihkan
        expect(lists["RAF-STEER-IH"]).toHaveLength(1);  // offline tetap
    });

    test("unsteer: intent hilang → reconcile membersihkan entri", async () => {
        const lists = {
            "RAF-STEER-IH": [{ id: "*C", address: "192.168.61.44", disabled: 0, dynamic: 0, comment: "RAF-STEER uid=7 budi7" }]
        };
        const { deps, state } = makeDeps({
            lists,
            actives: [{ name: "budi7", address: "192.168.61.44" }],
            intents: [{ userId: 7, pppoe: "budi7", path: "ih", addedIp: "192.168.61.44" }]
        });
        const r = await svc.steerCustomer({ userId: 7, path: null }, deps);
        expect(r.ok).toBe(true);
        expect(state.intents).toHaveLength(0);
        expect(lists["RAF-STEER-IH"]).toHaveLength(0);
    });
});

describe("poolEntryAction", () => {
    beforeEach(() => { global.config = baseConfig(); });

    test("allowlist: list di luar poolLists ditolak; add validasi CIDR", async () => {
        const { deps } = makeDeps();
        expect((await svc.poolEntryAction({ action: "toggle", list: "RAF-STEER-IH", id: "*1" }, deps)).error).toContain("tidak diizinkan");
        expect((await svc.poolEntryAction({ action: "add", list: "freedns", address: "bukan-ip" }, deps)).error).toContain("bukan IP/CIDR");
        const ok = await svc.poolEntryAction({ action: "add", list: "freedns", address: "192.168.62.0/24", actor: "admin:raf" }, deps);
        expect(ok.ok).toBe(true);
    });
});

describe("buildSteeringOverview", () => {
    test("join actives × users × lists × route → intended/actual + counts", async () => {
        global.config = baseConfig();
        global.users = [{ id: 7, name: "Budi", pppoe_username: "budi7", subscription: "110k" }];
        const { deps } = makeDeps({
            lists: {
                freedns: [{ id: "*1", address: "192.168.71.0/24", disabled: 0, dynamic: 0, comment: "" }],
                lokaldns: [{ id: "*2", address: "192.168.61.0/24", disabled: 0, dynamic: 0, comment: "" }]
            },
            actives: [
                { name: "budi7", address: "192.168.61.44" },
                { name: "anon", address: "192.168.71.9" }
            ]
        });
        deps.getStatusReport = async () => ({
            route_snapshot: [{ mark: "MNI", gateway: "SF", active: 1, disabled: 0 }]
        });
        const d = await svc.buildSteeringOverview(deps);
        expect(d.ok).toBe(true);
        expect(d.total_online).toBe(2);
        const budi = d.customers.find((c) => c.pppoe === "budi7");
        expect(budi).toMatchObject({ name: "Budi", paket: "110k", intended: "gmdp", actual: "gmdp" });
        const anon = d.customers.find((c) => c.pppoe === "anon");
        expect(anon).toMatchObject({ intended: "mni", actual: "sf", via: "SF" }); // MNI menumpang SF
        expect(d.counts.gmdp).toBe(1);
        expect(d.counts.sf).toBe(1);
    });
});
