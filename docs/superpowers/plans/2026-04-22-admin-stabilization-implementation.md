# Admin Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menstabilkan ownership route admin pasca-refactor agar router/controller/service/repository konsisten, route legacy tetap `410`, dan tidak ada routing admin yang bocor.

**Architecture:** `routes/admin-router.js` tetap menjadi composition root admin. Route aktif dijaga tetap tipis, controller hanya memetakan HTTP, service tetap owner business logic, dan `routes/admin.js` hanya fallback legacy. Verifikasi utama dilakukan lewat guardrail Jest yang mengecek mount order, owner endpoint aktif, dan stub `410` untuk legacy route.

**Tech Stack:** Node.js CommonJS, Express, Jest, route registry admin, service/controller/repository admin.

---

### Task 1: Stabilize Admin Mount Order Guardrail

**Files:**
- Modify: `C:\project\raf-bot-v2\routes\__tests__\routes-registry.test.js`
- Verify: `C:\project\raf-bot-v2\lib\routes-registry.js`

- [ ] **Step 1: Write the failing test update for the intended admin mount order**

```js
expect(app.use.mock.calls.slice(0, 6)).toEqual([
    ["/", expect.objectContaining({ __routerName: "public" })],
    ["/api/payment-status", expect.objectContaining({ __routerName: "payment-status" })],
    ["/api/requests", expect.objectContaining({ __routerName: "requests" })],
    ["/", expect.objectContaining({ __routerName: "admin" })],
    ["/api/users", expect.objectContaining({ __routerName: "users" })],
    ["/api/saldo", expect.objectContaining({ __routerName: "saldo" })]
]);
```

- [ ] **Step 2: Run test to verify the old expectation fails**

Run: `npm test -- routes/__tests__/routes-registry.test.js`
Expected: FAIL pada urutan mount admin.

- [ ] **Step 3: Apply the minimal test fix**

Tidak ada perubahan production code jika implementasi saat ini sudah benar; cukup selaraskan guardrail test dengan urutan mount aktual yang diinginkan spec.

- [ ] **Step 4: Run the targeted admin routing tests**

Run: `npm test -- routes/__tests__/routes-registry.test.js routes/__tests__/admin-legacy-routing.test.js`
Expected: PASS.

### Task 2: Expand Legacy Owner Coverage

**Files:**
- Modify: `C:\project\raf-bot-v2\routes\__tests__\admin-legacy-routing.test.js`
- Verify: `C:\project\raf-bot-v2\routes\admin.js`

- [ ] **Step 1: Add a failing assertion for every admin endpoint that already has a new owner**

```js
expect(adminLegacySource).toContain("router.get('/api/debug/database'");
expect(adminLegacySource).toContain("router.post('/api/migrate-users'");
expect(adminLegacySource).toContain("router.post('/api/broadcast'");
expect(adminLegacySource).toContain("router.delete('/api/:category/:id'");
```

- [ ] **Step 2: Run test to verify the new coverage catches missing/misaligned stubs**

Run: `npm test -- routes/__tests__/admin-legacy-routing.test.js`
Expected: FAIL jika masih ada pesan owner yang tidak sinkron.

- [ ] **Step 3: Update `routes/admin.js` messages or missing stubs minimally**

```js
message: "Legacy ... dinonaktifkan. Gunakan endpoint owner baru ..."
```

- [ ] **Step 4: Re-run the legacy routing guardrail**

Run: `npm test -- routes/__tests__/admin-legacy-routing.test.js`
Expected: PASS.

### Task 3: Normalize Active Admin Router Boundary

**Files:**
- Modify: `C:\project\raf-bot-v2\routes\__tests__\admin-legacy-routing.test.js`
- Modify: `C:\project\raf-bot-v2\routes\admin.routes.js`

- [ ] **Step 1: Add a failing assertion that active admin routes are wrapped by `asyncHandler` and only expose owned endpoints**

```js
expect(adminRoutesSource).toContain("asyncHandler(async (req, res) => controller.listUsers(req, res))");
expect(adminRoutesSource).not.toContain("bulkApprovePaymentRequests");
```

- [ ] **Step 2: Run the test and confirm it fails for any drift**

Run: `npm test -- routes/__tests__/admin-legacy-routing.test.js`
Expected: FAIL jika router aktif masih punya endpoint yang bukan owner atau handler belum dibungkus.

- [ ] **Step 3: Apply minimal router cleanup in `routes/admin.routes.js`**

```js
router.get("/api/list/users", ensureAuthenticatedStaff, rateLimit("list-users", 30, 60000), asyncHandler(async (req, res) => controller.listUsers(req, res)));
```

- [ ] **Step 4: Re-run admin route ownership tests**

Run: `npm test -- routes/__tests__/admin-legacy-routing.test.js routes/__tests__/routes-registry.test.js`
Expected: PASS.

### Task 4: Normalize Admin Controller Response Contract

