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

    async function ensureReady() {
        if (repository.ensureSchema) {
            await repository.ensureSchema();
        }
    }

    router.get("/api/admin/auto-outage/health", ensureAuthenticatedStaff, asyncHandler(async (_req, res) => {
        await ensureReady();
        res.status(200).json({ status: 200, message: "Auto outage route registered." });
    }));

    router.post("/api/admin/auto-outage/scan", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        await ensureReady();
        const result = await detectionService.runManualScan({
            router_id: req.body?.router_id || req.body?.routerId || "default"
        });
        res.status(result.status || 200).json({
            status: result.status || 200,
            message: result.message || "Auto outage manual scan completed.",
            data: result
        });
    }));

    router.get("/api/admin/auto-outage/rules", ensureAuthenticatedStaff, asyncHandler(async (_req, res) => {
        await ensureReady();
        const rules = await repository.listRules();
        res.status(200).json({
            status: 200,
            message: "Auto outage rules loaded.",
            data: { items: rules }
        });
    }));

    router.post("/api/admin/auto-outage/rules", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        await ensureReady();
        const normalized = ruleService.normalizeRuleInput(req.body || {});
        const saved = await repository.upsertRule({ ...normalized, id: req.body?.id || undefined });
        res.status(200).json({
            status: 200,
            message: "Auto outage rule saved.",
            data: saved
        });
    }));

    router.post("/api/admin/auto-outage/dry-run", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        await ensureReady();
        const rule = req.body?.rule_id
            ? await repository.getRuleById(req.body.rule_id)
            : ruleService.normalizeRuleInput(req.body || {});
        if (!rule) {
            res.status(404).json({ status: 404, message: "Rule not found." });
            return;
        }
        const snapshot = await detectionService.buildDetectionSnapshot({ rule, limit: toLimit(req.body?.limit, 500) });
        res.status(200).json({
            status: 200,
            message: "Auto outage dry-run completed.",
            data: snapshot
        });
    }));

    router.post("/api/admin/auto-outage/broadcast", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        await ensureReady();
        const rule = req.body?.rule_id
            ? await repository.getRuleById(req.body.rule_id)
            : ruleService.normalizeRuleInput(req.body || {});
        if (!rule) {
            res.status(404).json({ status: 404, message: "Rule not found." });
            return;
        }
        // Gerbang gangguan-massal berlaku juga untuk broadcast manual — justru saat kabel putus
        // godaan menekan tombol ini paling besar. Admin tetap bisa memaksa dengan `force: true`,
        // tapi harus sengaja; diam adalah default.
        const snapshot = await detectionService.buildDetectionSnapshot({
            rule,
            limit: toLimit(req.body?.limit, 500),
            ignoreMassOutageGate: req.body?.force === true
        });
        const sent = [];
        const skipped = [];
        for (const item of snapshot.eligible) {
            if (!item.user) {
                skipped.push({ user_id: item.user_id, reason: "user_not_found" });
                continue;
            }
            const result = await conversationService.startConversation({ user: item.user, state: item, rule });
            sent.push({
                user_id: item.user_id,
                pppoe_username: item.pppoe_username,
                conversation_id: result.conversation?.id || null
            });
        }
        res.status(200).json({
            status: 200,
            message: "Auto outage broadcast completed.",
            data: {
                sent,
                skipped,
                mass_outage: snapshot.mass_outage || null,
                summary: {
                    ...snapshot.summary,
                    total_sent: sent.length,
                    total_skipped_broadcast: skipped.length
                }
            }
        });
    }));

    router.get("/api/admin/auto-outage/states", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        await ensureReady();
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
        await ensureReady();
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
