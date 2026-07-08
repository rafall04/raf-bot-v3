/**
 * Header Doc
 * Purpose: Uji rangkuman data ISP on-demand — resolvePathArg (key + kata label), vonis
 *          keseluruhan (OK / perlu perhatian / sedang bermasalah), overview semua jalur,
 *          rangkuman satu jalur (arah+layanan+rapor+insiden), dan gate monitor nonaktif.
 * Caller: jest.
 * Deps: `../isp-data-summary` (deps di-inject penuh — tanpa SQLite/router nyata).
 * SideEffects: Mutasi global.config di-restore per test.
 */
"use strict";

const summary = require("../isp-data-summary");

const NOW = Date.parse("2026-07-07T13:00:00.000Z");

const CFG = {
    enabled: true,
    statusWindowMinutes: 15,
    thresholds: { lossWarnPct: 5, lossCritPct: 20 },
    paths: [
        { key: "gmdp", label: "GMDP (utama)", affects: "pelanggan reguler" },
        { key: "mni", label: "IH via MNI", routingTable: "MNI", tunnelType: "l2tp", affects: "paket 110k & 125k" }
    ],
    targets: [{ key: "google", label: "Google DNS", address: "8.8.4.4" }]
};

function entryFor(key, { status = "NORMAL", segment = "SEHAT", loss = 0, rtt = 25 } = {}) {
    return {
        key,
        status,
        segment,
        segment_label: segment === "UPSTREAM_ISP" ? "Masalah di sisi ISP (upstream)" : segment,
        targets: [{ target: "8.8.4.4", target_key: "google", samples: 5, loss_avg_pct: loss, rtt_avg_ms: rtt, baseline_rtt_ms: 25 }],
        gateway: { target: "10.9.0.1", samples: 5, loss_avg_pct: 0, rtt_avg_ms: 5 },
        wan: null
    };
}

function makeDeps({ entries, isp24 = [], isp7 = [], incidents = [], alertStates = {} } = {}) {
    return {
        getMonitorConfig: () => CFG,
        buildStatusReport: async () => ({ paths: entries }),
        getRepo: () => ({
            getIspReport: async ({ sinceIso }) => {
                // Jendela 7 hari punya sinceIso lebih tua — bedakan dari selisih waktu.
                const ageMs = NOW - Date.parse(sinceIso);
                return ageMs > 2 * 24 * 60 * 60 * 1000 ? isp7 : isp24;
            },
            getIncidents: async () => incidents
        }),
        getAlertStates: () => alertStates,
        buildDirectionText: () => "\n[ARAH]",
        buildConclusionText: () => "",
        buildServiceSection: async () => "\n[LAYANAN]",
        nowMs: () => NOW
    };
}

const origConfig = global.config;
afterEach(() => { global.config = origConfig; });

describe("resolvePathArg", () => {
    test("key persis, kata label, dan tanpa arg", () => {
        expect(summary.resolvePathArg("data gmdp", CFG)).toBe("gmdp");
        expect(summary.resolvePathArg("/data mni sekarang", CFG)).toBe("mni");
        expect(summary.resolvePathArg("data isp", CFG)).toBe(null);
        expect(summary.resolvePathArg("rapor isp", CFG)).toBe(null);
    });

    test("kata umum pada label tidak salah tangkap ('via'/'utama')", () => {
        expect(summary.resolvePathArg("data utama", CFG)).toBe(null);
        expect(summary.resolvePathArg("data via", CFG)).toBe(null);
    });
});

describe("overallVerdict", () => {
    const v = summary._internal.overallVerdict;
    test("status kini buruk → SEDANG BERMASALAH", () => {
        expect(v({ status: "GANGGUAN", isp24: { sick_pct: 5, availability_pct: 99.9 } }).ok).toBe(false);
    });
    test("sakit ≥30% dlm 24 jam → perlu perhatian walau kini normal", () => {
        const r = v({ status: "NORMAL", isp24: { sick_pct: 70, availability_pct: 97.4 } });
        expect(r.ok).toBe(false);
        expect(r.text).toContain("70");
    });
    test("sehat → OK dgn angka availability", () => {
        const r = v({ status: "NORMAL", isp24: { sick_pct: 2, availability_pct: 99.6 } });
        expect(r.ok).toBe(true);
        expect(r.text).toContain("99.6");
    });
});

