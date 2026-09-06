/**
 * Header Doc
 * Purpose: Uji engine failover WAN otomatis — gate enabled/switch-disabled, streak sakit +
 *          target sehat, mode propose vs auto, cooldown, kuota harian, kunci anti-flapping,
 *          verifikasi status router sebelum aksi, auto-revert berbasis gateway, dan rehidrasi
 *          dari insiden. Semua dependensi (repo/switch/WA) di-inject — tanpa router/WA nyata.
 * Caller: jest.
 * Deps: `../wan-failover-service`.
 * SideEffects: Mutasi global.config di-restore per test; state modul di-reset per test.
 */
"use strict";

const engine = require("../wan-failover-service");

const NOW = 1_800_000_000_000; // titik waktu tetap supaya deterministik
const INTERVAL_MS = 60_000;

const MONITOR_CFG = {
    intervalMs: INTERVAL_MS,
    thresholds: { lossWarnPct: 5, lossCritPct: 20 },
    paths: [
        { key: "mni", label: "IH via MNI" },
        { key: "sf", label: "SF (backup MNI)" },
        { key: "gmdp", label: "GMDP (utama)" },
        { key: "ih", label: "IndiHome direct" }
    ]
};

/** Bangun baris probe: spec {path: {far:[loss,...], gw:[loss,...]}} — index 0 = siklus TERLAMA. */
function makeRows(spec) {
    const rows = [];
    for (const [path, series] of Object.entries(spec)) {
        (series.far || []).forEach((loss, i) => {
            rows.push({
                path,
                probed_at: new Date(NOW - ((series.far.length - 1 - i) * INTERVAL_MS)).toISOString(),
                target: "8.8.4.4",
                target_key: "google",
                loss_pct: loss
            });
        });
        (series.gw || []).forEach((loss, i) => {
            rows.push({
                path,
                probed_at: new Date(NOW - ((series.gw.length - 1 - i) * INTERVAL_MS)).toISOString(),
                target: "10.99.0.1",
                target_key: "gateway",
                loss_pct: loss
            });
        });
    }
    return rows;
}

function makeDeps({ rows = [], incidents = [], applied = false, failoverOver = {}, ruleOver = {} } = {}) {
    const send = jest.fn(async () => ({ delivered: true }));
    const applySwitch = jest.fn(async () => ({ ok: true, message: "ok", summary: "MNI → SF" }));
    const restoreSwitch = jest.fn(async () => ({ ok: true, message: "ok", summary: "MNI → Tunnel-MNI" }));
    const getStatus = jest.fn(async () => ({
        ok: true,
        enabled: true,
        switches: [{ id: "mni-to-sf", applied }]
    }));
    const addIncident = jest.fn(async () => {});
    const deps = {
        getRepo: () => ({
            getRecentProbes: async () => rows,
            getIncidents: async () => incidents,
            addIncident
        }),
        switchService: {
            getSwitchConfig: () => ({ enabled: true, switches: [{ id: "mni-to-sf", label: "MNI → SF" }] }),
            getStatus,
            applySwitch,
            restoreSwitch
        },
        send,
        getAdminJids: () => ["6285233047094@s.whatsapp.net"],
        renderResponseTemplate: (key, fallback) => `[${key}] ${fallback}`,
        // Default TANPA data terdampak (→ buildTerdampakLine "" ). Cegah test menembak MikroTik
        // asli via defaultDeps.getAffectedSet. Test yang menguji baris terdampak override ini.
        getAffectedSet: async () => null,
        nowMs: () => NOW,
        getFailoverConfig: () => ({
            enabled: true,
            mode: "propose",
            maxAutoActionsPerDay: 4,
            flapLockCount: 2,
            flapLockHours: 24,
            notifyAdmins: true,
            recipients: [],
            rules: [{
                switchId: "mni-to-sf",
                sickPath: "mni",
                targetPath: "sf",
                minLevel: "GANGGUAN",
                sickCycles: 3,
                targetHealthyCycles: 3,
                cooldownMinutes: 30,
                proposeCooldownMinutes: 120,
                mode: null,
                autoRevert: false,
                revertHealthyCycles: 3,
                ...ruleOver
            }],
            ...failoverOver
        })
    };
    return { deps, send, applySwitch, restoreSwitch, getStatus, addIncident };
}

