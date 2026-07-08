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
        { key: "mni", label: "IH via MNI", tunnelType: "l2tp", affects: "paket 110k & 125k" }
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
    expect(teks).toContain("SEDANG GANGGUAN* sejak");
    expect(teks).toContain("[ARAH]");
    expect(teks).toContain("[LAYANAN]");
    expect(teks).toContain("24 jam: avail *97.4%*");
    expect(teks).toContain("7 hari: avail *98.8%*");
    expect(teks).toContain("🚨 alert gangguan (GANGGUAN)");
    expect(teks).toContain("🔎 traceroute");
    expect(teks).not.toContain("gmdp — 🚨"); // insiden jalur lain tak ikut
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