test("overview: semua jalur + vonis global + jalur sakit ditandai", async () => {
    const deps = makeDeps({
        entries: [
            entryFor("gmdp", { status: "NORMAL", loss: 0.5, rtt: 25 }),
            entryFor("mni", { status: "GANGGUAN", segment: "UPSTREAM_ISP", loss: 45, rtt: 90 })
        ],
        isp24: [
            { path: "gmdp", availability_pct: 99.6, loss_avg: 0.8, rtt_avg: 25, sick_pct: 1, flaps: 0 },
            { path: "mni", availability_pct: 97.4, loss_avg: 25.9, rtt_avg: 80, sick_pct: 70, flaps: 3 }
        ],
        alertStates: { mni: { condition: "SICK", sickSince: NOW - 30 * 60 * 1000, lastLevel: "GANGGUAN" } }
    });
    const teks = await summary.buildIspOverview(deps);
    expect(teks).toContain("ADA YANG PERLU PERHATIAN");
    expect(teks).toContain("🟢 *GMDP (utama)* — ✅ OK");
    expect(teks).toContain("🔴 *IH via MNI* — 🔴 SEDANG BERMASALAH");
    expect(teks).toContain("gangguan berjalan sejak");
    expect(teks).toContain("avail 97.4%");
    expect(teks).toContain("data gmdp");
});

test("rangkuman satu jalur: vonis + arah + layanan + rapor 24j/7h + insiden", async () => {
    const deps = makeDeps({
        entries: [entryFor("mni", { status: "GANGGUAN", segment: "UPSTREAM_ISP", loss: 45, rtt: 90 })],
        isp24: [{ path: "mni", availability_pct: 97.4, loss_avg: 25.9, rtt_avg: 80, sick_pct: 70, flaps: 3 }],
        isp7: [{ path: "mni", availability_pct: 98.8, loss_avg: 9.1, rtt_avg: 75, sick_pct: 22, flaps: 9 }],
        incidents: [
            { path: "mni", kind: "alert", created_at: new Date(NOW - 40 * 60 * 1000).toISOString(), detail: JSON.stringify({ level: "GANGGUAN" }) },
            { path: "gmdp", kind: "alert", created_at: new Date(NOW - 39 * 60 * 1000).toISOString(), detail: null },
            { path: "mni", kind: "trace", created_at: new Date(NOW - 38 * 60 * 1000).toISOString(), detail: null }
        ],
        alertStates: { mni: { condition: "SICK", sickSince: NOW - 40 * 60 * 1000, lastLevel: "GANGGUAN" } }
    });
    const teks = await summary.buildIspDataSummary("mni", deps);
    expect(teks).toContain("DATA JALUR IH VIA MNI");
    expect(teks).toContain("tunnel L2TP");
    expect(teks).toContain("Keseluruhan: 🔴 SEDANG BERMASALAH");
    expect(teks).toContain("Alert berjalan: *GANGGUAN* sejak");
    expect(teks).toContain("━━ *KONDISI SEKARANG* ━━");
    expect(teks).toContain("[ARAH]");
    expect(teks).toContain("[LAYANAN]");
    expect(teks).toContain("━━ *24 JAM TERAKHIR* ━━");
    expect(teks).toContain("avail *97.4%*");
    expect(teks).toContain("━━ *7 HARI* ━━");
    expect(teks).toContain("avail *98.8%*");
    // Alert 40 mnt lalu tanpa pulih + state SICK → downtime berjalan terhitung.
    expect(teks).toContain("Gangguan tercatat 24 jam: *1×*");
    expect(teks).toContain("SEDANG BERJALAN");
    expect(teks).toContain("🚨 alert gangguan (GANGGUAN)");
    expect(teks).toContain("🔎 traceroute");
    expect(teks).not.toContain("gmdp — 🚨"); // insiden jalur lain tak ikut
});