const SICK_SERIES = { mni: { far: [30, 35, 40], gw: [30, 30, 30] }, sf: { far: [0, 0, 0] } };

const origConfig = global.config;
beforeEach(() => {
    engine.resetForTest();
    global.config = { nama: "RAF NET" };
});
afterEach(() => { global.config = origConfig; });

describe("gate & prasyarat", () => {
    test("wanFailover disabled → skip tanpa aksi", async () => {
        const { deps, send } = makeDeps({ failoverOver: { enabled: false } });
        const res = await engine.evaluateAfterCycle(MONITOR_CFG, deps);
        expect(res.skipped).toBe(true);
        expect(send).not.toHaveBeenCalled();
    });

    test("wanSwitch disabled → skip", async () => {
        const { deps } = makeDeps({ rows: makeRows(SICK_SERIES) });
        deps.switchService.getSwitchConfig = () => ({ enabled: false, switches: [] });
        const res = await engine.evaluateAfterCycle(MONITOR_CFG, deps);
        expect(res.reason).toBe("switch-disabled");
    });

    test("switchId tak ada di allowlist → rule dilewati", async () => {
        const { deps, send } = makeDeps({ rows: makeRows(SICK_SERIES), ruleOver: { switchId: "tidak-ada" } });
        const res = await engine.evaluateAfterCycle(MONITOR_CFG, deps);
        expect(res.actions[0]).toEqual({ switchId: "tidak-ada", action: "skip", reason: "switch-unknown" });
        expect(send).not.toHaveBeenCalled();
    });

    test("sakit baru 2 siklus (butuh 3) → tidak ada aksi", async () => {
        const rows = makeRows({ mni: { far: [0, 30, 30] }, sf: { far: [0, 0, 0] } });
        const { deps, send } = makeDeps({ rows });
        const res = await engine.evaluateAfterCycle(MONITOR_CFG, deps);
        expect(res.actions).toEqual([]);
        expect(send).not.toHaveBeenCalled();
    });

    test("target backup ikut sakit → jangan failover (skip target-unhealthy)", async () => {
        const rows = makeRows({ mni: { far: [30, 30, 30] }, sf: { far: [0, 0, 25] } });
        const { deps, applySwitch, send } = makeDeps({ rows, failoverOver: { mode: "auto" } });
        const res = await engine.evaluateAfterCycle(MONITOR_CFG, deps);
        expect(res.actions[0].reason).toBe("target-unhealthy");
        expect(applySwitch).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
    });

    test("level DEGRADASI tidak memicu rule minLevel GANGGUAN", async () => {
        const rows = makeRows({ mni: { far: [10, 10, 10] }, sf: { far: [0, 0, 0] } });
        const { deps, send } = makeDeps({ rows });
        const res = await engine.evaluateAfterCycle(MONITOR_CFG, deps);
        expect(res.actions).toEqual([]);
        expect(send).not.toHaveBeenCalled();
    });
});