**Files:**
- Create: `C:\project\raf-bot-v2\controllers\__tests__\admin.controller.test.js`
- Modify: `C:\project\raf-bot-v2\controllers\admin.controller.js`

- [ ] **Step 1: Write failing controller tests for response shape and actor context flow**

```js
await controller.listPackageChangeRequests(req, res);
expect(res.json).toHaveBeenCalledWith({ status: 200, message: "Package change requests fetched.", data: [{ id: "req-1" }] });
```

- [ ] **Step 2: Run the controller test to verify it fails**

Run: `npm test -- controllers/__tests__/admin.controller.test.js`
Expected: FAIL pada response contract yang belum seragam.

- [ ] **Step 3: Make the minimal controller fix**

```js
res.json({ status: 200, message: "Package change requests fetched.", data });
```

- [ ] **Step 4: Re-run controller plus admin routing tests**

Run: `npm test -- controllers/__tests__/admin.controller.test.js routes/__tests__/admin-legacy-routing.test.js`
Expected: PASS.

### Task 5: Normalize Service Contract Surface

**Files:**
- Create: `C:\project\raf-bot-v2\services\__tests__\admin.service.test.js`
- Modify: `C:\project\raf-bot-v2\services\admin.service.js`
- Modify: `C:\project\raf-bot-v2\services\billing.service.js`

- [ ] **Step 1: Write failing tests for returned result shape and role guard in admin services**

```js
await expect(service.reloadUsersCache({ role: "staff" })).rejects.toMatchObject({ statusCode: 403 });
```

- [ ] **Step 2: Run service tests to verify the expected failure**

Run: `npm test -- services/__tests__/admin.service.test.js`
Expected: FAIL jika result shape atau role guard belum sesuai.

- [ ] **Step 3: Apply minimal service cleanup**

```js
return {
    status: 200,
    message: "Package change requests fetched.",
    data: requests
};
```

- [ ] **Step 4: Re-run service and controller tests**

Run: `npm test -- services/__tests__/admin.service.test.js controllers/__tests__/admin.controller.test.js`
Expected: PASS.

### Task 6: Add Registrar Boundary Audit Guardrail

**Files:**
- Create: `C:\project\raf-bot-v2\routes\__tests__\admin-registrar-boundaries.test.js`
- Verify: `C:\project\raf-bot-v2\routes\admin-*-routes.js`

- [ ] **Step 1: Write a failing guardrail test for registrar patterns**

```js
expect(source).not.toMatch(/router\.(get|post|put|delete)\([^\\n]+async \(req, res\) => \{/);
expect(source).toContain("asyncHandler");
```

- [ ] **Step 2: Run the new guardrail test and capture offending registrars**

Run: `npm test -- routes/__tests__/admin-registrar-boundaries.test.js`
Expected: FAIL dengan daftar file registrar yang masih bocor.

- [ ] **Step 3: Fix only the registrar files flagged by the test**

```js
router.get("/api/status/genieacs", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
    return res.json(await getStatus());
}));
```

- [ ] **Step 4: Re-run registrar guardrail plus legacy ownership tests**

Run: `npm test -- routes/__tests__/admin-registrar-boundaries.test.js routes/__tests__/admin-legacy-routing.test.js`
Expected: PASS.

### Task 7: Sync Route Documentation

**Files:**
- Modify: `C:\project\raf-bot-v2\routes\.module_map.md`
- Modify: `C:\project\raf-bot-v2\SYSTEM_MAP.md`

- [ ] **Step 1: Add a failing documentation consistency check via targeted content assertions in Jest or manual verification command**

Run: `Select-String -Path routes/.module_map.md,SYSTEM_MAP.md -Pattern "routes/admin.js|routes/admin.routes.js|routes/admin-router.js"`
Expected: temuan yang memperlihatkan narasi ownership lama bila belum sinkron.

- [ ] **Step 2: Update the docs minimally to match the stabilized ownership**

```md
- `routes/admin.js` | `router` | Router admin legacy fallback yang hanya menyimpan stub `410`.
- `routes/admin.routes.js` | `createAdminRoutes` | Owner endpoint admin aktif untuk billing/package change/listing/reload.
```

- [ ] **Step 3: Run final lightweight verification for routing/admin ownership**

Run: `npm test -- routes/__tests__/routes-registry.test.js routes/__tests__/admin-legacy-routing.test.js routes/__tests__/admin-registrar-boundaries.test.js controllers/__tests__/admin.controller.test.js services/__tests__/admin.service.test.js`
Expected: PASS.

- [ ] **Step 4: Commit the stabilization batch**

```bash
git add routes/__tests__/routes-registry.test.js routes/__tests__/admin-legacy-routing.test.js routes/__tests__/admin-registrar-boundaries.test.js controllers/__tests__/admin.controller.test.js services/__tests__/admin.service.test.js routes/admin.routes.js controllers/admin.controller.js services/admin.service.js services/billing.service.js routes/.module_map.md SYSTEM_MAP.md
git commit -m "refactor: stabilize admin routing boundaries"
```
