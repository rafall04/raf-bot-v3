# Auto Outage Broadcast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build database-first PPPoE outage detection, admin audit dashboard, and interactive WhatsApp triage for confirmed customer outage tickets.

**Architecture:** Add a focused `auto-outage-broadcast` bounded context with repository, detection service, rule service, conversation service, admin registrar, and WhatsApp state handler. Phase 1A ships precise dry-run/manual detection before automatic broadcast; Phase 1B adds configurable broadcast and customer triage.

**Tech Stack:** Node.js CommonJS, Express, SQLite3, Jest, existing runtime repositories, `lib/mikrotik.js`, `lib/whatsapp-delivery-service.js`, existing ticket/report orchestration services.

---

/**
 * Header Doc
 * Purpose: Implementation plan untuk fitur auto outage broadcast berbasis PPPoE MikroTik dengan tahapan skeleton-first, deteksi presisi, admin audit, dan triage WhatsApp.
 * Caller: Pengembang/agent yang menjalankan plan setelah spec `docs/superpowers/specs/2026-05-03-auto-outage-broadcast-design.md` disetujui.
 * Deps: `SYSTEM_MAP.md`, `lib/.module_map.md`, `routes/.module_map.md`, spec auto outage broadcast, Jest, SQLite runtime, MikroTik adapter, WhatsApp delivery boundary.
 * MainFuncs: Merinci file target, urutan tugas TDD, command verifikasi, checkpoint approval, dan commit per task.
 * SideEffects: Tidak ada; dokumen rencana statis.
 */

## Pre-Implementation Rules

- Read `SYSTEM_MAP.md`, `lib/.module_map.md`, `routes/.module_map.md`, `message/.module_map.md`, and `message/handlers/.module_map.md` before editing code.
- Do not scan ignored directories: `node_modules`, `venv`, `.venv`, `env`, `vendor`, `target`, `.gradle`, `bin`, `obj`, `pkg`, `.git`, `.vscode`, `.idea`, `pycache`, `dist`, `build`, `tmp`, `coverage`, `.next`, `.nuxt`, `.cache`.
- New feature work must follow skeleton-first. Task 1 creates contracts, stubs, and Header Docs only. Stop after Task 1 and request user approval before Task 2.
- Every created or modified file must have a Header Doc with Purpose, Caller, Deps, MainFuncs, and SideEffects.
- Do not import Baileys or raw WhatsApp socket in new route/service code. Use `lib/whatsapp-delivery-service.js`.
- Do not call MikroTik directly from routes. Inject adapter functions from `lib/mikrotik.js` into services.
- Do not create tickets until customer sends final confirmation.
- Keep route handlers thin and wrapped in `asyncHandler`.
- Use batch reads and upserts for state. Avoid N+1 MikroTik calls for all customers.

## File Structure

Create:

- `repositories/auto-outage.repository.js`: SQLite persistence owner for rules, states, conversations, scan logs, and batch upserts.
- `services/auto-outage-detection.service.js`: database-first PPPoE active diff, offline duration evaluation, and scan summary.
- `services/auto-outage-rule.service.js`: rule defaults, validation, target matching, threshold/cooldown eligibility.
- `services/auto-outage-conversation.service.js`: inbound reply normalization, triage category mapping, media attachment persistence handoff, ticket confirmation.
- `routes/admin-auto-outage-routes.js`: admin API registrar for scan, dashboard read model, rules, dry-run, manual broadcast.
- `message/handlers/state-domains/auto-outage-state-handler.js`: WhatsApp conversation state handler for outage confirmations.
- `lib/cron/jobs/auto-outage-check.js`: scheduler shell for enabled rules after manual detection is validated.
- `repositories/__tests__/auto-outage.repository.test.js`: repository schema and persistence tests.
- `services/__tests__/auto-outage-detection.service.test.js`: detection and audit tests.
- `services/__tests__/auto-outage-rule.service.test.js`: rule validation and eligibility tests.
- `services/__tests__/auto-outage-conversation.service.test.js`: triage, media, and ticket confirmation tests.
- `routes/__tests__/admin-auto-outage-routes.test.js`: admin route contract tests.
- `message/__tests__/auto-outage-state-handler.test.js`: WA state routing tests.

Modify:

- `routes/admin-router.js`: import and register `registerAdminAutoOutageRoutes` before legacy router.
- `lib/cron.js`: import and initialize `initAutoOutageCheckTask` only after manual feature flag/config exists.
- `message/handlers/conversation-state-owner-map.js`: add auto outage state owner key.
- `message/handlers/conversation-state-router.js`: route auto outage state to the new handler if map requires explicit import.
- `database/response_templates.json`: add default editable response template keys for outage initial, detail, media request, ticket confirmation, safe close, ticket created, and declined.
- `SYSTEM_MAP.md`: add boundary map entry after implementation.
- `routes/.module_map.md`, `lib/.module_map.md`, `message/handlers/.module_map.md`: sync new files and flow after implementation.

## Task 1: Skeleton Contracts and Headers

