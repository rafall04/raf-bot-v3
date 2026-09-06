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

// Jalur kini dari resolver LIVE (address-list router), bukan peta CIDR statis — jadi test
// MENYUNTIKKAN resolver, sama seperti report/render. Peta statis terbukti salah 21% dan buta
// 13% atas 62 pelanggan produksi, karena itu tak lagi jadi sumber jalur untuk pelanggan.
const ADDR_MNI = "192.168.61.10";
const resolvePath = async () => "mni";

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
        resolvePath,
        renderResponseTemplate: render,
        getServiceReport: async () => svcReport([
            { path: "mni", samples: 5, ok_pct: 100, tls_ms: 640, verdict: "LAMBAT" },
            { path: "gmdp", samples: 5, ok_pct: 100, tls_ms: 78, verdict: "OK" }
        ])
    };
    const teks = await buildAppDiagnosis({ addr: ADDR_MNI, appEntity: { key: "tiktok", serviceKey: "tiktok", label: "TikTok", kind: "video" } }, deps);
    expect(teks).toContain("conncheck_app_issue");
    expect(teks).toContain("TikTok");
    expect(teks).toContain("ada kendala");
    // Pesan pelanggan sederhana: TIDAK memuat angka ms teknis (itu utk owner/alert).
    expect(teks).not.toContain("640ms");
});

test("app DOWN → 'sulit diakses'", async () => {
    const deps = {
        resolvePath,
        renderResponseTemplate: render,
        getServiceReport: async () => svcReport([{ path: "mni", samples: 5, ok_pct: 0, tls_ms: null, verdict: "DOWN" }])
    };
    const teks = await buildAppDiagnosis({ addr: ADDR_MNI, appEntity: { key: "tiktok", serviceKey: "tiktok", label: "TikTok", kind: "video" } }, deps);
    expect(teks).toContain("conncheck_app_issue");
});

// #b332 — layanan buruk di SEMUA jalur = outage sisi platform (IG/WA global), BUKAN jaringan kami.
test("app buruk di SEMUA jalur → outage global (bukan menyalahkan jaringan kami)", async () => {
    const deps = {
        resolvePath,
        renderResponseTemplate: render,
        getServiceReport: async () => svcReport([
            { path: "mni", samples: 5, ok_pct: 0, tls_ms: null, verdict: "DOWN" },
            { path: "gmdp", samples: 5, ok_pct: 0, tls_ms: null, verdict: "DOWN" }
        ])
    };
    const teks = await buildAppDiagnosis({ addr: ADDR_MNI, appEntity: { key: "tiktok", serviceKey: "tiktok", label: "TikTok", kind: "video" } }, deps);
    expect(teks).toContain("conncheck_app_global_outage");
    expect(teks).not.toContain("conncheck_app_issue"); // jangan menyalahkan "jaringan kami"
});

test("app buruk HANYA di jalur pelanggan (sehat di jalur lain) → tetap 'kendala jaringan kami'", async () => {
    const deps = {
        resolvePath,
        renderResponseTemplate: render,
        getServiceReport: async () => svcReport([
            { path: "mni", samples: 5, ok_pct: 0, tls_ms: null, verdict: "DOWN" },
            { path: "gmdp", samples: 5, ok_pct: 100, tls_ms: 80, verdict: "OK" }
        ])
    };
    const teks = await buildAppDiagnosis({ addr: ADDR_MNI, appEntity: { key: "tiktok", serviceKey: "tiktok", label: "TikTok", kind: "video" } }, deps);
    expect(teks).toContain("conncheck_app_issue");
    expect(teks).not.toContain("conncheck_app_global_outage");
});

test("app NORMAL di jalur pelanggan → arahkan ke perangkat", async () => {
    const deps = {
        resolvePath,
        renderResponseTemplate: render,
        getServiceReport: async () => svcReport([{ path: "mni", samples: 5, ok_pct: 100, tls_ms: 90, verdict: "OK" }])
    };
    const teks = await buildAppDiagnosis({ addr: ADDR_MNI, appEntity: { key: "tiktok", serviceKey: "tiktok", label: "TikTok", kind: "video" } }, deps);
    expect(teks).toContain("conncheck_app_ok");
    expect(teks).toContain("lancar");
    expect(teks).not.toContain("90ms"); // pesan pelanggan tanpa angka teknis
});

test("game (serviceKey null): jalur terganggu → jawaban via loss/RTT jalur", async () => {
    const deps = {
        resolvePath,
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
    expect(teks).toContain("ada kendala");
});

// #b332 — Kelas 2 tak boleh membantah note kesehatan. DEGRADASI ringan (bukan seluruh-jalur) di
// handler = HEALTHY ("terpantau normal"); di sini HARUS conncheck_app_path_ok, bukan path_issue.
test("game: DEGRADASI ringan (bukan seluruh-jalur) → path_ok, jangan bertolak-belakang", async () => {
    const deps = {
        resolvePath,
        renderResponseTemplate: render,
        getStatusReport: async () => ({
            paths: [{
                key: "mni", label: "IH via MNI", status: "DEGRADASI",
                // Dua target DEGRADASI ringan (bukan GANGGUAN/PUTUS) → isPathWideIssue false.
                targets: [
                    { target: "8.8.4.4", target_key: "google", verdict: "DEGRADASI", samples: 5, loss_avg_pct: 7 },
                    { target: "1.1.1.1", target_key: "cf", verdict: "DEGRADASI", samples: 5, loss_avg_pct: 7 }
                ]
            }]
        })
    };
    const teks = await buildAppDiagnosis({ addr: ADDR_MNI, appEntity: { key: "game", serviceKey: null, label: "game online", kind: "game" } }, deps);
    expect(teks).toContain("conncheck_app_path_ok");
    expect(teks).not.toContain("conncheck_app_path_issue");
});

test("game: DEGRADASI SELURUH-JALUR (mayoritas target parah) → path_issue", async () => {
    const deps = {
        resolvePath,
        renderResponseTemplate: render,
        getStatusReport: async () => ({
            paths: [{
                key: "mni", label: "IH via MNI", status: "DEGRADASI",
                targets: [
                    { target: "8.8.4.4", target_key: "google", verdict: "GANGGUAN", samples: 5, loss_avg_pct: 60 },
                    { target: "1.1.1.1", target_key: "cf", verdict: "PUTUS", samples: 5, loss_avg_pct: 100 }
                ]
            }]
        })
    };
    const teks = await buildAppDiagnosis({ addr: ADDR_MNI, appEntity: { key: "game", serviceKey: null, label: "game online", kind: "game" } }, deps);
    expect(teks).toContain("conncheck_app_path_issue");
});

test("game: jalur stabil → arahkan ke perangkat/WiFi", async () => {
    const deps = {
        resolvePath,
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
        resolvePath,
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
