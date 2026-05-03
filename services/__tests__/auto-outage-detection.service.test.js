/**
 * Header Doc
 * Purpose: Unit test detection service auto outage untuk database-first PPPoE matching, fail-safe MikroTik, dan scan audit.
 * Caller: Jest targeted test Task 4 auto outage detection.
 * Deps: `services/auto-outage-detection.service.js`.
 * MainFuncs: Memverifikasi `runManualScan` dan `buildDetectionSnapshot`.
 * SideEffects: Tidak ada; repository dan MikroTik adapter direplace stub.
 */
"use strict";

const { createAutoOutageDetectionService } = require("../auto-outage-detection.service");

function createRepoStub(existingStates = []) {
    const writes = { states: [], logs: [] };
    return {
        writes,
        ensureSchema: jest.fn().mockResolvedValue(),
        listStates: jest.fn().mockResolvedValue({ items: existingStates }),
        upsertStates: jest.fn(async (states) => {
            writes.states.push(...states);
            return states;
        }),
        insertScanLog: jest.fn(async (log) => {
            writes.logs.push(log);
            return { id: "log-1", ...log };
        })
    };
}

function createRuntimeWithUsers(users) {
    return {
        repositories: {
            users: {
                getAll: () => users
            }
        }
    };
}

describe("auto-outage-detection.service", () => {
    test("uses database users as source of truth and ignores unknown active PPP", async () => {
        const repo = createRepoStub();
        const service = createAutoOutageDetectionService({
            repository: repo,
            runtime: createRuntimeWithUsers([
                { id: "1", name: "A", pppoe_username: "cust-a", phone_number: "6281" },
                { id: "2", name: "B", pppoe_username: "cust-b", phone_number: "6282" },
                { id: "3", name: "C", phone_number: "6283" }
            ]),
            getActivePPPoEUsers: jest.fn().mockResolvedValue([{ name: "cust-a" }, { name: "unknown-router-user" }]),
            getAllPPPoESecrets: jest.fn().mockResolvedValue([{ name: "cust-b", "last-logged-out": "May/03/2026 01:00:00" }]),
            now: () => new Date("2026-05-03T05:00:00.000Z")
        });

        const result = await service.runManualScan({ router_id: "main-router" });
        expect(result.status).toBe(200);
        expect(result.summary.total_db_users).toBe(3);
        expect(result.summary.total_with_pppoe).toBe(2);
        expect(result.summary.total_active_ppp).toBe(2);
        expect(result.summary.total_online).toBe(1);
        expect(result.summary.total_offline_candidates).toBe(1);
        expect(result.summary.total_skipped).toBe(1);
        expect(result.summary.ignored_active_ppp).toBe(1);

        const offlineState = repo.writes.states.find((state) => state.user_id === "2");
        expect(offlineState.status).toBe("offline");
        expect(offlineState.pppoe_username).toBe("cust-b");
        expect(offlineState.last_detection_reason).toBe("missing_from_ppp_active_last_logged_out");
        expect(repo.insertScanLog).toHaveBeenCalled();
    });

    test("does not mark all customers offline when active PPP fetch fails", async () => {
        const repo = createRepoStub();
        const service = createAutoOutageDetectionService({
            repository: repo,
            runtime: createRuntimeWithUsers([{ id: "1", pppoe_username: "cust-a" }]),
            getActivePPPoEUsers: jest.fn().mockRejectedValue(new Error("router timeout")),
            getAllPPPoESecrets: jest.fn(),
            now: () => new Date("2026-05-03T05:00:00.000Z")
        });

        const result = await service.runManualScan({ router_id: "main-router" });
        expect(result.status).toBe(502);
        expect(result.message).toContain("router timeout");
        expect(repo.upsertStates).not.toHaveBeenCalled();
        expect(repo.insertScanLog).toHaveBeenCalledWith(expect.objectContaining({
            error_message: "router timeout"
        }));
    });

    test("buildDetectionSnapshot evaluates rule eligibility from stored states", async () => {
        const repo = createRepoStub([
            {
                user_id: "1",
                pppoe_username: "cust-a",
                router_id: "main-router",
                status: "offline",
                offline_since: "2026-05-03T01:00:00.000Z",
                broadcast_count: 0
            },
            {
                user_id: "2",
                pppoe_username: "cust-b",
                router_id: "main-router",
                status: "offline",
                offline_since: "2026-05-03T04:30:00.000Z",
                broadcast_count: 0
            }
        ]);
        const service = createAutoOutageDetectionService({
            repository: repo,
            runtime: createRuntimeWithUsers([
                { id: "1", pppoe_username: "cust-a", area: "Utara" },
                { id: "2", pppoe_username: "cust-b", area: "Utara" }
            ]),
            now: () => new Date("2026-05-03T05:00:00.000Z")
        });

        const snapshot = await service.buildDetectionSnapshot({
            rule: {
                target_scope: "area",
                target_filter_json: { area: "Utara" },
                offline_threshold_minutes: 180,
                broadcast_cooldown_minutes: 720,
                max_broadcast_per_incident: 1
            }
        });
        expect(snapshot.eligible).toHaveLength(1);
        expect(snapshot.eligible[0].user_id).toBe("1");
        expect(snapshot.ineligible).toHaveLength(1);
    });
});
