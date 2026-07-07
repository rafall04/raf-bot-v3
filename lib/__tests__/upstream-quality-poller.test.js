/**
 * Header Doc
 * Purpose: Uji poller kualitas jalur upstream — gate config, siklus pollOnce (bridge mock),
 *          logika vonis per target, deteksi failover MNI→SF, dan perakitan laporan status.
 * Caller: jest.
 * Deps: `../upstream-quality-poller`.
 * MainFuncs: —
 * SideEffects: Mutasi global.config di-restore per test; tidak spawn php (bridge di-mock).
 */
"use strict";

const poller = require("../upstream-quality-poller");
const { _internal } = poller;

const VALID_CFG = {
    enabled: true,
    host: "172.17.11.1",
    port: 8799,
    user: "claude",
    password: "rahasia",
    intervalMs: 60000,
    pingCount: 5,
    pingIntervalSeconds: 0.3,
    connectTimeoutSeconds: 8,
    statusWindowMinutes: 15,
    baselineHours: 24,
    retentionDays: 30,
    thresholds: _internal.DEFAULT_THRESHOLDS,
    paths: _internal.DEFAULT_PATHS,
    targets: _internal.DEFAULT_TARGETS,
    valid: true
};

function makeFakeRepo() {
    const calls = { probes: [], routes: [] };
    return {
        calls,
        insertProbes: async (at, rows) => { calls.probes.push({ at, rows }); return rows.length; },
        insertRouteStates: async (at, rows) => { calls.routes.push({ at, rows }); return rows.length; },
        getSummary: async () => [],
        getLatestRouteStates: async () => []
    };
}

describe("getMonitorConfig — gate & default", () => {
    const originalConfig = global.config;
    afterEach(() => { global.config = originalConfig; });

    test("tanpa config → disabled + tidak valid", () => {
        global.config = {};
        const cfg = poller.getMonitorConfig();
        expect(cfg.enabled).toBe(false);
        expect(cfg.valid).toBe(false);
        expect(cfg.paths).toHaveLength(4);
    });

    test("config lengkap → valid + interval di-clamp minimal 30 dtk", () => {
        global.config = {
            upstreamMonitor: {
                enabled: true, host: "10.0.0.1", user: "u", password: "p", intervalSeconds: 5
            }
        };
        const cfg = poller.getMonitorConfig();
        expect(cfg.enabled).toBe(true);
        expect(cfg.valid).toBe(true);
        expect(cfg.intervalMs).toBe(60000); // 5 dtk < minimum → fallback default 60 dtk
    });
});

