# WA Template Finalization Wave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menghapus sisa pesan WhatsApp user/admin-facing hardcoded dari flow aktif agar bisa diedit lewat template admin.

**Architecture:** Semua teks outbound WhatsApp aktif harus dirender dari `database/response_templates.json` via helper template yang sudah ada. Guardrail source test menjaga file aktif tidak kembali memakai direct `reply("...")` atau text payload literal panjang untuk pesan user-facing.

**Tech Stack:** Node.js CommonJS, Jest, `lib/template-service.js`, `database/response_templates.json`.

---

### Task 1: Guardrail Bot Active Flows

**Files:**
- Create: `message/__tests__/wa-hardcoded-message-finalization-wave.test.js`
- Modify: `database/response_templates.json`
- Modify: `message/handlers/state-domains/reporting.state.js`
- Modify: `message/handlers/state-domains/payment.state.js`
- Modify: `message/handlers/state-domains/teknisi.state.js`
- Modify: `services/payment-flow.service.js`
- Modify: `services/wifi-management.service.js`

- [ ] **Step 1: Write failing source guardrail**

Create a Jest test that asserts required response template keys exist and active bot files do not contain direct hardcoded reply calls for targeted flows.

- [ ] **Step 2: Run targeted guardrail and confirm RED**

Run: `npx jest --runInBand message/__tests__/wa-hardcoded-message-finalization-wave.test.js`
Expected: FAIL because targeted source still contains direct hardcoded reply calls or missing template keys.

- [ ] **Step 3: Add response template keys**

Add explicit keys for reporting photo progress, payment state fallback, teknisi photo failure, WiFi management prompts/errors, and payment-flow voucher prompts.

- [ ] **Step 4: Migrate target files to template rendering**

Replace direct hardcoded outbound messages with calls to `renderResponseTemplate`/`renderWithFallback` while preserving dynamic placeholders.

- [ ] **Step 5: Run targeted tests**

Run: `npx jest --runInBand message/__tests__/wa-hardcoded-message-finalization-wave.test.js services/__tests__/payment-flow.service.test.js services/__tests__/wifi-management.service.test.js message/__tests__/conversation-state-router.test.js`
Expected: PASS.

### Task 2: Route Outbound Template Guardrail

**Files:**
- Modify: `message/__tests__/wa-hardcoded-message-finalization-wave.test.js`
- Modify: route/service outbound files after Task 1.

- [ ] **Step 1: Extend guardrail to web/API outbound WhatsApp builders**

Cover `routes/public.js`, `routes/saldo.js`, `routes/requests.js`, `routes/invoice.js`, `routes/users.js`, and `routes/speed-requests.js`.

- [ ] **Step 2: Migrate one route/service cluster at a time**

Move outbound message builders to response/notification templates without changing database writes or payment logic.

- [ ] **Step 3: Run full regression**

Run: `npm test`
Expected: PASS.
