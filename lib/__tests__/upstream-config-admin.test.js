/**
 * Header Doc
 * Purpose: Mengunci bahwa SEMUA setelan monitor yang ditambahkan hari ini bisa diatur dari
 *          halaman admin (#b266) — bukan hanya lewat menyunting `config.json` di server.
 * Caller: Jest test runner.
 * Deps: `lib/upstream-config-service`.
 * MainFuncs: —
 * SideEffects: Tidak ada (readConfig/writeConfig disuntik).
 */
"use strict";

const svc = require("../upstream-config-service");
const { validateTargets, validateStabilitas, validateAlertPaths } = svc._internal;

const cfgAwal = () => ({
    upstreamMonitor: {
        enabled: true, host: "h", user: "u", password: "p",
        paths: [{ key: "main", label: "Utama" }, { key: "vpn", label: "Cadangan" }],
        targets: [{ key: "google", label: "Google DNS", address: "8.8.4.4" }],
        // getMonitorConfig() SELALU mengisi thresholds/report — mock harus setia pada itu,
        // kalau tidak tesnya menguji dunia yang tak pernah ada.
        thresholds: { lossWarnPct: 5, lossCritPct: 20, rttWarnFactor: 1.7, rttCritFactor: 2.5, saturationPct: 85 }
    }
});

function terapkan(patch) {
    let ditulis = null;
    const r = svc.applyUpstreamConfigPatch(patch, "uji", {
        readConfig: () => cfgAwal(),
        writeConfig: (c) => { ditulis = c; },
        applyRuntime: () => {},
        getEffectiveMonitorConfig: () => ({ paths: cfgAwal().upstreamMonitor.paths }),
        getEffectiveServiceConfig: () => ({ enabled: false, services: [], paths: [] }),
        addIncident: () => {}
    });
    return { hasil: r, ditulis };
}

describe("#b266 — satu layanan boleh banyak alamat, diatur dari admin", () => {
    test("addresses diterima dan disimpan", () => {
        const v = validateTargets([{ key: "meta", label: "Facebook", addresses: ["157.240.14.35", "31.13.79.35"] }]);
        expect(v.errors).toEqual([]);
        expect(v.value[0].addresses).toHaveLength(2);
        // `address` tetap diisi alamat pertama supaya pembaca lama tak pecah.
        expect(v.value[0].address).toBe("157.240.14.35");
    });

    test("bentuk LAMA (address tunggal) tetap diterima", () => {
        const v = validateTargets([{ key: "google", label: "Google DNS", address: "8.8.4.4" }]);
        expect(v.errors).toEqual([]);
        expect(v.value[0].addresses).toEqual(["8.8.4.4"]);
    });

    test("alamat dobel & alamat terlarang ditolak dengan alasan", () => {
        expect(validateTargets([{ key: "meta", addresses: ["8.8.4.4", "8.8.4.4"] }]).errors.join(" ")).toMatch(/dobel/);
        expect(validateTargets([{ key: "meta", addresses: ["1.1.1.1"] }]).errors.join(" ")).toMatch(/recursive gateway-check/);
    });

    test("terlalu banyak alamat ditolak — tiap alamat = 1 ping per jalur per siklus", () => {
        const banyak = ["8.8.4.4", "8.8.8.8", "9.9.9.9", "4.2.2.2", "208.67.222.222", "8.26.56.26"];
        expect(validateTargets([{ key: "meta", addresses: banyak }]).errors.join(" ")).toMatch(/maksimal/);
    });

    test("namaAwam hanya ditulis bila diisi — kosong = jangan sebut ke pelanggan", () => {
        const dengan = validateTargets([{ key: "meta", namaAwam: "Facebook & Instagram", address: "157.240.14.35" }]);
        expect(dengan.value[0].namaAwam).toBe("Facebook & Instagram");
        const tanpa = validateTargets([{ key: "akamai", label: "Akamai CDN", address: "23.55.36.145" }]);
        expect(tanpa.value[0].namaAwam).toBeUndefined();
    });
});

