/**
 * Header Doc
 * Purpose: Validasi dan evaluasi rule auto outage untuk threshold offline, target filter, dan cooldown broadcast.
 * Caller: `services/auto-outage-detection.service.js`, `routes/admin-auto-outage-routes.js`.
 * Deps: `lib/account-classification` (kecualikan akun infrastruktur dari target broadcast); selebihnya waktu/payload via dependency injection.
 * MainFuncs: `createAutoOutageRuleService`, `normalizeRuleInput`, `evaluateEligibility`, `matchRuleTarget`.
 * SideEffects: Tidak ada; fungsi murni untuk normalisasi dan evaluasi rule.
 */
"use strict";

const { isInfrastructure } = require("../lib/account-classification");

const VALID_TARGET_SCOPES = new Set(["all", "area", "odp", "profile", "router", "custom"]);

function toPositiveInteger(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.floor(number) : fallback;
}

function normalizeJsonObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return value;
}

function normalizeString(value) {
    return String(value || "").trim().toLowerCase();
}

function sameValue(left, right) {
    return normalizeString(left) === normalizeString(right);
}

function firstDefined(...values) {
    return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");
}

function createAutoOutageRuleService(overrides = {}) {
    const deps = {
        now: () => new Date(),
        ...overrides
    };

    function normalizeRuleInput(input = {}) {
        const thresholdMinutes = input.offline_threshold_hours
            ? toPositiveInteger(input.offline_threshold_hours, 3) * 60
            : toPositiveInteger(input.offline_threshold_minutes, 180);
        const scanInterval = toPositiveInteger(input.scan_interval_minutes, 30);
        const cooldown = toPositiveInteger(input.broadcast_cooldown_minutes, 720);
        const targetScope = VALID_TARGET_SCOPES.has(input.target_scope) ? input.target_scope : "all";

        if (thresholdMinutes < 15) throw new Error("offline_threshold_minutes must be at least 15");
        if (scanInterval < 5) throw new Error("scan_interval_minutes must be at least 5");

        return {
            name: String(input.name || "Auto Outage Rule").trim(),
            enabled: Boolean(input.enabled),
            router_id: input.router_id ? String(input.router_id) : "default",
            target_scope: targetScope,
            target_filter_json: normalizeJsonObject(input.target_filter_json),
            offline_threshold_minutes: thresholdMinutes,
            scan_interval_minutes: scanInterval,
            broadcast_cooldown_minutes: cooldown,
            max_broadcast_per_incident: Math.max(1, toPositiveInteger(input.max_broadcast_per_incident, 1)),
            template_initial: String(input.template_initial || ""),
            template_followup: String(input.template_followup || ""),
            template_ticket_confirmation: String(input.template_ticket_confirmation || ""),
            options_json: Array.isArray(input.options_json) ? input.options_json : [],
            require_media_for_categories_json: Array.isArray(input.require_media_for_categories_json)
                ? input.require_media_for_categories_json
                : [],
            auto_ticket_enabled: input.auto_ticket_enabled !== false
        };
    }

    function matchRuleTarget(rule = {}, user = {}, state = {}) {
        // Akun infrastruktur (mis. modem CCTV/monitoring) bukan pelanggan bayar — jangan
        // pernah dijadikan target broadcast gangguan ke pelanggan. Tetap dilacak online/offline
        // oleh scan (runManualScan) untuk halaman Monitor Infrastruktur; hanya broadcast yang ditahan.
        if (isInfrastructure(user)) return false;

        const scope = rule.target_scope || "all";
        const filter = normalizeJsonObject(rule.target_filter_json);

        if (scope === "all") return true;
        if (scope === "area") return sameValue(firstDefined(user.area, user.zone), filter.area);
        if (scope === "odp") return sameValue(firstDefined(user.connected_odp_id, user.odp, user.odp_id), firstDefined(filter.odp, filter.odp_id));
        if (scope === "profile") return sameValue(firstDefined(user.subscription, user.profile, user.pppoe_profile), filter.profile);
        if (scope === "router") return sameValue(state.router_id, filter.router_id || rule.router_id);
        if (scope === "custom") {
            return Object.entries(filter).every(([key, expected]) => sameValue(user[key] ?? state[key], expected));
        }
        return false;
    }

    function evaluateEligibility(rule = {}, state = {}) {
        const now = deps.now();
        const offlineSince = state.offline_since ? new Date(state.offline_since) : null;
        if (!offlineSince || Number.isNaN(offlineSince.getTime())) {
            return { eligible: false, reason: "missing_offline_since", offline_minutes: 0 };
        }

        const offlineMinutes = Math.max(0, Math.floor((now.getTime() - offlineSince.getTime()) / 60000));
        const threshold = toPositiveInteger(rule.offline_threshold_minutes, 180);
        if (offlineMinutes < threshold) {
            return { eligible: false, reason: "below_threshold", offline_minutes: offlineMinutes };
        }

        const broadcastCount = Math.max(0, toPositiveInteger(state.broadcast_count, 0));
        const maxBroadcast = Math.max(1, toPositiveInteger(rule.max_broadcast_per_incident, 1));
        if (broadcastCount >= maxBroadcast) {
            return { eligible: false, reason: "max_broadcast_reached", offline_minutes: offlineMinutes };
        }

        if (state.last_broadcast_at) {
            const lastBroadcastAt = new Date(state.last_broadcast_at);
            if (!Number.isNaN(lastBroadcastAt.getTime())) {
                const minutesSinceBroadcast = Math.floor((now.getTime() - lastBroadcastAt.getTime()) / 60000);
                const cooldown = toPositiveInteger(rule.broadcast_cooldown_minutes, 720);
                if (minutesSinceBroadcast < cooldown) {
                    return {
                        eligible: false,
                        reason: "cooldown_active",
                        offline_minutes: offlineMinutes,
                        cooldown_remaining_minutes: cooldown - minutesSinceBroadcast
                    };
                }
            }
        }

        return { eligible: true, reason: "eligible", offline_minutes: offlineMinutes };
    }

    return {
        normalizeRuleInput,
        evaluateEligibility,
        matchRuleTarget
    };
}

module.exports = { createAutoOutageRuleService };