describe("helper murni detail", () => {
    test("sparkChar: skala absolut + tanpa data", () => {
        const c = summary._internal.sparkChar;
        expect(c(null)).toBe("·");
        expect(c(0)).toBe("▁");
        expect(c(2)).toBe("▂");
        expect(c(4)).toBe("▃");
        expect(c(7)).toBe("▄");
        expect(c(15)).toBe("▅");
        expect(c(25)).toBe("▆");
        expect(c(40)).toBe("▇");
        expect(c(80)).toBe("█");
    });

    test("buildHourlyBuckets: bucket per jam, gateway di-skip, worst ketemu", () => {
        const rows = [
            { path: "mni", probed_at: new Date(NOW - 30 * 60 * 1000).toISOString(), target_key: "google", loss_pct: 60 },
            { path: "mni", probed_at: new Date(NOW - 30 * 60 * 1000).toISOString(), target_key: "gateway", loss_pct: 0 },
            { path: "mni", probed_at: new Date(NOW - 2 * 60 * 60 * 1000 + 5 * 60 * 1000).toISOString(), target_key: "google", loss_pct: 0 }
        ];
        const { buckets, worst } = summary._internal.buildHourlyBuckets(rows, NOW, 24);
        expect(buckets).toHaveLength(24);
        expect(summary._internal.sparkline(buckets)).toHaveLength(24);
        expect(buckets[23].lossAvg).toBe(60); // gateway 0% TIDAK mendilusi (di-skip)
        expect(buckets[22].lossAvg).toBe(0);
        expect(buckets[0].lossAvg).toBe(null);
        expect(worst.lossAvg).toBe(60);
    });

    test("computeDowntime: pasangan alert→pulih + clip jendela + gangguan berjalan", () => {
        const cd = summary._internal.computeDowntime;
        const H = 60 * 60 * 1000;
        const incidents = [
            { path: "mni", kind: "alert", created_at: new Date(NOW - 30 * H).toISOString() },
            { path: "mni", kind: "alert_recovered", created_at: new Date(NOW - 23 * H).toISOString() },
            { path: "mni", kind: "alert", created_at: new Date(NOW - 5 * H).toISOString() },
            { path: "mni", kind: "alert_recovered", created_at: new Date(NOW - 4 * H).toISOString() },
            { path: "gmdp", kind: "alert", created_at: new Date(NOW - 3 * H).toISOString() }
        ];
        // Jendela 24 jam: pasangan pertama di-clip (mulai 30 jam lalu → dihitung dari batas 24 jam = 1 jam),
        // pasangan kedua utuh 1 jam; alert gmdp bukan jalur ini.
        const dt = cd({ incidents, pathKey: "mni", sinceMs: NOW - 24 * H, nowMs: NOW, sickNow: false });
        expect(dt.count).toBe(2);
        expect(Math.round(dt.totalMs / H)).toBe(2);
        expect(dt.ongoingMs).toBe(null);
        // Gangguan berjalan: alert tanpa pulih + state SICK.
        const dt2 = cd({
            incidents: [{ path: "mni", kind: "alert", created_at: new Date(NOW - 2 * H).toISOString() }],
            pathKey: "mni", sinceMs: NOW - 24 * H, nowMs: NOW, sickNow: true
        });
        expect(dt2.count).toBe(1);
        expect(Math.round(dt2.ongoingMs / H)).toBe(2);
        // Alert tanpa pulih TAPI state sudah sehat (notif pulih hilang) → tidak dihitung berjalan.
        const dt3 = cd({
            incidents: [{ path: "mni", kind: "alert", created_at: new Date(NOW - 2 * H).toISOString() }],
            pathKey: "mni", sinceMs: NOW - 24 * H, nowMs: NOW, sickNow: false
        });
        expect(dt3.count).toBe(0);
    });

    test("aggregateDirections: rata/puncak/jitter per target + gateway terpisah", () => {
        const rows = [
            { path: "mni", target: "8.8.4.4", target_key: "google", loss_pct: 40, rtt_avg_ms: 90, jitter_ms: 12 },
            { path: "mni", target: "8.8.4.4", target_key: "google", loss_pct: 60, rtt_avg_ms: 110, jitter_ms: 20 },
            { path: "mni", target: "10.9.0.1", target_key: "gateway", loss_pct: 1, rtt_avg_ms: 30, jitter_ms: 2 },
            { path: "sf", target: "8.8.4.4", target_key: "google", loss_pct: 99 }
        ];
        const dir = summary._internal.aggregateDirections(rows, "mni");
        expect(dir.far).toHaveLength(1);
        expect(dir.far[0].loss.avg).toBe(50);
        expect(dir.far[0].loss.max).toBe(60);
        expect(dir.far[0].jitter.avg).toBe(16);
        expect(dir.gw.loss.avg).toBe(1);
    });
});

