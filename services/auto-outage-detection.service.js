/**
 * Header Doc
 * Purpose: Orchestrator deteksi pelanggan offline berbasis database users dan PPP active MikroTik batch.
 * Caller: `routes/admin-auto-outage-routes.js`, `lib/cron/jobs/auto-outage-check.js`.
 * Deps: `repositories/auto-outage.repository.js`, runtime users repository, `lib/mikrotik` adapter functions, dan `services/auto-outage-rule.service.js`.
 * MainFuncs: `createAutoOutageDetectionService`, `runManualScan`, `buildDetectionSnapshot`.
 * SideEffects: Membaca MikroTik, membaca runtime users, dan menulis state/scan log auto outage.
 */
"use strict";

const { createAutoOutageRuleService } = require("./auto-outage-rule.service");

function defaultDeps() {
    return {
        repository: require("../repositories/auto-outage.repository").createAutoOutageRepository(),
        runtime: global.__appRuntime || null,
        getActivePPPoEUsers: require("../lib/mikrotik").getActivePPPoEUsers,
        getAllPPPoESecrets: require("../lib/mikrotik").getAllPPPoESecrets,
        now: () => new Date()
    };
}

function normalizeUsername(value) {
    return String(value || "").trim().toLowerCase();
}

function pickPppUsername(record = {}) {
    return normalizeUsername(record.name || record.user || record.username);
}