**Files:**
- Create: `repositories/auto-outage.repository.js`
- Create: `services/auto-outage-detection.service.js`
- Create: `services/auto-outage-rule.service.js`
- Create: `services/auto-outage-conversation.service.js`
- Create: `routes/admin-auto-outage-routes.js`
- Create: `message/handlers/state-domains/auto-outage-state-handler.js`
- Create: `lib/cron/jobs/auto-outage-check.js`
- Test: `repositories/__tests__/auto-outage.repository.test.js`
- Test: `services/__tests__/auto-outage-detection.service.test.js`
- Test: `services/__tests__/auto-outage-rule.service.test.js`
- Test: `services/__tests__/auto-outage-conversation.service.test.js`
- Test: `routes/__tests__/admin-auto-outage-routes.test.js`
- Test: `message/__tests__/auto-outage-state-handler.test.js`

- [ ] **Step 1: Create repository skeleton**

Create `repositories/auto-outage.repository.js` with Header Doc and exported factory only.

```js
/**
 * Header Doc
 * Purpose: Owner persistence SQLite untuk auto outage rules, states, conversations, dan scan logs.
 * Caller: `services/auto-outage-*.service.js` dan `routes/admin-auto-outage-routes.js`.
 * Deps: `sqlite3`, `lib/env-config.getDatabasePath`, runtime DB fallback.
 * MainFuncs: `createAutoOutageRepository`, `ensureSchema`, rule/state/conversation/scan-log CRUD skeleton.
 * SideEffects: Membuka koneksi SQLite dan menyiapkan table auto outage saat dipanggil.
 */
"use strict";

function defaultDeps() {
    return {
        sqlite3: require("sqlite3").verbose(),
        getDatabasePath: require("../lib/env-config").getDatabasePath,
        runtime: global.__appRuntime || null
    };
}

function createAutoOutageRepository(overrides = {}) {
    const deps = { ...defaultDeps(), ...overrides };

    return {
        deps,
        async ensureSchema() { throw new Error("AUTO_OUTAGE_REPOSITORY_NOT_IMPLEMENTED"); },
        async upsertRule() { throw new Error("AUTO_OUTAGE_REPOSITORY_NOT_IMPLEMENTED"); },
        async listRules() { throw new Error("AUTO_OUTAGE_REPOSITORY_NOT_IMPLEMENTED"); },
        async getRuleById() { throw new Error("AUTO_OUTAGE_REPOSITORY_NOT_IMPLEMENTED"); },
        async getEnabledRules() { throw new Error("AUTO_OUTAGE_REPOSITORY_NOT_IMPLEMENTED"); },
        async upsertStates() { throw new Error("AUTO_OUTAGE_REPOSITORY_NOT_IMPLEMENTED"); },
        async listStates() { throw new Error("AUTO_OUTAGE_REPOSITORY_NOT_IMPLEMENTED"); },
        async getStateByUserId() { throw new Error("AUTO_OUTAGE_REPOSITORY_NOT_IMPLEMENTED"); },
        async createConversation() { throw new Error("AUTO_OUTAGE_REPOSITORY_NOT_IMPLEMENTED"); },
        async updateConversation() { throw new Error("AUTO_OUTAGE_REPOSITORY_NOT_IMPLEMENTED"); },
        async getOpenConversationByUserId() { throw new Error("AUTO_OUTAGE_REPOSITORY_NOT_IMPLEMENTED"); },
        async insertScanLog() { throw new Error("AUTO_OUTAGE_REPOSITORY_NOT_IMPLEMENTED"); },
        async listScanLogs() { throw new Error("AUTO_OUTAGE_REPOSITORY_NOT_IMPLEMENTED"); }
    };
}

module.exports = { createAutoOutageRepository };
```

- [ ] **Step 2: Create service and route skeletons**

Create the remaining skeleton files with the factory names and sentinel errors listed here:

```js
// services/auto-outage-detection.service.js
module.exports = { createAutoOutageDetectionService };
// exported methods: runManualScan, buildDetectionSnapshot
// sentinel: AUTO_OUTAGE_DETECTION_NOT_IMPLEMENTED

// services/auto-outage-rule.service.js
module.exports = { createAutoOutageRuleService };
// exported methods: normalizeRuleInput, evaluateEligibility, matchRuleTarget
// sentinel: AUTO_OUTAGE_RULE_NOT_IMPLEMENTED

// services/auto-outage-conversation.service.js
module.exports = { createAutoOutageConversationService };
// exported methods: startConversation, handleCustomerReply, sendTicketConfirmation, finalizeTicketDecision
// sentinel: AUTO_OUTAGE_CONVERSATION_NOT_IMPLEMENTED

// routes/admin-auto-outage-routes.js
module.exports = { registerAdminAutoOutageRoutes };
// initial endpoint: GET /api/admin/auto-outage/health

// message/handlers/state-domains/auto-outage-state-handler.js
module.exports = { handleAutoOutageState };

// lib/cron/jobs/auto-outage-check.js
module.exports = { initAutoOutageCheckTask };
```

Every file must include a Header Doc matching its responsibility from the File Structure section.

- [ ] **Step 3: Create smoke tests for skeleton exports**

Example for `services/__tests__/auto-outage-rule.service.test.js`:

```js
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
```

- [ ] **Step 4: Run skeleton tests**