describe("mode propose", () => {
    test("sakit 3 siklus + backup sehat → kirim saran WA sekali (payload {text})", async () => {
        const { deps, send, applySwitch, addIncident } = makeDeps({ rows: makeRows(SICK_SERIES) });
        const res = await engine.evaluateAfterCycle(MONITOR_CFG, deps);
        expect(res.actions[0].action).toBe("propose");
        expect(send).toHaveBeenCalledTimes(1);
        expect(send.mock.calls[0][1]).toEqual({ text: expect.stringContaining("wanfail_propose") });
        expect(applySwitch).not.toHaveBeenCalled();
        expect(addIncident).toHaveBeenCalledWith(expect.objectContaining({ kind: "failover" }));
    });

    test("saran propose memuat baris 'Terdampak' LIVE (getAffectedSet)", async () => {
        const { deps, send } = makeDeps({ rows: makeRows(SICK_SERIES) });
        deps.getAffectedSet = async () => ({ path: "mni", count: 20, confidence: "live", customers: [{ name: "andik" }, { name: "budi" }] });
        await engine.evaluateAfterCycle(MONITOR_CFG, deps);
        expect(send).toHaveBeenCalledTimes(1);
        expect(send.mock.calls[0][1].text).toContain("*20 pelanggan* aktif");
        expect(send.mock.calls[0][1].text).toContain("andik, budi");
    });

    test("buildTerdampakLine: live (jumlah+nama) / unknown / absen / 0", () => {
        const b = engine._internal.buildTerdampakLine;
        const live = b({ count: 5, confidence: "live", customers: [{ name: "a" }, { name: "b" }, { name: "c" }, { name: "d" }] }, "MNI");
        expect(live).toContain("*5 pelanggan* aktif di MNI");
        expect(live).toContain("+2 lagi");
        expect(b({ count: null, confidence: "unknown" }, "MNI")).toContain("tak bisa dipastikan");
        expect(b(null, "MNI")).toBe("");
        expect(b({ count: 0, confidence: "live", customers: [] }, "MNI")).toContain("*0 pelanggan*");
    });

    test("saran kedua dalam proposeCooldown → tidak dikirim ulang", async () => {
        const { deps, send } = makeDeps({ rows: makeRows(SICK_SERIES) });
        await engine.evaluateAfterCycle(MONITOR_CFG, deps);
        await engine.evaluateAfterCycle(MONITOR_CFG, deps);
        expect(send).toHaveBeenCalledTimes(1);
    });

    test("switch ternyata sudah applied → tidak menyarankan, fase jadi APPLIED", async () => {
        const { deps, send } = makeDeps({ rows: makeRows(SICK_SERIES), applied: true });
        await engine.evaluateAfterCycle(MONITOR_CFG, deps);
        expect(send).not.toHaveBeenCalled();
        expect(engine.getRuleStates()["mni-to-sf"].phase).toBe("APPLIED");
    });
});