describe("#b266 — setelan kestabilan & alarm dapat diatur dari admin", () => {
    test("view menyajikan semua setelan dengan bawaan terukur", () => {
        const view = svc.getEditableUpstreamConfig({
            readConfig: () => cfgAwal(),
            getEffectiveMonitorConfig: () => cfgAwal().upstreamMonitor,
            getEffectiveServiceConfig: () => ({ enabled: false, services: [], paths: [] })
        });
        expect(view.stabilitas).toBeDefined();
        ["kabariPelanggan", "alarmAdmin", "windowMinutes", "siklusBeruntun", "cooldownMinutes",
            "lossPeringatanPct", "lossBurukPct", "jitterPeringatanMs", "jitterBurukMs",
            "minSampel", "minTargetSepakat", "traceCount"].forEach((k) => {
            expect(view.stabilitas).toHaveProperty(k);
        });
        expect(Array.isArray(view.alertPaths)).toBe(true);
        expect(Array.isArray(view.alarmKestabilanPaths)).toBe(true);
    });

    test("patch menulis ke kunci config yang BENAR", () => {
        const { ditulis } = terapkan({
            stabilitas: { kabariPelanggan: true, alarmAdmin: true, lossBurukPct: 15, jitterBurukMs: 40, minTargetSepakat: 2, traceCount: 10, windowMinutes: 10 }
        });
        const m = ditulis.upstreamMonitor;
        expect(m.stabilitasPelanggan.enabled).toBe(true);
        expect(m.alarmKestabilan.enabled).toBe(true);
        expect(m.ambangStabilitas.lossBurukPct).toBe(15);
        expect(m.ambangStabilitas.jitterBurukMs).toBe(40);
        expect(m.minTargetSepakat).toBe(2);
        expect(m.traceCount).toBe(10);
        expect(m.stabilitasWindowMinutes).toBe(10);
    });

    test("!! kombinasi yang tak masuk akal DITOLAK, bukan disimpan diam-diam", () => {
        expect(validateStabilitas({ lossPeringatanPct: 5, lossBurukPct: 3 }).errors.join(" ")).toMatch(/lossBurukPct harus >/);
        expect(validateStabilitas({ jitterPeringatanMs: 10, jitterBurukMs: 5 }).errors.join(" ")).toMatch(/jitterBurukMs harus >/);
        expect(validateStabilitas({ minTargetSepakat: 0 }).errors.length).toBeGreaterThan(0);
    });

    test("satu bagian error → TIDAK ada yang ditulis", () => {
        const { hasil, ditulis } = terapkan({ stabilitas: { lossPeringatanPct: 5, lossBurukPct: 3 } });
        expect(hasil.ok).toBe(false);
        expect(hasil.errors.join(" ")).toMatch(/lossBurukPct harus >/);
        expect(ditulis).toBeNull();
    });
});

describe("#b266 — jalur yang boleh membangunkan admin", () => {
    test("hanya jalur yang dikenal yang diterima", () => {
        const jalur = [{ key: "main" }, { key: "vpn" }];
        expect(validateAlertPaths(["main"], jalur).value).toEqual(["main"]);
        expect(validateAlertPaths(["tidak-ada"], jalur).errors.join(" ")).toMatch(/bukan jalur yang dikenal/);
    });

    test("daftar KOSONG = semua jalur — mengosongkan tak boleh diam-diam mematikan alarm", () => {
        const r = validateAlertPaths([], [{ key: "main" }]);
        expect(r.errors).toEqual([]);
        expect(r.value).toEqual([]);
    });

    test("patch menulis ke alerts.paths dan alarmKestabilan.paths terpisah", () => {
        const a = terapkan({ alertPaths: ["main"] });
        expect(a.ditulis.upstreamMonitor.alerts.paths).toEqual(["main"]);
        const b = terapkan({ alarmKestabilanPaths: ["vpn"] });
        expect(b.ditulis.upstreamMonitor.alarmKestabilan.paths).toEqual(["vpn"]);
    });
});