```bash
npm test -- --runTestsByPath repositories/__tests__/auto-outage.repository.test.js services/__tests__/auto-outage-detection.service.test.js services/__tests__/auto-outage-rule.service.test.js services/__tests__/auto-outage-conversation.service.test.js routes/__tests__/admin-auto-outage-routes.test.js message/__tests__/auto-outage-state-handler.test.js
```

Expected: PASS for export-contract tests only.

- [ ] **Step 5: Commit skeleton and stop for approval**

```bash
git add repositories/auto-outage.repository.js services/auto-outage-detection.service.js services/auto-outage-rule.service.js services/auto-outage-conversation.service.js routes/admin-auto-outage-routes.js message/handlers/state-domains/auto-outage-state-handler.js lib/cron/jobs/auto-outage-check.js repositories/__tests__/auto-outage.repository.test.js services/__tests__/auto-outage-detection.service.test.js services/__tests__/auto-outage-rule.service.test.js services/__tests__/auto-outage-conversation.service.test.js routes/__tests__/admin-auto-outage-routes.test.js message/__tests__/auto-outage-state-handler.test.js
git commit -m "feat: add auto outage skeleton contracts"
```

Stop and ask user approval before Task 2.

## Task 2: Repository Schema and Persistence

**Files:**
- Modify: `repositories/auto-outage.repository.js`
- Test: `repositories/__tests__/auto-outage.repository.test.js`

- [ ] **Step 1: Replace repository skeleton tests with schema tests**

```js
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
    });

    test("upserts enabled rule", async () => {
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
        const enabled = await repository.getEnabledRules();
        expect(enabled).toHaveLength(1);
        expect(enabled[0].offline_threshold_minutes).toBe(180);
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
    });
});
```

- [ ] **Step 2: Run repository tests to verify failure**

```bash
npm test -- --runTestsByPath repositories/__tests__/auto-outage.repository.test.js
```

Expected: FAIL with `AUTO_OUTAGE_REPOSITORY_NOT_IMPLEMENTED`.

- [ ] **Step 3: Implement schema and repository methods**

Implement promise wrappers for `db.run`, `db.get`, and `db.all`. Create these tables: `auto_outage_rules`, `auto_outage_states`, `auto_outage_conversations`, `auto_outage_scan_logs`. Add indexes on `pppoe_username`, `user_id`, `router_id`, `status`, `offline_since`, and `started_at`.

Required method signatures:

```js
async function ensureSchema() {}
async function upsertRule(input) {}
async function listRules() {}
async function getRuleById(id) {}
async function getEnabledRules() {}
async function upsertStates(states) {}
async function listStates({ status, limit = 100, offset = 0 } = {}) {}
async function getStateByUserId(userId) {}
async function createConversation(input) {}
async function updateConversation(id, patch) {}
async function getOpenConversationByUserId(userId) {}
async function insertScanLog(input) {}
async function listScanLogs({ limit = 50, offset = 0 } = {}) {}
```

- [ ] **Step 4: Run repository tests to verify pass**

```bash
npm test -- --runTestsByPath repositories/__tests__/auto-outage.repository.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit repository**

```bash
git add repositories/auto-outage.repository.js repositories/__tests__/auto-outage.repository.test.js
git commit -m "feat: add auto outage persistence"
```

## Task 3: Rule Service Logic

**Files:**
- Modify: `services/auto-outage-rule.service.js`
- Test: `services/__tests__/auto-outage-rule.service.test.js`

- [ ] **Step 1: Write rule service tests**

```js
const { createAutoOutageRuleService } = require("../auto-outage-rule.service");

describe("auto-outage-rule.service", () => {
    test("normalizes valid rule input with defaults", () => {
        const service = createAutoOutageRuleService();
        const rule = service.normalizeRuleInput({ name: "Rule Utama", offline_threshold_hours: 3 });
        expect(rule.name).toBe("Rule Utama");
        expect(rule.enabled).toBe(false);
        expect(rule.target_scope).toBe("all");
        expect(rule.offline_threshold_minutes).toBe(180);
        expect(rule.scan_interval_minutes).toBe(30);
        expect(rule.broadcast_cooldown_minutes).toBe(720);
    });

    test("rejects invalid threshold and interval", () => {
        const service = createAutoOutageRuleService();
        expect(() => service.normalizeRuleInput({ name: "Bad", offline_threshold_minutes: 0 })).toThrow("offline_threshold_minutes must be at least 15");
        expect(() => service.normalizeRuleInput({ name: "Bad", scan_interval_minutes: 0 })).toThrow("scan_interval_minutes must be at least 5");
    });

    test("matches all, area, odp, profile, and router targets", () => {
        const service = createAutoOutageRuleService();
        const user = { area: "Utara", connected_odp_id: "ODP-1", subscription: "20M" };
        const state = { router_id: "router-a" };
        expect(service.matchRuleTarget({ target_scope: "all" }, user, state)).toBe(true);
        expect(service.matchRuleTarget({ target_scope: "area", target_filter_json: { area: "Utara" } }, user, state)).toBe(true);
        expect(service.matchRuleTarget({ target_scope: "odp", target_filter_json: { odp: "ODP-1" } }, user, state)).toBe(true);
        expect(service.matchRuleTarget({ target_scope: "profile", target_filter_json: { profile: "20M" } }, user, state)).toBe(true);
        expect(service.matchRuleTarget({ target_scope: "router", target_filter_json: { router_id: "router-a" } }, user, state)).toBe(true);
    });

    test("evaluates threshold and cooldown eligibility", () => {
        const service = createAutoOutageRuleService({ now: () => new Date("2026-05-03T05:00:00.000Z") });
        const rule = { offline_threshold_minutes: 180, broadcast_cooldown_minutes: 720, max_broadcast_per_incident: 1 };
        const state = { offline_since: "2026-05-03T01:00:00.000Z", broadcast_count: 0, last_broadcast_at: null };
        expect(service.evaluateEligibility(rule, state).eligible).toBe(true);
        const sent = { ...state, broadcast_count: 1, last_broadcast_at: "2026-05-03T04:00:00.000Z" };
        expect(service.evaluateEligibility(rule, sent).eligible).toBe(false);
    });
});
```

- [ ] **Step 2: Run rule tests to verify failure**

```bash
npm test -- --runTestsByPath services/__tests__/auto-outage-rule.service.test.js
```

Expected: FAIL with sentinel error.

- [ ] **Step 3: Implement rule service**

Core normalization code:

```js
function toPositiveInteger(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.floor(number) : fallback;
}

function normalizeJsonObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return value;
}

function normalizeRuleInput(input = {}) {
    const thresholdMinutes = input.offline_threshold_hours
        ? toPositiveInteger(input.offline_threshold_hours, 3) * 60
        : toPositiveInteger(input.offline_threshold_minutes, 180);
    const scanInterval = toPositiveInteger(input.scan_interval_minutes, 30);
    const cooldown = toPositiveInteger(input.broadcast_cooldown_minutes, 720);
    if (thresholdMinutes < 15) throw new Error("offline_threshold_minutes must be at least 15");
    if (scanInterval < 5) throw new Error("scan_interval_minutes must be at least 5");
    return {
        name: String(input.name || "Auto Outage Rule").trim(),
        enabled: Boolean(input.enabled),
        router_id: input.router_id ? String(input.router_id) : "default",
        target_scope: input.target_scope || "all",
        target_filter_json: normalizeJsonObject(input.target_filter_json),
        offline_threshold_minutes: thresholdMinutes,
        scan_interval_minutes: scanInterval,
        broadcast_cooldown_minutes: cooldown,
        max_broadcast_per_incident: toPositiveInteger(input.max_broadcast_per_incident, 1),
        template_initial: String(input.template_initial || ""),
        template_followup: String(input.template_followup || ""),
        template_ticket_confirmation: String(input.template_ticket_confirmation || ""),
        options_json: Array.isArray(input.options_json) ? input.options_json : [],
        require_media_for_categories_json: Array.isArray(input.require_media_for_categories_json) ? input.require_media_for_categories_json : [],
        auto_ticket_enabled: input.auto_ticket_enabled !== false
    };
}
```

- [ ] **Step 4: Run rule tests to verify pass**

```bash
npm test -- --runTestsByPath services/__tests__/auto-outage-rule.service.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit rule service**

```bash
git add services/auto-outage-rule.service.js services/__tests__/auto-outage-rule.service.test.js
git commit -m "feat: add auto outage rule evaluation"
```

## Task 4: Detection Service

**Files:**
- Modify: `services/auto-outage-detection.service.js`
- Test: `services/__tests__/auto-outage-detection.service.test.js`

- [ ] **Step 1: Write detection tests**

