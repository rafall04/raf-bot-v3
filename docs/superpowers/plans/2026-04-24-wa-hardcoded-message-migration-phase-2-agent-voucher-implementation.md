# Header Doc
- Purpose: Implementation plan migrasi pesan WhatsApp hardcoded fase 2 khusus agent voucher.
- Caller: Agent/pengembang saat mengeksekusi fase `wa-hardcoded-message-migration-phase-2-agent-voucher`.
- Deps: Spec fase 2 agent voucher, `message/handlers/agent-voucher-handler.js`, `database/response_templates.json`.
- MainFuncs: Merinci task TDD, template keys, patch handler, guardrail, dan verifikasi.
- SideEffects: Tidak ada; dokumen rencana statis.

# WA Hardcoded Message Migration Phase 2 Agent Voucher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mengurangi sisa pesan hardcoded di flow agent voucher quantity/payment/customer/confirmation/success/history.

**Architecture:** Tambahkan key `agent_voucher_*` di `responseTemplates`, gunakan helper `renderResponseTemplate` yang sudah ada di handler, dan pertahankan fallback untuk safety.

**Tech Stack:** Node.js CommonJS, Jest source guardrail, JSON template storage.

---

## Tasks

### Task 1: Template Keys and Guardrail

**Files:**
- Modify `database/response_templates.json`
- Modify `message/__tests__/wa-hardcoded-message-migration-phase1.test.js`

- [ ] Add phase-2 key list to guardrail.
- [ ] Add matching JSON template entries.
- [ ] Run guardrail to confirm failures before handler migration if key usage missing.

### Task 2: Patch Agent Voucher Handler

**Files:**
- Modify `message/handlers/agent-voucher-handler.js`

- [ ] Replace quantity/payment/customer/confirmation/success/error/empty-history messages with `renderResponseTemplate`.
- [ ] Keep dynamic list/detail construction intact.
- [ ] Run `node --check`.

### Task 3: Docs and Verification

**Files:**
- Modify `SYSTEM_MAP.md`
- Modify `message/handlers/.module_map.md`
- Create results doc.

- [ ] Sync maps.
- [ ] Run focused tests: `npm test -- message/__tests__/wa-hardcoded-message-migration-phase1.test.js lib/__tests__/template-service.test.js`.

## Self-Review

- Scope is one domain only: agent voucher.
- No placeholder/TBD items remain.
- Key names use existing `agent_voucher_*` prefix.
