/**
 * Header Doc
 * Purpose: Smoke test kontrak rule service auto outage sebelum logic evaluasi rule ditulis.
 * Caller: Jest targeted test Task 1 auto outage skeleton.
 * Deps: `services/auto-outage-rule.service.js`.
 * MainFuncs: Memverifikasi export `createAutoOutageRuleService` dan method skeleton.
 * SideEffects: Tidak ada.
 */
"use strict";

const { createAutoOutageRuleService } = require("../auto-outage-rule.service");

describe("auto-outage-rule.service skeleton", () => {
    test("exports rule service contract", () => {
        const service = createAutoOutageRuleService();
        expect(typeof service.normalizeRuleInput).toBe("function");
        expect(typeof service.evaluateEligibility).toBe("function");
        expect(typeof service.matchRuleTarget).toBe("function");
        expect(() => service.normalizeRuleInput()).toThrow("AUTO_OUTAGE_RULE_NOT_IMPLEMENTED");
    });
});
