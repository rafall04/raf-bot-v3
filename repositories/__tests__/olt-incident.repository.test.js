/**
 * Header Doc
 * Purpose: Guardrail repo state modem OLT — idempotensi open (dedup_key), tutup+durasi,
 *          reklasifikasi LOS→DG, upsert modem_state (COALESCE identitas), tutup insiden nyangkut.
 * Caller: Jest.
 * Deps: `../olt-incident.repository`, `sqlite3` in-memory.
 * SideEffects: DB SQLite in-memory per test.
 */
"use strict";

const sqlite3 = require("sqlite3").verbose();
const { createOltIncidentRepository } = require("../olt-incident.repository");

function makeRepo() {
    const db = new sqlite3.Database(":memory:");
    return createOltIncidentRepository({ db, getDatabasePath: () => ":memory:" });
}

describe("olt-incident.repository", () => {
    test("open → close: durasi dihitung, status resolved", async () => {
        const repo = makeRepo();
        const o = await repo.openIncident({
            mac: "AA:BB:CC:00:00:01", incident_type: "los", started_at_ms: 1000,
            down_source: "syslog", confidence: 0.6, dedup_key: "k1",
            customer: { id: 5, name: "Budi", pppoe_username: "budi@rafcybernet" },
        });
        expect(o.opened).toBe(true);

        const open = await repo.getOpenIncidentByMac("aabbcc000001");
        expect(open.incident_type).toBe("los");
        expect(open.status).toBe("open");
        expect(open.pppoe_username).toBe("budi@rafcybernet");

        const c = await repo.closeIncident(o.id, { ended_at_ms: 1000 + 15 * 60000, up_source: "syslog", incident_type: "los" });
        expect(c.closed).toBe(true);
        expect(c.duration_ms).toBe(900000);

        const list = await repo.listIncidents({ mac: "aabbcc000001" });
        expect(list).toHaveLength(1);
        expect(list[0].status).toBe("resolved");
        expect(list[0].duration_ms).toBe(900000);
        await repo.close();
    });

    test("idempoten: dedup_key sama tak buat insiden ganda", async () => {
        const repo = makeRepo();
        const a = await repo.openIncident({ mac: "m1", incident_type: "los", started_at_ms: 1, dedup_key: "dup", customer: {} });
        const b = await repo.openIncident({ mac: "m1", incident_type: "los", started_at_ms: 1, dedup_key: "dup", customer: {} });
        expect(a.opened).toBe(true);
        expect(b.opened).toBe(false);
        expect(b.duplicate).toBe(true);
        expect(b.id).toBe(a.id);
        const rows = await repo.listIncidents({ mac: "m1" });
        expect(rows).toHaveLength(1);
        await repo.close();
    });

    test("reklasifikasi insiden open: LOS → dying_gasp", async () => {
        const repo = makeRepo();
        const o = await repo.openIncident({ mac: "m2", incident_type: "los", started_at_ms: 1, dedup_key: "k2", confidence: 0.6, customer: {} });
        const r = await repo.reclassifyOpenIncident(o.id, { incident_type: "dying_gasp", confidence: 0.85, verify_method: "dg_pair" });
        expect(r.updated).toBe(true);
        const open = await repo.getOpenIncidentByMac("m2");
        expect(open.incident_type).toBe("dying_gasp");
        expect(open.confidence).toBeCloseTo(0.85);
        await repo.close();
    });

    test("upsert modem_state: timpa status, COALESCE pertahankan identitas", async () => {
        const repo = makeRepo();
        await repo.upsertModemState({
            mac: "m3", current_state: "los", state_since_ms: 100, last_event_at_ms: 100,
            last_source: "syslog", open_incident_id: 7,
            customer: { id: 9, name: "Sari", pppoe_username: "sari@rafcybernet" },
        });
        let s = await repo.getModemState("m3");
        expect(s.current_state).toBe("los");
        expect(s.pppoe_username).toBe("sari@rafcybernet");
        expect(s.open_incident_id).toBe(7);

        // Pulih — TIDAK mengirim customer lagi; identitas harus tetap (COALESCE).
        await repo.upsertModemState({ mac: "m3", current_state: "online", state_since_ms: 200, last_event_at_ms: 200, last_source: "syslog", open_incident_id: null });
        s = await repo.getModemState("m3");
        expect(s.current_state).toBe("online");
        expect(s.open_incident_id).toBe(null);
        expect(s.customer_name).toBe("Sari");
        await repo.close();
    });

    test("closeStaleIncidents: insiden nyangkut → assumed_recovered, confidence turun", async () => {
        const repo = makeRepo();
        await repo.openIncident({ mac: "m4", incident_type: "los", started_at_ms: 0, dedup_key: "k4", confidence: 0.6, customer: {} });
        const r = await repo.closeStaleIncidents({ maxOpenMs: 1000, now_ms: 10000 });
        expect(r.closed).toBe(1);
        const rows = await repo.listIncidents({ mac: "m4" });
        expect(rows[0].status).toBe("assumed_recovered");
        expect(rows[0].duration_ms).toBe(10000);
        expect(rows[0].confidence).toBeLessThanOrEqual(0.3);
        await repo.close();
    });

    test("listIncidents excludeArea menyaring insiden area", async () => {
        const repo = makeRepo();
        const a = await repo.openIncident({ mac: "m5", incident_type: "los", started_at_ms: 1, dedup_key: "k5a", customer: {} });
        await repo.openIncident({ mac: "m6", incident_type: "los", started_at_ms: 1, dedup_key: "k5b", customer: {} });
        await repo.markIncidentsAreaEvent([a.id], "olt1:bucket", 2);
        const all = await repo.listIncidents({});
        const nonArea = await repo.listIncidents({ excludeArea: true });
        expect(all).toHaveLength(2);
        expect(nonArea).toHaveLength(1);
        expect(nonArea[0].mac).toBe(repo.normMac("m6")); // normMac buang char non-hex ("m6" → "6")
        await repo.close();
    });
});
