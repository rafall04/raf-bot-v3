# Message Raf Final Slimming + Location Flow Ownership Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menghapus dead fallback dari `message/raf.js`, memindahkan ownership flow lokasi ke owner state/domain yang jelas, dan mengunci router utama agar tetap tipis.

**Architecture:** Fase ini menutup sisa penataan router bot utama. Pekerjaan dimulai dari baseline source guardrail untuk dead fallback dan location branch, lalu owner flow lokasi dipindah ke domain teknisi/state, setelah itu branch dan dependency legacy dihapus dari `message/raf.js`. Ditutup dengan sinkronisasi docs dan regression suite state/router.

**Tech Stack:** Node.js CommonJS, Jest, `message/raf.js`, `message/handlers/state-domains/teknisi.state.js`, `message/handlers/conversation-state-router.js`, `message/handlers/teknisi-workflow-handler.js`, static/source guardrails, `.module_map.md`, `SYSTEM_MAP.md`.

---

### Task 1: Baseline Dead Fallback and Location Guards

**Files:**
- Modify: `C:\project\raf-bot-v2\message\__tests__\conversation-state-boundary.test.js`
- Modify: `C:\project\raf-bot-v2\message\__tests__\teknisi-state-owner.test.js`
- Verify: `C:\project\raf-bot-v2\message\raf.js`

- [ ] **Step 1: Add source guard baseline for dead fallback**

Tambahkan assertion representative untuk pola yang masih harus dipurge:
- `false && userState?.step`
- `false && isTeknisiPhotoState`
- representative location branch `AWAITING_LOCATION_FOR_JOURNEY`

- [ ] **Step 2: Add owner expectation for location handling**

Pastikan test owner teknisi menegaskan step lokasi representative harus hidup di owner domain/state, bukan di router.

- [ ] **Step 3: Run baseline tests**

Run: `npm test -- message/__tests__/conversation-state-boundary.test.js message/__tests__/teknisi-state-owner.test.js`
Expected: PASS dengan baseline branch yang masih ada.

### Task 2: Extract Location Ownership

**Files:**
- Modify: `C:\project\raf-bot-v2\message\handlers\state-domains\teknisi.state.js`
- Modify: `C:\project\raf-bot-v2\message\handlers\conversation-state-owner-map.js`
- Verify: `C:\project\raf-bot-v2\message\handlers\teknisi-workflow-handler.js`

- [ ] **Step 1: Add representative location step ownership**

Pastikan `AWAITING_LOCATION_FOR_JOURNEY` dan flow location representative resolve ke owner teknisi/state.

- [ ] **Step 2: Delegate orchestration to existing teknisi workflow**

State owner hanya memanggil workflow/helper existing; jangan duplikasi logic.

- [ ] **Step 3: Re-run owner/router tests**

Run: `npm test -- message/__tests__/teknisi-state-owner.test.js message/__tests__/conversation-state-router.test.js`
Expected: PASS.

### Task 3: Purge Dead Fallback and Location Branches from Router

**Files:**
- Modify: `C:\project\raf-bot-v2\message\raf.js`
- Modify: `C:\project\raf-bot-v2\message\__tests__\conversation-state-boundary.test.js`

- [ ] **Step 1: Remove dead fallback source**

Hapus branch `false && ...` dan helper fallback yang sudah tidak authoritative.

- [ ] **Step 2: Remove direct location ownership from router**

Pindahkan representative location branch ke owner state/domain sehingga `raf.js` tinggal orchestrator.

- [ ] **Step 3: Flip boundary test to prohibition**

Setelah purge, test harus melarang dead fallback dan representative location branch kembali ke router.

- [ ] **Step 4: Run focused router verification**

Run: `npm test -- message/__tests__/conversation-state-boundary.test.js message/__tests__/conversation-state-router.test.js message/__tests__/raf-router-boundary.test.js`
Expected: PASS.

### Task 4: Final Cleanup and Docs Sync

**Files:**
- Modify: `C:\project\raf-bot-v2\SYSTEM_MAP.md`
- Modify: `C:\project\raf-bot-v2\message\.module_map.md`
- Modify: `C:\project\raf-bot-v2\message\handlers\.module_map.md`

- [ ] **Step 1: Remove stale dependency wording**

Sinkronkan bahwa `message/raf.js` sudah final-slim untuk state/location ownership yang dipindah.

- [ ] **Step 2: Run full verification**

Run: `npm test -- message/__tests__/conversation-state-boundary.test.js message/__tests__/teknisi-state-owner.test.js message/__tests__/conversation-state-router.test.js message/__tests__/bot-hardening.test.js message/__tests__/raf-router-boundary.test.js`
Expected: PASS.

- [ ] **Step 3: Commit the slimming batch**

```bash
git add message SYSTEM_MAP.md docs/superpowers
git commit -m "refactor: slim raf router and extract location ownership"
```
