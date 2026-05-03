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
const { createAutoOutageRepository } = require("../repositories/auto-outage.repository");
const { createAutoOutageDetectionService } = require("../services/auto-outage-detection.service");
const { createAutoOutageRuleService } = require("../services/auto-outage-rule.service");
const { createAutoOutageConversationService } = require("../services/auto-outage-conversation.service");

function toLimit(value, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(1, Math.min(Math.floor(number), 500));
}

function toOffset(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.floor(number));
}

function registerAdminAutoOutageRoutes(router, deps = {}) {
    const ensureAuthenticatedStaff = deps.ensureAuthenticatedStaff || ((_req, _res, next) => next());
    const repository = deps.repository || createAutoOutageRepository(deps);
    const detectionService = deps.detectionService || createAutoOutageDetectionService(deps);
    const ruleService = deps.ruleService || createAutoOutageRuleService(deps);
    const conversationService = deps.conversationService || createAutoOutageConversationService(deps);

    router.get("/api/admin/auto-outage/health", ensureAuthenticatedStaff, asyncHandler(async (_req, res) => {
        res.status(200).json({ status: 200, message: "Auto outage route registered." });
    }));

    router.post("/api/admin/auto-outage/scan", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        const result = await detectionService.runManualScan({
            router_id: req.body?.router_id || req.body?.routerId || "default"
        });
        res.status(result.status || 200).json({
            status: result.status || 200,
            message: result.message || "Auto outage manual scan completed.",
            data: result
        });
    }));

    router.get("/api/admin/auto-outage/states", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        const result = await repository.listStates({
            status: req.query?.status || undefined,
            limit: toLimit(req.query?.limit, 100),
            offset: toOffset(req.query?.offset)
        });
        res.status(200).json({
            status: 200,
            message: "Auto outage states loaded.",
            data: result
        });
    }));

    router.get("/api/admin/auto-outage/scan-logs", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        const result = await repository.listScanLogs({
            limit: toLimit(req.query?.limit, 50),
            offset: toOffset(req.query?.offset)
        });
        res.status(200).json({
            status: 200,
            message: "Auto outage scan logs loaded.",
            data: result
        });
    }));

    return { detectionService, ruleService, conversationService };
}

module.exports = { registerAdminAutoOutageRoutes };
