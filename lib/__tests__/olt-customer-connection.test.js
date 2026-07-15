/**
 * Header Doc
 * Purpose: Guardrail fusi status koneksi pelanggan (OLT+PPPoE+billing) + orchestrator diagnosa
 *          end-to-end (seed via projector → buildModemDiagnosis → ringkasan pelanggan).
 * Caller: Jest.
 * Deps: `../olt-customer-connection`, `../olt-modem-diagnostics`, repo insiden + projector (in-memory).
 * SideEffects: DB SQLite in-memory pada test end-to-end.
 */
"use strict";

const sqlite3 = require("sqlite3").verbose();
const { buildCustomerConnectionSummary } = require("../olt-customer-connection");
const { buildModemDiagnosis } = require("../olt-modem-diagnostics");
const { createOltIncidentRepository } = require("../../repositories/olt-incident.repository");
const { createProjector } = require("../olt-incident-projector");

const DAY = 24 * 60 * 60 * 1000;

describe("olt-customer-connection (fusi)", () => {
    test("isolir → surface billing dulu (bukan masalah jaringan)", () => {
        const r = buildCustomerConnectionSummary({ isolated: true, unpaid: true, oltDiagnosis: { current_state: "los", verdict: {} } });
        expect(r.status).toBe("billing");
        expect(r.layer).toBe("billing");
        expect(r.headline).toMatch(/tagihan/i);
    });

    test("dying-gasp → lapisan power (listrik)", () => {
        const r = buildCustomerConnectionSummary({ oltDiagnosis: { current_state: "dying_gasp", verdict: {} } });
        expect(r.layer).toBe("power");
        expect(r.headline).toMatch(/listrik|mati/i);
    });

    test("LOS + area → bahasa gangguan area", () => {
        const r = buildCustomerConnectionSummary({ oltDiagnosis: { current_state: "los", verdict: { code: "area_affected" } } });
        expect(r.layer).toBe("fiber");
        expect(r.headline).toMatch(/area/i);
    });

    test("modem online tapi PPPoE mati → lapisan sesi", () => {
        const r = buildCustomerConnectionSummary({ oltDiagnosis: { current_state: "online", verdict: {} }, pppoeActive: false });
        expect(r.layer).toBe("session");
        expect(r.headline).toMatch(/sesi internet/i);
    });

    test("semua lapisan up → normal", () => {
        const r = buildCustomerConnectionSummary({ oltDiagnosis: { current_state: "online", verdict: { health: "ok" } }, pppoeActive: true });
        expect(r.status).toBe("ok");
    });

    test("data tak cukup → jujur 'belum bisa memastikan'", () => {
        const r = buildCustomerConnectionSummary({});
        expect(r.status).toBe("unknown");
    });
});

describe("buildModemDiagnosis (orchestrator, end-to-end)", () => {
    test("seed via projector → diagnosa → ringkasan pelanggan", async () => {
        const now = Date.now();
        const repo = createOltIncidentRepository({ db: new sqlite3.Database(":memory:"), getDatabasePath: () => ":memory:" });
        const proj = createProjector({ repo, config: {} });
        const MAC = "ab:cd:ef:00:00:aa";

        // 1 gangguan LOS 20 menit, 2 hari lalu, lalu pulih (online sekarang).
        await proj.handleEvent({ event_type: "los", mac: MAC, olt_id: "olt1", source: "syslog", server_time_ms: now - 2 * DAY, customer: { id: 7, name: "Bu Rina", pppoe_username: "rina@rafcybernet" } });
        await proj.handleEvent({ event_type: "discovery", mac: MAC, olt_id: "olt1", source: "syslog", server_time_ms: now - 2 * DAY + 20 * 60000 });

        const d = await buildModemDiagnosis({ repo, mac: MAC, config: {}, now: () => now });
        expect(d.found).toBe(true);
        expect(d.current_state).toBe("online");
        expect(d.pppoe_username).toBe("rina@rafcybernet");
        expect(d.metrics.los).toBe(1);
        expect(d.verdict).toBeDefined();

        // Fusi jadi ringkasan pelanggan (PPPoE aktif → normal).
        const summary = buildCustomerConnectionSummary({ oltDiagnosis: d, pppoeActive: true });
        expect(summary.status).toBe("ok");
        await repo.close();
    });
});