describe("pollOnce", () => {
    test("sukses: baris probe & route tersimpan, stats terisi", async () => {
        const repo = makeFakeRepo();
        const envelope = {
            status: "success",
            data: {
                probes: [{ path: "mni", target: "8.8.4.4", sent: 5, received: 5, loss_pct: 0, rtt_avg_ms: 68 }],
                routes: [{ mark: "MNI", gateway: "Tunnel-MNI", distance: 1, active: 1, disabled: 0 }]
            }
        };
        const result = await poller.pollOnce({
            config: VALID_CFG,
            repo,
            runBridge: async () => envelope,
            nowIso: "2026-07-07T10:00:00.000Z"
        });
        expect(result.ok).toBe(true);
        expect(repo.calls.probes).toHaveLength(1);
        expect(repo.calls.probes[0].at).toBe("2026-07-07T10:00:00.000Z");
        expect(repo.calls.routes[0].rows[0].mark).toBe("MNI");
    });

    test("bridge gagal → ok:false tanpa throw, tidak ada tulis", async () => {
        const repo = makeFakeRepo();
        const result = await poller.pollOnce({
            config: VALID_CFG,
            repo,
            runBridge: async () => ({ status: "error", message: "CONNECT_ERROR" })
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain("CONNECT_ERROR");
        expect(repo.calls.probes).toHaveLength(0);
    });

    test("config tidak valid → ok:false", async () => {
        const result = await poller.pollOnce({
            config: { ...VALID_CFG, valid: false },
            repo: makeFakeRepo(),
            runBridge: async () => { throw new Error("tidak boleh terpanggil"); }
        });
        expect(result.ok).toBe(false);
    });
});

describe("verdictForTarget", () => {
    const t = _internal.DEFAULT_THRESHOLDS;
    const row = (over = {}) => ({ samples: 5, loss_avg: 0, rtt_avg: 30, baseline: { rtt_avg: 30 }, ...over });

    test("sampel kurang → UNKNOWN", () => {
        expect(_internal.verdictForTarget(row({ samples: 1 }), t)).toBe("UNKNOWN");
    });
    test("loss total → PUTUS", () => {
        expect(_internal.verdictForTarget(row({ loss_avg: 100 }), t)).toBe("PUTUS");
    });
    test("loss berat → GANGGUAN", () => {
        expect(_internal.verdictForTarget(row({ loss_avg: 25 }), t)).toBe("GANGGUAN");
    });
    test("RTT meledak vs baseline → GANGGUAN", () => {
        expect(_internal.verdictForTarget(row({ rtt_avg: 90 }), t)).toBe("GANGGUAN"); // 3× baseline
    });
    test("loss ringan → DEGRADASI", () => {
        expect(_internal.verdictForTarget(row({ loss_avg: 7 }), t)).toBe("DEGRADASI");
    });
    test("RTT naik moderat → DEGRADASI", () => {
        expect(_internal.verdictForTarget(row({ rtt_avg: 55 }), t)).toBe("DEGRADASI"); // 1.8× baseline
    });
    test("sehat → NORMAL", () => {
        expect(_internal.verdictForTarget(row(), t)).toBe("NORMAL");
    });
    test("tanpa baseline → faktor RTT dilewati, tetap NORMAL", () => {
        expect(_internal.verdictForTarget(row({ baseline: null, rtt_avg: 500 }), t)).toBe("NORMAL");
    });
});

describe("detectFailover", () => {
    test("MNI primary mati + backup SF aktif → failover true", () => {
        const result = _internal.detectFailover([
            { mark: "MNI", gateway: "Tunnel-MNI", distance: 1, active: 0, disabled: 0 },
            { mark: "MNI", gateway: "SF", distance: 2, active: 1, disabled: 0 }
        ]);
        expect(result.MNI.failover).toBe(true);
        expect(result.MNI.backup_gateway).toBe("SF");
    });

    test("primary sehat → failover false; mark satu-route dilewati", () => {
        const result = _internal.detectFailover([
            { mark: "MNI", gateway: "Tunnel-MNI", distance: 1, active: 1, disabled: 0 },
            { mark: "MNI", gateway: "SF", distance: 2, active: 0, disabled: 0 },
            { mark: "SF-PROBE", gateway: "SF", distance: 1, active: 1, disabled: 0 }
        ]);
        expect(result.MNI.failover).toBe(false);
        expect(result["SF-PROBE"]).toBeUndefined();
    });
});

describe("buildStatusReport", () => {
    test("merakit status per jalur (worst-of-targets) + failover", async () => {
        const repo = {
            getSummary: async () => [
                { path: "mni", target: "8.8.4.4", target_key: "google", samples: 5, loss_avg: 30, rtt_avg: 90, jitter_avg: 5, last_probed_at: "x", baseline: { rtt_avg: 68 } },
                { path: "mni", target: "1.0.0.1", target_key: "cloudflare", samples: 5, loss_avg: 0, rtt_avg: 70, jitter_avg: 3, last_probed_at: "x", baseline: { rtt_avg: 68 } },
                { path: "gmdp", target: "8.8.4.4", target_key: "google", samples: 5, loss_avg: 0, rtt_avg: 25, jitter_avg: 1, last_probed_at: "x", baseline: { rtt_avg: 24 } }
            ],
            getLatestRouteStates: async () => [
                { mark: "MNI", gateway: "Tunnel-MNI", distance: 1, active: 0, disabled: 0 },
                { mark: "MNI", gateway: "SF", distance: 2, active: 1, disabled: 0 }
            ]
        };
        const report = await poller.buildStatusReport({ config: VALID_CFG, repo, nowMs: Date.now() });

        const mni = report.paths.find((p) => p.key === "mni");
        expect(mni.status).toBe("GANGGUAN"); // target google loss 30% menang atas cloudflare NORMAL
        const gmdp = report.paths.find((p) => p.key === "gmdp");
        expect(gmdp.status).toBe("NORMAL");
        const sf = report.paths.find((p) => p.key === "sf");
        expect(sf.status).toBe("UNKNOWN"); // belum ada sampel
        expect(report.failover.MNI.failover).toBe(true);
    });
});

describe("start gate", () => {
    const originalConfig = global.config;
    afterEach(() => {
        poller.stopUpstreamQualityPoller();
        global.config = originalConfig;
    });

    test("disabled → poller tidak jalan", () => {
        global.config = { upstreamMonitor: { enabled: false } };
        poller.startUpstreamQualityPoller();
        expect(poller.getPollerStats().is_running).toBe(false);
    });

    test("enabled tapi kredensial kosong → poller tidak jalan", () => {
        global.config = { upstreamMonitor: { enabled: true } };
        poller.startUpstreamQualityPoller();
        expect(poller.getPollerStats().is_running).toBe(false);
    });
});