```js
const { createAutoOutageDetectionService } = require("../auto-outage-detection.service");

function createRepoStub() {
    const writes = { states: [], logs: [] };
    return {
        writes,
        ensureSchema: jest.fn().mockResolvedValue(),
        listStates: jest.fn().mockResolvedValue({ items: [] }),
        upsertStates: jest.fn(async (states) => { writes.states.push(...states); return states; }),
        insertScanLog: jest.fn(async (log) => { writes.logs.push(log); return { id: 1, ...log }; })
    };
}

describe("auto-outage-detection.service", () => {
    test("uses database users as source of truth and ignores unknown active PPP", async () => {
        const repo = createRepoStub();
        const service = createAutoOutageDetectionService({
            repository: repo,
            runtime: { repositories: { users: { getAll: () => [
                { id: "1", name: "A", pppoe_username: "cust-a", phone_number: "6281" },
                { id: "2", name: "B", pppoe_username: "cust-b", phone_number: "6282" },
                { id: "3", name: "C", phone_number: "6283" }
            ] } } },
            getActivePPPoEUsers: jest.fn().mockResolvedValue([{ name: "cust-a" }, { name: "unknown-router-user" }]),
            getAllPPPoESecrets: jest.fn().mockResolvedValue([{ name: "cust-b", "last-logged-out": "May/03/2026 01:00:00" }]),
            now: () => new Date("2026-05-03T05:00:00.000Z")
        });
        const result = await service.runManualScan({ router_id: "main-router" });
        expect(result.summary.total_db_users).toBe(3);
        expect(result.summary.total_with_pppoe).toBe(2);
        expect(result.summary.total_online).toBe(1);
        expect(result.summary.total_offline_candidates).toBe(1);
        expect(result.summary.total_skipped).toBe(1);
        expect(repo.writes.states.find((state) => state.user_id === "2").status).toBe("offline");
    });

    test("does not mark all customers offline when active PPP fetch fails", async () => {
        const repo = createRepoStub();
        const service = createAutoOutageDetectionService({
            repository: repo,
            runtime: { repositories: { users: { getAll: () => [{ id: "1", pppoe_username: "cust-a" }] } } },
            getActivePPPoEUsers: jest.fn().mockRejectedValue(new Error("router timeout")),
            getAllPPPoESecrets: jest.fn(),
            now: () => new Date("2026-05-03T05:00:00.000Z")
        });
        const result = await service.runManualScan({ router_id: "main-router" });
        expect(result.status).toBe(502);
        expect(repo.upsertStates).not.toHaveBeenCalled();
        expect(repo.insertScanLog).toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run detection tests to verify failure**

```bash
npm test -- --runTestsByPath services/__tests__/auto-outage-detection.service.test.js
```

Expected: FAIL with sentinel error.

- [ ] **Step 3: Implement detection algorithm**

Required behavior:

- `getUsersSnapshot()` reads `deps.runtime.repositories.users.getAll()`, then `deps.runtime.state.get("users")`, then `global.users`, then `[]`.
- Normalize PPPoE username with `String(value || "").trim().toLowerCase()`.
- Active PPP set comes from `name`, `user`, or `username` field.
- On active fetch failure, insert scan log with `error_message` and return `{ status: 502, message, summary }` without writing offline states.
- For candidates missing from active set, call `getAllPPPoESecrets` once and build `secretByName` map.
- Use `last-logged-out`, `last_logged_out`, or `lastLoggedOut` when available.
- If date parse fails, use `now().toISOString()` as `offline_since` and set detection reason `missing_from_ppp_active_internal_time`.
- Upsert all state changes in one `upsertStates(states)` call.

- [ ] **Step 4: Run detection tests to verify pass**

```bash
npm test -- --runTestsByPath services/__tests__/auto-outage-detection.service.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit detection service**

```bash
git add services/auto-outage-detection.service.js services/__tests__/auto-outage-detection.service.test.js
git commit -m "feat: add PPPoE outage detection service"
```

## Task 5: Admin Routes for Phase 1A

**Files:**
- Modify: `routes/admin-auto-outage-routes.js`
- Modify: `routes/admin-router.js`
- Test: `routes/__tests__/admin-auto-outage-routes.test.js`

- [ ] **Step 1: Write route tests**

```js
const express = require("express");
const request = require("supertest");
const { registerAdminAutoOutageRoutes } = require("../admin-auto-outage-routes");

function buildApp(overrides = {}) {
    const app = express();
    app.use(express.json());
    const router = express.Router();
    registerAdminAutoOutageRoutes(router, {
        ensureAuthenticatedStaff: (_req, _res, next) => next(),
        detectionService: overrides.detectionService,
        repository: overrides.repository
    });
    app.use(router);
    return app;
}

describe("admin auto outage routes", () => {
    test("POST /api/admin/auto-outage/scan runs manual scan", async () => {
        const detectionService = { runManualScan: jest.fn().mockResolvedValue({ status: 200, summary: { total_db_users: 2 } }) };
        const app = buildApp({ detectionService });
        const res = await request(app).post("/api/admin/auto-outage/scan").send({ router_id: "main-router" });
        expect(res.status).toBe(200);
        expect(res.body.data.summary.total_db_users).toBe(2);
    });
});
```

- [ ] **Step 2: Run route tests to verify failure**

```bash
npm test -- --runTestsByPath routes/__tests__/admin-auto-outage-routes.test.js
```

Expected: FAIL because route paths are not implemented.

- [ ] **Step 3: Implement Phase 1A endpoints**

Add:

- `GET /api/admin/auto-outage/health`
- `POST /api/admin/auto-outage/scan`
- `GET /api/admin/auto-outage/states`
- `GET /api/admin/auto-outage/scan-logs`

Response shape:

```js
res.status(200).json({
    status: 200,
    message: "Auto outage states loaded.",
    data: result
});
```

- [ ] **Step 4: Register admin route**

Modify `routes/admin-router.js`:

```js
const { registerAdminAutoOutageRoutes } = require("./admin-auto-outage-routes");

function createAdminAutoOutageDeps(runtime) {
    return {
        ensureAuthenticatedStaff,
        runtime
    };
}

registerAdminAutoOutageRoutes(router, createAdminAutoOutageDeps(runtime));
```

- [ ] **Step 5: Run route tests to verify pass**

```bash
npm test -- --runTestsByPath routes/__tests__/admin-auto-outage-routes.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit admin Phase 1A routes**

```bash
git add routes/admin-auto-outage-routes.js routes/admin-router.js routes/__tests__/admin-auto-outage-routes.test.js
git commit -m "feat: add auto outage admin scan routes"
```

## Task 6: Conversation Service Phase 1B

**Files:**
- Modify: `services/auto-outage-conversation.service.js`
- Test: `services/__tests__/auto-outage-conversation.service.test.js`

- [ ] **Step 1: Write conversation tests**

```js
const { createAutoOutageConversationService } = require("../auto-outage-conversation.service");

