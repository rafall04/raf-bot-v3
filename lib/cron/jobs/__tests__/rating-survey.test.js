/**
 * Header Doc
 * Purpose: Uji cron survei CSAT (lib/cron/jobs/rating-survey) dgn deps diinjeksi + repo in-memory.
 *   Fokus: (1) targeting benar (kecualikan infra/whitelist-gratis/belum-bayar/tanpa-HP/tanpa-PPPoE
 *   & yang sudah disurvei), (2) kirim lewat antrian → tandai sent, (3) idempoten antar-run,
 *   (4) OFF saat csatSurvey.enabled != true, (5) digest kirim rekap ke owner.
 * Caller: Jest.
 * Deps: sqlite3, ../rating-survey, ../../../csat/csat-time, ../../../../repositories/csat.repository.
 * MainFuncs: -
 * SideEffects: DB in-memory.
 */
"use strict";

const { runRatingSurveyCycle, runRatingDigestCycle } = require("../rating-survey");
const { createCsatRepository } = require("../../../../repositories/csat.repository");
const { periodOf } = require("../../../csat/csat-time");

const PERIOD = periodOf(new Date());
const silent = { log() {}, warn() {}, error() {} };

function makeRepo() {
    return createCsatRepository({ sqlite3: require("sqlite3"), dbPath: ":memory:", now: () => "2026-07-22 09:30:00" });
}

function baseUsers() {
    return [
        { id: 1, name: "Budi", pppoe_username: "budi", phone_number: "628111", subscription: "Reguler", paid: 1 },
        { id: 2, name: "CCTV", account_type: "infrastruktur", pppoe_username: "cctv", phone_number: "628222", subscription: "Reguler", paid: 1 },
        { id: 3, name: "Gratisan", pppoe_username: "gratis", phone_number: "628333", subscription: "Voucher", paid: 1 },
        { id: 4, name: "Nunggak", pppoe_username: "nunggak", phone_number: "628444", subscription: "Reguler", paid: 0 },
        { id: 5, name: "NoPhone", pppoe_username: "nop", phone_number: "", subscription: "Reguler", paid: 1 },
        { id: 6, name: "NoPppoe", pppoe_username: "", phone_number: "628666", subscription: "Reguler", paid: 1 },
    ];
}

function makeDeps(repo, overrides = {}) {
    const sent = [];
    const deps = {
        getUsers: () => baseUsers(),
        getPackages: () => [{ name: "Voucher", profile: "PAKET-VOUCHER", whitelist: true }],
        getConfig: () => ({ csatSurvey: { enabled: true, responseWindowDays: 3, onlyPaid: true }, whatsapp_message_delay: 0 }),
        getRepository: () => repo,
        renderTemplate: (key, data) => `SURVEI utk ${data.nama_pelanggan}`,
        isReady: () => true,
        safeSendMessage: async (jid, msg) => { sent.push({ jid, text: msg.text }); return { success: true }; },
        delay: () => Promise.resolve(),
        isInfrastructure: (u) => u.account_type === "infrastruktur",
        getProfileBySubscription: (sub) => (sub === "Voucher" ? "PAKET-VOUCHER" : "PPPOE-REG"),
        getAdminJids: () => ["628999@s.whatsapp.net"],
        now: () => "2026-07-22 09:30:00",
        logger: silent,
        ...overrides,
    };
    return { deps, sent };
}