function parseMikrotikDate(value) {
    if (!value) return null;
    const direct = new Date(value);
    if (!Number.isNaN(direct.getTime())) return direct;

    const match = String(value).match(/^([A-Za-z]{3})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
    if (!match) return null;
    const [, monthText, day, year, hour, minute, second] = match;
    const month = {
        jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
        jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
    }[monthText.toLowerCase()];
    if (month === undefined) return null;
    const parsed = new Date(Date.UTC(Number(year), month, Number(day), Number(hour), Number(minute), Number(second)));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getLastLoggedOut(secret = {}) {
    return secret["last-logged-out"] || secret.last_logged_out || secret.lastLoggedOut || null;
}

function unwrapMikrotikList(result, operationName) {
    if (Array.isArray(result)) return result;
    if (result && result.ok === false) {
        throw new Error(result.message || `${operationName} failed`);
    }
    if (Array.isArray(result?.data)) return result.data;
    if (Array.isArray(result?.data?.data)) return result.data.data;
    if (Array.isArray(result?.items)) return result.items;
    return [];
}

function createAutoOutageDetectionService(overrides = {}) {
    const deps = { ...defaultDeps(), ...overrides };
    const ruleService = deps.ruleService || createAutoOutageRuleService({ now: deps.now });

    function getUsersSnapshot() {
        const usersRepository = deps.runtime?.repositories?.users || null;
        if (usersRepository?.getAll) return usersRepository.getAll();
        if (deps.runtime?.state?.has?.("users")) return deps.runtime.state.get("users");
        if (Array.isArray(global.users)) return global.users;
        return [];
    }

    function findUserById(id) {
        return getUsersSnapshot().find((user) => String(user.id) === String(id)) || null;
    }

    async function runManualScan(input = {}) {
        const startedAt = deps.now().toISOString();
        const routerId = input.router_id || "default";
        const users = Array.isArray(getUsersSnapshot()) ? getUsersSnapshot() : [];
        const usersWithPppoe = [];
        const skipped = [];
        const dbUsernameSet = new Set();

        for (const user of users) {
            const pppoeUsername = normalizeUsername(user.pppoe_username);
            if (!pppoeUsername) {
                skipped.push({ user_id: user.id, skip_reason: "missing_pppoe_username" });
                continue;
            }
            usersWithPppoe.push({ user, pppoeUsername });
            dbUsernameSet.add(pppoeUsername);
        }

        let activePpp = [];
        try {
            activePpp = unwrapMikrotikList(await deps.getActivePPPoEUsers({ router_id: routerId }), "getActivePPPoEUsers");
        } catch (error) {
            const summary = {
                total_db_users: users.length,
                total_with_pppoe: usersWithPppoe.length,
                total_active_ppp: 0,
                total_online: 0,
                total_offline_candidates: 0,
                total_eligible: 0,
                total_skipped: skipped.length,
                ignored_active_ppp: 0
            };
            await deps.repository.insertScanLog({
                router_id: routerId,
                started_at: startedAt,
                finished_at: deps.now().toISOString(),
                ...summary,
                error_message: error.message,
                summary_json: summary
            });
            return {
                status: 502,
                message: `Failed to fetch active PPP users: ${error.message}`,
                summary
            };
        }

        const activeSet = new Set();
        let ignoredActivePpp = 0;
        for (const item of Array.isArray(activePpp) ? activePpp : []) {
            const username = pickPppUsername(item);
            if (!username) continue;
            activeSet.add(username);
            if (!dbUsernameSet.has(username)) ignoredActivePpp += 1;
        }

        const offlineCandidates = usersWithPppoe.filter(({ pppoeUsername }) => !activeSet.has(pppoeUsername));
        const onlineUsers = usersWithPppoe.filter(({ pppoeUsername }) => activeSet.has(pppoeUsername));
        let secrets = [];
        if (offlineCandidates.length > 0 && deps.getAllPPPoESecrets) {
            secrets = unwrapMikrotikList(await deps.getAllPPPoESecrets({ router_id: routerId }), "getAllPPPoESecrets");
        }
        const secretByName = new Map();
        for (const secret of Array.isArray(secrets) ? secrets : []) {
            const username = pickPppUsername(secret);
            if (username) secretByName.set(username, secret);
        }

        const nowIso = deps.now().toISOString();
        const states = [];
        for (const { user, pppoeUsername } of onlineUsers) {
            states.push({
                user_id: String(user.id),
                pppoe_username: pppoeUsername,
                router_id: routerId,
                status: "online",
                offline_since: null,
                last_logged_out: null,
                last_checked_at: nowIso,
                recovered_at: nowIso,
                broadcast_count: 0,
                last_detection_reason: "found_in_ppp_active"
            });
        }

        for (const { user, pppoeUsername } of offlineCandidates) {
            const secret = secretByName.get(pppoeUsername) || {};
            const rawLastLoggedOut = getLastLoggedOut(secret);
            const parsedLastLoggedOut = parseMikrotikDate(rawLastLoggedOut);
            states.push({
                user_id: String(user.id),
                pppoe_username: pppoeUsername,
                router_id: routerId,
                status: "offline",
                offline_since: parsedLastLoggedOut ? parsedLastLoggedOut.toISOString() : nowIso,
                last_logged_out: parsedLastLoggedOut ? parsedLastLoggedOut.toISOString() : null,
                last_checked_at: nowIso,
                broadcast_count: 0,
                last_detection_reason: parsedLastLoggedOut
                    ? "missing_from_ppp_active_last_logged_out"
                    : "missing_from_ppp_active_internal_time"
            });
        }

        if (states.length > 0) {
            await deps.repository.upsertStates(states);
        }

        const summary = {
            total_db_users: users.length,
            total_with_pppoe: usersWithPppoe.length,
            total_active_ppp: Array.isArray(activePpp) ? activePpp.length : 0,
            total_online: onlineUsers.length,
            total_offline_candidates: offlineCandidates.length,
            total_eligible: 0,
            total_skipped: skipped.length,
            ignored_active_ppp: ignoredActivePpp
        };
        await deps.repository.insertScanLog({
            router_id: routerId,
            started_at: startedAt,
            finished_at: deps.now().toISOString(),
            ...summary,
            summary_json: { ...summary, skipped }
        });

        return {
            status: 200,
            message: "Auto outage manual scan completed.",
            summary,
            skipped
        };
    }

    async function buildDetectionSnapshot(input = {}) {
        const rule = input.rule || {};
        const statesResult = await deps.repository.listStates({ status: "offline", limit: input.limit || 500 });
        const states = statesResult.items || [];
        const eligible = [];
        const ineligible = [];

        for (const state of states) {
            const user = findUserById(state.user_id);
            if (!ruleService.matchRuleTarget(rule, user || {}, state)) {
                ineligible.push({ ...state, eligibility: { eligible: false, reason: "target_not_matched" } });
                continue;
            }
            const eligibility = ruleService.evaluateEligibility(rule, state);
            const record = { ...state, user, eligibility };
            if (eligibility.eligible) eligible.push(record);
            else ineligible.push(record);
        }

        return {
            eligible,
            ineligible,
            summary: {
                total_offline: states.length,
                total_eligible: eligible.length,
                total_ineligible: ineligible.length
            }
        };
    }

    return {
        deps,
        runManualScan,
        buildDetectionSnapshot
    };
}

module.exports = { createAutoOutageDetectionService };
