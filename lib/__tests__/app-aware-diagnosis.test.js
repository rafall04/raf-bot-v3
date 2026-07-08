/**
 * Header Doc
 * Purpose: Uji diagnosa app-aware — jawaban spesifik dari sel matriks reachability (app lambat/
 *          down/normal + pembanding jalur tersehat), fallback kualitas jalur utk game (tanpa
 *          probe), gate fitur mati, dan best-effort (tanpa data → "").
 * Caller: jest.
 * Deps: `../app-aware-diagnosis` (report/render di-inject).
 * SideEffects: Mutasi global.config di-restore per test.
 */
"use strict";

const { buildAppDiagnosis } = require("../app-aware-diagnosis");

const ADDR_MNI = "192.168.61.10"; // pool mni (lihat upstream-path-resolver default)

function svcReport(cells) {
    return {
        paths: [{ key: "mni", label: "IH via MNI" }, { key: "gmdp", label: "GMDP (utama)" }],
        services: [{ key: "tiktok", label: "TikTok", host: "www.tiktok.com", cells }]
    };
}

const origConfig = global.config;
beforeEach(() => {
    global.config = {
        upstreamMonitor: { enabled: true },
        serviceMonitor: { enabled: true }
    };
});
afterEach(() => { global.config = origConfig; });

const render = (key, fallback) => `[${key}] ${fallback}`;

test("app LAMBAT di jalur pelanggan → jawaban spesifik + pembanding jalur sehat", async () => {
    const deps = {
        renderResponseTemplate: render,
        getServiceReport: async () => svcReport([
            { path: "mni", samples: 5, ok_pct: 100, tls_ms: 640, verdict: "LAMBAT" },
            { path: "gmdp", samples: 5, ok_pct: 100, tls_ms: 78, verdict: "OK" }
        ])
    };
    const teks = await buildAppDiagnosis({ addr: ADDR_MNI, appEntity: { key: "tiktok", serviceKey: "tiktok", label: "TikTok", kind: "video" } }, deps);
    expect(teks).toContain("conncheck_app_issue");
    expect(teks).toContain("TikTok");
    expect(teks).toContain("IH via MNI");
    expect(teks).toContain("640ms");
    expect(teks).toContain("78ms"); // pembanding jalur sehat
});

test("app DOWN → 'sulit diakses'", async () => {
    const deps = {
        renderResponseTemplate: render,
        getServiceReport: async () => svcReport([{ path: "mni", samples: 5, ok_pct: 0, tls_ms: null, verdict: "DOWN" }])
    };
    const teks = await buildAppDiagnosis({ addr: ADDR_MNI, appEntity: { key: "tiktok", serviceKey: "tiktok", label: "TikTok", kind: "video" } }, deps);
    expect(teks).toContain("conncheck_app_issue");
});

test("app NORMAL di jalur pelanggan → arahkan ke perangkat", async () => {
    const deps = {
        renderResponseTemplate: render,
        getServiceReport: async () => svcReport([{ path: "mni", samples: 5, ok_pct: 100, tls_ms: 90, verdict: "OK" }])
    };
    const teks = await buildAppDiagnosis({ addr: ADDR_MNI, appEntity: { key: "tiktok", serviceKey: "tiktok", label: "TikTok", kind: "video" } }, deps);
    expect(teks).toContain("conncheck_app_ok");
    expect(teks).toContain("90ms");
});

test("game (serviceKey null): jalur terganggu → jawaban via loss/RTT jalur", async () => {
    const deps = {
        renderResponseTemplate: render,
        getStatusReport: async () => ({
            paths: [{
                key: "mni", label: "IH via MNI", status: "GANGGUAN",
                targets: [{ target: "8.8.4.4", target_key: "google", samples: 5, loss_avg_pct: 45, rtt_avg_ms: 90 }]
            }]
        })
    };
    const teks = await buildAppDiagnosis({ addr: ADDR_MNI, appEntity: { key: "game", serviceKey: null, label: "game online", kind: "game" } }, deps);
    expect(teks).toContain("conncheck_app_path_issue");
    expect(teks).toContain("game online");
    expect(teks).toContain("45");
});

test("game: jalur stabil → arahkan ke perangkat/WiFi", async () => {
    const deps = {
        renderResponseTemplate: render,
        getStatusReport: async () => ({
            paths: [{
                key: "mni", label: "IH via MNI", status: "NORMAL",
                targets: [{ target: "8.8.4.4", target_key: "google", samples: 5, loss_avg_pct: 0, rtt_avg_ms: 40 }]
            }]
        })
    };
    const teks = await buildAppDiagnosis({ addr: ADDR_MNI, appEntity: { key: "game", serviceKey: null, label: "game online", kind: "game" } }, deps);
    expect(teks).toContain("conncheck_app_path_ok");
});

test("gate: serviceMonitor mati + app punya serviceKey → jatuh ke status jalur (best-effort)", async () => {
    global.config = { upstreamMonitor: { enabled: true }, serviceMonitor: { enabled: false } };
    const deps = {
        renderResponseTemplate: render,
        getServiceReport: async () => { throw new Error("tidak dipanggil idealnya"); },
        getStatusReport: async () => ({ paths: [{ key: "mni", label: "IH via MNI", status: "NORMAL", targets: [] }] })
    };
    const teks = await buildAppDiagnosis({ addr: ADDR_MNI, appEntity: { key: "tiktok", serviceKey: "tiktok", label: "TikTok", kind: "video" } }, deps);
    expect(teks).toContain("conncheck_app_path_ok");
});

test("monitor mati / tanpa app / IP tak terpetakan → string kosong (best-effort)", async () => {
    expect(await buildAppDiagnosis({ addr: ADDR_MNI, appEntity: null }, { renderResponseTemplate: render })).toBe("");
    global.config = { upstreamMonitor: { enabled: false } };
    expect(await buildAppDiagnosis({ addr: ADDR_MNI, appEntity: { serviceKey: "tiktok", label: "TikTok" } }, { renderResponseTemplate: render })).toBe("");
    global.config = { upstreamMonitor: { enabled: true } };
    expect(await buildAppDiagnosis({ addr: "8.8.8.8", appEntity: { serviceKey: "tiktok", label: "TikTok" } }, { renderResponseTemplate: render })).toBe("");
});
