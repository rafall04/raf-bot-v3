/**
 * Header Doc
 * Purpose: Uji prober reachability per-layanan per-jalur — probeConnect (TCP/TLS ok/timeout/error,
 *          bind localAddress), probeCycle (resolve→probe semua jalur, dns-fail, simpan), verdict,
 *          alert per-jalur-down, buildServiceReport matriks. net/tls/dns di-inject.
 * Caller: jest.
 * Deps: `../service-reachability-prober`.
 * MainFuncs: —
 * SideEffects: global.config di-restore; state alert di-reset per test.
 */
"use strict";

const { EventEmitter } = require("events");
const prober = require("../service-reachability-prober");

const origConfig = global.config;
afterEach(() => { global.config = origConfig; prober._internal.resetAlertState(); });

function setConfig(over = {}) {
    global.config = {
        nama: "RAF NET",
        serviceMonitor: {
            enabled: true, intervalSeconds: 60, timeoutMs: 6000, tlsCheck: true,
            services: [{ key: "instagram", label: "Instagram", host: "www.instagram.com" }],
            paths: [
                { key: "gmdp", label: "GMDP", srcIp: "172.17.11.2" },
                { key: "mni", label: "MNI", srcIp: "172.17.11.202" }
            ],
            ...over
        }
    };
}

// Socket palsu untuk net/tls: emit event sesuai skenario.
function fakeSocket(scenario) {
    const s = new EventEmitter();
    s.destroy = () => {};
    setImmediate(() => {
        if (scenario === "ok") { s.emit("connect"); setImmediate(() => s.emit("secureConnect")); }
        else if (scenario === "connect-only") { s.emit("connect"); }
        else if (scenario === "error") { s.emit("error", new Error("ECONNREFUSED")); }
        // "hang": tak emit apa-apa → timeout
    });
    return s;
}

describe("probeConnect", () => {
    test("TLS sukses → ok, connect_ms & tls_ms terisi, localAddress diteruskan", async () => {
        let seenLocal = null;
        const tls = { connect: (opts) => { seenLocal = opts.localAddress; return fakeSocket("ok"); } };
        const r = await prober._internal.probeConnect(
            { ip: "1.2.3.4", host: "x", srcIp: "172.17.11.202", timeoutMs: 6000, tlsCheck: true },
            { tls, now: (() => { let t = 0; return () => (t += 10); })() }
        );
        expect(r.ok).toBe(true);
        expect(r.connect_ms).not.toBeNull();
        expect(r.tls_ms).not.toBeNull();
        expect(seenLocal).toBe("172.17.11.202");
    });

    test("error socket → ok:false + error code", async () => {
        const tls = { connect: () => fakeSocket("error") };
        const r = await prober._internal.probeConnect({ ip: "1.2.3.4", host: "x", srcIp: "s", timeoutMs: 6000, tlsCheck: true }, { tls });
        expect(r.ok).toBe(false);
        expect(r.error).toBe("ECONNREFUSED");
    });

    test("hang → timeout (ok:false)", async () => {
        const tls = { connect: () => fakeSocket("hang") };
        const r = await prober._internal.probeConnect({ ip: "1.2.3.4", host: "x", srcIp: "s", timeoutMs: 30, tlsCheck: true }, { tls });
        expect(r.ok).toBe(false);
        expect(r.error).toBe("timeout");
    });

    test("tlsCheck=false → pakai net.connect (TCP saja)", async () => {
        let used = null;
        const net = { connect: () => { used = "net"; return fakeSocket("connect-only"); } };
        const r = await prober._internal.probeConnect({ ip: "1.2.3.4", host: "x", srcIp: "s", timeoutMs: 6000, tlsCheck: false }, { net });
        expect(used).toBe("net");
        expect(r.ok).toBe(true);
        expect(r.tls_ms).toBeNull();
    });
});

describe("probeCycle", () => {
    test("resolve ok → probe semua jalur, simpan baris service×path", async () => {
        setConfig();
        const inserted = [];
        const deps = {
            lookup: (host, opts, cb) => cb(null, "157.240.208.174"),
            tls: { connect: () => fakeSocket("ok") },
            repo: { insertServiceProbes: async (at, rows) => { inserted.push(...rows); return rows.length; } },
            nowIso: "2026-07-07T10:00:00.000Z"
        };
        const r = await prober.probeCycle(deps);
        expect(r.ok).toBe(true);
        expect(inserted).toHaveLength(2); // 1 layanan × 2 jalur
        expect(inserted.every((x) => x.ok)).toBe(true);
        expect(inserted.map((x) => x.path).sort()).toEqual(["gmdp", "mni"]);
        expect(inserted[0].target_ip).toBe("157.240.208.174");
    });

    test("dns gagal → semua jalur layanan itu ok:false error dns-fail", async () => {
        setConfig();
        const inserted = [];
        const deps = {
            lookup: (host, opts, cb) => cb(new Error("ENOTFOUND")),
            tls: { connect: () => { throw new Error("tidak boleh terpanggil"); } },
            repo: { insertServiceProbes: async (at, rows) => { inserted.push(...rows); return rows.length; } }
        };
        const r = await prober.probeCycle(deps);
        expect(r.ok).toBe(true);
        expect(inserted).toHaveLength(2);
        expect(inserted.every((x) => !x.ok && x.error === "dns-fail")).toBe(true);
    });

    test("config tanpa jalur ber-srcIp → ok:false (belum siap)", async () => {
        setConfig({ paths: [{ key: "gmdp", label: "GMDP", srcIp: "" }] });
        const r = await prober.probeCycle({ repo: { insertServiceProbes: async () => 0 } });
        expect(r.ok).toBe(false);
    });
});