describe("auto-outage-conversation.service", () => {
    test("maps aman replies and closes conversation safely", async () => {
        const repository = {
            getOpenConversationByUserId: jest.fn().mockResolvedValue({ id: "conv-1", user_id: "1", status: "waiting_initial" }),
            updateConversation: jest.fn().mockResolvedValue({ id: "conv-1", status: "closed", closed_reason: "customer_safe" })
        };
        const service = createAutoOutageConversationService({ repository, sendMessage: jest.fn(), now: () => new Date("2026-05-03T05:00:00.000Z") });
        const result = await service.handleCustomerReply({ user: { id: "1" }, text: "aman" });
        expect(result.category).toBe("aman");
        expect(repository.updateConversation).toHaveBeenCalledWith("conv-1", expect.objectContaining({ status: "closed", closed_reason: "customer_safe" }));
    });

    test("maps LOS/kabel complaint and asks ticket confirmation", async () => {
        const repository = {
            getOpenConversationByUserId: jest.fn().mockResolvedValue({ id: "conv-1", user_id: "1", status: "waiting_detail" }),
            updateConversation: jest.fn().mockResolvedValue({ id: "conv-1", status: "waiting_ticket_confirm" })
        };
        const sendMessage = jest.fn().mockResolvedValue({ ok: true });
        const service = createAutoOutageConversationService({ repository, sendMessage, renderResponseTemplate: (_key, fallback) => fallback });
        const result = await service.handleCustomerReply({ user: { id: "1", phone_number: "6281" }, text: "lampu los merah" });
        expect(result.category).toBe("los_kabel");
        expect(sendMessage).toHaveBeenCalled();
    });

    test("creates ticket only on final YA", async () => {
        const repository = {
            getOpenConversationByUserId: jest.fn().mockResolvedValue({ id: "conv-1", user_id: "1", status: "waiting_ticket_confirm", triage_category: "los_kabel", description: "LOS merah" }),
            updateConversation: jest.fn().mockResolvedValue({ id: "conv-1", status: "closed", ticket_id: "TKT-1" })
        };
        const createCustomerReportTicket = jest.fn().mockResolvedValue({ ticketId: "TKT-1" });
        const service = createAutoOutageConversationService({ repository, createCustomerReportTicket, sendMessage: jest.fn() });
        const result = await service.handleCustomerReply({ user: { id: "1", name: "A", phone_number: "6281" }, text: "YA" });
        expect(result.ticketCreated).toBe(true);
        expect(createCustomerReportTicket).toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npm test -- --runTestsByPath services/__tests__/auto-outage-conversation.service.test.js
```

Expected: FAIL with sentinel error.

- [ ] **Step 3: Implement conversation service**

Implement:

- `normalizeReply(text)` lowercases and trims text.
- `classifyTriage(text)` maps `aman`, `alat_mati`, `los_kabel`, `no_internet`, `lambat`, `lainnya`.
- `startConversation({ user, state, rule })` creates conversation and sends initial template.
- `handleCustomerReply(context)` reads open conversation, branches by status, saves raw reply and category.
- `finalizeTicketDecision(context)` creates ticket only for `ya`, `y`, `iya`, `ajukan`, `buat tiket`.
- Media metadata from context is stored in `media_json` without downloading raw Baileys content in this service.

- [ ] **Step 4: Run conversation tests to verify pass**

```bash
npm test -- --runTestsByPath services/__tests__/auto-outage-conversation.service.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit conversation service**

```bash
git add services/auto-outage-conversation.service.js services/__tests__/auto-outage-conversation.service.test.js
git commit -m "feat: add auto outage conversation triage"
```

## Task 7: WhatsApp State Handler Integration

**Files:**
- Modify: `message/handlers/state-domains/auto-outage-state-handler.js`
- Modify: `message/handlers/conversation-state-owner-map.js`
- Modify: `message/handlers/conversation-state-router.js`
- Test: `message/__tests__/auto-outage-state-handler.test.js`

- [ ] **Step 1: Write state handler tests**

```js
const { handleAutoOutageState } = require("../handlers/state-domains/auto-outage-state-handler");

describe("auto outage state handler", () => {
    test("delegates customer reply to conversation service", async () => {
        const autoOutageConversationService = {
            handleCustomerReply: jest.fn().mockResolvedValue({ handled: true, category: "aman" })
        };
        const result = await handleAutoOutageState({
            autoOutageConversationService,
            user: { id: "1" },
            text: "aman",
            sender: "6281@s.whatsapp.net"
        });
        expect(result.handled).toBe(true);
        expect(autoOutageConversationService.handleCustomerReply).toHaveBeenCalledWith(expect.objectContaining({ text: "aman" }));
    });
});
```

- [ ] **Step 2: Add owner map entry**

In `message/handlers/conversation-state-owner-map.js`, add the smallest entry matching existing map style:

```js
auto_outage: "auto-outage"
```

If map uses object descriptors, add:

```js
auto_outage: { owner: "auto-outage", handler: "autoOutage" }
```

Use the exact shape already used in that file.

- [ ] **Step 3: Add router import and dispatch**

In `message/handlers/conversation-state-router.js`, add import:

```js
const { handleAutoOutageState } = require("./state-domains/auto-outage-state-handler");
```

Add dispatch branch following existing pattern:

```js
if (owner === "auto-outage" || state?.type === "auto_outage") {
    return handleAutoOutageState(context);
}
```

- [ ] **Step 4: Run targeted message tests**

```bash
npm test -- --runTestsByPath message/__tests__/auto-outage-state-handler.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit WA state integration**

```bash
git add message/handlers/state-domains/auto-outage-state-handler.js message/handlers/conversation-state-owner-map.js message/handlers/conversation-state-router.js message/__tests__/auto-outage-state-handler.test.js
git commit -m "feat: route auto outage WhatsApp replies"
```

## Task 8: Broadcast Eligibility and Manual Trigger

**Files:**
- Modify: `routes/admin-auto-outage-routes.js`
- Modify: `services/auto-outage-detection.service.js`
- Modify: `services/auto-outage-conversation.service.js`
- Test: `routes/__tests__/admin-auto-outage-routes.test.js`
- Test: `services/__tests__/auto-outage-detection.service.test.js`

- [ ] **Step 1: Add tests for dry-run eligible broadcast**

```js
test("POST /api/admin/auto-outage/dry-run returns eligible states without sending WA", async () => {
    const detectionService = { buildDetectionSnapshot: jest.fn().mockResolvedValue({ eligible: [{ user_id: "1" }] }) };
    const app = buildApp({ detectionService });
    const res = await request(app).post("/api/admin/auto-outage/dry-run").send({ rule_id: "rule-1" });
    expect(res.status).toBe(200);
    expect(res.body.data.eligible).toHaveLength(1);
});
```

- [ ] **Step 2: Add tests for manual broadcast trigger**

Test route `POST /api/admin/auto-outage/broadcast` calls `startConversation` only for eligible states and returns `total_sent`.

- [ ] **Step 3: Run tests to verify failure**

```bash
npm test -- --runTestsByPath routes/__tests__/admin-auto-outage-routes.test.js services/__tests__/auto-outage-detection.service.test.js
```

Expected: FAIL for missing endpoints/methods.

- [ ] **Step 4: Implement dry-run and manual broadcast endpoints**

Add endpoints:

- `POST /api/admin/auto-outage/dry-run`
- `POST /api/admin/auto-outage/broadcast`

Rules:

- Dry-run returns eligible states and summary only.
- Manual broadcast checks WhatsApp readiness through conversation service dependency before sending.
- Manual broadcast updates `broadcast_count`, `last_broadcast_at`, and conversation status.

- [ ] **Step 5: Run tests to verify pass**

```bash
npm test -- --runTestsByPath routes/__tests__/admin-auto-outage-routes.test.js services/__tests__/auto-outage-detection.service.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit manual broadcast**

```bash
git add routes/admin-auto-outage-routes.js services/auto-outage-detection.service.js services/auto-outage-conversation.service.js routes/__tests__/admin-auto-outage-routes.test.js services/__tests__/auto-outage-detection.service.test.js
git commit -m "feat: add auto outage dry-run broadcast"
```

## Task 9: Response Templates

**Files:**
- Modify: `database/response_templates.json`
- Test: `services/__tests__/auto-outage-conversation.service.test.js`

- [ ] **Step 1: Add template keys**

Add these response template entries preserving existing JSON structure:

- `auto_outage_initial_question`
- `auto_outage_detail_prompt`
- `auto_outage_media_prompt`
- `auto_outage_ticket_confirmation`
- `auto_outage_safe_closed`
- `auto_outage_ticket_created`
- `auto_outage_ticket_declined`
- `auto_outage_online_again_closed`

Each entry must include `name`, `category`, and `template` fields if current file uses object entries.

- [ ] **Step 2: Update conversation service fallbacks**

Use `renderResponseTemplate(key, fallback, data)` for every outbound customer-facing message.

- [ ] **Step 3: Run template/conversation tests**

```bash
npm test -- --runTestsByPath services/__tests__/auto-outage-conversation.service.test.js lib/__tests__/template-service.test.js
```

Expected: PASS.

- [ ] **Step 4: Commit templates**

```bash
git add database/response_templates.json services/auto-outage-conversation.service.js services/__tests__/auto-outage-conversation.service.test.js
git commit -m "feat: add auto outage response templates"
```

## Task 10: Cron Hook Disabled-by-Default

**Files:**
- Modify: `lib/cron/jobs/auto-outage-check.js`
- Modify: `lib/cron.js`
- Test: `lib/__tests__/auto-outage-cron.test.js`

- [ ] **Step 1: Write cron disabled test**

```js
const { initAutoOutageCheckTask } = require("../cron/jobs/auto-outage-check");

describe("auto outage cron", () => {
    test("does not start when disabled", () => {
        const result = initAutoOutageCheckTask({ autoOutage: { enabled: false } }, {});
        expect(result.started).toBe(false);
        expect(result.reason).toBe("AUTO_OUTAGE_DISABLED");
    });
});
```

- [ ] **Step 2: Run cron test**

```bash
npm test -- --runTestsByPath lib/__tests__/auto-outage-cron.test.js
```

Expected: PASS after the test file path exists.

- [ ] **Step 3: Implement enabled cron path**

Use `node-cron` only when `config.autoOutage.enabled === true`. Call detection service, catch errors, and log `[AUTO_OUTAGE_CRON_ERROR]` without crashing process. Return `{ started: true, task }`.

- [ ] **Step 4: Wire cron composer**

Modify `lib/cron.js`:

```js
const { initAutoOutageCheckTask } = require('./cron/jobs/auto-outage-check');
initAutoOutageCheckTask(config);
```

Export `initAutoOutageCheckTask`.

- [ ] **Step 5: Run cron tests**

```bash
npm test -- --runTestsByPath lib/__tests__/auto-outage-cron.test.js lib/__tests__/cron-whatsapp.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit cron hook**

```bash
git add lib/cron/jobs/auto-outage-check.js lib/cron.js lib/__tests__/auto-outage-cron.test.js
git commit -m "feat: add disabled auto outage cron hook"
```

## Task 11: Documentation and Maps

**Files:**
- Modify: `SYSTEM_MAP.md`
- Modify: `lib/.module_map.md`
- Modify: `routes/.module_map.md`
- Modify: `message/handlers/.module_map.md`

- [ ] **Step 1: Update root system map**

Add boundary entry:

```text
- `repositories/auto-outage.repository.js` + `services/auto-outage-*.service.js` + `routes/admin-auto-outage-routes.js` + `message/handlers/state-domains/auto-outage-state-handler.js`: owner fitur auto outage broadcast berbasis PPPoE MikroTik dengan database-first match `pppoe_username`, scan dry-run/manual, rule eligibility, WA triage interaktif, dan ticket handoff setelah konfirmasi pelanggan.
```

- [ ] **Step 2: Update local module maps**

Add rows for every new file with correct exports and responsibilities.

- [ ] **Step 3: Run documentation diff check**

```bash
git diff -- SYSTEM_MAP.md lib/.module_map.md routes/.module_map.md message/handlers/.module_map.md
```

Expected: only auto outage entries added.

- [ ] **Step 4: Commit docs**

```bash
git add SYSTEM_MAP.md lib/.module_map.md routes/.module_map.md message/handlers/.module_map.md
git commit -m "docs: map auto outage broadcast flow"
```

## Task 12: Final Verification

**Files:**
- No source edits expected.

- [ ] **Step 1: Run focused auto outage tests**

```bash
npm test -- --runTestsByPath repositories/__tests__/auto-outage.repository.test.js services/__tests__/auto-outage-detection.service.test.js services/__tests__/auto-outage-rule.service.test.js services/__tests__/auto-outage-conversation.service.test.js routes/__tests__/admin-auto-outage-routes.test.js message/__tests__/auto-outage-state-handler.test.js lib/__tests__/auto-outage-cron.test.js
```

Expected: PASS.

- [ ] **Step 2: Run related boundary tests**

```bash
npm test -- --runTestsByPath lib/__tests__/whatsapp-delivery-service.test.js lib/__tests__/mikrotik.test.js lib/__tests__/cron-whatsapp.test.js lib/__tests__/template-service.test.js
```

Expected: PASS.

- [ ] **Step 3: Run full test suite if time allows**

```bash
npm test
```

Expected: PASS, or document pre-existing unrelated failures with exact suite names and failure messages.

- [ ] **Step 4: Manual verification checklist**

Check these manually in dev:

- `POST /api/admin/auto-outage/scan` with mocked/known MikroTik data does not mark everyone offline when MikroTik request fails.
- PPPoE usernames present in MikroTik but absent from database do not appear as broadcast targets.
- A database customer without `pppoe_username` appears as skipped.
- Dry-run shows eligible customers after threshold.
- Manual broadcast creates conversation state and sends exactly one WA per target number set.
- Customer `aman` reply closes without ticket.
- Customer `ada kendala` reply asks for detail and confirmation.
- Customer `YA` after confirmation creates one ticket.

- [ ] **Step 5: Final commit if verification adjusted docs or tests**

```bash
git status --short
git add <only-auto-outage-files-that-changed-during-verification>
git commit -m "test: verify auto outage broadcast flow"
```

Only commit if Step 4 required file edits.

## Self-Review

- Spec coverage: Fase 1A detection, audit, dry-run, and Fase 1B broadcast/triage/ticket confirmation are covered by Tasks 2-10.
- Empty-marker scan: plan avoids unresolved implementation markers and keeps open decisions as explicit task choices.
- Type consistency: service factories use `createAutoOutage*Service`; repository uses `createAutoOutageRepository`; route registrar uses `registerAdminAutoOutageRoutes`; state handler uses `handleAutoOutageState`.
- SDD compliance: Task 1 creates skeletons and stops for approval before implementation logic.
- DB performance: Task 4 enforces one active PPP fetch per router and one secret fetch for offline candidates; Task 2 uses indexed SQLite tables and batch state upsert.