describe("mode auto", () => {
    test("eksekusi applySwitch dengan actor auto + notifikasi mulai", async () => {
        const { deps, send, applySwitch } = makeDeps({
            rows: makeRows(SICK_SERIES),
            failoverOver: { mode: "auto" }
        });
        const res = await engine.evaluateAfterCycle(MONITOR_CFG, deps);
        expect(res.actions[0].action).toBe("auto_apply");
        expect(applySwitch).toHaveBeenCalledWith("mni-to-sf", "apply", { label: "bot:auto-failover" });
        expect(send.mock.calls[0][1].text).toContain("wanfail_auto_start");
        expect(engine.getRuleStates()["mni-to-sf"].phase).toBe("APPLIED");
    });

    test("status router tak terbaca → JANGAN menulis", async () => {
        const { deps, applySwitch, getStatus } = makeDeps({
            rows: makeRows(SICK_SERIES),
            failoverOver: { mode: "auto" }
        });
        getStatus.mockResolvedValue({ ok: false });
        const res = await engine.evaluateAfterCycle(MONITOR_CFG, deps);
        expect(res.actions[0].reason).toBe("status-unreadable");
        expect(applySwitch).not.toHaveBeenCalled();
    });

    test("applySwitch gagal → alert gagal + cooldown (tak diulang siklus berikut)", async () => {
        const { deps, send, applySwitch } = makeDeps({
            rows: makeRows(SICK_SERIES),
            failoverOver: { mode: "auto" }
        });
        applySwitch.mockResolvedValue({ ok: false, message: "router menolak" });
        const res1 = await engine.evaluateAfterCycle(MONITOR_CFG, deps);
        expect(res1.actions[0].action).toBe("error");
        expect(send.mock.calls.some((c) => c[1].text.includes("wanfail_auto_fail"))).toBe(true);
        const res2 = await engine.evaluateAfterCycle(MONITOR_CFG, deps);
        expect(res2.actions[0].reason).toBe("cooldown");
        expect(applySwitch).toHaveBeenCalledTimes(1);
    });

    test("kuota harian habis → skip daily-cap", async () => {
        const { deps, applySwitch } = makeDeps({
            rows: makeRows(SICK_SERIES),
            failoverOver: { mode: "auto", maxAutoActionsPerDay: 1 },
            incidents: [{
                kind: "failover",
                created_at: new Date(NOW - 60 * 60 * 1000).toISOString(),
                detail: JSON.stringify({ switchId: "mni-to-sf", action: "auto_apply" })
            }, {
                kind: "switch",
                created_at: new Date(NOW - 30 * 60 * 1000).toISOString(),
                detail: JSON.stringify({ id: "mni-to-sf", direction: "restore", actor: "admin:X" })
            }]
        });
        const res = await engine.evaluateAfterCycle(MONITOR_CFG, deps);
        expect(res.actions[0].reason).toBe("daily-cap");
        expect(applySwitch).not.toHaveBeenCalled();
    });

    test("bolak-balik ≥ flapLockCount pasang → dikunci + alert lock sekali", async () => {
        const mk = (minAgo, action) => ({
            kind: "failover",
            created_at: new Date(NOW - minAgo * 60 * 1000).toISOString(),
            detail: JSON.stringify({ switchId: "mni-to-sf", action })
        });
        const { deps, send, applySwitch } = makeDeps({
            rows: makeRows(SICK_SERIES),
            failoverOver: { mode: "auto", maxAutoActionsPerDay: 10 },
            incidents: [
                mk(300, "auto_apply"), mk(240, "auto_restore"),
                mk(180, "auto_apply"), mk(120, "auto_restore"),
                {
                    kind: "switch",
                    created_at: new Date(NOW - 100 * 60 * 1000).toISOString(),
                    detail: JSON.stringify({ id: "mni-to-sf", direction: "restore", actor: "bot:auto-failover" })
                }
            ]
        });
        const res = await engine.evaluateAfterCycle(MONITOR_CFG, deps);
        expect(res.actions[0].action).toBe("lock");
        expect(applySwitch).not.toHaveBeenCalled();
        expect(send.mock.calls.some((c) => c[1].text.includes("wanfail_lock"))).toBe(true);
        // Siklus berikutnya: masih terkunci, tidak ada alert kedua.
        const sendCountAfterLock = send.mock.calls.length;
        const res2 = await engine.evaluateAfterCycle(MONITOR_CFG, deps);
        expect(res2.actions[0].reason).toBe("locked");
        expect(send.mock.calls.length).toBe(sendCountAfterLock);
    });
});

// #b342 — kunci anti-flapping WAJIB tahan restart (dulu in-memory → reset 0 tiap restart).
describe("#b342 — lock anti-flapping dipulihkan dari insiden setelah restart", () => {
    const lockInc = (minAgo) => ({
        kind: "failover",
        created_at: new Date(NOW - minAgo * 60 * 1000).toISOString(),
        detail: JSON.stringify({ switchId: "mni-to-sf", action: "lock", autoApplies: 4 })
    });

    test("insiden 'lock' 1 jam lalu (window 24 jam) → rule TETAP terkunci setelah restart, tak auto-switch, tak spam alert", async () => {
        // Tak ada 4 auto-event di run ini (di prod tergusur cap-200) — HANYA insiden lock.
        const { deps, applySwitch, send } = makeDeps({
            rows: makeRows(SICK_SERIES),
            failoverOver: { mode: "auto", maxAutoActionsPerDay: 10 },
            incidents: [lockInc(60)],
        });
        const res = await engine.evaluateAfterCycle(MONITOR_CFG, deps);
        expect(res.actions[0].reason).toBe("locked");
        expect(applySwitch).not.toHaveBeenCalled();
        // lockNotified dipulihkan → tak kirim ulang alert lock saat restart.
        expect(send.mock.calls.some((c) => c[1] && c[1].text && c[1].text.includes("wanfail_lock"))).toBe(false);
    });

    test("insiden 'lock' KEDALUWARSA (25 jam lalu > flapLockHours 24) → tidak lagi mengunci", async () => {
        const { deps } = makeDeps({
            rows: makeRows(SICK_SERIES),
            failoverOver: { mode: "auto", maxAutoActionsPerDay: 10 },
            incidents: [lockInc(25 * 60)],
        });
        const res = await engine.evaluateAfterCycle(MONITOR_CFG, deps);
        expect(res.actions[0].reason).not.toBe("locked");
    });
});

