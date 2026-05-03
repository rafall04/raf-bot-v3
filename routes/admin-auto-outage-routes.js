/**
 * Header Doc
 * Purpose: Registrar route admin untuk auto outage scan, dashboard state, rules, dry-run, dan manual broadcast.
 * Caller: `routes/admin-router.js`.
 * Deps: Express router instance, `ensureAuthenticatedStaff`, auto outage services, `lib/error-handler.asyncHandler`.
 * MainFuncs: `registerAdminAutoOutageRoutes`.
 * SideEffects: Mendaftarkan endpoint admin auto outage pada router admin utama.
 */
"use strict";

const { asyncHandler } = require("../lib/error-handler");
const { createAutoOutageDetectionService } = require("../services/auto-outage-detection.service");
const { createAutoOutageRuleService } = require("../services/auto-outage-rule.service");
const { createAutoOutageConversationService } = require("../services/auto-outage-conversation.service");

function registerAdminAutoOutageRoutes(router, deps = {}) {
    const ensureAuthenticatedStaff = deps.ensureAuthenticatedStaff || ((_req, _res, next) => next());
    const detectionService = deps.detectionService || createAutoOutageDetectionService(deps);
    const ruleService = deps.ruleService || createAutoOutageRuleService(deps);
    const conversationService = deps.conversationService || createAutoOutageConversationService(deps);

    router.get("/api/admin/auto-outage/health", ensureAuthenticatedStaff, asyncHandler(async (_req, res) => {
        res.status(200).json({ status: 200, message: "Auto outage route registered." });
    }));

    return { detectionService, ruleService, conversationService };
}

module.exports = { registerAdminAutoOutageRoutes };
