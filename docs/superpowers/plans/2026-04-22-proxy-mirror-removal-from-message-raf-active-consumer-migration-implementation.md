# Proxy Mirror Removal from `message/raf.js` + Active Consumer Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menghapus mirror compatibility state dari `message/raf.js` dan memigrasikan consumer aktif prioritas ke API state native/scoped.

**Architecture:** Fase ini menutup hidden dependency state yang masih tersisa di router bot. Pekerjaan dimulai dari baseline source guard untuk `createScopedStateProxy('legacy-temp')` dan `global.teknisiStates`, lalu consumer aktif dipetakan dan dimigrasikan bertahap ke API state owner, setelah itu mirror creation dibuang dari `message/raf.js`. Ditutup dengan guardrail test dan regression suite bot/state.

**Tech Stack:** Node.js CommonJS, Jest, `message/raf.js`, `message/handlers/raf-context.js`, `message/handlers/conversation-handler.js`, `message/handlers/teknisi-workflow-handler.js`, static/source guardrails, `.module_map.md`, `SYSTEM_MAP.md`.

---

### Task 1: Baseline Mirror Guards

**Files:**
- Modify: `C:\project\raf-bot-v2\message\__tests__\conversation-state-boundary.test.js`
- Modify: `C:\project\raf-bot-v2\message\__tests__\raf-router-boundary.test.js`
- Verify: `C:\project\raf-bot-v2\message\raf.js`

- [ ] **Step 1: Add baseline assertions for mirror compatibility**

Tambahkan assertion representative bahwa router masih memuat:
- `createScopedStateProxy('legacy-temp')`
- `global.teknisiStates = createScopedStateProxy('teknisi')`

- [ ] **Step 2: Run boundary baseline**

Run: `npm test -- message/__tests__/conversation-state-boundary.test.js message/__tests__/raf-router-boundary.test.js`
Expected: PASS dengan baseline mirror yang masih ada.

### Task 2: Audit and Migrate Active Consumers

**Files:**
- Modify: active consumer files discovered during audit
- Verify: `C:\project\raf-bot-v2\message\handlers\raf-context.js`
- Verify: `C:\project\raf-bot-v2\message\handlers\teknisi-workflow-handler.js`

- [ ] **Step 1: Audit mirror/proxy consumers**

Identifikasi consumer aktif dari:
- `legacy-temp`
- `global.teknisiStates`
- `createScopedStateProxy('teknisi')`

- [ ] **Step 2: Migrate priority consumer(s) to owner state APIs**

Prioritaskan consumer runtime aktif yang masih bergantung pada mirror/proxy compatibility.

- [ ] **Step 3: Add/adjust targeted consumer tests**

Tambahkan guardrail bahwa consumer yang dimigrasikan tidak lagi membutuhkan mirror dari router.

- [ ] **Step 4: Run focused consumer verification**

Run: `npm test -- message/__tests__/bot-hardening.test.js message/__tests__/teknisi-workflow-boundary.test.js`
Expected: PASS.

### Task 3: Remove Mirror Creation from Router

**Files:**
- Modify: `C:\project\raf-bot-v2\message\raf.js`
- Modify: `C:\project\raf-bot-v2\message\__tests__\conversation-state-boundary.test.js`
- Modify: `C:\project\raf-bot-v2\message\__tests__\raf-router-boundary.test.js`

- [ ] **Step 1: Remove `createScopedStateProxy('legacy-temp')` from router**

- [ ] **Step 2: Remove `global.teknisiStates = createScopedStateProxy('teknisi')` from router**

- [ ] **Step 3: Flip guardrails from baseline to prohibition**

Setelah removal, source tests harus melarang mirror compatibility kembali ke `message/raf.js`.

- [ ] **Step 4: Run focused router regression**

Run: `npm test -- message/__tests__/conversation-state-boundary.test.js message/__tests__/raf-router-boundary.test.js message/__tests__/conversation-state-router.test.js`
Expected: PASS.

### Task 4: Final Cleanup and Docs Sync

**Files:**
- Modify: `C:\project\raf-bot-v2\SYSTEM_MAP.md`
- Modify: `C:\project\raf-bot-v2\message\.module_map.md`
- Modify: `C:\project\raf-bot-v2\message\handlers\.module_map.md`

- [ ] **Step 1: Sync ownership wording**

Dokumentasikan bahwa router tidak lagi membuat proxy mirror dan consumer aktif prioritas memakai owner state API.

- [ ] **Step 2: Run final verification**

Run: `npm test -- message/__tests__/conversation-state-boundary.test.js message/__tests__/raf-router-boundary.test.js message/__tests__/simple-location-owner.test.js message/__tests__/teknisi-workflow-boundary.test.js message/__tests__/teknisi-state-owner.test.js message/__tests__/conversation-state-owner-map.test.js message/__tests__/conversation-state-router.test.js message/__tests__/bot-hardening.test.js`
Expected: PASS.

- [ ] **Step 3: Commit the batch**

```bash
git add message SYSTEM_MAP.md docs/superpowers
git commit -m "refactor: remove state proxy mirrors from raf"
```