describe("fase APPLIED & revert", () => {
    test("autoRevert: gateway pulih N siklus → restoreSwitch otomatis", async () => {
        const { deps, applySwitch, restoreSwitch, getStatus, send } = makeDeps({
            rows: makeRows(SICK_SERIES),
            failoverOver: { mode: "auto" },
            ruleOver: { autoRevert: true, revertHealthyCycles: 3, cooldownMinutes: 30 }
        });
        await engine.evaluateAfterCycle(MONITOR_CFG, deps); // auto_apply
        expect(applySwitch).toHaveBeenCalledTimes(1);

        // Setelah switch: far MNI ikut backup (sehat), gateway MNI pulih 3 siklus.
        const rowsPulih = makeRows({ mni: { far: [0, 0, 0], gw: [0, 1, 0] }, sf: { far: [0, 0, 0] } });
        deps.getRepo = () => ({ getRecentProbes: async () => rowsPulih, getIncidents: async () => [], addIncident: async () => {} });
        getStatus.mockResolvedValue({ ok: true, enabled: true, switches: [{ id: "mni-to-sf", applied: true }] });
        const later = NOW + 31 * 60 * 1000; // lewati cooldown
        deps.nowMs = () => later;
        const res = await engine.evaluateAfterCycle(MONITOR_CFG, deps);
        expect(res.actions[0].action).toBe("auto_restore");
        expect(restoreSwitch).toHaveBeenCalledWith("mni-to-sf", { label: "bot:auto-failover" });
        expect(send.mock.calls.some((c) => c[1].text.includes("wanfail_auto_revert_start"))).toBe(true);
        expect(engine.getRuleStates()["mni-to-sf"].phase).toBe("IDLE");
    });

    test("gateway masih sakit → tahan di jalur backup (tidak revert)", async () => {
        const { deps, restoreSwitch } = makeDeps({
            rows: makeRows(SICK_SERIES),
            failoverOver: { mode: "auto" },
            ruleOver: { autoRevert: true, revertHealthyCycles: 3 }
        });
        await engine.evaluateAfterCycle(MONITOR_CFG, deps); // auto_apply
        const rowsMasihSakit = makeRows({ mni: { far: [0, 0, 0], gw: [0, 0, 30] }, sf: { far: [0, 0, 0] } });
        deps.getRepo = () => ({ getRecentProbes: async () => rowsMasihSakit, getIncidents: async () => [], addIncident: async () => {} });
        deps.nowMs = () => NOW + 31 * 60 * 1000;
        await engine.evaluateAfterCycle(MONITOR_CFG, deps);
        expect(restoreSwitch).not.toHaveBeenCalled();
    });

    test("tanpa autoRevert: gateway pulih → saran kembalikan (bukan aksi tulis)", async () => {
        const { deps, restoreSwitch, send, getStatus } = makeDeps({
            rows: makeRows(SICK_SERIES),
            failoverOver: { mode: "auto" },
            ruleOver: { autoRevert: false, revertHealthyCycles: 3 }
        });
        await engine.evaluateAfterCycle(MONITOR_CFG, deps); // auto_apply
        const rowsPulih = makeRows({ mni: { far: [0, 0, 0], gw: [0, 0, 0] }, sf: { far: [0, 0, 0] } });
        deps.getRepo = () => ({ getRecentProbes: async () => rowsPulih, getIncidents: async () => [], addIncident: async () => {} });
        getStatus.mockResolvedValue({ ok: true, enabled: true, switches: [{ id: "mni-to-sf", applied: true }] });
        deps.nowMs = () => NOW + 31 * 60 * 1000;
        const res = await engine.evaluateAfterCycle(MONITOR_CFG, deps);
        expect(res.actions[0].action).toBe("revert_propose");
        expect(restoreSwitch).not.toHaveBeenCalled();
        expect(send.mock.calls.some((c) => c[1].text.includes("wanfail_revert_propose"))).toBe(true);
    });

    test("admin sudah mengembalikan manual → fase kembali IDLE tanpa aksi", async () => {
        const { deps, restoreSwitch, getStatus } = makeDeps({
            rows: makeRows(SICK_SERIES),
            failoverOver: { mode: "auto" },
            ruleOver: { autoRevert: true, revertHealthyCycles: 3 }
        });
        await engine.evaluateAfterCycle(MONITOR_CFG, deps); // auto_apply
        const rowsPulih = makeRows({ mni: { far: [0, 0, 0], gw: [0, 0, 0] }, sf: { far: [0, 0, 0] } });
        deps.getRepo = () => ({ getRecentProbes: async () => rowsPulih, getIncidents: async () => [], addIncident: async () => {} });
        getStatus.mockResolvedValue({ ok: true, enabled: true, switches: [{ id: "mni-to-sf", applied: false }] });
        deps.nowMs = () => NOW + 31 * 60 * 1000;
        await engine.evaluateAfterCycle(MONITOR_CFG, deps);
        expect(restoreSwitch).not.toHaveBeenCalled();
        expect(engine.getRuleStates()["mni-to-sf"].phase).toBe("IDLE");
    });
});

