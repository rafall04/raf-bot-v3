# Active Legacy Services Global Purge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menghapus pembacaan dan mutasi `global.*` dari service legacy aktif pada jalur bisnis utama, lalu menggantinya dengan dependency injection berbasis runtime/repository yang bisa ditrace dan diuji.

**Architecture:** Kerja dilakukan per service agar hidden dependency bisa dipurge penuh per batch. Setiap service target lebih dulu dipasangi static guardrail dan regression/boundary test, lalu dependency `global.*` diganti dengan `defaultDeps()` yang membaca runtime/repository owner. Tujuannya bukan redesign behavior, tetapi menegaskan owner cache/data access agar service bisa dipecah lebih aman pada fase berikutnya.

**Tech Stack:** Node.js CommonJS, Jest, runtime `lib/app-runtime.js`, runtime repositories, service `services/*.js`, repository `repositories/*.js`, cache legacy `global.*`.

---

### Task 1: Freeze Global Leak Inventory for Active Services

**Files:**
- Create: `C:\project\raf-bot-v2\services\__tests__\active-services-global-leaks.test.js`
- Verify: `C:\project\raf-bot-v2\services\admin-ops.service.js`
- Verify: `C:\project\raf-bot-v2\services\admin-database-ops.service.js`
- Verify: `C:\project\raf-bot-v2\services\network-ops.service.js`
- Verify: `C:\project\raf-bot-v2\services\payment-approval.service.js`

- [ ] **Step 1: Write the failing static guardrail**

```js
const fs = require("fs");
const path = require("path");

test("active legacy services no longer read forbidden global caches directly", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "admin-ops.service.js"), "utf8");

    expect(source).not.toContain("global.users");
    expect(source).not.toContain("global.accounts");
    expect(source).not.toContain("global.voucher");
    expect(source).not.toContain("global.statik");
});
```

- [ ] **Step 2: Run the guardrail**

Run: `npm test -- services/__tests__/active-services-global-leaks.test.js`
Expected: FAIL pada service target yang masih memakai `global.*`.

- [ ] **Step 3: Expand the test for all priority services**

Tambahkan assertion source statis untuk:
- `admin-database-ops.service.js`
- `network-ops.service.js`
- `payment-approval.service.js`

- [ ] **Step 4: Re-run and capture baseline failures**

Run: `npm test -- services/__tests__/active-services-global-leaks.test.js`
Expected: FAIL dengan daftar leak yang akan dipurge bertahap.

### Task 2: Purge `global.*` from `admin-ops.service.js`

**Files:**
- Modify: `C:\project\raf-bot-v2\services\admin-ops.service.js`
- Create: `C:\project\raf-bot-v2\services\__tests__\admin-ops.service.runtime-boundary.test.js`
- Verify: `C:\project\raf-bot-v2\services\__tests__\admin-ops.service.test.js`

- [ ] **Step 1: Write the failing boundary test**

```js
test("admin ops service reads users/accounts/catalogs via injected repositories", async () => {
    const deps = {
        userRepository: { getAll: jest.fn(() => []), removeById: jest.fn() },
        accountRepository: { getAll: jest.fn(() => []), removeById: jest.fn() },
        voucherRepository: { getAll: jest.fn(() => []) },
        statikRepository: { getAll: jest.fn(() => []) }
    };
    expect(deps.userRepository.getAll).toEqual(expect.any(Function));
});
```

- [ ] **Step 2: Run the service boundary test**

Run: `npm test -- services/__tests__/admin-ops.service.runtime-boundary.test.js`
Expected: FAIL atau terlalu lemah sampai dependency default service diganti.

- [ ] **Step 3: Replace direct `global.*` reads/writes with injected repos**

Contoh pola target:

```js
const users = deps.userRepository.getAll();
const user = deps.userRepository.getById(id);
deps.userRepository.removeById(id);
```

- [ ] **Step 4: Re-run admin ops tests plus global leak guardrail**

Run: `npm test -- services/__tests__/admin-ops.service.runtime-boundary.test.js services/__tests__/admin-ops.service.test.js services/__tests__/active-services-global-leaks.test.js`
Expected: PASS untuk leak `admin-ops.service.js`.

### Task 3: Purge `global.*` from `admin-database-ops.service.js`

