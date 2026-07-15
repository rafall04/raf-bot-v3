/**
 * Header Doc
 * Purpose: Guardrail perawatan state OLT — reconcile (tutup insiden nyangkut) & backfill/rebuild
 *          (replay olt_events → olt_state) yang idempoten.
 * Caller: Jest.
 * Deps: `../olt-state-maintenance`, repo insiden & event (in-memory), projector.
 * SideEffects: DB SQLite in-memory per test.
 */
"use strict";

const sqlite3 = require("sqlite3").verbose();
const { reconcileOltState, backfillOltStateFromEvents } = require("../olt-state-maintenance");
const { createOltIncidentRepository } = require("../../repositories/olt-incident.repository");
const { createOltEventRepository } = require("../../repositories/olt-event.repository");
const { createProjector } = require("../olt-incident-projector");

function makeIncidentRepo() {
    return createOltIncidentRepository({ db: new sqlite3.Database(":memory:"), getDatabasePath: () => ":memory:" });
}
function makeEventRepo() {
    return createOltEventRepository({ db: new sqlite3.Database(":memory:"), getDatabasePath: () => ":memory:" });
}

describe("olt-state-maintenance", () => {
    test("reconcile menutup insiden nyangkut (assumed_recovered)", async () => {
        // Jam repo & reconcile disinkron (10000) supaya closeStale & prune konsisten.
        const repo = createOltIncidentRepository({ db: new sqlite3.Database(":memory:"), getDatabasePath: () => ":memory:", now: () => 10000 });
        await repo.openIncident({ mac: "11:00:00:00:00:aa", incident_type: "los", started_at_ms: 0, dedup_key: "st1", customer: {} });
        const res = await reconcileOltState({
            repo,
            config: { oltModemState: { maxOpenIncidentMs: 1000, incidentRetentionDays: 365 } },
            now: () => 10000,
        });
        expect(res.closed_stale).toBe(1);
        const rows = await repo.listIncidents({ mac: "1100000000aa" });
        expect(rows[0].status).toBe("assumed_recovered");
        await repo.close();
    });

    test("backfill: replay olt_events membangun ulang olt_state (rebuildable)", async () => {
        const eventRepo = makeEventRepo();
        const incidentRepo = makeIncidentRepo();
        const projector = createProjector({ repo: incidentRepo, config: { oltModemState: { rebootWindowMs: 5 * 60000 } } });

        const MAC = "de:ad:be:ef:00:11";
        await eventRepo.recordEvent({ event_type: "los", mac: MAC, ts_ms: 1000, source: "syslog", olt_id: "olt1", customer: { id: 3, name: "Pak Budi", pppoe_username: "budi@rafcybernet" } });
        await eventRepo.recordEvent({ event_type: "discovery", mac: MAC, ts_ms: 1000 + 10 * 60000, source: "syslog", olt_id: "olt1" });

        const res = await backfillOltStateFromEvents({ eventRepo, projector, sinceMs: 0 });
        expect(res.processed).toBe(2);

        const incidents = await incidentRepo.listIncidents({ mac: incidentRepo.normMac(MAC) });
        expect(incidents).toHaveLength(1);
        expect(incidents[0].status).toBe("resolved");
        expect(incidents[0].incident_type).toBe("los");
        expect(incidents[0].duration_ms).toBe(600000);

        const state = await incidentRepo.getModemState(incidentRepo.normMac(MAC));
        expect(state.current_state).toBe("online");
        expect(state.pppoe_username).toBe("budi@rafcybernet");
        await eventRepo.close();
        await incidentRepo.close();
    });

    test("backfill idempoten: replay dua kali tak menggandakan insiden", async () => {
        const eventRepo = makeEventRepo();
        const incidentRepo = makeIncidentRepo();
        const projector = createProjector({ repo: incidentRepo, config: {} });
        const MAC = "de:ad:be:ef:00:22";
        await eventRepo.recordEvent({ event_type: "los", mac: MAC, ts_ms: 2000, source: "syslog" });
        await eventRepo.recordEvent({ event_type: "discovery", mac: MAC, ts_ms: 2000 + 20 * 60000, source: "syslog" });

        await backfillOltStateFromEvents({ eventRepo, projector, sinceMs: 0 });
        await backfillOltStateFromEvents({ eventRepo, projector, sinceMs: 0 });

        const incidents = await incidentRepo.listIncidents({ mac: incidentRepo.normMac(MAC) });
        expect(incidents).toHaveLength(1); // tetap 1 walau di-replay 2×
        await eventRepo.close();
        await incidentRepo.close();
    });
});
