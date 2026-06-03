# Runtime Boundary and Repository Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menetapkan `runtime boundary` sebagai source dependency yang eksplisit dan menormalkan `repository owner` per domain prioritas agar penambahan fitur lebih presisi, test setup lebih ringan, dan maintenance tidak bergantung pada `global.*`.

**Architecture:** Kerja dilakukan dalam dua fase fondasi. Fase P0 membekukan kontrak runtime dan mengurangi pembacaan `global.*` di jalur bisnis aktif melalui container/factory yang bisa ditrace. Fase P1 membungkus persistence campuran ke repository owner, lalu mengarahkan service agar hanya berbicara ke repository. Setiap slice harus berakhir dengan guardrail test atau verifikasi ringan agar tidak ada drift dependency atau routing behavior.

**Tech Stack:** Node.js CommonJS, Jest, WhatsApp bot `message/*`, Express routes `routes/*`, service `services/*`, repository `repositories/*`, persistence SQLite + JSON legacy + helper `lib/*`.

---

### Task 1: Freeze Runtime Contract and Current Leak Points

**Files:**
- Create: `C:\project\raf-bot-v2\lib\__tests__\runtime-contract.test.js`
- Verify: `C:\project\raf-bot-v2\lib\app-runtime.js`
- Verify: `C:\project\raf-bot-v2\index.js`
- Verify: `C:\project\raf-bot-v2\message\raf.js`

- [ ] **Step 1: Write the failing runtime contract test**

```js
const { createAppRuntime } = require("../app-runtime");

test("runtime exposes explicit registries for config, services, repositories, and gateways", () => {
    const runtime = createAppRuntime({ bootstrapOnly: true });

    expect(runtime).toEqual(expect.objectContaining({
        config: expect.any(Object),
        services: expect.any(Object),
        repositories: expect.any(Object),
        gateways: expect.any(Object)
    }));
});
```

- [ ] **Step 2: Run the contract test to capture current gap**

Run: `npm test -- lib/__tests__/runtime-contract.test.js`
Expected: FAIL jika kontrak registry belum eksplisit atau shape belum stabil.

- [ ] **Step 3: Add the minimal runtime registry shape**

```js
return {
    config,
    repositories,
    services,
    gateways,
    adapters,
    caches
};
```

- [ ] **Step 4: Re-run the runtime contract guardrail**

Run: `npm test -- lib/__tests__/runtime-contract.test.js`
Expected: PASS.

### Task 2: Add Global Access Static Guardrail

**Files:**
- Create: `C:\project\raf-bot-v2\lib\__tests__\runtime-global-leaks.test.js`
- Verify: `C:\project\raf-bot-v2\message\raf.js`
- Verify: `C:\project\raf-bot-v2\routes\admin.routes.js`
- Verify: `C:\project\raf-bot-v2\services\*.js`

- [ ] **Step 1: Write the failing static guardrail**

```js
const fs = require("fs");
const path = require("path");

test("active business entrypoints do not read forbidden global runtime fields directly", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "..", "message", "raf.js"), "utf8");

    expect(source).not.toContain("global.voucher");
    expect(source).not.toContain("global.statik");
});
```

- [ ] **Step 2: Run the guardrail to identify current direct global reads**

Run: `npm test -- lib/__tests__/runtime-global-leaks.test.js`
Expected: FAIL pada field global yang masih dipakai langsung.

- [ ] **Step 3: Replace one leak class at a time with runtime-backed dependency access**

```js
const runtime = global.__appRuntime || null;
const voucherCatalog = runtime?.repositories?.voucherCatalog || global.voucher;
```

- [ ] **Step 4: Re-run the static guardrail**

Run: `npm test -- lib/__tests__/runtime-global-leaks.test.js`
Expected: PASS untuk target leak awal.

### Task 3: Route and Bot Entry Points Consume Runtime Explicitly

**Files:**
- Modify: `C:\project\raf-bot-v2\index.js`
- Modify: `C:\project\raf-bot-v2\lib\routes-registry.js`
- Modify: `C:\project\raf-bot-v2\message\raf.js`
- Create: `C:\project\raf-bot-v2\routes\__tests__\runtime-wiring.test.js`

- [ ] **Step 1: Write the failing wiring test**

```js
test("app runtime is passed into route and bot composition roots", () => {
    const registry = require("../../lib/routes-registry");
    expect(registry.registerRoutes).toBeDefined();
});
```

