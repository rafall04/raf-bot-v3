/**
 * Header Doc
 * Purpose: Uji state-machine penangkap balasan survei (lib/csat/csat-survey-service.handleInboundReply)
 *   memakai repo sqlite in-memory NYATA. Fokus: (1) rating -> tanya komentar -> simpan komentar,
 *   (2) optout, (3) `unclear` TIDAK membajak pesan (balik false), (4) tanpa survei aktif -> false,
 *   (5) jendela komentar habis -> finalisasi & lepaskan pesan.
 * Caller: Jest.
 * Deps: sqlite3, ../csat-survey-service, ../../../repositories/csat.repository.
 * MainFuncs: -
 * SideEffects: DB in-memory.
 */
"use strict";

const service = require("../csat-survey-service");
const { createCsatRepository } = require("../../../repositories/csat.repository");

function makeRepo() {
    return createCsatRepository({ sqlite3: require("sqlite3"), dbPath: ":memory:", now: () => "2026-07-22 09:30:00" });
}

async function seedSent(repo, userId) {
    const { id } = await repo.upsertPending({ user_id: userId, name: "Budi", phone: "628111", period: "2026-07" });
    await repo.markSent(id, { sent_at: "2026-07-22 09:30:00", expires_at: "2026-07-25 09:30:00" });
    return id;
}

const cfg = { csatSurvey: { commentWindowMinutes: 60 } };

describe("handleInboundReply", () => {
    let repo;
    let replies;
    const reply = (t) => { replies.push(t); };
    beforeEach(() => { repo = makeRepo(); replies = []; });
    afterEach(async () => { await repo.close(); });

    test("rating -> tanya komentar -> simpan komentar -> done", async () => {
        const id = await seedSent(repo, 1);

        const h1 = await service.handleInboundReply({
            user: { id: 1, name: "Budi" }, text: "4 mas", reply, repo, config: cfg,
            now: () => "2026-07-22 09:35:00", logger: { log() {} },
        });
        expect(h1).toBe(true);
        expect(replies).toHaveLength(1);
        let row = await repo.getActiveByUserId(1, "2026-07-22 09:36:00");
        expect(row.status).toBe("rated");
        expect(row.score).toBe(4);

        const h2 = await service.handleInboundReply({
            user: { id: 1, name: "Budi" }, text: "kadang malam agak lemot", reply, repo, config: cfg,
            now: () => "2026-07-22 09:50:00", logger: { log() {} },
        });
        expect(h2).toBe(true);
        expect(replies).toHaveLength(2);
        row = await repo.getActiveByUserId(1, "2026-07-22 09:55:00");
        expect(row).toBeNull(); // done
        expect(id).toBeTruthy();
    });

    test("optout menghentikan survei", async () => {
        await seedSent(repo, 2);
        const h = await service.handleInboundReply({
            user: { id: 2 }, text: "stop", reply, repo, config: cfg,
            now: () => "2026-07-22 09:35:00", logger: { log() {} },
        });
        expect(h).toBe(true);
        expect(await repo.getActiveByUserId(2, "2026-07-22 09:40:00")).toBeNull();
    });

    test("optout STOP → catat opt-out survei PERMANEN", async () => {
        await seedSent(repo, 8);
        const h = await service.handleInboundReply({
            user: { id: 8 }, text: "stop", reply, repo, config: cfg,
            now: () => "2026-07-22 09:35:00", logger: { log() {} },
        });
        expect(h).toBe(true);
        expect(await repo.isSurveyOptedOut(8)).toBe(true);
    });

    test("unclear TIDAK membajak (balik false, survei tetap aktif)", async () => {
        await seedSent(repo, 3);
        const h = await service.handleInboundReply({
            user: { id: 3 }, text: "cek koneksi dong", reply, repo, config: cfg,
            now: () => "2026-07-22 09:35:00", logger: { log() {} },
        });
        expect(h).toBe(false);
        expect(replies).toHaveLength(0);
        expect(await repo.getActiveByUserId(3, "2026-07-22 09:40:00")).not.toBeNull();
    });

    test("tanpa survei aktif -> false cepat", async () => {
        const h = await service.handleInboundReply({
            user: { id: 999 }, text: "5", reply, repo, config: cfg,
            now: () => "2026-07-22 09:35:00", logger: { log() {} },
        });
        expect(h).toBe(false);
    });

    test("jendela komentar habis -> finalisasi & lepaskan pesan (false)", async () => {
        await seedSent(repo, 4);
        await service.handleInboundReply({
            user: { id: 4 }, text: "2", reply, repo, config: cfg,
            now: () => "2026-07-22 09:30:00", logger: { log() {} },
        });
        // komentar 90 menit kemudian (window 60) -> lepaskan
        const h = await service.handleInboundReply({
            user: { id: 4 }, text: "ini keluhan baru", reply, repo, config: cfg,
            now: () => "2026-07-22 11:00:00", logger: { log() {} },
        });
        expect(h).toBe(false);
        expect(await repo.getActiveByUserId(4, "2026-07-22 11:05:00")).toBeNull(); // sudah difinalisasi done
    });

    test("user tanpa id -> false", async () => {
        const h = await service.handleInboundReply({ user: {}, text: "5", reply, repo, config: cfg, logger: { log() {} } });
        expect(h).toBe(false);
    });

    test("P1: skor rendah -> alert detractor ke owner (rating lalu komentar)", async () => {
        await seedSent(repo, 5);
        const alerts = [];
        const notifyOwner = (text, label) => { alerts.push({ text, label }); };
        await service.handleInboundReply({
            user: { id: 5, name: "Budi" }, text: "1", reply, repo, config: cfg, notifyOwner,
            now: () => "2026-07-22 09:35:00", logger: { log() {} },
        });
        expect(alerts).toHaveLength(1);
        expect(alerts[0].label).toBe("csat-detractor-rating");
        expect(alerts[0].text).toContain("628111"); // P2/alert: nomor HP ikut

        await service.handleInboundReply({
            user: { id: 5, name: "Budi" }, text: "lemot tiap malam", reply, repo, config: cfg, notifyOwner,
            now: () => "2026-07-22 09:40:00", logger: { log() {} },
        });
        expect(alerts).toHaveLength(2);
        expect(alerts[1].label).toBe("csat-detractor-comment");
        expect(alerts[1].text).toContain("lemot tiap malam");
    });

    test("P1: skor tinggi -> TIDAK alert detractor", async () => {
        await seedSent(repo, 6);
        const alerts = [];
        await service.handleInboundReply({
            user: { id: 6, name: "Budi" }, text: "5", reply, repo, config: cfg,
            notifyOwner: (t, l) => alerts.push({ t, l }),
            now: () => "2026-07-22 09:35:00", logger: { log() {} },
        });
        expect(alerts).toHaveLength(0);
    });

    test("P1: alertDetractor=false -> TIDAK alert walau skor rendah", async () => {
        await seedSent(repo, 7);
        const alerts = [];
        await service.handleInboundReply({
            user: { id: 7, name: "Budi" }, text: "1", reply, repo,
            config: { csatSurvey: { commentWindowMinutes: 60, alertDetractor: false } },
            notifyOwner: (t, l) => alerts.push({ t, l }),
            now: () => "2026-07-22 09:35:00", logger: { log() {} },
        });
        expect(alerts).toHaveLength(0);
    });
});