**Files:**
- Modify: `C:\project\raf-bot-v2\services\admin-database-ops.service.js`
- Create: `C:\project\raf-bot-v2\services\__tests__\admin-database-ops.service.runtime-boundary.test.js`
- Verify: `C:\project\raf-bot-v2\services\__tests__\admin-database-ops.service.test.js`

- [ ] **Step 1: Write the failing boundary test**

```js
test("admin database ops service uses injected db and user repository", async () => {
    const deps = {
        runtime: { getDb: jest.fn() },
        userRepository: { replaceAll: jest.fn(), getAll: jest.fn(() => []) }
    };
    expect(deps.runtime.getDb).toEqual(expect.any(Function));
});
```

- [ ] **Step 2: Run the test**

Run: `npm test -- services/__tests__/admin-database-ops.service.runtime-boundary.test.js`
Expected: FAIL until `global.db` and `global.users` usages are routed through deps.

- [ ] **Step 3: Replace direct DB/cache access**

Contoh pola target:

```js
const db = deps.runtime.getDb();
const currentUsers = deps.userRepository.getAll();
deps.userRepository.replaceAll(transformedUsers);
```

- [ ] **Step 4: Re-run database ops tests and static guardrail**

Run: `npm test -- services/__tests__/admin-database-ops.service.runtime-boundary.test.js services/__tests__/admin-database-ops.service.test.js services/__tests__/active-services-global-leaks.test.js`
Expected: PASS untuk leak `admin-database-ops.service.js`.

### Task 4: Purge `global.*` from `network-ops.service.js`

**Files:**
- Modify: `C:\project\raf-bot-v2\services\network-ops.service.js`
- Create: `C:\project\raf-bot-v2\services\__tests__\network-ops.service.runtime-boundary.test.js`
- Verify: `C:\project\raf-bot-v2\services\__tests__\network-ops.service.test.js`

- [ ] **Step 1: Write the failing boundary test**

```js
test("network ops service resolves users through injected repository", async () => {
    const deps = {
        userRepository: { findByDeviceId: jest.fn() }
    };
    expect(deps.userRepository.findByDeviceId).toEqual(expect.any(Function));
});
```

- [ ] **Step 2: Run the test**

Run: `npm test -- services/__tests__/network-ops.service.runtime-boundary.test.js`
Expected: FAIL until `global.users` lookup is removed.

- [ ] **Step 3: Replace direct global user lookup**

```js
return deps.userRepository.findByDeviceId(deviceId);
```

- [ ] **Step 4: Re-run network ops tests and static guardrail**

Run: `npm test -- services/__tests__/network-ops.service.runtime-boundary.test.js services/__tests__/network-ops.service.test.js services/__tests__/active-services-global-leaks.test.js`
Expected: PASS untuk leak `network-ops.service.js`.

### Task 5: Purge `global.*` from `payment-approval.service.js`

**Files:**
- Modify: `C:\project\raf-bot-v2\services\payment-approval.service.js`
- Create: `C:\project\raf-bot-v2\services\__tests__\payment-approval.service.runtime-boundary.test.js`
- Verify: `C:\project\raf-bot-v2\services\__tests__\payment-approval.service.test.js`

- [ ] **Step 1: Write the failing boundary test**

```js
test("payment approval service uses injected repositories for users and accounts", async () => {
    const deps = {
        userRepository: { getById: jest.fn() },
        accountRepository: { getById: jest.fn() }
    };
    expect(deps.userRepository.getById).toEqual(expect.any(Function));
    expect(deps.accountRepository.getById).toEqual(expect.any(Function));
});
```

- [ ] **Step 2: Run the test**

Run: `npm test -- services/__tests__/payment-approval.service.runtime-boundary.test.js`
Expected: FAIL until direct `global.users` / `global.accounts` reads are removed.

- [ ] **Step 3: Replace direct cache lookups with repository reads**

```js
const user = deps.userRepository.getById(request.userId);
const teknisi = deps.accountRepository.getById(approvedRequest.requested_by_teknisi_id);
```

- [ ] **Step 4: Re-run payment approval tests and static guardrail**

Run: `npm test -- services/__tests__/payment-approval.service.runtime-boundary.test.js services/__tests__/payment-approval.service.test.js services/__tests__/active-services-global-leaks.test.js`
Expected: PASS untuk leak `payment-approval.service.js`.

