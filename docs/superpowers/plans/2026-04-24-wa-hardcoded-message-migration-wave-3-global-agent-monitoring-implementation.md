# Header Doc
- Purpose: Implementation plan Wave 3 migrasi pesan WhatsApp hardcoded lintas dispatcher, agent, dan monitoring.
- Caller: Agent/pengembang saat mengeksekusi Wave 3.
- Deps: Spec Wave 3, target handlers, `database/response_templates.json`.
- MainFuncs: Merinci target file, template keys, guardrail, patch handler, docs, dan verification commands.
- SideEffects: Tidak ada; dokumen rencana statis.

# WA Hardcoded Message Migration Wave 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrasi pesan user-facing prioritas di dispatcher global, agent umum, dan monitoring ke `responseTemplates`.

**Architecture:** Handler memakai helper render template dengan fallback. Dynamic list tetap dibangun di handler dan tidak diubah.

**Tech Stack:** Node.js CommonJS, Jest source guardrail, JSON template storage.

---

## Tasks

### Task 1: Guardrail and Template Keys

**Files:**
- Modify `database/response_templates.json`
- Create `message/__tests__/wa-hardcoded-message-migration-wave3.test.js`

- [ ] Add template keys for `raf_dispatch_*`, `agent_general_*`, and `monitoring_*`.
- [ ] Add source guardrail for all target handlers.

### Task 2: Patch Handlers

**Files:**
- Modify `message/handlers/raf-intent-dispatch.js`
- Modify `message/handlers/agent.js`
- Modify `message/handlers/monitoring-handler.js`

- [ ] Add/use `renderResponseTemplate`.
- [ ] Replace priority hardcoded reply strings only.
- [ ] Preserve business logic and dynamic lists.

### Task 3: Docs and Verification

**Files:**
- Modify `SYSTEM_MAP.md`
- Modify `message/handlers/.module_map.md`
- Create results doc.

- [ ] Run `node --check` for touched JS files.
- [ ] Run JSON parse.
- [ ] Run focused Jest tests.

## Self-Review

- Scope is limited to three approved domains.
- No business logic changes are planned.
- Fallbacks remain for runtime safety.
