/**
 * Header Doc
 * Purpose: Uji kustomisasi arah monitor — validator target/layanan/jalur/thresholds (termasuk
 *          penolakan 1.1.1.1/8.8.8.8 dan host layanan wajib hostname), semua-atau-batal saat
 *          ada error (config TIDAK ditulis), merge + live-apply + audit saat sukses, dan view
 *          efektif dengan penanda wiring read-only.
 * Caller: jest.
 * Deps: `../upstream-config-service` (deps di-inject penuh — tanpa fs/config nyata).
 * SideEffects: Tidak ada.
 */
"use strict";

const svc = require("../upstream-config-service");

const { validateTargets, validateServices, validatePathsPatch, validateThresholds, validateReport } = svc._internal;

describe("validateTargets", () => {
    test("valid → normalized; kosong/dobel/alamat rusak/terlarang → error", () => {
        expect(validateTargets([{ key: "google", label: "Google DNS", address: "8.8.4.4" }]).value)
            .toEqual([{ key: "google", label: "Google DNS", address: "8.8.4.4" }]);
        expect(validateTargets([]).errors[0]).toContain("minimal 1");
        expect(validateTargets([{ key: "a b", label: "x", address: "8.8.4.4" }]).errors[0]).toContain("key tidak valid");
        expect(validateTargets([
            { key: "gg", label: "x", address: "8.8.4.4" },
            { key: "gg", label: "y", address: "1.0.0.1" }
        ]).errors.join()).toContain("dobel");
        expect(validateTargets([{ key: "gg", label: "x", address: "999.1.1.1" }]).errors[0]).toContain("bukan IPv4/hostname");
        expect(validateTargets([{ key: "gg", label: "x", address: "8.8.8.8" }]).errors[0]).toContain("recursive gateway-check");
        expect(validateTargets([{ key: "meta", label: "Meta", address: "www.facebook.com" }]).value[0].address)
            .toBe("www.facebook.com"); // hostname boleh utk target ping
    });
});

describe("validateServices", () => {
    test("host wajib hostname (IP ditolak), key unik", () => {
        expect(validateServices([{ key: "netflix", label: "Netflix", host: "www.netflix.com" }]).value)
            .toEqual([{ key: "netflix", label: "Netflix", host: "www.netflix.com" }]);
        expect(validateServices([{ key: "x1", label: "X", host: "157.240.208.1" }]).errors[0]).toContain("harus HOSTNAME");
        expect(validateServices([
            { key: "a1", label: "A", host: "a.com" },
            { key: "a1", label: "B", host: "b.com" }
        ]).errors.join()).toContain("dobel");
        expect(validateServices([]).value).toEqual([]); // boleh kosong (prober pakai default)
    });
});

describe("validatePathsPatch", () => {
    const current = [{ key: "mni", label: "IH via MNI" }, { key: "gmdp", label: "GMDP" }];
    test("edit field non-struktural ok; key asing ditolak; gateway harus IPv4", () => {
        const ok = validatePathsPatch([{ key: "mni", label: "MNI Baru", affects: "paket 110k", gatewayTarget: "", capacity: { downMbps: 100, upMbps: 50 } }], current);
        expect(ok.errors).toEqual([]);
        expect(ok.value[0]).toEqual({ key: "mni", label: "MNI Baru", affects: "paket 110k", gatewayTarget: "", capacity: { downMbps: 100, upMbps: 50 } });
        expect(validatePathsPatch([{ key: "asing", label: "X" }], current).errors[0]).toContain("tidak dikenal");
        expect(validatePathsPatch([{ key: "mni", gatewayTarget: "bukan-ip" }], current).errors[0]).toContain("bukan IPv4");
        expect(validatePathsPatch([{ key: "mni", label: "" }], current).errors[0]).toContain("tidak boleh kosong");
        expect(validatePathsPatch([{ key: "mni", capacity: { downMbps: -1, upMbps: 0 } }], current).errors[0]).toContain("0-100000");
    });
});

