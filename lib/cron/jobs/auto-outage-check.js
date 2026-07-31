/**
 * Header Doc
 * Purpose: Scheduler auto outage check untuk scan PPPoE MikroTik dan broadcast rule aktif secara periodik.
 * Caller: `lib/cron.js`.
 * Deps: `node-cron`, repository/service auto outage.
 * MainFuncs: `initAutoOutageCheckTask`.
 * SideEffects: Menjadwalkan background scan jika config auto outage aktif.
 */
"use strict";

const cron = require("node-cron");
const { createAutoOutageRepository } = require("../../../repositories/auto-outage.repository");
const { createAutoOutageDetectionService } = require("../../../services/auto-outage-detection.service");
const { createAutoOutageConversationService } = require("../../../services/auto-outage-conversation.service");

let autoOutageTask = null;
const lastRunByRuleId = new Map();

function initAutoOutageCheckTask(config = {}, deps = {}) {
    if (autoOutageTask) {
        autoOutageTask.stop();
        autoOutageTask = null;
    }

    if (config.status_auto_outage_check === false) {
        return { started: false, reason: "AUTO_OUTAGE_DISABLED", task: null, deps };
    }

    const repository = deps.repository || createAutoOutageRepository(deps);
    const detectionService = deps.detectionService || createAutoOutageDetectionService({ ...deps, repository });
    const conversationService = deps.conversationService || createAutoOutageConversationService({ ...deps, repository });
    const schedule = config.schedule_auto_outage_check || "* * * * *";

    autoOutageTask = cron.schedule(schedule, async () => {
        try {
            await repository.ensureSchema();
            const rules = (await repository.getEnabledRules()).filter((rule) => rule.enabled);
            const now = Date.now();
            const dueRules = rules.filter((rule) => {
                const intervalMs = Math.max(5, Number(rule.scan_interval_minutes || 30)) * 60000;
                const lastRun = lastRunByRuleId.get(rule.id) || 0;
                return now - lastRun >= intervalMs;
            });
            if (dueRules.length === 0) return;

            const scannedRouters = new Set();
            for (const rule of dueRules) {
                const routerId = rule.router_id || "default";
                if (!scannedRouters.has(routerId)) {
                    await detectionService.runManualScan({ router_id: routerId });
                    scannedRouters.add(routerId);
                }

                const snapshot = await detectionService.buildDetectionSnapshot({ rule, limit: 500 });
                // Gerbang gangguan-massal sudah mengosongkan `eligible` di service. Dicatat di sini
                // supaya operator tahu bot SENGAJA diam (bukan cron mati) saat kabel putus.
                if (snapshot.mass_outage && snapshot.mass_outage.suppressed) {
                    const mo = snapshot.mass_outage;
                    console.log(
                        `[CRON_AUTO_OUTAGE] Rule ${rule.id}: ditahan — dugaan gangguan massal ` +
                        `(${mo.eligibleCount} pelanggan akan disapa sekaligus, ambang ${mo.minOffline}). ` +
                        `Tidak ada DM per-pelanggan.`
                    );
                }
                for (const item of snapshot.eligible) {
                    if (!item.user) continue;
                    await conversationService.startConversation({ user: item.user, state: item, rule });
                }
                lastRunByRuleId.set(rule.id, now);
            }
        } catch (error) {
            console.error(`[CRON_AUTO_OUTAGE_ERROR] ${error.message}`);
        }
    }, {
        scheduled: true,
        timezone: "Asia/Jakarta"
    });

    autoOutageTask.start();
    return {
        started: true,
        reason: "AUTO_OUTAGE_STARTED",
        task: autoOutageTask,
        deps
    };
}

module.exports = { initAutoOutageCheckTask };
