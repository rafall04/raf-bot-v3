/**
 * Header Doc
 * Purpose: Uji alerter jalur upstream — gate default mati, alert setelah N siklus sakit beruntun
 *          (anti-flap), saran steer/switch, cooldown, notif pulih, PLUS isi alert spesifik-arah:
 *          level far-only (gateway tak mendilusi), rincian per-target vs gateway, kesimpulan
 *          segmen, traceroute inline, solusi per-ISP, dan rehidrasi anti-dobel pasca-restart.
 * Caller: jest.
 * Deps: `../upstream-quality-alerter` (deps di-inject penuh — tanpa WA/SQLite nyata).
 * MainFuncs: —
 * SideEffects: State alerter di-reset per test.
 */
"use strict";

const alerter = require("../upstream-quality-alerter");

const CFG = {
    intervalMs: 60000,
    thresholds: { lossWarnPct: 5, lossCritPct: 20 },
    paths: [
        { key: "mni", label: "IH via MNI", routingTable: "MNI" },
        { key: "sf", label: "SF (backup MNI)", routingTable: "SF-PROBE" }
    ],
    alerts: { enabled: true, consecutiveCycles: 3, recoveryCycles: 2, cooldownMinutes: 120 }
};

// Bangun baris probe: satu baris per (siklus × jalur), loss ditentukan per siklus.
function rowsFor(pathLossSeries) {
    const rows = [];
    const base = Date.parse("2026-07-07T10:00:00.000Z");
    for (const [path, losses] of Object.entries(pathLossSeries)) {
        losses.forEach((loss, i) => {
            rows.push({
                path,
                probed_at: new Date(base + i * 60000).toISOString(),
                loss_pct: loss,
                rtt_avg_ms: 80
            });
        });
    }
    return rows;
}

function makeDeps(rows, sent) {
    return {
        getRepo: () => ({ getRecentProbes: async () => rows }),
        // Kontrak sendCritical: payload WAJIB objek { text } — string polos = crash Baileys.
        send: async (jid, payload) => {
            if (typeof payload !== "object" || typeof payload.text !== "string") {
                throw new Error("payload harus objek { text }");
            }
            sent.push({ jid, text: payload.text });
            return { delivered: true };
        },
        getAdminJids: () => ["628111@s.whatsapp.net"],
        renderResponseTemplate: (key, fallback) => fallback,
        // Default: TANPA data terdampak live (→ buildAffectedLine fallback ke affects statis).
        // Mencegah test menembak MikroTik asli lewat defaultDeps.getAffectedSet. Test yang menguji
        // jalur LIVE meng-override ini secara eksplisit.
        getAffectedSet: async () => null,
        nowMs: () => Date.parse("2026-07-07T10:30:00.000Z")
    };
}