describe("runRatingSurveyCycle — targeting & kirim", () => {
    test("hanya pelanggan aktif-bayar-non-infra-non-whitelist yang disurvei", async () => {
        const repo = makeRepo();
        const { deps, sent } = makeDeps(repo);
        const res = await runRatingSurveyCycle(deps);

        expect(res.ok).toBe(true);
        expect(res.surveys).toBe(1);      // hanya Budi
        expect(res.sent).toBe(1);
        expect(sent).toHaveLength(1);
        expect(sent[0].jid).toBe("628111@s.whatsapp.net");
        expect(await repo.hasSurveyForPeriod(1, PERIOD)).toBe(true);
        expect(await repo.hasSurveyForPeriod(2, PERIOD)).toBe(false); // infra
        expect(await repo.hasSurveyForPeriod(3, PERIOD)).toBe(false); // whitelist
        expect(await repo.hasSurveyForPeriod(4, PERIOD)).toBe(false); // belum bayar
        await repo.close();
    });

    test("skip pelanggan yang OPT-OUT survei (balas STOP)", async () => {
        const repo = makeRepo();
        await repo.setSurveyOptout({ user_id: 1, reason: "balas STOP" }); // Budi opt-out
        const { deps, sent } = makeDeps(repo);
        const res = await runRatingSurveyCycle(deps);
        expect(res.surveys).toBe(0); // Budi satu-satunya eligible, kini di-skip
        expect(sent).toHaveLength(0);
        await repo.close();
    });

    test("idempoten: run kedua tak menyurvei ulang", async () => {
        const repo = makeRepo();
        const first = makeDeps(repo);
        await runRatingSurveyCycle(first.deps);
        const second = makeDeps(repo);
        const res2 = await runRatingSurveyCycle(second.deps);
        expect(res2.surveys).toBe(0);
        expect(second.sent).toHaveLength(0);
        await repo.close();
    });

    test("OFF saat csatSurvey.enabled != true", async () => {
        const repo = makeRepo();
        const { deps, sent } = makeDeps(repo, { getConfig: () => ({ csatSurvey: { enabled: false } }) });
        const res = await runRatingSurveyCycle(deps);
        expect(res.ok).toBe(false);
        expect(res.reason).toBe("disabled");
        expect(sent).toHaveLength(0);
        await repo.close();
    });

    test("MODE TES testPhone: hanya kirim ke nomor itu, dedup dilewati", async () => {
        const repo = makeRepo();
        await repo.upsertPending({ user_id: 1, name: "Budi", phone: "628111", period: PERIOD }); // survei sudah ada
        const { deps, sent } = makeDeps(repo, {
            getConfig: () => ({ csatSurvey: { enabled: true, onlyPaid: true, testPhone: "628111" }, whatsapp_message_delay: 0 }),
        });
        const res = await runRatingSurveyCycle(deps);
        expect(res.surveys).toBe(1);
        expect(sent).toHaveLength(1);
        expect(sent[0].jid).toBe("628111@s.whatsapp.net"); // hanya Budi walau eligible lain ada + survei sudah ada
        await repo.close();
    });

    test("nomor pipe-separated -> kirim ke tiap nomor, tetap 1 survei", async () => {
        const repo = makeRepo();
        const { deps, sent } = makeDeps(repo, {
            getUsers: () => [{ id: 1, name: "Budi", pppoe_username: "budi", phone_number: "628111|628112", subscription: "Reguler", paid: 1 }],
        });
        const res = await runRatingSurveyCycle(deps);
        expect(res.surveys).toBe(1);
        expect(sent.map((s) => s.jid).sort()).toEqual(["628111@s.whatsapp.net", "628112@s.whatsapp.net"]);
        await repo.close();
    });
});

describe("#b335 — re-entrancy guard (cron + endpoint manual)", () => {
    test("panggilan tumpang-tindih dilewati (already_running), tak menyurvei dobel", async () => {
        const repo = makeRepo();
        // Tahan run pertama di fase kirim supaya belum melepas kunci.
        let lepas;
        const gate = new Promise((r) => { lepas = r; });
        const first = makeDeps(repo, {
            safeSendMessage: async (_jid, _msg) => { await gate; return { success: true }; },
        });
        const p1 = runRatingSurveyCycle(first.deps); // surveyRunning=true (sinkron sebelum await)
        const second = makeDeps(repo);
        const res2 = await runRatingSurveyCycle(second.deps);
        expect(res2.ok).toBe(false);
        expect(res2.reason).toBe("already_running");
        expect(second.sent).toHaveLength(0); // run kedua tak mengirim apa pun
        lepas();
        await p1;
        await repo.close();
    });

    test("setelah run pertama selesai, run berikutnya boleh jalan lagi", async () => {
        const repo = makeRepo();
        const a = makeDeps(repo);
        const r1 = await runRatingSurveyCycle(a.deps);
        expect(r1.ok).toBe(true);
        // Periode sama → idempoten (0 survei baru), TAPI bukan diblokir 'already_running'.
        const b = makeDeps(repo);
        const r2 = await runRatingSurveyCycle(b.deps);
        expect(r2.ok).toBe(true);
        expect(r2.reason).not.toBe("already_running");
        await repo.close();
    });
});

