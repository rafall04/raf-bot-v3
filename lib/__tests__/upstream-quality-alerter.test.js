/**
 * Header Doc
 * Purpose: Uji alerter jalur upstream — gate default mati, alert setelah N siklus sakit beruntun
 *          (anti-flap), saran steer MNI→SF, cooldown, dan notif pulih setelah M siklus sehat.
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
        send: async (jid, text) => { sent.push({ jid, text }); return { delivered: true }; },
        getAdminJids: () => ["628111@s.whatsapp.net"],
        renderResponseTemplate: (key, fallback) => fallback,
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
});
