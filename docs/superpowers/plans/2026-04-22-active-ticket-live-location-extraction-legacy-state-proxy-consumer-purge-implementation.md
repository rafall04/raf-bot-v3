# Active Ticket Live-Location Extraction + Legacy State Proxy Consumer Purge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mengeluarkan branch active-ticket live-location dari `message/raf.js` dan mulai purge consumer aktif yang masih memakai legacy state proxy.

**Architecture:** Fase ini melanjutkan final slimming router bot. Branch location update yang masih non-state dipindah ke owner helper/domain yang sudah ada, lalu consumer state aktif yang masih memicu `legacyStateProxy*` diaudit dan dipurge bertahap ke boundary state native. Ditutup dengan guardrail source test dan regression suite bot/state.

**Tech Stack:** Node.js CommonJS, Jest, `message/raf.js`, `message/handlers/simple-location-handler.js`, `message/handlers/state-domains/teknisi.state.js`, `message/handlers/conversation-handler.js`, `.module_map.md`, `SYSTEM_MAP.md`.

---

### Task 1: Baseline Live-Location and Proxy Guards

**Files:**
- Modify: `C:\project\raf-bot-v2\message\__tests__\conversation-state-boundary.test.js`
- Modify: `C:\project\raf-bot-v2\message\__tests__\bot-hardening.test.js`
- Verify: `C:\project\raf-bot-v2\message\raf.js`

- [ ] **Step 1: Add baseline marker for active-ticket live-location branch**

Tambahkan assertion representative untuk branch router yang masih menangani:
- `type === locationMessage/liveLocationMessage`
- lookup `activeTicket`
- delegasi `handleTeknisiShareLocation`

- [ ] **Step 2: Identify proxy-noisy consumer path in bot-hardening**

Pastikan test menunjuk consumer aktif prioritas yang masih memicu `legacyStateProxy*` sebagai baseline sebelum purge.

- [ ] **Step 3: Run baseline tests**

Run: `npm test -- message/__tests__/conversation-state-boundary.test.js message/__tests__/bot-hardening.test.js`
Expected: PASS dengan baseline branch/proxy consumer yang masih ada.

### Task 2: Extract Active-Ticket Live-Location Ownership

**Files:**
- Modify: `C:\project\raf-bot-v2\message\handlers\simple-location-handler.js`
- Modify: `C:\project\raf-bot-v2\message\handlers\state-domains\teknisi.state.js` or owner helper if needed
- Modify: `C:\project\raf-bot-v2\message\raf.js`

- [ ] **Step 1: Add owner entrypoint for active-ticket live-location**

Buat facade/helper owner yang menerima sender + payload lokasi lalu menanggung lookup active ticket dan update lokasi.

- [ ] **Step 2: Replace router branch with owner call or remove it fully**

`message/raf.js` tidak lagi memegang representative location update branch.

- [ ] **Step 3: Re-run focused location verification**

Run: `npm test -- message/__tests__/conversation-state-boundary.test.js message/__tests__/teknisi-state-owner.test.js message/__tests__/conversation-state-router.test.js`
Expected: PASS.

### Task 3: Purge Priority Legacy Proxy Consumers

**Files:**
- Modify: `C:\project\raf-bot-v2\message\handlers\conversation-handler.js` only if helper exposure needs tightening
- Modify: active consumer files discovered from `bot-hardening`/search results
- Add/Modify: targeted tests for migrated consumer paths

- [ ] **Step 1: Audit active consumers that still rely on `legacyStateProxy*`**

Prioritaskan jalur yang disentuh test dan runtime aktif, bukan purge massal.

- [ ] **Step 2: Migrate priority consumer(s) to managed/scoped state APIs**

Gunakan `getUserState/setUserState` atau owner state/domain yang benar; jangan tambah consumer baru ke proxy compatibility.

- [ ] **Step 3: Tighten proxy regression test**

Pastikan jalur yang dimigrasikan tidak lagi bergantung pada proxy lama.

- [ ] **Step 4: Run regression suite**

Run: `npm test -- message/__tests__/bot-hardening.test.js message/__tests__/conversation-state-boundary.test.js message/__tests__/raf-router-boundary.test.js`
Expected: PASS.

### Task 4: Final Cleanup and Docs Sync

**Files:**
- Modify: `C:\project\raf-bot-v2\SYSTEM_MAP.md`
- Modify: `C:\project\raf-bot-v2\message\.module_map.md`
- Modify: `C:\project\raf-bot-v2\message\handlers\.module_map.md`

- [ ] **Step 1: Sync location/proxy ownership wording**

Dokumentasikan bahwa:
- live-location aktif tidak lagi di-own `message/raf.js`
- consumer prioritas tertentu sudah keluar dari proxy compatibility

- [ ] **Step 2: Run final verification**

Run: `npm test -- message/__tests__/conversation-state-boundary.test.js message/__tests__/teknisi-state-owner.test.js message/__tests__/conversation-state-owner-map.test.js message/__tests__/conversation-state-router.test.js message/__tests__/bot-hardening.test.js message/__tests__/raf-router-boundary.test.js`
Expected: PASS.

- [ ] **Step 3: Commit the batch**

```bash
git add message SYSTEM_MAP.md docs/superpowers
git commit -m "refactor: extract live location and purge proxy consumers"
```
