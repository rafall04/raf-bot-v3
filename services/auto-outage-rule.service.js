/**
 * Header Doc
 * Purpose: Validasi dan evaluasi rule auto outage untuk threshold offline, target filter, dan cooldown broadcast.
 * Caller: `services/auto-outage-detection.service.js`, `routes/admin-auto-outage-routes.js`.
 * Deps: Tidak ada side-effect default; menerima waktu dan payload via dependency injection.
 * MainFuncs: `createAutoOutageRuleService`, `normalizeRuleInput`, `evaluateEligibility`, `matchRuleTarget`.
 * SideEffects: Tidak ada; fungsi murni untuk normalisasi dan evaluasi rule.
 */
"use strict";

function createAutoOutageRuleService() {
    return {
        normalizeRuleInput() { throw new Error("AUTO_OUTAGE_RULE_NOT_IMPLEMENTED"); },
        evaluateEligibility() { throw new Error("AUTO_OUTAGE_RULE_NOT_IMPLEMENTED"); },
        matchRuleTarget() { throw new Error("AUTO_OUTAGE_RULE_NOT_IMPLEMENTED"); }
    };
}

module.exports = { createAutoOutageRuleService };