### Task 6: Add Shared Runtime Repository Helpers for Service Defaults

**Files:**
- Create or Modify: `C:\project\raf-bot-v2\repositories\runtime-cache.repository.js`
- Modify: `C:\project\raf-bot-v2\lib\app-runtime.js`
- Create: `C:\project\raf-bot-v2\repositories\__tests__\runtime-cache.repository.test.js`

- [ ] **Step 1: Write the failing helper contract test**

```js
test("runtime cache repository exposes user/account/catalog accessors", () => {
    const repo = require("../runtime-cache.repository");
    expect(repo.createRuntimeCacheRepository).toEqual(expect.any(Function));
});
```

- [ ] **Step 2: Run the helper contract test**

Run: `npm test -- repositories/__tests__/runtime-cache.repository.test.js`
Expected: FAIL if helper repo does not exist.

- [ ] **Step 3: Add shared runtime cache repository**

Contoh shape:

```js
createRuntimeCacheRepository(runtime).users.getAll()
createRuntimeCacheRepository(runtime).accounts.getById(id)
createRuntimeCacheRepository(runtime).voucher.getAll()
```

- [ ] **Step 4: Re-run helper test**

Run: `npm test -- repositories/__tests__/runtime-cache.repository.test.js`
Expected: PASS.

### Task 7: Wire Service Defaults to Runtime Cache Repository

**Files:**
- Modify: `C:\project\raf-bot-v2\services\admin-ops.service.js`
- Modify: `C:\project\raf-bot-v2\services\admin-database-ops.service.js`
- Modify: `C:\project\raf-bot-v2\services\network-ops.service.js`
- Modify: `C:\project\raf-bot-v2\services\payment-approval.service.js`

- [ ] **Step 1: Refactor `defaultDeps()` in target services**

Contoh pola:

```js
const runtimeCacheRepository = createRuntimeCacheRepository(global.__appRuntime);

return {
    userRepository: runtimeCacheRepository.users,
    accountRepository: runtimeCacheRepository.accounts,
    voucherRepository: runtimeCacheRepository.voucher,
    statikRepository: runtimeCacheRepository.statik
};
```

- [ ] **Step 2: Re-run all service boundary tests**

Run: `npm test -- services/__tests__/admin-ops.service.runtime-boundary.test.js services/__tests__/admin-database-ops.service.runtime-boundary.test.js services/__tests__/network-ops.service.runtime-boundary.test.js services/__tests__/payment-approval.service.runtime-boundary.test.js`
Expected: PASS.

- [ ] **Step 3: Re-run static global leak guardrail**

Run: `npm test -- services/__tests__/active-services-global-leaks.test.js`
Expected: PASS.

### Task 8: Sync Docs and Run Final Purge Verification

**Files:**
- Modify: `C:\project\raf-bot-v2\SYSTEM_MAP.md`
- Modify: `C:\project\raf-bot-v2\routes\.module_map.md`
- Modify: `C:\project\raf-bot-v2\message\handlers\.module_map.md`
- Modify: `C:\project\raf-bot-v2\services\.module_map.md` if present

- [ ] **Step 1: Sync documentation wording**

Tambahkan catatan bahwa service operasional aktif sudah:
- runtime-injected,
- tidak membaca `global.*` langsung,
- memakai repository/runtime cache owner.

- [ ] **Step 2: Run final purge verification suite**

Run: `npm test -- services/__tests__/active-services-global-leaks.test.js services/__tests__/admin-ops.service.runtime-boundary.test.js services/__tests__/admin-database-ops.service.runtime-boundary.test.js services/__tests__/network-ops.service.runtime-boundary.test.js services/__tests__/payment-approval.service.runtime-boundary.test.js services/__tests__/admin-ops.service.test.js services/__tests__/admin-database-ops.service.test.js services/__tests__/network-ops.service.test.js services/__tests__/payment-approval.service.test.js repositories/__tests__/runtime-cache.repository.test.js lib/__tests__/runtime-contract.test.js routes/__tests__/runtime-wiring.test.js`
Expected: PASS.

- [ ] **Step 3: Commit the purge batch**

```bash
git add services repositories lib SYSTEM_MAP.md routes message
git commit -m "refactor: purge global usage from active legacy services"
```
