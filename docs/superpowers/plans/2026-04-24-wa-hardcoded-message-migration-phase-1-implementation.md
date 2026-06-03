# Header Doc
- Purpose: Implementation plan migrasi pesan WhatsApp hardcoded fase 1 untuk WiFi state dan agent voucher.
- Caller: Agent/pengembang saat mengeksekusi fase `wa-hardcoded-message-migration-phase-1`.
- Deps: `docs/superpowers/specs/2026-04-24-wa-hardcoded-message-migration-phase-1-design.md`, handler WiFi state, handler agent voucher, `database/response_templates.json`.
- MainFuncs: Merinci task TDD, target file, template keys, command verifikasi, dan dokumen/map yang harus disinkronkan.
- SideEffects: Tidak ada; dokumen rencana statis.

# WA Hardcoded Message Migration Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrasi pesan WA user-facing prioritas di WiFi state dan agent voucher ke `responseTemplates` yang editable dari admin.

**Architecture:** Handler target memakai helper `renderResponseTemplate(key, fallback, data)` dengan fallback runtime aman. Template key baru disimpan di `database/response_templates.json`; source guardrail menjaga pola ini tidak regres.

**Tech Stack:** Node.js CommonJS, Jest source guardrail, JSON template storage, handler WhatsApp legacy.

---

## File Structure

- Modify `message/handlers/states/wifi-password-state-handler.js`: pindahkan prompt/confirm/success prioritas ke `renderResponseTemplate`.
- Modify `message/handlers/states/wifi-name-state-handler.js`: pindahkan confirm/success prioritas ke `renderResponseTemplate`.
- Modify `message/handlers/agent-voucher-handler.js`: tambah helper template dan migrasi error/prompt/empty-state prioritas.
- Modify `database/response_templates.json`: tambah key `wifi_password_*`, `wifi_name_*`, dan `agent_voucher_*`.
- Create `message/__tests__/wa-hardcoded-message-migration-phase1.test.js`: source guardrail template usage.
- Modify `SYSTEM_MAP.md`, `message/.module_map.md`, `message/handlers/.module_map.md`: sync flow migrasi.

## Tasks

### Task 1: Guardrail and Template Keys

**Files:**
- Create `message/__tests__/wa-hardcoded-message-migration-phase1.test.js`
- Modify `database/response_templates.json`

- [ ] **Step 1: Add source guardrail**

Guardrail checks target files contain phase-1 template keys and helper usage.

- [ ] **Step 2: Add response template keys**

Add object entries for `wifi_password_*`, `wifi_name_*`, and `agent_voucher_*` with `name`, `category`, `description`, `template`, and `placeholders`.

- [ ] **Step 3: Run failing test before handler migration**

Run: `npm test -- message/__tests__/wa-hardcoded-message-migration-phase1.test.js`

Expected: FAIL for missing handler key usage.

### Task 2: WiFi State Migration

**Files:**
- Modify `message/handlers/states/wifi-password-state-handler.js`
- Modify `message/handlers/states/wifi-name-state-handler.js`

- [ ] **Step 1: Migrate password prompt/confirm/success**

Replace selected direct string replies with `renderResponseTemplate` calls.

- [ ] **Step 2: Migrate name confirm/success**

Replace selected direct string replies with `renderResponseTemplate` calls.

- [ ] **Step 3: Run guardrail**

Run: `npm test -- message/__tests__/wa-hardcoded-message-migration-phase1.test.js`

Expected: WiFi assertions PASS.

### Task 3: Agent Voucher Migration

**Files:**
- Modify `message/handlers/agent-voucher-handler.js`

- [ ] **Step 1: Add local render helper**

Import `renderResponseTemplate` from `../../lib/templating` and expose helper wrapper if needed.

- [ ] **Step 2: Migrate priority replies**

Migrate agent-not-found, empty-stock, generic-error, purchase prompt, sale prompt, and invalid choice replies.

- [ ] **Step 3: Run guardrail**

Run: `npm test -- message/__tests__/wa-hardcoded-message-migration-phase1.test.js`

Expected: Agent voucher assertions PASS.

### Task 4: Docs and Verification

**Files:**
- Modify `SYSTEM_MAP.md`
- Modify `message/.module_map.md`
- Modify `message/handlers/.module_map.md`

- [ ] **Step 1: Sync maps**

Document phase-1 WA message template migration for WiFi state and agent voucher.

- [ ] **Step 2: Run focused tests**

Run: `npm test -- message/__tests__/wa-hardcoded-message-migration-phase1.test.js lib/__tests__/template-service.test.js`

Expected: PASS.

## Self-Review

- Spec coverage: Task 1 covers key/template inventory, Task 2 WiFi state, Task 3 agent voucher, Task 4 docs/verifikasi.
- Placeholder scan: No TBD/TODO placeholders remain.
- Type consistency: Template key names match design and response template category owner.
