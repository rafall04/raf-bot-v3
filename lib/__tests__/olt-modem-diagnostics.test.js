/**
 * Header Doc
 * Purpose: Guardrail analitik/verdict modem OLT — metrik, deteksi reboot terjadwal, dan pemetaan
 *          pola → verdict (reboot/listrik/LOS/flapping/area/sehat) + overlay "sedang down".
 * Caller: Jest.
 * Deps: `../olt-modem-diagnostics`.
 * SideEffects: Tidak ada (fungsi murni).
 */
"use strict";

const { computeModemMetrics, detectRebootSchedule, computeVerdict } = require("../olt-modem-diagnostics");

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 6, 15, 12, 0, 0);

function inc(type, startedAtMs, durationMs = null, area = false, confidence = 0.7) {
    return { incident_type: type, started_at_ms: startedAtMs, duration_ms: durationMs, is_area_event: area ? 1 : 0, confidence };
}

describe("olt-modem-diagnostics", () => {
    test("metrik: uptime/mttr/downtime, kecualikan area", async () => {
        const incidents = [
            inc("los", NOW - 2 * DAY, 10 * 60000),
            inc("dying_gasp", NOW - 5 * DAY, 5 * 60000),
            inc("los", NOW - 3 * DAY, 60 * 60000, true), // area → dikecualikan
        ];
        const m = computeModemMetrics(incidents, { windowMs: 30 * DAY, now: NOW });
        expect(m.total).toBe(3);
        expect(m.non_area).toBe(2);
        expect(m.area).toBe(1);
        expect(m.los).toBe(1);
        expect(m.dying_gasp).toBe(1);
        expect(m.downtime_ms).toBe(15 * 60000);
        expect(m.mttr_ms).toBe(Math.round((15 * 60000) / 2));
        expect(m.longest_ms).toBe(10 * 60000);
        expect(m.uptime_pct).toBeGreaterThan(99);
    });

    test("verdict: sehat saat tanpa gangguan", () => {
        const v = computeVerdict({ incidents: [], current_state: "online", now: NOW });
        expect(v.code).toBe("healthy");
        expect(v.health).toBe("ok");
    });

    test("verdict: reboot terjadwal (5× jam sama) → dugaan listrik", () => {
        const reboots = [1, 2, 3, 4, 5].map((k) => inc("reboot", NOW - k * DAY, 60000)); // 24h apart = jam lokal sama
        const sched = detectRebootSchedule(reboots, { rebootK: 4, now: NOW });
        expect(sched.scheduled).toBe(true);
        const v = computeVerdict({ incidents: reboots, current_state: "online", now: NOW });
        expect(v.code).toBe("scheduled_reboot");
        expect(v.health).toBe("chronic");
        expect(v.dugaan).toMatch(/listrik/i);
    });

    test("verdict: sering dying-gasp → frequent_power", () => {
        const dgs = [1, 2, 3, 4, 5].map((k) => inc("dying_gasp", NOW - k * 2 * DAY, 30 * 60000));
        const v = computeVerdict({ incidents: dgs, current_state: "online", now: NOW });
        expect(v.code).toBe("frequent_power");
    });

    test("verdict: LOS berulang non-area → recurring_los", () => {
        const loss = [1, 3, 6, 9].map((k) => inc("los", NOW - k * DAY, 20 * 60000));
        const v = computeVerdict({ incidents: loss, current_state: "online", now: NOW });
        expect(v.code).toBe("recurring_los");
        expect(v.dugaan).toMatch(/fiber|konektor|splic/i);
    });

    test("verdict: mayoritas area → area_affected (bukan modem ini)", () => {
        const incidents = [
            inc("los", NOW - 10 * DAY, 30 * 60000, false), // 1 non-area, lama (di luar flap window)
            inc("los", NOW - 2 * DAY, 30 * 60000, true),
            inc("los", NOW - 3 * DAY, 30 * 60000, true),
            inc("dying_gasp", NOW - 4 * DAY, 30 * 60000, true),
        ];
        const v = computeVerdict({ incidents, current_state: "online", now: NOW });
        expect(v.code).toBe("area_affected");
        expect(v.headline_customer).toMatch(/area/i);
    });

    test("verdict: flapping (banyak gangguan 6 jam terakhir)", () => {
        const flaps = [0.5, 1, 2, 3].map((h) => inc("los", NOW - h * HOUR, 60000));
        const v = computeVerdict({ incidents: flaps, current_state: "online", now: NOW });
        expect(v.code).toBe("unstable_flapping");
    });

    test("verdict: overlay SEDANG DOWN saat current_state los", () => {
        const v = computeVerdict({ incidents: [], current_state: "los", now: NOW });
        expect(v.currently_down).toBe(true);
        expect(v.headline_internal).toMatch(/SEDANG DOWN/);
        expect(v.headline_customer).toMatch(/kehilangan sinyal/i);
    });
});
