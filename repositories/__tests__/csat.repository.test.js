/**
 * Header Doc
 * Purpose: Uji repository CSAT (repositories/csat.repository) — skema, idempotensi upsert,
 *   transisi status (sent->rated->done), jendela kedaluwarsa getActiveByUserId, dan agregat rekap.
 *   Pakai sqlite in-memory (dbPath ':memory:') + `now` diinjeksi supaya deterministik.
 * Caller: Jest.
 * Deps: sqlite3, ../csat.repository.
 * MainFuncs: -
 * SideEffects: DB in-memory (hilang saat close).
 */
"use strict";

const { createCsatRepository } = require("../csat.repository");

function makeRepo() {
    return createCsatRepository({ sqlite3: require("sqlite3"), dbPath: ":memory:", now: () => "2026-07-22 09:30:00" });
}

describe("csat.repository", () => {
    let repo;
    beforeEach(() => { repo = makeRepo(); });
    afterEach(async () => { await repo.close(); });

    test("upsertPending idempoten per (user,period)", async () => {
        const a = await repo.upsertPending({ user_id: 1, name: "Budi", phone: "628111", period: "2026-07" });
        expect(a.created).toBe(true);
        const b = await repo.upsertPending({ user_id: 1, name: "Budi", phone: "628111", period: "2026-07" });
        expect(b.created).toBe(false);
        expect(b.id).toBe(a.id);
        expect(await repo.hasSurveyForPeriod(1, "2026-07")).toBe(true);
        expect(await repo.hasSurveyForPeriod(1, "2026-08")).toBe(false);
    });

    test("alur sent -> rated -> done + getActiveByUserId", async () => {
        const { id } = await repo.upsertPending({ user_id: 7, name: "Sari", period: "2026-07" });
        // pending belum aktif utk balasan
        expect(await repo.getActiveByUserId(7, "2026-07-22 10:00:00")).toBeNull();

        await repo.markSent(id, { sent_at: "2026-07-22 09:30:00", expires_at: "2026-07-25 09:30:00" });
        let active = await repo.getActiveByUserId(7, "2026-07-22 10:00:00");
        expect(active).not.toBeNull();
        expect(active.status).toBe("sent");

        await repo.recordRating(id, { score: 2, sentiment: "neg", rated_at: "2026-07-22 10:00:00" });
        active = await repo.getActiveByUserId(7, "2026-07-22 10:05:00");
        expect(active.status).toBe("rated"); // masih aktif utk komentar
        expect(active.score).toBe(2);

        await repo.recordComment(id, { comment: "lemot tiap malam", commented_at: "2026-07-22 10:05:00" });
        expect(await repo.getActiveByUserId(7, "2026-07-22 10:10:00")).toBeNull(); // done -> tak aktif
    });

    test("getActiveByUserId menghormati kedaluwarsa", async () => {
        const { id } = await repo.upsertPending({ user_id: 8, period: "2026-07" });
        await repo.markSent(id, { sent_at: "2026-07-22 09:30:00", expires_at: "2026-07-25 09:30:00" });
        // now setelah expires -> tidak aktif
        expect(await repo.getActiveByUserId(8, "2026-07-26 00:00:00")).toBeNull();
    });

    test("markUndelivered menandai gagal kirim", async () => {
        const { id } = await repo.upsertPending({ user_id: 9, period: "2026-07" });
        await repo.markUndelivered(id);
        expect(await repo.getActiveByUserId(9, "2026-07-22 10:00:00")).toBeNull();
    });

    test("getReport + listDetractors + listNonResponders", async () => {
        const mk = async (uid, period, score, comment) => {
            const { id } = await repo.upsertPending({ user_id: uid, name: `U${uid}`, phone: `62${uid}`, period });
            await repo.markSent(id, { sent_at: "2026-07-22 09:30:00", expires_at: "2026-07-25 09:30:00" });
            if (score != null) {
                await repo.recordRating(id, { score, sentiment: score <= 2 ? "neg" : "pos", rated_at: "2026-07-22 10:00:00" });
                if (comment) await repo.recordComment(id, { comment, commented_at: "2026-07-22 10:05:00" });
            }
            return id;
        };
        await mk(1, "2026-07", 5, null);
        await mk(2, "2026-07", 4, "oke");
        await mk(3, "2026-07", 1, "sering mati");
        await mk(4, "2026-07", null, null); // terkirim, tak menjawab

        const rep = await repo.getReport("2026-07");
        expect(rep.delivered).toBe(4);
        expect(rep.responded).toBe(3);
        expect(rep.avg).toBeCloseTo((5 + 4 + 1) / 3, 2);
        expect(rep.distribution[5]).toBe(1);
        expect(rep.distribution[1]).toBe(1);
        expect(rep.responseRate).toBeCloseTo(75, 1);

        const det = await repo.listDetractors("2026-07");
        expect(det).toHaveLength(1);
        expect(det[0].score).toBe(1);

        const nr = await repo.listNonResponders("2026-07");
        expect(nr).toHaveLength(1);
        expect(nr[0].name).toBe("U4");
    });

    test("getTrend agregat per periode terurut terbaru", async () => {
        const mk = async (uid, period, score) => {
            const { id } = await repo.upsertPending({ user_id: uid, period });
            await repo.markSent(id, { sent_at: "x", expires_at: "9999-12-31 00:00:00" });
            if (score != null) await repo.recordRating(id, { score, sentiment: "x", rated_at: "x" });
        };
        await mk(1, "2026-06", 4);
        await mk(2, "2026-06", 2);
        await mk(3, "2026-07", 5);
        const trend = await repo.getTrend({ limit: 12 });
        expect(trend.map((t) => t.period)).toEqual(["2026-07", "2026-06"]); // terbaru dulu
        const jun = trend.find((t) => t.period === "2026-06");
        expect(jun.delivered).toBe(2);
        expect(jun.responded).toBe(2);
        expect(jun.avg).toBeCloseTo(3, 5);
    });

    test("setOptout menghentikan status aktif", async () => {
        const { id } = await repo.upsertPending({ user_id: 10, period: "2026-07" });
        await repo.markSent(id, { sent_at: "2026-07-22 09:30:00", expires_at: "2026-07-25 09:30:00" });
        await repo.setOptout(id, "2026-07-22 10:00:00");
        expect(await repo.getActiveByUserId(10, "2026-07-22 10:05:00")).toBeNull();
    });
});
