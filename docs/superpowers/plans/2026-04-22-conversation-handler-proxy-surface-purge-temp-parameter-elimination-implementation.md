# Conversation Handler Proxy Surface Purge + Temp Parameter Elimination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mengurangi surface proxy compatibility dan menghapus parameter `temp` zombie dari chain state handler aktif.

**Architecture:** Fase ini fokus pada pembersihan state-layer internals. Pekerjaan dimulai dari audit penggunaan riil `temp`, lalu signature `conversation-state-handler` dan sub-handler state dipangkas bertahap. Consumer proxy aktif prioritas dimigrasikan ke owner APIs eksplisit. Ditutup dengan guardrail source test, regression suite, dan sinkronisasi docs.

**Tech Stack:** Node.js CommonJS, Jest, `message/handlers/conversation-handler.js`, `message/handlers/conversation-state-handler.js`, `message/handlers/states/*.js`, static/source guardrails, `.module_map.md`, `SYSTEM_MAP.md`.

---

### Task 1: Audit Temp Usage and Baseline Guards

**Files:**
- Modify: `C:\project\raf-bot-v2\message\__tests__\conversation-handler-state-store.test.js`
- Modify: `C:\project\raf-bot-v2\message\__tests__\conversation-state-boundary.test.js`
- Verify: `C:\project\raf-bot-v2\message\handlers\conversation-state-handler.js`

- [ ] **Step 1: Add baseline assertions for `temp` call-chain**

Tambahkan source guard representative bahwa `conversation-state-handler.js` masih meneruskan `temp` ke sub-handler prioritas sebelum dipangkas.

- [ ] **Step 2: Identify active proxy-heavy consumer path**

Gunakan test/state store sebagai baseline compatibility agar perbedaan antara flow aktif dan compatibility surface tetap jelas.

- [ ] **Step 3: Run baseline tests**

Run: `npm test -- message/__tests__/conversation-handler-state-store.test.js message/__tests__/conversation-state-boundary.test.js`
Expected: PASS.

### Task 2: Eliminate `temp` from Priority State Chain

**Files:**
- Modify: `C:\project\raf-bot-v2\message\handlers\conversation-state-handler.js`
- Modify: priority files in `C:\project\raf-bot-v2\message\handlers\states\`

- [ ] **Step 1: Remove `temp` from sub-handler signatures that do not use it**

Prioritaskan:
- WiFi name/password handlers
- other-state handlers
- report-state handlers yang sampling awal menunjukkan `temp` tidak dipakai

- [ ] **Step 2: Update call-sites in `conversation-state-handler.js`**

Pastikan call-chain memakai signature baru dan tetap bergantung pada `userState` + owner APIs.

- [ ] **Step 3: Re-run focused state verification**

Run: `npm test -- message/__tests__/raf-router.test.js message/__tests__/conversation-state-boundary.test.js`
Expected: PASS.

### Task 3: Reduce Proxy Surface for Active Consumers

**Files:**
- Modify: active consumer files discovered during audit
- Modify: `C:\project\raf-bot-v2\message\handlers\conversation-handler.js` only if needed for explicit helper exposure
- Add/Modify: targeted tests for migrated consumer paths

- [ ] **Step 1: Migrate priority consumer(s) from proxy assumptions to explicit state APIs**

Focus on runtime-active consumers, not compatibility tests.

- [ ] **Step 2: Keep compatibility tests isolated**

Compatibility proxy may remain for untouched legacy boundaries, but active-flow tests should no longer depend on it accidentally.

- [ ] **Step 3: Run regression for active consumers**

Run: `npm test -- message/__tests__/bot-hardening.test.js message/__tests__/raf-router.test.js`
Expected: PASS.

### Task 4: Final Cleanup and Docs Sync

**Files:**
- Modify: `C:\project\raf-bot-v2\SYSTEM_MAP.md`
- Modify: `C:\project\raf-bot-v2\message\.module_map.md`
- Modify: `C:\project\raf-bot-v2\message\handlers\.module_map.md`

- [ ] **Step 1: Sync state-layer ownership wording**

Dokumentasikan bahwa `temp` tidak lagi menjadi parameter default aktif dan proxy compatibility makin terisolasi.

- [ ] **Step 2: Run final verification**

Run: `npm test -- message/__tests__/conversation-handler-state-store.test.js message/__tests__/conversation-state-boundary.test.js message/__tests__/raf-router-boundary.test.js message/__tests__/simple-location-owner.test.js message/__tests__/teknisi-workflow-boundary.test.js message/__tests__/teknisi-state-owner.test.js message/__tests__/conversation-state-owner-map.test.js message/__tests__/conversation-state-router.test.js message/__tests__/bot-hardening.test.js message/__tests__/raf-router.test.js`
Expected: PASS.

- [ ] **Step 3: Commit the batch**

```bash
git add message SYSTEM_MAP.md docs/superpowers
git commit -m "refactor: purge state proxy surface and temp params"
```