describe("validateThresholds", () => {
    test("rentang dijaga + crit > warn", () => {
        expect(validateThresholds({ lossWarnPct: 5, lossCritPct: 20 }).value).toEqual({ lossWarnPct: 5, lossCritPct: 20 });
        expect(validateThresholds({ lossWarnPct: 20, lossCritPct: 10 }).errors[0]).toContain("lossCritPct harus > lossWarnPct");
        expect(validateThresholds({ saturationPct: 200 }).errors[0]).toContain("50-100");
    });
});

describe("validateReport", () => {
    test("angka valid + seksi dikenal → normalized; di luar rentang / seksi asing → error", () => {
        const ok = validateReport({ affectedListMax: 0, alertAffectedListMax: 5, sections: { rincianArah: true, insidenTerakhir: false } });
        expect(ok.errors).toEqual([]);
        expect(ok.value).toEqual({ affectedListMax: 0, alertAffectedListMax: 5, sections: { rincianArah: true, insidenTerakhir: false } });
        expect(validateReport({ affectedListMax: -1 }).errors[0]).toContain("affectedListMax");
        expect(validateReport({ affectedListMax: 5000 }).errors[0]).toContain("affectedListMax");
        expect(validateReport({ alertAffectedListMax: 999 }).errors[0]).toContain("alertAffectedListMax");
        expect(validateReport({ sections: { ngawur: true } }).errors[0]).toContain("tidak dikenal");
        expect(validateReport(null).errors[0]).toContain("report harus objek");
        // Coercion checkbox string ("on"/"false") → boolean; tak pernah lempar.
        expect(validateReport({ sections: { rincianArah: "on", layananPopuler: "false" } }).value.sections)
            .toEqual({ rincianArah: true, layananPopuler: false });
    });
});