describe("rehidrasi dari insiden", () => {
    test("insiden switch apply oleh auto-pilot → fase APPLIED + appliedByAuto", async () => {
        const { deps } = makeDeps({
            rows: makeRows({ mni: { far: [0, 0, 0], gw: [0, 0, 30] }, sf: { far: [0, 0, 0] } }),
            incidents: [{
                kind: "switch",
                created_at: new Date(NOW - 10 * 60 * 1000).toISOString(),
                detail: JSON.stringify({ id: "mni-to-sf", direction: "apply", actor: "bot:auto-failover" })
            }]
        });
        await engine.evaluateAfterCycle(MONITOR_CFG, deps);
        const st = engine.getRuleStates()["mni-to-sf"];
        expect(st.phase).toBe("APPLIED");
        expect(st.appliedByAuto).toBe(true);
    });
});

describe("helper murni", () => {
    test("levelForLoss: null dianggap tidak sehat (PUTUS)", () => {
        const t = { lossWarnPct: 5, lossCritPct: 20 };
        expect(engine._internal.levelForLoss(null, t)).toBe("PUTUS");
        expect(engine._internal.levelForLoss(0, t)).toBe("NORMAL");
        expect(engine._internal.levelForLoss(7, t)).toBe("DEGRADASI");
        expect(engine._internal.levelForLoss(25, t)).toBe("GANGGUAN");
        expect(engine._internal.levelForLoss(100, t)).toBe("PUTUS");
    });

    test("buildSeries memisah far vs gateway per jalur", () => {
        const rows = makeRows({ mni: { far: [1, 2], gw: [3] } });
        const s = engine._internal.buildSeries(rows).get("mni");
        expect(s.far.map((c) => c.lossAvg)).toEqual([1, 2]);
        expect(s.gw.map((c) => c.lossAvg)).toEqual([3]);
    });
});