- [ ] **Step 2: Run the test and inspect where runtime is still implicit**

Run: `npm test -- routes/__tests__/runtime-wiring.test.js`
Expected: FAIL or incomplete assertions until runtime is threaded consistently.

- [ ] **Step 3: Thread runtime through composition roots**

```js
registerRoutes(app, {
    runtime: appRuntime
});

msgHandler(rafSocket, msg, m, {
    runtime: appRuntime
});
```

- [ ] **Step 4: Re-run the wiring test plus current route registry tests**

Run: `npm test -- routes/__tests__/runtime-wiring.test.js routes/__tests__/routes-registry.test.js`
Expected: PASS.

### Task 4: Introduce Repository Contract Tests for Billing and Voucher

**Files:**
- Create: `C:\project\raf-bot-v2\repositories\__tests__\billing.repository.contract.test.js`
- Create: `C:\project\raf-bot-v2\repositories\__tests__\voucher.repository.contract.test.js`
- Verify: `C:\project\raf-bot-v2\repositories\billing.repository.js`
- Verify: `C:\project\raf-bot-v2\repositories\voucher.repository.js`

- [ ] **Step 1: Write failing contract tests for repository owners**

```js
test("billing repository exposes package-change and billing list reads", () => {
    const repository = require("../billing.repository");
    expect(repository.listPackageChangeRequests).toEqual(expect.any(Function));
});
```

```js
test("voucher repository exposes catalog and inventory reads", () => {
    const repository = require("../voucher.repository");
    expect(repository.getVoucherCatalog).toEqual(expect.any(Function));
});
```

- [ ] **Step 2: Run the contract tests**

Run: `npm test -- repositories/__tests__/billing.repository.contract.test.js repositories/__tests__/voucher.repository.contract.test.js`
Expected: FAIL untuk repository yang belum ada atau belum lengkap.

- [ ] **Step 3: Add minimal repository owner shells**

```js
module.exports = {
    listPackageChangeRequests,
    getVoucherCatalog
};
```

- [ ] **Step 4: Re-run repository contract tests**

Run: `npm test -- repositories/__tests__/billing.repository.contract.test.js repositories/__tests__/voucher.repository.contract.test.js`
Expected: PASS.

### Task 5: Move One Active Service Path Fully Behind Repositories

**Files:**
- Modify: `C:\project\raf-bot-v2\services\billing.service.js`
- Modify: `C:\project\raf-bot-v2\services\admin.service.js`
- Modify: `C:\project\raf-bot-v2\repositories\billing.repository.js`
- Create: `C:\project\raf-bot-v2\services\__tests__\billing.service.repository-boundary.test.js`

- [ ] **Step 1: Write the failing service boundary test**

