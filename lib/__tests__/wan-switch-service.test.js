/**
 * Header Doc
 * Purpose: Uji service switch koneksi WAN — buildOps (apply/restore), isApplied, allowlist,
 *          gate enabled, plan-verify abort (topology drift), apply sukses + notify/audit,
 *          normalizeRecipients. Bridge & WA di-inject (tanpa router/WA nyata).
 * Caller: jest.
 * Deps: `../wan-switch-service`.
 * MainFuncs: —
 * SideEffects: Mutasi global.config di-restore per test.
 */
"use strict";

const svc = require("../wan-switch-service");

const SWITCHES = [
    {
        id: "mni-to-sf",
        label: "MNI → SF",
        affects: "Paket 110k & 125k",
        operations: [{ match: { routingMark: "MNI", gateway: "Tunnel-MNI" }, apply: "disable" }]
    },
    {
        id: "main-to-ih",
        label: "GMDP → IH",
        operations: [
            { match: { table: "main", gateway: "1.1.1.1", comment: "MAIN" }, apply: "disable" },
            { match: { table: "main", gateway: "192.168.102.1" }, apply: "enable" }
        ]
    }
];

function setConfig(over = {}) {
    global.config = {
        nama: "RAF NET",
        upstreamMonitor: { host: "10.0.0.1", port: 8799, user: "u", password: "p" },
        wanSwitch: { enabled: true, switches: SWITCHES, recipients: [], ...over }
    };
}

const origConfig = global.config;
afterEach(() => { global.config = origConfig; });

describe("buildOps", () => {
    beforeEach(setConfig);
    test("apply: op 'disable' → disabled true; op 'enable' → disabled false", () => {
        const ops = svc._internal.buildOps(SWITCHES[1], "apply");
        expect(ops[0].disabled).toBe(true);
        expect(ops[1].disabled).toBe(false);
    });
    test("restore membalik keduanya", () => {
        const ops = svc._internal.buildOps(SWITCHES[1], "restore");
        expect(ops[0].disabled).toBe(false);
        expect(ops[1].disabled).toBe(true);
    });
});

describe("normalizeRecipients", () => {
    test("08x → 62 JID, JID lolos, sampah dibuang", () => {
        expect(svc._internal.normalizeRecipients(["085233047094", "628@s.whatsapp.net", "x"]))
            .toEqual(["6285233047094@s.whatsapp.net", "628@s.whatsapp.net"]);
    });
});

describe("getStatus", () => {
    test("fitur nonaktif → enabled:false tanpa panggil bridge", async () => {
        setConfig({ enabled: false });
        const runBridge = jest.fn();
        const st = await svc.getStatus({ runBridge });
        expect(st.enabled).toBe(false);
        expect(runBridge).not.toHaveBeenCalled();
    });

    test("applied terdeteksi bila route sudah pada kondisi target", async () => {
        setConfig();
        const runBridge = async ({ ops }) => ({
            status: "success",
            data: {
                operations: ops.map((o) => ({
                    match: o.match,
                    matched: [{ gateway: "Tunnel-MNI", routing_mark: "MNI", disabled: o.disabled ? 1 : 0, active: 0 }],
                    matched_count: 1
                }))
            }
        });
        const st = await svc.getStatus({ runBridge });
        // Semua matched.disabled == desired → applied true.
        expect(st.switches[0].applied).toBe(true);
    });
});

describe("applySwitch — guard", () => {
    test("fitur nonaktif → ok:false", async () => {
        setConfig({ enabled: false });
        const r = await svc.applySwitch("mni-to-sf", "apply", null, { runBridge: jest.fn() });
        expect(r.ok).toBe(false);
    });

    test("id tak dikenal (allowlist) → ok:false, tak menulis", async () => {
        setConfig();
        const runBridge = jest.fn();
        const r = await svc.applySwitch("hapus-semua-route", "apply", null, { runBridge });
        expect(r.ok).toBe(false);
        expect(runBridge).not.toHaveBeenCalled();
    });

    test("plan menemukan 0 route → ABORT, tidak pernah apply (anti topology-drift)", async () => {
        setConfig();
        const calls = [];
        const runBridge = async (spec) => {
            calls.push(spec.mode);
            if (spec.mode === "plan") {
                return { status: "success", data: { operations: [{ match: {}, matched: [], matched_count: 0 }] } };
            }
            return { status: "success", data: { applied: [], routes_after: [] } };
        };
        const r = await svc.applySwitch("mni-to-sf", "apply", null, { runBridge });
        expect(r.ok).toBe(false);
        expect(calls).toContain("plan");
        expect(calls).not.toContain("apply"); // apply TIDAK pernah dipanggil
    });
});

describe("applySwitch — sukses", () => {
    beforeEach(setConfig);

    test("plan ok → apply → notify admin + audit incident", async () => {
        const sent = [];
        const incidents = [];
        const runBridge = async (spec) => {
            if (spec.mode === "plan") {
                return { status: "success", data: { operations: [{ match: {}, matched: [{ gateway: "Tunnel-MNI", disabled: 0 }], matched_count: 1 }] } };
            }
            // apply
            return {
                status: "success",
                data: {
                    applied: [{ before: { gateway: "Tunnel-MNI", disabled: 0 }, set_disabled: 1, error: null }],
                    routes_after: [
                        { gateway: "Tunnel-MNI", routing_mark: "MNI", active: 0, disabled: 1 },
                        { gateway: "SF", routing_mark: "MNI", active: 1, disabled: 0 }
                    ]
                }
            };
        };
        const deps = {
            runBridge,
            send: async (jid, payload) => {
                if (typeof payload !== "object" || typeof payload.text !== "string") throw new Error("payload wajib {text}");
                sent.push({ jid, text: payload.text });
                return { delivered: true };
            },
            getAdminJids: () => ["6285233047094@s.whatsapp.net"],
            repo: { addIncident: async (i) => incidents.push(i) }
        };
        const r = await svc.applySwitch("mni-to-sf", "apply", { label: "admin:raf" }, deps);
        expect(r.ok).toBe(true);
        expect(r.summary).toContain("SF"); // MNI kini aktif via SF
        expect(sent).toHaveLength(1);
        expect(sent[0].jid).toBe("6285233047094@s.whatsapp.net");
        expect(incidents).toHaveLength(1);
        expect(incidents[0].kind).toBe("switch");
    });

    test("router menolak set (error per-route) → ok:false", async () => {
        const runBridge = async (spec) => {
            if (spec.mode === "plan") return { status: "success", data: { operations: [{ matched: [{}], matched_count: 1 }] } };
            return { status: "success", data: { applied: [{ error: "no such item" }], routes_after: [] } };
        };
        const r = await svc.applySwitch("mni-to-sf", "apply", null, { runBridge });
        expect(r.ok).toBe(false);
        expect(r.message).toContain("menolak");
    });
});
