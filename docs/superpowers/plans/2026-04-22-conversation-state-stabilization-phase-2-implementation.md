# Conversation State Stabilization Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menjadikan `conversation-state-router` sebagai otoritas state yang nyata dengan menghapus fallback branch lama dari `message/raf.js` per domain secara aman dan terverifikasi.

**Architecture:** Fase ini bukan menambah owner baru, melainkan menegaskan authority owner yang sudah dibuat. Tiap slice dimulai dengan guardrail yang menarget branch fallback tertentu, lalu branch itu dihapus setelah owner domain dan regression test dinyatakan aman. Reporting dikerjakan terakhir karena blast radius paling besar.

**Tech Stack:** Node.js CommonJS, Jest, `message/raf.js`, `message/handlers/conversation-state-router.js`, `message/handlers/state-domains/*`, source/static guardrails, `.module_map.md`, `SYSTEM_MAP.md`.

---

### Task 1: Guardrail the Existing Fallback Paths

**Files:**
- Modify: `C:\project\raf-bot-v2\message\__tests__\conversation-state-boundary.test.js`
- Verify: `C:\project\raf-bot-v2\message\raf.js`

- [ ] **Step 1: Add explicit fallback markers**

Tambahkan assertion yang menandai branch fallback domain mana yang masih ada sekarang:
- `AGENT_VOUCHER_*`
- `ASK_VOUCHER_CHOICE`
- managed WiFi
- teknisi photo/completion
- reporting representative steps

- [ ] **Step 2: Run boundary baseline**

Run: `npm test -- message/__tests__/conversation-state-boundary.test.js`
Expected: PASS and capture current fallback baseline.

### Task 2: Purge Agent-Voucher and Payment Fallbacks

**Files:**
- Modify: `C:\project\raf-bot-v2\message\raf.js`
- Modify: `C:\project\raf-bot-v2\message\__tests__\conversation-state-boundary.test.js`
- Verify: `C:\project\raf-bot-v2\message\handlers\state-domains\agent-voucher.state.js`
- Verify: `C:\project\raf-bot-v2\message\handlers\state-domains\payment.state.js`

- [ ] **Step 1: Remove direct fallback branches for agent-voucher + payment**

- [ ] **Step 2: Tighten boundary assertions for these branches**

- [ ] **Step 3: Re-run focused verification**

Run: `npm test -- message/__tests__/conversation-state-router.test.js message/__tests__/payment-state-owner.test.js message/__tests__/conversation-state-boundary.test.js`
Expected: PASS.

### Task 3: Purge WiFi Fallbacks

**Files:**
- Modify: `C:\project\raf-bot-v2\message\raf.js`
- Modify: `C:\project\raf-bot-v2\message\__tests__\conversation-state-boundary.test.js`
- Verify: `C:\project\raf-bot-v2\message\handlers\state-domains\wifi.state.js`

- [ ] **Step 1: Remove managed/legacy WiFi fallback branches from router**

- [ ] **Step 2: Tighten boundary assertions for WiFi**

- [ ] **Step 3: Re-run WiFi verification**

Run: `npm test -- message/__tests__/wifi-state-owner.test.js message/__tests__/conversation-state-router.test.js message/__tests__/conversation-state-boundary.test.js`
Expected: PASS.

### Task 4: Purge Teknisi Fallbacks

**Files:**
- Modify: `C:\project\raf-bot-v2\message\raf.js`
- Modify: `C:\project\raf-bot-v2\message\__tests__\conversation-state-boundary.test.js`
- Verify: `C:\project\raf-bot-v2\message\handlers\state-domains\teknisi.state.js`

- [ ] **Step 1: Remove teknisi photo/completion fallback branches**

- [ ] **Step 2: Tighten boundary assertions for teknisi**

- [ ] **Step 3: Re-run teknisi verification**

Run: `npm test -- message/__tests__/teknisi-state-owner.test.js message/__tests__/conversation-state-router.test.js message/__tests__/conversation-state-boundary.test.js`
Expected: PASS.

### Task 5: Purge Reporting Fallbacks

**Files:**
- Modify: `C:\project\raf-bot-v2\message\raf.js`
- Modify: `C:\project\raf-bot-v2\message\__tests__\conversation-state-boundary.test.js`
- Verify: `C:\project\raf-bot-v2\message\handlers\state-domains\reporting.state.js`

- [ ] **Step 1: Remove remaining reporting fallback branches from router**

- [ ] **Step 2: Tighten reporting assertions**

- [ ] **Step 3: Re-run reporting verification**

Run: `npm test -- message/__tests__/reporting-state-owner.test.js message/__tests__/conversation-state-router.test.js message/__tests__/conversation-state-boundary.test.js message/__tests__/bot-hardening.test.js`
Expected: PASS.

### Task 6: Sync Docs and Run Final Router Authority Verification

**Files:**
- Modify: `C:\project\raf-bot-v2\SYSTEM_MAP.md`
- Modify: `C:\project\raf-bot-v2\message\.module_map.md`
- Modify: `C:\project\raf-bot-v2\message\handlers\.module_map.md`

- [ ] **Step 1: Sync authority wording**

Tambahkan wording bahwa:
- `conversation-state-router` adalah jalur utama authority state,
- fallback lama di router utama sudah dipurge untuk domain prioritas.

- [ ] **Step 2: Run final verification suite**

Run: `npm test -- message/__tests__/conversation-state-owner-map.test.js message/__tests__/conversation-state-router.test.js message/__tests__/reporting-state-owner.test.js message/__tests__/wifi-state-owner.test.js message/__tests__/teknisi-state-owner.test.js message/__tests__/payment-state-owner.test.js message/__tests__/conversation-state-boundary.test.js message/__tests__/bot-hardening.test.js message/__tests__/raf-router-boundary.test.js`
Expected: PASS.

- [ ] **Step 3: Commit the stabilization batch**

```bash
git add message SYSTEM_MAP.md
git commit -m "refactor: harden conversation state router authority"
```
