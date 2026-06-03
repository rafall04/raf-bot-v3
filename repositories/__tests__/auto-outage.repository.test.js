/**
 * Header Doc
 * Purpose: Unit test persistence repository auto outage untuk schema, rule upsert, state batch upsert, conversation, dan scan log.
 * Caller: Jest targeted test Task 2 auto outage repository.
 * Deps: `repositories/auto-outage.repository.js`.
 * MainFuncs: Memverifikasi `ensureSchema`, `upsertRule`, `getEnabledRules`, `upsertStates`, `getStateByUserId`, `createConversation`, dan `insertScanLog`.
 * SideEffects: Membuka SQLite in-memory untuk durasi test.
 */
"use strict";

const { createAutoOutageRepository } = require("../auto-outage.repository");

function createMemoryDbDeps() {
    const sqlite3 = require("sqlite3").verbose();
    return {
        sqlite3,
        getDatabasePath: () => ":memory:",
        runtime: null
    };
}

describe("auto-outage.repository", () => {
    test("ensureSchema creates empty read models", async () => {
        const repository = createAutoOutageRepository(createMemoryDbDeps());
        await repository.ensureSchema();
        await expect(repository.listRules()).resolves.toEqual([]);
        await expect(repository.listStates({ limit: 10 })).resolves.toEqual({ items: [] });
        await expect(repository.listScanLogs({ limit: 10 })).resolves.toEqual({ items: [] });
        await repository.close();
    });

    test("upserts enabled rule and parses JSON fields", async () => {
        const repository = createAutoOutageRepository(createMemoryDbDeps());
        await repository.ensureSchema();
        const rule = await repository.upsertRule({
            name: "Default 3 Jam",
            enabled: true,
            router_id: "main-router",
            target_scope: "all",
            target_filter_json: {},
            offline_threshold_minutes: 180,
            scan_interval_minutes: 30,
            broadcast_cooldown_minutes: 720,
            max_broadcast_per_incident: 1,
            template_initial: "Halo ${nama}",
            template_followup: "Jelaskan kendalanya",
            template_ticket_confirmation: "Ajukan tiket?",
            options_json: [{ label: "AMAN", category: "aman" }],
            require_media_for_categories_json: ["los_kabel"],
            auto_ticket_enabled: true
        });

        expect(rule.id).toBeTruthy();
        expect(rule.enabled).toBe(true);
        expect(rule.options_json).toEqual([{ label: "AMAN", category: "aman" }]);

        const enabled = await repository.getEnabledRules();
        expect(enabled).toHaveLength(1);
        expect(enabled[0].offline_threshold_minutes).toBe(180);
        expect(enabled[0].require_media_for_categories_json).toEqual(["los_kabel"]);
        await repository.close();
    });

    test("batch upserts states by user and pppoe username", async () => {
        const repository = createAutoOutageRepository(createMemoryDbDeps());
        await repository.ensureSchema();
        await repository.upsertStates([{
            user_id: "42",
            pppoe_username: "cust-42",
            router_id: "main-router",
            status: "offline",
            offline_since: "2026-05-03T01:00:00.000Z",
            last_logged_out: "2026-05-03T01:00:00.000Z",
            last_checked_at: "2026-05-03T04:00:00.000Z",
            broadcast_count: 0,
            last_detection_reason: "missing_from_ppp_active"
        }]);

        const state = await repository.getStateByUserId("42");
        expect(state.pppoe_username).toBe("cust-42");
        expect(state.status).toBe("offline");

        await repository.upsertStates([{ ...state, status: "recovered", recovered_at: "2026-05-03T06:00:00.000Z" }]);
        const updated = await repository.getStateByUserId("42");
        expect(updated.status).toBe("recovered");
        expect(updated.recovered_at).toBe("2026-05-03T06:00:00.000Z");
        await repository.close();
    });

    test("stores open conversation and scan log", async () => {
        const repository = createAutoOutageRepository(createMemoryDbDeps());
        await repository.ensureSchema();
        const conversation = await repository.createConversation({
            state_id: "state-1",
            user_id: "42",
            pppoe_username: "cust-42",
            status: "waiting_initial",
            media_json: []
        });
        expect(conversation.id).toBeTruthy();

        const open = await repository.getOpenConversationByUserId("42");
        expect(open.status).toBe("waiting_initial");

        await repository.updateConversation(conversation.id, {
            status: "closed",
            closed_reason: "customer_safe"
        });
        await expect(repository.getOpenConversationByUserId("42")).resolves.toBeNull();

        await repository.insertScanLog({
            rule_id: "rule-1",
            router_id: "main-router",
            started_at: "2026-05-03T04:00:00.000Z",
            finished_at: "2026-05-03T04:00:01.000Z",
            total_db_users: 10,
            total_with_pppoe: 8,
            total_active_ppp: 6,
            total_online: 6,
            total_offline_candidates: 2,
            total_eligible: 1,
            total_skipped: 2,
            summary_json: { ok: true }
        });
        const logs = await repository.listScanLogs({ limit: 10 });
        expect(logs.items).toHaveLength(1);
        expect(logs.items[0].summary_json).toEqual({ ok: true });
        await repository.close();
    });
});