describe("#b335 — FASE 3: skipped/deferred = tak terkirim (bukan hantu 'sent')", () => {
    function oneUser() {
        return [{ id: 1, name: "Budi", pppoe_username: "budi", phone_number: "628111", subscription: "Reguler", paid: 1 }];
    }

    test("nomor SATU-satunya di-skip (ledger-block) → survei undelivered, bukan terkirim", async () => {
        const repo = makeRepo();
        const { deps } = makeDeps(repo, {
            getUsers: oneUser,
            sendQueue: async ({ items }) => ({
                sent: 0, failed: [],
                skipped: items.map((it) => ({ jid: it.jid, label: it.label, reason: "ledger-block" })),
                deferred: [],
            }),
        });
        const res = await runRatingSurveyCycle(deps);
        expect(res.undelivered).toBe(1);
        expect(res.sent).toBe(0);
        await repo.close();
    });

    test("nomor SATU-satunya deferred (maxPerRun) → survei undelivered", async () => {
        const repo = makeRepo();
        const { deps } = makeDeps(repo, {
            getUsers: oneUser,
            sendQueue: async ({ items }) => ({ sent: 0, failed: [], skipped: [], deferred: items.slice() }),
        });
        const res = await runRatingSurveyCycle(deps);
        expect(res.undelivered).toBe(1);
        expect(res.sent).toBe(0);
        await repo.close();
    });

    test("satu nomor terkirim + satu deferred → survei TETAP terkirim (delivered>=1)", async () => {
        const repo = makeRepo();
        const { deps } = makeDeps(repo, {
            getUsers: () => [{ id: 1, name: "Budi", pppoe_username: "budi", phone_number: "628111|628112", subscription: "Reguler", paid: 1 }],
            sendQueue: async ({ items }) => ({
                sent: 1, failed: [],
                skipped: [],
                deferred: items.filter((it) => it.jid === "628112@s.whatsapp.net"), // nomor kedua ditunda
            }),
        });
        const res = await runRatingSurveyCycle(deps);
        expect(res.sent).toBe(1);       // survei tetap dihitung terkirim
        expect(res.undelivered).toBe(0);
        await repo.close();
    });
});

describe("runRatingDigestCycle", () => {
    test("kirim rekap ke owner setelah ada survei", async () => {
        const repo = makeRepo();
        const survey = makeDeps(repo);
        await runRatingSurveyCycle(survey.deps);

        const dig = makeDeps(repo);
        const res = await runRatingDigestCycle(dig.deps);
        expect(res.ok).toBe(true);
        expect(res.recipients).toBe(1);
        // 1 pesan survei (Budi) + 1 pesan digest (owner) memakai sent list terpisah per makeDeps
        expect(dig.sent).toHaveLength(1);
        expect(dig.sent[0].jid).toBe("628999@s.whatsapp.net");
        expect(dig.sent[0].text).toContain("Rekap Survei");
        await repo.close();
    });

    test("tak spam owner bila belum ada survei", async () => {
        const repo = makeRepo();
        const { deps, sent } = makeDeps(repo);
        const res = await runRatingDigestCycle(deps);
        expect(res.skipped).toBe("no-data");
        expect(sent).toHaveLength(0);
        await repo.close();
    });
});
