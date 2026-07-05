"use strict";

const sqlite3 = require("sqlite3");
const { createOltEventRepository } = require("../olt-event.repository");

function makeRepo() {
    let t = 1000000;
    const clock = {
        now: () => t,
        set: (v) => { t = v; },
    };
    const db = new sqlite3.Database(":memory:");
    const repo = createOltEventRepository({ db, now: clock.now });
    return { repo, clock, db };
}

describe("olt-event.repository", () => {
    test("record + list dengan enrich pelanggan", async () => {
        const { repo } = makeRepo();
        await repo.recordEvent({
            event_type: "los", mac: "AA:BB:CC:00:00:01", slot: 1, onu: 2, olt_id: "olt-x", ts_ms: 1000,
            customer: { id: 7, name: "Budi", pppoe_username: "budi", phone: "0812", address: "Jl. A" },
        });
        const rows = await repo.listEvents({});
        expect(rows.length).toBe(1);
        expect(rows[0].event_type).toBe("los");
        expect(rows[0].customer_name).toBe("Budi");
        expect(rows[0].pppoe_username).toBe("budi");
        expect(rows[0].phone).toBe("0812");
        expect(rows[0].slot).toBe("1");
    });

    test("tipe tak valid ditolak", async () => {
        const { repo } = makeRepo();
        const r = await repo.recordEvent({ event_type: "bogus", mac: "AA" });
        expect(r.saved).toBe(false);
        expect(r.reason).toBe("invalid_type");
    });

    test("dedup state: down berturut untuk MAC sama → hanya 1 baris", async () => {
        const { repo } = makeRepo();
        await repo.recordEvent({ event_type: "los", mac: "M1", ts_ms: 1000 });
        // Jauh kemudian (bukan window waktu), ONU masih down → tetap dedup.
        const r2 = await repo.recordEvent({ event_type: "los", mac: "M1", ts_ms: 5 * 60000 });
        expect(r2.deduped).toBe(true);
        expect((await repo.listEvents({})).length).toBe(1);
    });

    test("discovery tanpa down sebelumnya → dilewati", async () => {
        const { repo } = makeRepo();
        const r = await repo.recordEvent({ event_type: "discovery", mac: "M2", ts_ms: 1000 });
        expect(r.deduped).toBe(true);
        expect((await repo.listEvents({})).length).toBe(0);
    });

    test("discovery memasangkan durasi dengan down terakhir", async () => {
        const { repo } = makeRepo();
        await repo.recordEvent({ event_type: "los", mac: "M3", ts_ms: 1000 });
        const rec = await repo.recordEvent({ event_type: "discovery", mac: "M3", ts_ms: 1000 + 5 * 60000 });
        expect(rec.saved).toBe(true);
        const rows = await repo.listEvents({ type: "discovery" });
        expect(rows[0].down_ts_ms).toBe(1000);
        expect(rows[0].duration_ms).toBe(5 * 60000);
    });

    test("flap: los → discovery → los menghasilkan 3 baris", async () => {
        const { repo } = makeRepo();
        await repo.recordEvent({ event_type: "los", mac: "M4", ts_ms: 1000 });
        await repo.recordEvent({ event_type: "discovery", mac: "M4", ts_ms: 3000 });
        await repo.recordEvent({ event_type: "los", mac: "M4", ts_ms: 5000 });
        expect((await repo.listEvents({})).length).toBe(3);
    });

    test("filter q mencari nama/pppoe/mac", async () => {
        const { repo } = makeRepo();
        await repo.recordEvent({ event_type: "los", mac: "AA", ts_ms: 1000, customer: { name: "Siti", pppoe_username: "siti-01" } });
        await repo.recordEvent({ event_type: "los", mac: "BB", ts_ms: 1000, customer: { name: "Budi" } });
        const byName = await repo.listEvents({ q: "siti" });
        expect(byName.length).toBe(1);
        expect(byName[0].customer_name).toBe("Siti");
        const byMac = await repo.listEvents({ q: "BB" });
        expect(byMac.length).toBe(1);
        expect(byMac[0].mac).toBe("BB");
    });

    test("filter waktu + getStats", async () => {
        const { repo } = makeRepo();
        await repo.recordEvent({ event_type: "los", mac: "AA", ts_ms: 1000 });
        await repo.recordEvent({ event_type: "dying-gasp", mac: "BB", ts_ms: 5000 });
        const stats = await repo.getStats({});
        expect(stats.total).toBe(2);
        const byType = {};
        stats.by_type.forEach((t) => { byType[t.event_type] = t.count; });
        expect(byType.los).toBe(1);
        expect(byType["dying-gasp"]).toBe(1);
        const inRange = await repo.listEvents({ from: 4000, to: 6000 });
        expect(inRange.length).toBe(1);
        expect(inRange[0].mac).toBe("BB");
    });

    test("pruneOld menghapus baris lebih tua dari retensi", async () => {
        const { repo, clock } = makeRepo();
        await repo.recordEvent({ event_type: "los", mac: "AA", ts_ms: 1000 });
        clock.set(100 * 24 * 60 * 60 * 1000);
        await repo.recordEvent({ event_type: "los", mac: "BB", ts_ms: clock.now() });
        const removed = await repo.pruneOld(90);
        expect(removed).toBe(1);
        const rows = await repo.listEvents({});
        expect(rows.length).toBe(1);
        expect(rows[0].mac).toBe("BB");
    });
});
