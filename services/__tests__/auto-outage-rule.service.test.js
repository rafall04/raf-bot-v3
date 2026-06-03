/**
 * Header Doc
 * Purpose: Unit test rule service auto outage untuk normalisasi input, target matching, threshold, dan cooldown broadcast.
 * Caller: Jest targeted test Task 3 auto outage rule service.
 * Deps: `services/auto-outage-rule.service.js`.
 * MainFuncs: Memverifikasi `normalizeRuleInput`, `matchRuleTarget`, dan `evaluateEligibility`.
 * SideEffects: Tidak ada.
 */
"use strict";

const { createAutoOutageRuleService } = require("../auto-outage-rule.service");

describe("auto-outage-rule.service", () => {
    test("normalizes valid rule input with defaults", () => {
        const service = createAutoOutageRuleService();
        const rule = service.normalizeRuleInput({ name: "Rule Utama", offline_threshold_hours: 3 });
        expect(rule.name).toBe("Rule Utama");
        expect(rule.enabled).toBe(false);
        expect(rule.target_scope).toBe("all");
        expect(rule.offline_threshold_minutes).toBe(180);
        expect(rule.scan_interval_minutes).toBe(30);
        expect(rule.broadcast_cooldown_minutes).toBe(720);
        expect(rule.max_broadcast_per_incident).toBe(1);
        expect(rule.auto_ticket_enabled).toBe(true);
    });

    test("rejects invalid threshold and interval", () => {
        const service = createAutoOutageRuleService();
        expect(() => service.normalizeRuleInput({ name: "Bad", offline_threshold_minutes: 0 }))
            .toThrow("offline_threshold_minutes must be at least 15");
        expect(() => service.normalizeRuleInput({ name: "Bad", scan_interval_minutes: 0 }))
            .toThrow("scan_interval_minutes must be at least 5");
    });

    test("matches all, area, odp, profile, and router targets", () => {
        const service = createAutoOutageRuleService();
        const user = { area: "Utara", connected_odp_id: "ODP-1", subscription: "20M" };
        const state = { router_id: "router-a" };
        expect(service.matchRuleTarget({ target_scope: "all" }, user, state)).toBe(true);
        expect(service.matchRuleTarget({ target_scope: "area", target_filter_json: { area: "Utara" } }, user, state)).toBe(true);
        expect(service.matchRuleTarget({ target_scope: "odp", target_filter_json: { odp: "ODP-1" } }, user, state)).toBe(true);
        expect(service.matchRuleTarget({ target_scope: "profile", target_filter_json: { profile: "20M" } }, user, state)).toBe(true);
        expect(service.matchRuleTarget({ target_scope: "router", target_filter_json: { router_id: "router-a" } }, user, state)).toBe(true);
        expect(service.matchRuleTarget({ target_scope: "area", target_filter_json: { area: "Selatan" } }, user, state)).toBe(false);
    });

    test("evaluates threshold and cooldown eligibility", () => {
        const service = createAutoOutageRuleService({ now: () => new Date("2026-05-03T05:00:00.000Z") });
        const rule = { offline_threshold_minutes: 180, broadcast_cooldown_minutes: 720, max_broadcast_per_incident: 1 };
        const state = { offline_since: "2026-05-03T01:00:00.000Z", broadcast_count: 0, last_broadcast_at: null };
        expect(service.evaluateEligibility(rule, state)).toEqual(expect.objectContaining({
            eligible: true,
            reason: "eligible",
            offline_minutes: 240
        }));

        const sent = { ...state, broadcast_count: 1, last_broadcast_at: "2026-05-03T04:00:00.000Z" };
        expect(service.evaluateEligibility(rule, sent)).toEqual(expect.objectContaining({
            eligible: false,
            reason: "max_broadcast_reached"
        }));
    });

    test("rejects eligibility when offline duration is below threshold", () => {
        const service = createAutoOutageRuleService({ now: () => new Date("2026-05-03T05:00:00.000Z") });
        const result = service.evaluateEligibility(
            { offline_threshold_minutes: 180, broadcast_cooldown_minutes: 720, max_broadcast_per_incident: 2 },
            { offline_since: "2026-05-03T03:30:00.000Z", broadcast_count: 0 }
        );
        expect(result.eligible).toBe(false);
        expect(result.reason).toBe("below_threshold");
    });
});
