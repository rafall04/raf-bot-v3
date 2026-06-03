# Conversation State Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mengkonsolidasikan ownership state percakapan bot agar `message/raf.js` tidak lagi memegang branching state lintas domain, dan setiap `state.step` aktif punya owner domain tunggal yang bisa diuji.

**Architecture:** Fase ini dimulai dengan mengunci owner map semua state aktif, lalu menambahkan `conversation-state-router` sebagai dispatcher tunggal. Setelah itu branching reporting/WiFi dipindah lebih dulu karena paling padat, disusul teknisi/payment. Guardrail source tests dipasang sebelum dan sesudah ekstraksi agar kebocoran ownership langsung tertangkap.

**Tech Stack:** Node.js CommonJS, Jest, `message/raf.js`, `message/handlers/conversation-handler.js`, state domain handlers, source/static guardrail tests, `.module_map.md`, `SYSTEM_MAP.md`.

---

### Task 1: Lock the State Ownership Map

**Files:**
- Create: `C:\project\raf-bot-v2\message\handlers\conversation-state-owner-map.js`
- Create: `C:\project\raf-bot-v2\message\__tests__\conversation-state-owner-map.test.js`
- Verify: `C:\project\raf-bot-v2\message\raf.js`
- Verify: `C:\project\raf-bot-v2\message\handlers\legacy-*.js`

- [ ] **Step 1: Write the failing ownership map test**

Kunci owner minimal untuk step aktif prioritas:
- reporting
- WiFi
- teknisi
- payment
- agent-voucher

- [ ] **Step 2: Add the owner map**

Contoh target:

```js
const CONVERSATION_STATE_OWNER_MAP = {
    REPORT_MENU: "reporting",
    ASK_NEW_PASSWORD: "wifi",
    AWAITING_COMPLETION_PHOTOS: "teknisi"
};
```

- [ ] **Step 3: Run owner map tests**

Run: `npm test -- message/__tests__/conversation-state-owner-map.test.js`
Expected: PASS.

### Task 2: Add `conversation-state-router`

**Files:**
- Create: `C:\project\raf-bot-v2\message\handlers\conversation-state-router.js`
- Create: `C:\project\raf-bot-v2\message\__tests__\conversation-state-router.test.js`
- Modify: `C:\project\raf-bot-v2\message\handlers\.module_map.md`

- [ ] **Step 1: Write the failing router dispatch test**

Test bahwa `state.step` tertentu jatuh ke owner domain yang benar.

- [ ] **Step 2: Add router skeleton with Header Doc**

Target API:

```js
async function routeConversationState(context) {}
```

- [ ] **Step 3: Re-run router tests**

Run: `npm test -- message/__tests__/conversation-state-owner-map.test.js message/__tests__/conversation-state-router.test.js`
Expected: PASS.

### Task 3: Extract Reporting and WiFi State Branching from `message/raf.js`

**Files:**
- Create: `C:\project\raf-bot-v2\message\handlers\state-domains\reporting.state.js`
- Create: `C:\project\raf-bot-v2\message\handlers\state-domains\wifi.state.js`
- Modify: `C:\project\raf-bot-v2\message\raf.js`
- Create: `C:\project\raf-bot-v2\message\__tests__\reporting-state-owner.test.js`
- Create: `C:\project\raf-bot-v2\message\__tests__\wifi-state-owner.test.js`

- [ ] **Step 1: Write failing owner tests**

Guardrail target:
- reporting step tidak lagi di-handle branch panjang di router utama,
- WiFi managed step tidak lagi di-handle langsung di `message/raf.js`.

- [ ] **Step 2: Move branching into domain state owners**

Gunakan `conversation-state-router` sebagai entrypoint.

- [ ] **Step 3: Re-run reporting and WiFi tests**

Run: `npm test -- message/__tests__/reporting-state-owner.test.js message/__tests__/wifi-state-owner.test.js message/__tests__/conversation-state-router.test.js`
Expected: PASS.

### Task 4: Extract Teknisi and Payment State Branching

**Files:**
- Create: `C:\project\raf-bot-v2\message\handlers\state-domains\teknisi.state.js`
- Create: `C:\project\raf-bot-v2\message\handlers\state-domains\payment.state.js`
- Modify: `C:\project\raf-bot-v2\message\raf.js`
- Create: `C:\project\raf-bot-v2\message\__tests__\teknisi-state-owner.test.js`
- Create: `C:\project\raf-bot-v2\message\__tests__\payment-state-owner.test.js`

- [ ] **Step 1: Write failing owner tests**

Prioritas:
- photo completion / teknisi resolution
- topup/payment proof state

- [ ] **Step 2: Move state branching to domain owners**

- [ ] **Step 3: Re-run teknisi/payment state tests**

Run: `npm test -- message/__tests__/teknisi-state-owner.test.js message/__tests__/payment-state-owner.test.js message/__tests__/conversation-state-router.test.js`
Expected: PASS.

### Task 5: Add Static Guardrails Against Router State Spaghetti

**Files:**
- Create: `C:\project\raf-bot-v2\message\__tests__\conversation-state-boundary.test.js`
- Verify: `C:\project\raf-bot-v2\message\raf.js`

- [ ] **Step 1: Write source/static guardrail**

Larangan minimum:
- `message/raf.js` tidak boleh berisi daftar panjang `stateStep === ...` untuk domain yang sudah punya owner.
- owner map dan router harus jadi jalur utama dispatch state.

- [ ] **Step 2: Run guardrail tests**

Run: `npm test -- message/__tests__/conversation-state-boundary.test.js message/__tests__/conversation-state-owner-map.test.js message/__tests__/conversation-state-router.test.js`
Expected: PASS.

### Task 6: Sync Docs and Run Final Consolidation Verification

**Files:**
- Modify: `C:\project\raf-bot-v2\SYSTEM_MAP.md`
- Modify: `C:\project\raf-bot-v2\message\.module_map.md`
- Modify: `C:\project\raf-bot-v2\message\handlers\.module_map.md`

- [ ] **Step 1: Sync docs**

Tambahkan wording bahwa:
- state ownership dipusatkan lewat owner map + router,
- `message/raf.js` hanya orchestrator state,
- state domain owner utama sudah dipisah per bounded context.

- [ ] **Step 2: Run final verification suite**

Run: `npm test -- message/__tests__/conversation-state-owner-map.test.js message/__tests__/conversation-state-router.test.js message/__tests__/reporting-state-owner.test.js message/__tests__/wifi-state-owner.test.js message/__tests__/teknisi-state-owner.test.js message/__tests__/payment-state-owner.test.js message/__tests__/conversation-state-boundary.test.js message/__tests__/bot-hardening.test.js message/__tests__/raf-router-boundary.test.js`
Expected: PASS.

- [ ] **Step 3: Commit the consolidation batch**

```bash
git add message SYSTEM_MAP.md
git commit -m "refactor: consolidate conversation state ownership"
```