test("rangkuman kaya: route+failover, trafik, sparkline, arah 24 jam, layanan 24 jam, engine, komplain", async () => {
    const origConfig = global.config;
    global.config = {
        serviceMonitor: { enabled: true },
        wanFailover: { rules: [{ sickPath: "mni", targetPath: "sf", switchId: "mni-to-sf" }] }
    };
    try {
        const H = 60 * 60 * 1000;
        const probeRows = [];
        for (let i = 0; i < 6; i += 1) {
            probeRows.push({ path: "mni", probed_at: new Date(NOW - i * H - 10 * 60 * 1000).toISOString(), target: "8.8.4.4", target_key: "google", loss_pct: i === 0 ? 55 : 2, rtt_avg_ms: 80, jitter_ms: 9 });
            probeRows.push({ path: "mni", probed_at: new Date(NOW - i * H - 10 * 60 * 1000).toISOString(), target: "10.9.0.1", target_key: "gateway", loss_pct: 0, rtt_avg_ms: 30, jitter_ms: 1 });
        }
        const deps = {
            ...makeDeps({
                entries: [{
                    ...entryFor("mni", { status: "NORMAL" }),
                    wan: { rx_mbps: 41.2, tx_mbps: 8.3, util_down_max_pct: 41, util_up_max_pct: 12, errors: 0, drops: 0, flaps_24h: 1 }
                }],
                isp24: [{ path: "mni", availability_pct: 98.5, loss_avg: 10.6, rtt_avg: 68, sick_pct: 28, flaps: 3 }]
            }),
            buildStatusReport: async () => ({
                paths: [{
                    ...entryFor("mni", { status: "NORMAL" }),
                    wan: { rx_mbps: 41.2, tx_mbps: 8.3, util_down_max_pct: 41, util_up_max_pct: 12 }
                }],
                failover: { MNI: { failover: true, primary_gateway: "Tunnel-MNI", backup_gateway: "SF", primary_active: false, backup_active: true } },
                route_snapshot: [
                    { mark: "MNI", gateway: "Tunnel-MNI", distance: 1, active: 0, disabled: 1 },
                    { mark: "MNI", gateway: "SF", distance: 2, active: 1, disabled: 0 }
                ]
            }),
            getFailoverStates: () => ({ "mni-to-sf": { phase: "APPLIED", appliedByAuto: true, lockedUntilMs: 0 } }),
            getComplaintSignals: () => ([
                { path: "mni", userId: "1", atMs: NOW - 10 * 60 * 1000 },
                { path: "mni", userId: "2", atMs: NOW - 20 * 60 * 1000 },
                { path: "gmdp", userId: "3", atMs: NOW - 5 * 60 * 1000 }
            ])
        };
        // Repo kaya: probe 24 jam + wan history + service summary.
        const baseRepo = deps.getRepo();
        deps.getRepo = () => ({
            ...baseRepo,
            getRecentProbes: async () => probeRows,
            getWanHistory: async () => ([
                { sampled_at: new Date(NOW - 60 * 1000).toISOString(), rx_bps: 52_400_000, tx_bps: 9_100_000, rx_error_d: 0, tx_error_d: 0, rx_drop_d: 2, tx_drop_d: 0, flap: 0, tunnel_uptime_s: 7300 },
                { sampled_at: new Date(NOW - 2 * 60 * 1000).toISOString(), rx_bps: 30_000_000, tx_bps: 5_000_000, rx_error_d: 1, tx_error_d: 0, rx_drop_d: 0, tx_drop_d: 0, flap: 1, tunnel_uptime_s: 7240 }
            ]),
            getServiceSummary: async () => ([
                { service: "instagram", path: "mni", samples: 100, ok_count: 93, connect_avg: 100, tls_avg: 200 },
                { service: "tiktok", path: "mni", samples: 100, ok_count: 100, connect_avg: 150, tls_avg: 620 },
                { service: "google", path: "mni", samples: 100, ok_count: 100, connect_avg: 50, tls_avg: 90 },
                { service: "google", path: "gmdp", samples: 100, ok_count: 50, connect_avg: 50, tls_avg: 90 }
            ])
        });
        const teks = await summary.buildIspDataSummary("mni", deps);
        expect(teks).toContain("Route aktif (MNI): *SF* — ⚠️ BACKUP AKTIF (primary Tunnel-MNI tidak jalan)");
        expect(teks).toContain("1 route dinonaktifkan");
        expect(teks).toContain("Trafik (15 mnt): ↓41.2 Mbps / ↑8.3 Mbps • util ↓41%/↑12%");
        expect(teks).toContain("Link 24 jam: puncak ↓52.4 Mbps / ↑9.1 Mbps • error 1 • drop 2 • flap 1×");
        expect(teks).toContain("Tunnel uptime: 2 jam 2 mnt");
        expect(teks).toContain("Pola loss per jam");
        expect(teks).toContain("█"); // jam dgn loss 55% → blok penuh
        expect(teks).toContain("terburuk:");
        expect(teks).toContain("Per arah 24 jam:");
        expect(teks).toContain("→ Google DNS (8.8.4.4)"); // label target, bukan key mentah
        expect(teks).toContain("jitter 9ms");
        expect(teks).toContain("→ gateway (10.9.0.1)");
        expect(teks).toContain("Layanan 24 jam bermasalah: Instagram ok 93.0% • TikTok TLS rata 620ms");
        expect(teks).toContain("Auto-failover: switch *mni-to-sf* sedang DITERAPKAN (oleh bot)");
        expect(teks).toContain("Komplain pelanggan jalur ini (60 mnt): *2 pelanggan*");
    } finally {
        global.config = origConfig;
    }
});

test("jalur tak dikenal & monitor nonaktif → pesan informatif, tidak throw", async () => {
    const deps = makeDeps({ entries: [] });
    const salah = await summary.buildIspDataSummary("xyz", deps);
    expect(salah).toContain("tidak dikenal");
    expect(salah).toContain("gmdp");

    const depsOff = { ...deps, getMonitorConfig: () => ({ enabled: false, paths: [] }) };
    expect(await summary.buildIspOverview(depsOff)).toContain("belum aktif");
    expect(await summary.buildIspDataSummary("gmdp", depsOff)).toContain("belum aktif");
});