describe("verdictFor", () => {
    const t = 6000;
    test("ok-rate 0 → DOWN", () => {
        expect(prober._internal.verdictFor({ samples: 5, ok_count: 0 }, t)).toBe("DOWN");
    });
    test("ok-rate 60% → TERGANGGU", () => {
        expect(prober._internal.verdictFor({ samples: 5, ok_count: 3 }, t)).toBe("TERGANGGU");
    });
    test("sehat TLS cepat → OK", () => {
        expect(prober._internal.verdictFor({ samples: 5, ok_count: 5, tls_avg: 60 }, t)).toBe("OK");
    });
    test("TLS ≥ setengah timeout → LAMBAT", () => {
        expect(prober._internal.verdictFor({ samples: 5, ok_count: 5, tls_avg: 3200 }, t)).toBe("LAMBAT");
    });
});

describe("evaluateAlerts", () => {
    test("jalur MNI gagal ≥2 layanan selama 3 siklus → alert sekali", async () => {
        setConfig({
            services: [{ key: "ig", host: "a" }, { key: "fb", host: "b" }],
            alerts: { enabled: true, consecutiveCycles: 3, minServicesDown: 2, cooldownMinutes: 120, notifyAdmins: true }
        });
        const cfg = prober.getServiceConfig();
        const sent = [];
        const deps = {
            send: async (jid, payload) => { if (typeof payload.text !== "string") throw new Error("payload {text}"); sent.push(jid); return { delivered: true }; },
            getAdminJids: () => ["628@s.whatsapp.net"],
            repo: { addIncident: async () => {} }
        };
        const rowsDown = [
            { service: "ig", path: "mni", ok: false }, { service: "fb", path: "mni", ok: false },
            { service: "ig", path: "gmdp", ok: true }, { service: "fb", path: "gmdp", ok: true }
        ];
        // siklus 1 & 2 → belum alert; siklus 3 → alert.
        await prober._internal.evaluateAlerts(cfg, rowsDown, "2026-07-07T10:00:00Z", deps);
        await prober._internal.evaluateAlerts(cfg, rowsDown, "2026-07-07T10:01:00Z", deps);
        expect(sent).toHaveLength(0);
        await prober._internal.evaluateAlerts(cfg, rowsDown, "2026-07-07T10:02:00Z", deps);
        expect(sent).toHaveLength(1);
        // GMDP sehat → tidak ikut alert
        expect(sent[0]).toBe("628@s.whatsapp.net");
    });
});

describe("buildServiceReport", () => {
    test("matriks layanan×jalur dengan verdict", async () => {
        setConfig();
        const repo = {
            getServiceSummary: async () => [
                { service: "instagram", path: "gmdp", samples: 5, ok_count: 5, connect_avg: 21, tls_avg: 55 },
                { service: "instagram", path: "mni", samples: 5, ok_count: 0, connect_avg: null, tls_avg: null }
            ]
        };
        const report = await prober.buildServiceReport({ config: prober.getServiceConfig(), repo, nowMs: Date.now() });
        const ig = report.services.find((s) => s.key === "instagram");
        const gmdp = ig.cells.find((c) => c.path === "gmdp");
        const mni = ig.cells.find((c) => c.path === "mni");
        expect(gmdp.verdict).toBe("OK");
        expect(gmdp.tls_ms).toBe(55);
        expect(mni.verdict).toBe("DOWN");
    });

    test("verdict RELATIF: jalur ok tapi ≥3× & ≥300ms dari best → LAMBAT (kasus FB via MNI)", async () => {
        setConfig();
        const repo = {
            getServiceSummary: async () => [
                { service: "instagram", path: "gmdp", samples: 5, ok_count: 5, connect_avg: 20, tls_avg: 68 },
                { service: "instagram", path: "mni", samples: 5, ok_count: 5, connect_avg: 200, tls_avg: 711 }
            ]
        };
        const report = await prober.buildServiceReport({ config: prober.getServiceConfig(), repo, nowMs: Date.now() });
        const ig = report.services.find((s) => s.key === "instagram");
        expect(ig.cells.find((c) => c.path === "gmdp").verdict).toBe("OK");
        // 711ms >= max(68*3=204, 300) → LAMBAT walau ok-rate 100%
        expect(ig.cells.find((c) => c.path === "mni").verdict).toBe("LAMBAT");
    });
});