describe("applyUpstreamConfigPatch", () => {
    function makeDeps(diskCfg) {
        const writes = [];
        const runtimeApplied = [];
        const incidents = [];
        return {
            deps: {
                readConfig: () => JSON.parse(JSON.stringify(diskCfg)),
                writeConfig: (c) => writes.push(c),
                applyRuntime: (c) => runtimeApplied.push(c),
                addIncident: (p) => incidents.push(p),
                getEffectiveMonitorConfig: () => ({
                    enabled: true,
                    intervalMs: 60000,
                    statusWindowMinutes: 15,
                    thresholds: { lossWarnPct: 5, lossCritPct: 20, rttWarnFactor: 1.7, rttCritFactor: 2.5, saturationPct: 85 },
                    targets: [{ key: "google", label: "Google DNS", address: "8.8.4.4" }],
                    paths: [
                        { key: "mni", label: "IH via MNI", routingTable: "MNI", iface: "Tunnel-MNI", tunnelType: "l2tp" },
                        { key: "gmdp", label: "GMDP (utama)", iface: "vlan62", gatewayTarget: "195.168.62.1" }
                    ]
                }),
                getEffectiveServiceConfig: () => ({ enabled: true, services: [], paths: [] })
            },
            writes, runtimeApplied, incidents
        };
    }

    test("sukses: tulis config + live-apply + insiden; paths dimaterialisasi dari efektif", () => {
        const { deps, writes, runtimeApplied, incidents } = makeDeps({ upstreamMonitor: { enabled: true } });
        const r = svc.applyUpstreamConfigPatch({
            targets: [{ key: "quad9", label: "Quad9", address: "9.9.9.9" }],
            services: [{ key: "netflix", label: "Netflix", host: "www.netflix.com" }],
            paths: [{ key: "mni", capacity: { downMbps: 150, upMbps: 150 } }],
            thresholds: { saturationPct: 80 }
        }, "admin:raf", deps);
        expect(r.ok).toBe(true);
        expect(r.changes.sort()).toEqual(["paths", "services", "targets", "thresholds"]);
        expect(writes).toHaveLength(1);
        const saved = writes[0];
        expect(saved.upstreamMonitor.targets).toEqual([{ key: "quad9", label: "Quad9", address: "9.9.9.9" }]);
        expect(saved.serviceMonitor.services[0].host).toBe("www.netflix.com");
        // Materialisasi: wiring dari efektif TERBAWA + capacity ter-set.
        const mni = saved.upstreamMonitor.paths.find((p) => p.key === "mni");
        expect(mni.routingTable).toBe("MNI");
        expect(mni.capacity).toEqual({ downMbps: 150, upMbps: 150 });
        expect(saved.upstreamMonitor.thresholds.saturationPct).toBe(80);
        expect(runtimeApplied).toHaveLength(1);
        expect(incidents[0]).toMatchObject({ kind: "config", detail: { actor: "admin:raf" } });
    });

    test("patch report: deep-merge sections + tulis ke upstreamMonitor.report", () => {
        const { deps, writes } = makeDeps({ upstreamMonitor: { report: { affectedListMax: 3, sections: { rincianArah: true, layananPopuler: true } } } });
        const r = svc.applyUpstreamConfigPatch({ report: { affectedListMax: 0, sections: { layananPopuler: false } } }, "admin:raf", deps);
        expect(r.ok).toBe(true);
        expect(r.changes).toContain("report");
        const saved = writes[0].upstreamMonitor.report;
        expect(saved.affectedListMax).toBe(0);
        // Deep-merge: rincianArah (lama) tetap true, layananPopuler jadi false — toggle lain tak terhapus.
        expect(saved.sections).toEqual({ rincianArah: true, layananPopuler: false });
    });

    test("semua-atau-batal: satu bagian error → TIDAK ada tulis/apply", () => {
        const { deps, writes, runtimeApplied } = makeDeps({ upstreamMonitor: {} });
        const r = svc.applyUpstreamConfigPatch({
            targets: [{ key: "ok", label: "OK", address: "9.9.9.9" }],
            services: [{ key: "bad", label: "Bad", host: "1.2.3.4" }]
        }, "admin:raf", deps);
        expect(r.ok).toBe(false);
        expect(r.errors.join()).toContain("HOSTNAME");
        expect(writes).toHaveLength(0);
        expect(runtimeApplied).toHaveLength(0);
    });

    test("patch kosong → error informatif; gatewayTarget '' menghapus field; affects '' menghapus", () => {
        const base = {
            upstreamMonitor: {
                paths: [{ key: "gmdp", label: "GMDP", gatewayTarget: "195.168.62.1", affects: "lama" }]
            }
        };
        const kosong = makeDeps(base);
        expect(svc.applyUpstreamConfigPatch({}, "a", kosong.deps).errors[0]).toContain("tidak ada bagian");

        const hapus = makeDeps(base);
        const r = svc.applyUpstreamConfigPatch({
            paths: [{ key: "gmdp", gatewayTarget: "", affects: "" }]
        }, "a", hapus.deps);
        expect(r.ok).toBe(true);
        const g = hapus.writes[0].upstreamMonitor.paths[0];
        expect(g.gatewayTarget).toBeUndefined();
        expect(g.affects).toBeUndefined();
        expect(g.label).toBe("GMDP"); // field lain tak tersentuh
    });

    test("getEditableUpstreamConfig: view efektif + wiring read-only + flag enable", () => {
        const { deps } = makeDeps({});
        const view = svc.getEditableUpstreamConfig(deps);
        expect(view.monitorEnabled).toBe(true);
        expect(view.targets[0].address).toBe("8.8.4.4");
        expect(view.paths[0].wiring).toEqual({ routingTable: "MNI", iface: "Tunnel-MNI", tunnelType: "l2tp" });
        expect(view.paths[1].wiring.routingTable).toBe("main");
        expect(view.thresholds.saturationPct).toBe(85);
        expect(view.serviceEnabled).toBe(true);
    });
});