describe("upstream-quality-alerter", () => {
    beforeEach(() => alerter.resetAlertStatesForTest());

    test("gate: alerts tidak dikonfigurasi → skip tanpa efek", async () => {
        const result = await alerter.evaluateAfterCycle({ ...CFG, alerts: undefined });
        expect(result.skipped).toBe(true);
    });

    test("3 siklus sakit beruntun → SATU alert dgn saran steer (SF sehat)", async () => {
        const sent = [];
        const rows = rowsFor({ mni: [30, 40, 25], sf: [0, 0, 0] });
        const result = await alerter.evaluateAfterCycle(CFG, makeDeps(rows, sent));
        const aksi = result.actions.filter((a) => a.action === "alert");
        expect(aksi).toHaveLength(1);
        expect(aksi[0].path).toBe("mni");
        expect(aksi[0].level).toBe("GANGGUAN");
        expect(sent).toHaveLength(1);
        expect(sent[0].text).toContain("SF");           // saran steer menyebut backup sehat
        expect(sent[0].jid).toBe("628111@s.whatsapp.net");
    });

    test("baru 2 siklus sakit (siklus ke-3 sehat) → belum alert (anti-flap)", async () => {
        const sent = [];
        const rows = rowsFor({ mni: [30, 40, 0], sf: [0, 0, 0] });
        const result = await alerter.evaluateAfterCycle(CFG, makeDeps(rows, sent));
        expect(result.actions.filter((a) => a.action === "alert")).toHaveLength(0);
        expect(sent).toHaveLength(0);
    });

    test("setelah alert, evaluasi ulang saat masih sakit → tidak dobel; pulih 2 siklus → notif pulih", async () => {
        const sent = [];
        // 1) trigger alert
        await alerter.evaluateAfterCycle(CFG, makeDeps(rowsFor({ mni: [30, 40, 25] }), sent));
        expect(sent).toHaveLength(1);
        // 2) masih sakit → state SICK, tidak kirim lagi
        await alerter.evaluateAfterCycle(CFG, makeDeps(rowsFor({ mni: [35, 30, 28] }), sent));
        expect(sent).toHaveLength(1);
        // 3) dua siklus terakhir sehat → notif pulih
        const result = await alerter.evaluateAfterCycle(CFG, makeDeps(rowsFor({ mni: [25, 0, 0] }), sent));
        expect(result.actions.filter((a) => a.action === "recovered")).toHaveLength(1);
        expect(sent).toHaveLength(2);
        expect(sent[1].text).toContain("PULIH");
    });

    test("cooldown menahan alert ulang setelah pulih lalu sakit lagi cepat", async () => {
        const sent = [];
        const deps = (rows) => makeDeps(rows, sent);
        await alerter.evaluateAfterCycle(CFG, deps(rowsFor({ mni: [30, 40, 25] })));      // alert #1
        await alerter.evaluateAfterCycle(CFG, deps(rowsFor({ mni: [25, 0, 0] })));         // pulih
        // sakit lagi < cooldown (nowMs sama) → TIDAK alert lagi
        const result = await alerter.evaluateAfterCycle(CFG, deps(rowsFor({ mni: [30, 40, 25] })));
        expect(result.actions.filter((a) => a.action === "alert")).toHaveLength(0);
        expect(sent).toHaveLength(2); // alert #1 + pulih saja
    });

    test("kirim gagal → tidak throw, state tetap transisi", async () => {
        const rows = rowsFor({ mni: [30, 40, 25] });
        const deps = {
            ...makeDeps(rows, []),
            send: async () => { throw new Error("WA putus"); }
        };
        await expect(alerter.evaluateAfterCycle(CFG, deps)).resolves.toMatchObject({ skipped: false });
        expect(alerter.getAlertStates().mni.condition).toBe("SICK");
    });

    test("alerts.recipients (nomor 08x) ikut jadi penerima walau daftar admin kosong", async () => {
        const sent = [];
        const cfg = { ...CFG, alerts: { ...CFG.alerts, recipients: ["085233047094"] } };
        const deps = { ...makeDeps(rowsFor({ mni: [30, 40, 25] }), sent), getAdminJids: () => [] };
        const result = await alerter.evaluateAfterCycle(cfg, deps);
        expect(result.actions.filter((a) => a.action === "alert")).toHaveLength(1);
        expect(sent).toHaveLength(1);
        expect(sent[0].jid).toBe("6285233047094@s.whatsapp.net");
    });

    test("normalizeRecipients: 08x → JID 62, JID lolos apa adanya, sampah dibuang", () => {
        expect(alerter._internal.normalizeRecipients(["085233047094", "6281234567890@s.whatsapp.net", "abc", ""]))
            .toEqual(["6285233047094@s.whatsapp.net", "6281234567890@s.whatsapp.net"]);
    });

    test("level far-only: ping gateway bersih TIDAK mendilusi loss (30% far = GANGGUAN, bukan 15%)", async () => {
        const sent = [];
        const base = Date.parse("2026-07-07T10:00:00.000Z");
        const rows = [];
        [30, 30, 30].forEach((loss, i) => {
            const at = new Date(base + i * 60000).toISOString();
            rows.push({ path: "mni", probed_at: at, target_key: "google", loss_pct: loss, rtt_avg_ms: 80 });
            rows.push({ path: "mni", probed_at: at, target_key: "gateway", loss_pct: 0, rtt_avg_ms: 40 });
        });
        const result = await alerter.evaluateAfterCycle(CFG, makeDeps(rows, sent));
        const aksi = result.actions.filter((a) => a.action === "alert");
        expect(aksi).toHaveLength(1);
        expect(aksi[0].level).toBe("GANGGUAN"); // dulu terdilusi jadi 15% = DEGRADASI
        expect(sent[0].text).toContain("Loss: 30%");
    });

    test("alert memuat rincian arah + kesimpulan segmen + traceroute inline + solusi", async () => {
        const sent = [];
        const cfg = {
            ...CFG,
            statusWindowMinutes: 15,
            targets: [{ key: "google", label: "Google DNS", address: "8.8.4.4" }],
            paths: [
                { key: "mni", label: "IH via MNI", routingTable: "MNI", tunnelType: "l2tp", affects: "paket 110k & 125k" },
                { key: "sf", label: "SF (backup MNI)", routingTable: "SF-PROBE" }
            ],
            alerts: { ...CFG.alerts, traceWaitSeconds: 5 }
        };
        const deps = {
            ...makeDeps(rowsFor({ mni: [30, 40, 52], sf: [0, 0, 0] }), sent),
            getPathStatus: async () => ({
                key: "mni",
                segment: "UPSTREAM_ISP",
                segment_label: "Masalah di sisi ISP (upstream)",
                targets: [{ target: "8.8.4.4", target_key: "google", samples: 5, loss_avg_pct: 52, rtt_avg_ms: 74, baseline_rtt_ms: 25 }],
                gateway: { target: "10.90.0.1", samples: 5, loss_avg_pct: 0, rtt_avg_ms: 45 },
                wan: { util_down_max_pct: 41, util_up_max_pct: 12 }
            }),
            requestTrace: async () => ({
                ok: true,
                target: "8.8.4.4",
                hops: [{ address: "10.90.0.1", loss_pct: 0 }, { address: "172.16.0.1", loss_pct: 100 }],
                firstBadHop: { address: "172.16.0.1", loss_pct: 100 },
                hopCount: 2
            })
        };
        const result = await alerter.evaluateAfterCycle(cfg, deps);
        expect(result.actions.filter((a) => a.action === "alert")).toHaveLength(1);
        const teks = sent[0].text;
        expect(teks).toContain("Google DNS (8.8.4.4)");           // arah loss jelas
        expect(teks).toContain("loss *52%*");
        expect(teks).toContain("Gateway IH via MNI (10.90.0.1)"); // pembanding gateway
        expect(teks).toContain("Terdampak: paket 110k & 125k");
        expect(teks).toContain("Kesimpulan");
        expect(teks).toContain("SISI ATAS");                       // segmen upstream lugas
        expect(teks).toContain("loss MULAI di hop 2");             // trace inline
        expect(teks).toContain("172.16.0.1");
        expect(teks).toContain("Solusi jalur ini");
        expect(teks).toContain("Komplain ke IH via MNI");
        expect(teks).toContain("switch koneksi");                  // backup SF sehat → opsi switch
    });

    test("buildAffectedLine: default report tampilkan SEMUA (inline utk ≤5) / unknown / fallback / 0", () => {
        const cfg = { paths: [{ key: "mni", label: "IH via MNI", affects: "paket 110k & 125k" }] };
        const bal = alerter._internal.buildAffectedLine;
        // Default report (affectedListMax 0 = semua); ≤5 nama → inline, tanpa "+N lagi".
        const live = bal(cfg, "mni", {
            path: "mni", count: 4, confidence: "live",
            customers: [{ name: "andik" }, { name: "budi" }, { name: "cici" }, { name: "dedi" }]
        });
        expect(live).toContain("*4 pelanggan*");
        expect(live).toContain("andik, budi, cici, dedi");
        expect(live).not.toContain("lagi");
        // unknown → jujur, JANGAN karang teks statis
        const unk = bal(cfg, "mni", { path: "mni", count: null, confidence: "unknown" });
        expect(unk).toContain("tak bisa dipastikan");
        expect(unk).not.toContain("paket 110k");
        // absen (null, mis. dep tak diinjeksi) → fallback statis (kompat mundur)
        expect(bal(cfg, "mni", null)).toContain("paket 110k & 125k");
        // live 0 pelanggan (mis. semua sudah dialihkan)
        expect(bal(cfg, "mni", { path: "mni", count: 0, confidence: "live", customers: [] })).toContain("*0 pelanggan*");
    });

    test("buildAffectedLine: banyak nama → daftar vertikal bernomor; alert dibatasi alertAffectedListMax", () => {
        const bal = alerter._internal.buildAffectedLine;
        const customers = Array.from({ length: 8 }, function (_v, i) { return { name: "user" + (i + 1) }; });
        const affected = { path: "gmdp", count: 8, confidence: "live", customers: customers };
        // Report (affectedListMax 0 = semua) & >5 nama → vertikal bernomor 1..8, tanpa "+N lagi".
        const rep = bal({ report: { affectedListMax: 0 } }, "gmdp", affected);
        expect(rep).toContain("aktif di jalur ini:");
        expect(rep).toContain("1. user1");
        expect(rep).toContain("8. user8");
        expect(rep).not.toContain("lagi");
        // Mode alert → dibatasi alertAffectedListMax (3) + "+5 lagi", nama ke-8 tak ikut.
        const al = bal({ report: { alertAffectedListMax: 3 } }, "gmdp", affected, { alert: true });
        expect(al).toContain("+5 lagi");
        expect(al).not.toContain("user8");
        // Report dgn batas eksplisit affectedListMax 2 → 2 nama + "+6 lagi" (≤5 → inline).
        expect(bal({ report: { affectedListMax: 2 } }, "gmdp", affected)).toContain("+6 lagi");
    });

    test("alert memakai 'Terdampak' LIVE (getAffectedSet) menggantikan affects statis", async () => {
        const sent = [];
        const cfg = {
            ...CFG,
            paths: [{ key: "mni", label: "IH via MNI", routingTable: "MNI", affects: "paket 110k & 125k" }]
        };
        const deps = {
            ...makeDeps(rowsFor({ mni: [30, 40, 25] }), sent),
            // entry non-null wajib supaya buildDirectionText (tempat baris Terdampak) tidak di-skip.
            getPathStatus: async () => ({
                key: "mni", segment: "UPSTREAM_ISP",
                targets: [{ target: "8.8.4.4", target_key: "google", samples: 5, loss_avg_pct: 40, rtt_avg_ms: 90 }],
                gateway: { target: "10.0.0.1", samples: 5, loss_avg_pct: 0, rtt_avg_ms: 40 }
            }),
            getAffectedSet: async () => ({
                path: "mni", count: 3, confidence: "live",
                customers: [{ name: "andik" }, { name: "budi" }, { name: "cici" }]
            })
        };
        await alerter.evaluateAfterCycle(cfg, deps);
        expect(sent).toHaveLength(1);
        expect(sent[0].text).toContain("*3 pelanggan* aktif di jalur ini");
        expect(sent[0].text).toContain("andik, budi, cici");
        expect(sent[0].text).not.toContain("paket 110k & 125k"); // statis TIDAK dipakai saat live tersedia
    });

    test("P1 blip: segmen SEHAT (window bersih) → kesimpulan JUJUR 'blip singkat', bukan diam", () => {
        const cfg = { statusWindowMinutes: 15, paths: [{ key: "mni", label: "IH via MNI" }] };
        const entry = { segment: "SEHAT", targets: [{ loss_avg_pct: 2 }, { loss_avg_pct: 3 }] };
        const t = alerter._internal.buildConclusionText(cfg, "mni", entry);
        expect(t).toContain("blip singkat");
        expect(t).toContain("mayoritas BERSIH");
        expect(t).toContain("2.5%"); // rata far-loss window
    });

    test("P1 flap: jalur TUNNEL dgn flaps_24h → sebut 'tunnel re-dial'", () => {
        const cfg = { statusWindowMinutes: 15, paths: [{ key: "mni", label: "IH via MNI", tunnelType: "l2tp", iface: "Tunnel-MNI" }] };
        const entry = {
            targets: [{ target: "8.8.4.4", target_key: "google", samples: 5, loss_avg_pct: 30, rtt_avg_ms: 90 }],
            gateway: { target: "10.0.0.1", samples: 5, loss_avg_pct: 0, rtt_avg_ms: 40 },
            wan: { flaps_24h: 12 }
        };
        const t = alerter._internal.buildDirectionText(cfg, "mni", entry, null);
        expect(t).toContain("re-dial *12×*");
        expect(t).toContain("Tunnel-MNI");
    });

    test("P1 flap: jalur DIRECT (non-tunnel) → TIDAK ada baris re-dial walau ada flaps_24h", () => {
        const cfg = { statusWindowMinutes: 15, paths: [{ key: "gmdp", label: "GMDP" }] };
        const entry = {
            targets: [{ target: "8.8.4.4", target_key: "google", samples: 5, loss_avg_pct: 30, rtt_avg_ms: 90 }],
            gateway: { samples: 5, loss_avg_pct: 0 }, wan: { flaps_24h: 5 }
        };
        const t = alerter._internal.buildDirectionText(cfg, "gmdp", entry, null);
        expect(t).not.toContain("re-dial");
    });

    test("backup ikut sakit → solusi memperingatkan JANGAN switch", async () => {
        const sent = [];
        const rows = rowsFor({ mni: [30, 40, 25], sf: [28, 30, 33] });
        await alerter.evaluateAfterCycle(CFG, makeDeps(rows, sent));
        // Dua alert (mni & sf sama-sama sakit); cari pesan mni.
        const teksMni = sent.map((s) => s.text).find((t) => t.includes("IH via MNI"));
        expect(teksMni).toContain("JANGAN buru-buru switch");
        expect(teksMni).not.toContain("backup SF (backup MNI) SEHAT");
    });

    test("rehidrasi: insiden alert terakhir masih SICK → restart TIDAK alert dobel, pulih tetap dinotif", async () => {
        const sent = [];
        const addIncident = jest.fn(async () => {});
        const nowMs = Date.parse("2026-07-07T10:30:00.000Z");
        const withIncidents = (rows) => ({
            ...makeDeps(rows, sent),
            getRepo: () => ({
                getRecentProbes: async () => rows,
                getIncidents: async () => [{
                    kind: "alert", path: "mni",
                    created_at: new Date(nowMs - 10 * 60 * 1000).toISOString(),
                    detail: JSON.stringify({ level: "GANGGUAN" })
                }],
                addIncident
            })
        });
        // Masih sakit pasca-restart → TIDAK ada alert baru (anti-dobel).
        const r1 = await alerter.evaluateAfterCycle(CFG, withIncidents(rowsFor({ mni: [35, 30, 28] })));
        expect(r1.actions.filter((a) => a.action === "alert")).toHaveLength(0);
        expect(sent).toHaveLength(0);
        expect(alerter.getAlertStates().mni.condition).toBe("SICK");
        // Sembuh 2 siklus → notif pulih + insiden alert_recovered tercatat.
        const r2 = await alerter.evaluateAfterCycle(CFG, withIncidents(rowsFor({ mni: [25, 0, 0] })));
        expect(r2.actions.filter((a) => a.action === "recovered")).toHaveLength(1);
        expect(sent).toHaveLength(1);
        expect(addIncident).toHaveBeenCalledWith(expect.objectContaining({ kind: "alert_recovered" }));
    });

    test("alert memuat seksi layanan populer: Meta/TikTok per jalur + pembanding + vonis global", async () => {
        const sent = [];
        const origConfig = global.config;
        global.config = { serviceMonitor: { enabled: true } };
        try {
            const deps = {
                ...makeDeps(rowsFor({ mni: [30, 40, 52], sf: [0, 0, 0] }), sent),
                getServiceReport: async () => ({
                    window_minutes: 10,
                    paths: [{ key: "mni", label: "MNI" }, { key: "gmdp", label: "GMDP" }],
                    services: [
                        {
                            key: "instagram", label: "Instagram", host: "www.instagram.com",
                            cells: [
                                { path: "mni", samples: 5, ok_pct: 20, tls_ms: null, verdict: "TERGANGGU" },
                                { path: "gmdp", samples: 5, ok_pct: 100, tls_ms: 62, verdict: "OK" }
                            ]
                        },
                        {
                            key: "tiktok", label: "TikTok", host: "www.tiktok.com",
                            cells: [
                                { path: "mni", samples: 5, ok_pct: 100, tls_ms: 640, verdict: "LAMBAT" },
                                { path: "gmdp", samples: 5, ok_pct: 100, tls_ms: 78, verdict: "OK" }
                            ]
                        },
                        {
                            key: "whatsapp", label: "WhatsApp", host: "web.whatsapp.com",
                            cells: [
                                { path: "mni", samples: 5, ok_pct: 0, tls_ms: null, verdict: "DOWN" },
                                { path: "gmdp", samples: 5, ok_pct: 0, tls_ms: null, verdict: "DOWN" }
                            ]
                        },
                        {
                            key: "google", label: "Google", host: "www.google.com",
                            cells: [
                                { path: "mni", samples: 5, ok_pct: 100, tls_ms: 70, verdict: "OK" },
                                { path: "gmdp", samples: 5, ok_pct: 100, tls_ms: 60, verdict: "OK" }
                            ]
                        }
                    ]
                })
            };
            await alerter.evaluateAfterCycle(CFG, deps);
            const teks = sent.map((s) => s.text).find((t) => t.includes("IH via MNI"));
            expect(teks).toContain("Layanan populer via MNI");
            expect(teks).toContain("🔴 Instagram: TERGANGGU (berhasil 20%) — via GMDP normal (62ms)");
            expect(teks).toContain("🟠 TikTok: LAMBAT (640ms — via GMDP cuma 78ms)");
            expect(teks).toContain("⛔ WhatsApp: DOWN (berhasil 0%) — SEMUA jalur gagal → indikasi gangguan WhatsApp global, BUKAN masalah ISP");
            expect(teks).toContain("🟢 Google: OK (70ms)");
            // Terburuk dulu: DOWN sebelum TERGANGGU sebelum LAMBAT sebelum OK.
            expect(teks.indexOf("WhatsApp: DOWN")).toBeLessThan(teks.indexOf("Instagram: TERGANGGU"));
            expect(teks.indexOf("Instagram: TERGANGGU")).toBeLessThan(teks.indexOf("TikTok: LAMBAT"));
        } finally {
            global.config = origConfig;
        }
    });

    test("seksi layanan senyap saat serviceMonitor mati / jalur tak dipantau prober", async () => {
        const origConfig = global.config;
        global.config = { serviceMonitor: { enabled: false } };
        try {
            const teks = await alerter._internal.buildServiceSectionText("mni", {});
            expect(teks).toBe("");
        } finally {
            global.config = origConfig;
        }
    });

    test("notif PULIH memuat rekap laporan-ISP: arah+puncak loss, gateway bersih, layanan terdampak, trace, segmen", async () => {
        const sent = [];
        const origConfig = global.config;
        global.config = { serviceMonitor: { enabled: true } };
        try {
            const nowMs = Date.parse("2026-07-07T10:30:00.000Z");
            const sickSinceMs = nowMs - 50 * 60 * 1000;
            const outageRows = [];
            [40, 60].forEach((loss, i) => {
                const at = new Date(sickSinceMs + i * 60000).toISOString();
                outageRows.push({ path: "mni", probed_at: at, target: "8.8.4.4", target_key: "google", loss_pct: loss, rtt_avg_ms: 90 + i * 30 });
                outageRows.push({ path: "mni", probed_at: at, target: "10.90.0.1", target_key: "gateway", loss_pct: 0, rtt_avg_ms: 45 });
            });
            const incidents = [
                {
                    kind: "alert", path: "mni",
                    created_at: new Date(sickSinceMs).toISOString(),
                    detail: JSON.stringify({ level: "GANGGUAN", segment: "UPSTREAM_ISP" })
                },
                {
                    kind: "trace", path: "mni",
                    created_at: new Date(sickSinceMs + 2 * 60000).toISOString(),
                    detail: JSON.stringify({ first_bad_hop: { address: "172.16.0.1", loss_pct: 100 } })
                }
            ];
            const svcHistory = [];
            for (let i = 0; i < 10; i += 1) {
                svcHistory.push({ path: "mni", service: "instagram", ok: i < 3 ? 1 : 0, tls_ms: i < 3 ? 80 : null });
                svcHistory.push({ path: "mni", service: "tiktok", ok: 1, tls_ms: i === 5 ? 900 : 90 });
                svcHistory.push({ path: "mni", service: "google", ok: 1, tls_ms: 70 });
            }
            const healthyRows = rowsFor({ mni: [25, 0, 0] });
            const deps = {
                ...makeDeps(healthyRows, sent),
                nowMs: () => nowMs,
                getRepo: () => ({
                    // Panggilan utama (tanpa path) → deret sehat; panggilan rekap (path mni) → jendela gangguan.
                    getRecentProbes: async (args) => (args && args.path === "mni" ? outageRows : healthyRows),
                    getIncidents: async () => incidents,
                    getServiceHistory: async () => svcHistory,
                    addIncident: jest.fn(async () => {})
                })
            };
            const result = await alerter.evaluateAfterCycle(CFG, deps);
            expect(result.actions.filter((a) => a.action === "recovered")).toHaveLength(1);
            const teks = sent[0].text;
            expect(teks).toContain("PULIH");
            expect(teks).toContain("Rekap gangguan (bahan laporan ke ISP)");
            expect(teks).toContain("Level terburuk: GANGGUAN");
            expect(teks).toContain("(8.8.4.4): loss rata *50%* • puncak *60%*");
            expect(teks).toContain("Gateway (10.90.0.1)");
            expect(teks).toContain("bukti masalah di upstream ISP");
            expect(teks).toContain("Instagram: gagal *70%* percobaan (10 sampel)");
            expect(teks).toContain("TikTok: sempat LAMBAT (TLS sampai 900ms)");
            expect(teks).not.toContain("Google: gagal");
            expect(teks).toContain("loss mulai di 172.16.0.1");
            expect(teks).toContain("Vonis segmen saat gangguan: masalah di sisi ISP (upstream)");
        } finally {
            global.config = origConfig;
        }
    });

    test("buildTraceText: tak ada hop tertuduh → sebutkan SEBAB sebenarnya, jangan menebak", () => {
        // Dulu tes ini menuntut kata "intermiten" untuk keadaan APA PUN tanpa hop tertuduh (#b256).
        // Itu tebakan, dan sebab paling sering justru kebalikannya: jalur SEHAT, tujuan tercapai
        // utuh. Menebak di sini membuat admin mengejar masalah yang tidak ada.
        const cfg = { paths: [{ key: "mni", label: "IH via MNI" }] };
        expect(alerter._internal.buildTraceText(cfg, "mni", null)).toContain("Insiden");

        const sehat = alerter._internal.buildTraceText(cfg, "mni", {
            ok: true, target: "8.8.4.4", firstBadHop: null,
            sebab: "tujuan akhir (8.8.4.4) hanya loss 0% — jalur SEHAT",
            jalur: [
                { posisi: 1, address: "1.1.1.1", menjawab: true, lossPct: 0, avgMs: 5 },
                { posisi: 2, address: "8.8.4.4", menjawab: true, lossPct: 0, avgMs: 15 }
            ]
        });
        expect(sehat).toContain("SEHAT");
        expect(sehat).not.toContain("intermiten");
        expect(sehat).toContain("2 hop menjawab");

        // Bentuk LAMA (cuma hops mentah) tetap terbaca — dianalisa di tempat, bukan ditolak.
        const lama = alerter._internal.buildTraceText(cfg, "mni", {
            ok: true, target: "8.8.4.4", hopCount: 9,
            hops: [{ address: "1.1.1.1", loss_pct: 0 }], firstBadHop: null
        });
        expect(lama).toMatch(/hop menjawab|tidak ada hop terbaca/);
        expect(lama).not.toContain("intermiten");
    });

    test("#b258 — penyaring jalur: hanya jalur terdaftar yang boleh memicu alert", async () => {
        // TERUKUR 14 hari: menyalakan alerts apa adanya di Tanjungharjo = ~10,7 alert/hari, dan
        // 7,2 di antaranya dari `vpn` — radio cadangan TERAKHIR yang tak dipakai pelanggan mana
        // pun. Alert harian untuk jalur tak terpakai melatih pemiliknya mengabaikan alert.
        const sent = [];
        const cfg = { ...CFG, alerts: { ...CFG.alerts, paths: ["mni"] } };
        // KEDUA jalur sakit identik — hanya penyaring yang boleh membedakan hasilnya.
        const rows = rowsFor({ mni: [30, 40, 52], sf: [30, 40, 52] });
        const result = await alerter.evaluateAfterCycle(cfg, makeDeps(rows, sent));
        const alerts = result.actions.filter((a) => a.action === "alert");
        expect(alerts).toHaveLength(1);
        expect(alerts[0].path).toBe("mni");
        // Catatan: teks alert `mni` BOLEH menyebut SF sebagai saran jalur cadangan — itu konten
        // sah, bukan kebocoran penyaring. Bukti penyaring = tak ada aksi alert untuk `sf`.
        expect(result.actions.some((a) => a.action === "alert" && a.path === "sf")).toBe(false);
    });

    test("#b258 — daftar jalur KOSONG = semua jalur (kunci baru tak boleh mematikan alert lama)", async () => {
        const sent = [];
        const rows = rowsFor({ mni: [30, 40, 52], sf: [30, 40, 52] });
        const result = await alerter.evaluateAfterCycle(CFG, makeDeps(rows, sent));
        expect(result.actions.filter((a) => a.action === "alert")).toHaveLength(2);
    });
});
