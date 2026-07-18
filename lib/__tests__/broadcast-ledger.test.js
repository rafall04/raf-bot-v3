/**
 * Header Doc
 * Purpose: Uji ledger broadcast (lib/broadcast-ledger) — skip nomor terblokir, skip min-gap,
 *   recordSent/lastSentAt, block/unblock, dan FAIL-OPEN (error → tak menahan kirim).
 *   Sqlite in-memory + `now` diinjeksi supaya deterministik.
 * Caller: Jest.
 * Deps: sqlite3, ../broadcast-ledger.
 * MainFuncs: -
 * SideEffects: DB in-memory.
 */
"use strict";

const { createBroadcastLedger } = require("../broadcast-ledger");

function makeLedger(nowRef) {
    return createBroadcastLedger({ sqlite3: require("sqlite3"), dbPath: ":memory:", now: () => nowRef.t });
}

describe("broadcast-ledger", () => {
    let ledger; let nowRef;
    beforeEach(() => { nowRef = { t: 1_000_000_000_000 }; ledger = makeLedger(nowRef); });
    afterEach(async () => { await ledger.close(); });

    test("nomor baru → tidak di-skip", async () => {
        expect(await ledger.shouldSkip("628a@s.whatsapp.net", { minGapMs: 0 })).toEqual({ skip: false });
    });

    test("recordSent → lastSentAt terisi + min-gap men-skip dalam jendela", async () => {
        await ledger.recordSent("628b@s.whatsapp.net");
        expect(await ledger.lastSentAt("628b@s.whatsapp.net")).toBe(nowRef.t);

        // 1 jam kemudian, minGap 24 jam → masih di-skip
        nowRef.t += 3600_000;
        const s1 = await ledger.shouldSkip("628b@s.whatsapp.net", { minGapMs: 24 * 3600_000 });
        expect(s1.skip).toBe(true);

        // 25 jam sejak kirim → tak di-skip lagi
        nowRef.t += 25 * 3600_000;
        const s2 = await ledger.shouldSkip("628b@s.whatsapp.net", { minGapMs: 24 * 3600_000 });
        expect(s2.skip).toBe(false);
    });

    test("minGap 0 → tak pernah di-skip karena gap", async () => {
        await ledger.recordSent("628c@s.whatsapp.net");
        expect((await ledger.shouldSkip("628c@s.whatsapp.net", { minGapMs: 0 })).skip).toBe(false);
    });

    test("block → selalu di-skip; unblock → tidak lagi", async () => {
        await ledger.block("628d@s.whatsapp.net", "opt-out");
        expect(await ledger.isBlocked("628d@s.whatsapp.net")).toBe(true);
        expect((await ledger.shouldSkip("628d@s.whatsapp.net", { minGapMs: 0 })).skip).toBe(true);
        await ledger.unblock("628d@s.whatsapp.net");
        expect(await ledger.isBlocked("628d@s.whatsapp.net")).toBe(false);
        expect((await ledger.shouldSkip("628d@s.whatsapp.net", { minGapMs: 0 })).skip).toBe(false);
    });

    test("recordSent increment count + stats", async () => {
        await ledger.recordSent("628e@s.whatsapp.net");
        await ledger.recordSent("628e@s.whatsapp.net");
        await ledger.block("628f@s.whatsapp.net", "x");
        const st = await ledger.stats();
        expect(st.total).toBe(2);
        expect(st.blocked).toBe(1);
    });

    test("wa-status cache: set/get onWhatsApp", async () => {
        expect(await ledger.getWaStatus("628a@s.whatsapp.net")).toBeNull();
        await ledger.setWaStatus("628a@s.whatsapp.net", true);
        expect((await ledger.getWaStatus("628a@s.whatsapp.net")).registered).toBe(true);
        await ledger.setWaStatus("628b@s.whatsapp.net", false);
        expect((await ledger.getWaStatus("628b@s.whatsapp.net")).registered).toBe(false);
    });

    test("FAIL-OPEN: shouldSkip pada jid kosong → tak menahan", async () => {
        expect(await ledger.shouldSkip("", { minGapMs: 999 })).toEqual({ skip: false });
        expect(await ledger.shouldSkip(null, { minGapMs: 999 })).toEqual({ skip: false });
    });
});
