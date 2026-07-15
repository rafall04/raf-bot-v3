/**
 * Header Doc
 * Purpose: Guardrail projector state modem OLT — down→up jadi insiden+state, inferensi reboot,
 *          reklasifikasi LOS→DG, idempotensi, discovery tanpa down, tag area, waktu-server.
 * Caller: Jest.
 * Deps: `../olt-incident-projector`, `../../repositories/olt-incident.repository`, sqlite3 in-memory.
 * SideEffects: DB SQLite in-memory per test.
 */
"use strict";

const sqlite3 = require("sqlite3").verbose();
const { createProjector } = require("../olt-incident-projector");
const { createOltIncidentRepository } = require("../../repositories/olt-incident.repository");

function makeRepo() {
    return createOltIncidentRepository({ db: new sqlite3.Database(":memory:"), getDatabasePath: () => ":memory:" });
}
function makeProjector(overrides = {}) {
    const repo = makeRepo();
    const config = { oltModemState: { rebootWindowMs: 5 * 60 * 1000, clusterThreshold: 5, ...overrides } };
    return { repo, proj: createProjector({ repo, config }) };
}

describe("olt-incident-projector", () => {
    test("LOS panjang: buka insiden → state los → discovery menutup (durasi benar)", async () => {
        const { repo, proj } = makeProjector();
        await proj.handleEvent({ event_type: "los", mac: "11:00:00:00:00:01", olt_id: "olt1", source: "syslog", server_time_ms: 1000, confidence: 0.6, customer: { id: 1, name: "A", pppoe_username: "a@rafcybernet" } });

        let s = await repo.getModemState("110000000001");
        expect(s.current_state).toBe("los");
        expect(s.state_since_ms).toBe(1000);
        expect(s.open_incident_id).toBeGreaterThan(0);
        expect(s.pppoe_username).toBe("a@rafcybernet");

        // pulih setelah 10 menit (> rebootWindow 5 mnt) → tetap LOS
        await proj.handleEvent({ event_type: "discovery", mac: "11:00:00:00:00:01", olt_id: "olt1", source: "syslog", server_time_ms: 1000 + 10 * 60000 });
        s = await repo.getModemState("110000000001");
        expect(s.current_state).toBe("online");
        expect(s.open_incident_id).toBe(null);
        const list = await repo.listIncidents({ mac: "110000000001" });
        expect(list[0].status).toBe("resolved");
        expect(list[0].incident_type).toBe("los");
        expect(list[0].duration_ms).toBe(600000);
        await repo.close();
    });

    test("inferensi reboot: LOS pendek yang cepat pulih (< window)", async () => {
        const { repo, proj } = makeProjector();
        await proj.handleEvent({ event_type: "los", mac: "11:00:00:00:00:02", server_time_ms: 1000, customer: {} });
        await proj.handleEvent({ event_type: "discovery", mac: "11:00:00:00:00:02", server_time_ms: 1000 + 60000 }); // 1 mnt < 5 mnt
        const list = await repo.listIncidents({ mac: "110000000002" });
        expect(list[0].incident_type).toBe("reboot");
        expect(list[0].verify_method).toBe("inferred_reboot");
        await repo.close();
    });

    test("DG menyusul LOS → reklasifikasi dying_gasp (state_since asli dipertahankan)", async () => {
        const { repo, proj } = makeProjector();
        await proj.handleEvent({ event_type: "los", mac: "11:00:00:00:00:03", server_time_ms: 1000, customer: {} });
        const r = await proj.handleEvent({ event_type: "dying-gasp", mac: "11:00:00:00:00:03", server_time_ms: 1001 });
        expect(r.action).toBe("reclassified");
        const open = await repo.getOpenIncidentByMac("110000000003");
        expect(open.incident_type).toBe("dying_gasp");
        expect(open.verify_method).toBe("dg_pair");
        const s = await repo.getModemState("110000000003");
        expect(s.current_state).toBe("dying_gasp");
        expect(s.state_since_ms).toBe(1000); // waktu down asli, bukan waktu DG menyusul
        await repo.close();
    });

    test("DG langsung: insiden dying_gasp confidence 0.85", async () => {
        const { repo, proj } = makeProjector();
        await proj.handleEvent({ event_type: "dying-gasp", mac: "11:00:00:00:00:04", server_time_ms: 1000, customer: {} });
        const open = await repo.getOpenIncidentByMac("110000000004");
        expect(open.incident_type).toBe("dying_gasp");
        expect(open.confidence).toBeCloseTo(0.85);
        await repo.close();
    });

    test("idempoten: LOS berulang tak buat insiden kedua (still_down)", async () => {
        const { repo, proj } = makeProjector();
        const r1 = await proj.handleEvent({ event_type: "los", mac: "11:00:00:00:00:05", server_time_ms: 1000, customer: {} });
        const r2 = await proj.handleEvent({ event_type: "los", mac: "11:00:00:00:00:05", server_time_ms: 1005, customer: {} });
        expect(r1.action).toBe("opened");
        expect(r2.action).toBe("still_down");
        expect(await repo.listIncidents({ mac: "110000000005" })).toHaveLength(1);
        await repo.close();
    });

    test("discovery tanpa down sebelumnya → online, tanpa insiden hantu", async () => {
        const { repo, proj } = makeProjector();
        const r = await proj.handleEvent({ event_type: "discovery", mac: "11:00:00:00:00:06", server_time_ms: 1000, customer: {} });
        expect(r.action).toBe("online");
        expect(await repo.listIncidents({ mac: "110000000006" })).toHaveLength(0);
        expect((await repo.getModemState("110000000006")).current_state).toBe("online");
        await repo.close();
    });

    test("event tak valid ditolak tanpa throw", async () => {
        const { repo, proj } = makeProjector();
        expect((await proj.handleEvent({ event_type: "garbage", mac: "11:00:00:00:00:07" })).ok).toBe(false);
        expect((await proj.handleEvent({ event_type: "los" })).ok).toBe(false); // tanpa mac
        await repo.close();
    });

    test("tag gangguan area saat cluster ≥ threshold di 1 OLT", async () => {
        const { repo, proj } = makeProjector({ clusterThreshold: 3 });
        await proj.handleEvent({ event_type: "los", mac: "22:00:00:00:00:01", olt_id: "oltX", server_time_ms: 1000, customer: {} });
        await proj.handleEvent({ event_type: "los", mac: "22:00:00:00:00:02", olt_id: "oltX", server_time_ms: 1000, customer: {} });
        await proj.handleEvent({ event_type: "los", mac: "22:00:00:00:00:03", olt_id: "oltX", server_time_ms: 1000, customer: {} });
        expect((await repo.getOpenIncidentByMac("220000000003")).is_area_event).toBe(1);
        expect((await repo.getOpenIncidentByMac("220000000001")).is_area_event).toBe(0);
        await repo.close();
    });
});
