/**
 * Header Doc
 * Purpose: Uji repository kualitas jalur upstream — insert probe/route-state, ringkasan
 *          window+baseline, snapshot route terakhir, dan prune retensi. Pakai SQLite in-memory
 *          (tanpa file, tanpa teardown bocor).
 * Caller: jest.
 * Deps: `../upstream-quality.repository`, `sqlite3`.
 * MainFuncs: —
 * SideEffects: Tidak ada (db :memory: per test).
 */
"use strict";

const sqlite3 = require("sqlite3").verbose();
const { createUpstreamQualityRepository } = require("../upstream-quality.repository");

function makeRepo() {
    return createUpstreamQualityRepository({ db: new sqlite3.Database(":memory:") });
}

function isoMinutesAgo(minutes) {
    return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

const BASE_PROBE = {
    path: "mni",
    routing_table: "MNI",
    target: "8.8.4.4",
    target_key: "google",
    sent: 5,
    received: 5,
    loss_pct: 0,
    rtt_min_ms: 60,
    rtt_avg_ms: 68,
    rtt_max_ms: 75,
    jitter_ms: 3,
    error: null
};

describe("upstream-quality.repository", () => {
    let repo;

    beforeEach(() => {
        repo = makeRepo();
    });

    afterEach(async () => {
        await repo.close();
    });

    test("insertProbes + getRecentProbes mengembalikan baris tersimpan", async () => {
        const probedAt = isoMinutesAgo(1);
        const n = await repo.insertProbes(probedAt, [
            BASE_PROBE,
            { ...BASE_PROBE, path: "gmdp", routing_table: null, rtt_avg_ms: 25 }
        ]);
        expect(n).toBe(2);

        const rows = await repo.getRecentProbes({ sinceIso: isoMinutesAgo(10) });
        expect(rows).toHaveLength(2);
        const mni = rows.find((r) => r.path === "mni");
        expect(mni.ok).toBe(1);
        expect(mni.rtt_avg_ms).toBe(68);

        const filtered = await repo.getRecentProbes({ sinceIso: isoMinutesAgo(10), path: "gmdp" });
        expect(filtered).toHaveLength(1);
        expect(filtered[0].routing_table).toBeNull();
    });

    test("baris error tersimpan dengan ok=0", async () => {
        await repo.insertProbes(isoMinutesAgo(1), [{ ...BASE_PROBE, error: "trap: timeout" }]);
        const rows = await repo.getRecentProbes({ sinceIso: isoMinutesAgo(10) });
        expect(rows[0].ok).toBe(0);
        expect(rows[0].error).toContain("timeout");
    });

    test("getSummary memisahkan window vs baseline dan mengecualikan sampel sakit dari baseline", async () => {
        // Baseline sehat 2 jam lalu: RTT 60
        await repo.insertProbes(isoMinutesAgo(120), [{ ...BASE_PROBE, rtt_avg_ms: 60 }]);
        // Sampel sakit 90 menit lalu (loss 80) — TIDAK boleh meracuni baseline
        await repo.insertProbes(isoMinutesAgo(90), [{ ...BASE_PROBE, loss_pct: 80, rtt_avg_ms: 300 }]);
        // Window 5 menit terakhir: RTT 150
        await repo.insertProbes(isoMinutesAgo(5), [{ ...BASE_PROBE, rtt_avg_ms: 150 }]);
        await repo.insertProbes(isoMinutesAgo(3), [{ ...BASE_PROBE, rtt_avg_ms: 150 }]);

        const summary = await repo.getSummary({
            windowSinceIso: isoMinutesAgo(15),
            baselineSinceIso: isoMinutesAgo(24 * 60)
        });
        expect(summary).toHaveLength(1);
        const row = summary[0];
        expect(Number(row.samples)).toBe(2);
        expect(Number(row.rtt_avg)).toBe(150);
        // Baseline = rata-rata sampel sehat (60 + 150 + 150) / 3 — sampel loss 80 dikecualikan.
        expect(row.baseline).not.toBeNull();
        expect(Number(row.baseline.rtt_avg)).toBeCloseTo(120, 0);
    });

    test("getLatestRouteStates hanya snapshot terakhir", async () => {
        await repo.insertRouteStates(isoMinutesAgo(10), [
            { mark: "MNI", gateway: "Tunnel-MNI", distance: 1, active: 1, disabled: 0 }
        ]);
        await repo.insertRouteStates(isoMinutesAgo(1), [
            { mark: "MNI", gateway: "Tunnel-MNI", distance: 1, active: 0, disabled: 0 },
            { mark: "MNI", gateway: "SF", distance: 2, active: 1, disabled: 0 }
        ]);
        const rows = await repo.getLatestRouteStates();
        expect(rows).toHaveLength(2);
        expect(rows.every((r) => r.checked_at === rows[0].checked_at)).toBe(true);
        const primary = rows.find((r) => r.distance === 1);
        expect(primary.active).toBe(0);
    });

    test("pruneOld menghapus data lebih tua dari retensi", async () => {
        await repo.insertProbes(new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(), [BASE_PROBE]);
        await repo.insertProbes(isoMinutesAgo(5), [BASE_PROBE]);
        const result = await repo.pruneOld(30);
        expect(result.probes).toBe(1);
        const rows = await repo.getRecentProbes({ sinceIso: new Date(0).toISOString() });
        expect(rows).toHaveLength(1);
    });
});