```js
test("billing service reads package-change data via billing repository", async () => {
    const repository = { listPackageChangeRequests: jest.fn().mockResolvedValue([]) };
    const service = require("../billing.service");

    await service.listPackageChangeRequests({ repository });
    expect(repository.listPackageChangeRequests).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the service boundary test**

Run: `npm test -- services/__tests__/billing.service.repository-boundary.test.js`
Expected: FAIL jika service masih akses helper persistence langsung.

- [ ] **Step 3: Inject repository dependency and remove direct persistence call from the service path**

```js
async function listPackageChangeRequests({ repository = billingRepository } = {}) {
    return repository.listPackageChangeRequests();
}
```

- [ ] **Step 4: Re-run service boundary test plus current admin/billing suites**

Run: `npm test -- services/__tests__/billing.service.repository-boundary.test.js services/__tests__/billing.service.test.js services/__tests__/admin.service.test.js controllers/__tests__/admin.controller.test.js`
Expected: PASS.

### Task 6: Wrap Legacy JSON/SQLite Access for Saldo and Ticket Domains

**Files:**
- Create: `C:\project\raf-bot-v2\repositories\saldo.repository.js`
- Create: `C:\project\raf-bot-v2\repositories\ticket.repository.js`
- Create: `C:\project\raf-bot-v2\repositories\__tests__\saldo-ticket-repositories.test.js`
- Verify: `C:\project\raf-bot-v2\message\handlers\saldo-handler.js`
- Verify: `C:\project\raf-bot-v2\message\handlers\smart-report-*.js`

- [ ] **Step 1: Write the failing repository contract tests**

```js
test("saldo repository owns canonical saldo lookups", () => {
    const repository = require("../saldo.repository");
    expect(repository.getSaldoUser).toEqual(expect.any(Function));
});
```

```js
test("ticket repository owns report persistence entrypoints", () => {
    const repository = require("../ticket.repository");
    expect(repository.saveReportDraft).toEqual(expect.any(Function));
});
```

- [ ] **Step 2: Run the repository tests**

Run: `npm test -- repositories/__tests__/saldo-ticket-repositories.test.js`
Expected: FAIL until repository shells exist.

- [ ] **Step 3: Add compatibility repositories over existing helpers**

```js
async function getSaldoUser(senderId) {
    return saldoManager.getUserSaldo(senderId);
}
```

- [ ] **Step 4: Re-run the repository tests**

Run: `npm test -- repositories/__tests__/saldo-ticket-repositories.test.js`
Expected: PASS.

### Task 7: Replace High-Impact Domain Reads with Repository Injection

**Files:**
- Modify: `C:\project\raf-bot-v2\message\handlers\domain-services.js`
- Modify: `C:\project\raf-bot-v2\message\handlers\domains\saldo-payment.domain.js`
- Modify: `C:\project\raf-bot-v2\message\handlers\domains\reporting.domain.js`
- Create: `C:\project\raf-bot-v2\message\__tests__\runtime-repository-bridge.test.js`

- [ ] **Step 1: Write the failing bridge test**

```js
test("priority message domains can receive repository-backed helpers from runtime", async () => {
    const runtime = {
        repositories: {
            saldo: { getSaldoUser: jest.fn() },
            ticket: { saveReportDraft: jest.fn() }
        }
    };

    expect(runtime.repositories.saldo.getSaldoUser).toEqual(expect.any(Function));
    expect(runtime.repositories.ticket.saveReportDraft).toEqual(expect.any(Function));
});
```

- [ ] **Step 2: Run the bridge test**

Run: `npm test -- message/__tests__/runtime-repository-bridge.test.js`
Expected: FAIL or remain too weak until runtime bridge is wired.

- [ ] **Step 3: Thread repository-backed helpers through domain services/facades**

```js
const saldoRepository = runtime?.repositories?.saldo || legacySaldoRepository;
```

- [ ] **Step 4: Re-run bridge plus existing message regression suites**

Run: `npm test -- message/__tests__/runtime-repository-bridge.test.js message/__tests__/raf-router-boundary.test.js message/__tests__/bot-hardening.test.js`
Expected: PASS.

### Task 8: Sync Maps and Run Final Foundation Verification

**Files:**
- Modify: `C:\project\raf-bot-v2\SYSTEM_MAP.md`
- Modify: `C:\project\raf-bot-v2\message\.module_map.md`
- Modify: `C:\project\raf-bot-v2\message\handlers\.module_map.md`
- Modify: `C:\project\raf-bot-v2\routes\.module_map.md`
- Verify: `C:\project\raf-bot-v2\lib\app-runtime.js`

- [ ] **Step 1: Sync maps with runtime/repository ownership wording**

```md
- `lib/app-runtime.js`: source wiring runtime container untuk config, services, repositories, dan gateways.
- `repositories/*.js`: owner persistence domain; service aktif tidak lagi membaca helper/DB langsung.
```

- [ ] **Step 2: Run final foundation verification suite**

Run: `npm test -- lib/__tests__/runtime-contract.test.js lib/__tests__/runtime-global-leaks.test.js routes/__tests__/runtime-wiring.test.js repositories/__tests__/billing.repository.contract.test.js repositories/__tests__/voucher.repository.contract.test.js repositories/__tests__/saldo-ticket-repositories.test.js services/__tests__/billing.service.repository-boundary.test.js services/__tests__/billing.service.test.js services/__tests__/admin.service.test.js controllers/__tests__/admin.controller.test.js message/__tests__/runtime-repository-bridge.test.js message/__tests__/raf-router-boundary.test.js message/__tests__/bot-hardening.test.js`
Expected: PASS.

- [ ] **Step 3: Commit the foundation batch**

```bash
git add lib/app-runtime.js lib/routes-registry.js index.js routes/__tests__/runtime-wiring.test.js lib/__tests__/runtime-contract.test.js lib/__tests__/runtime-global-leaks.test.js repositories services message SYSTEM_MAP.md
git commit -m "refactor: normalize runtime boundary and repositories"
```
