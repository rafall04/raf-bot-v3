# Header Doc
- Purpose: Plan implementasi Wave 4 migrasi pesan WhatsApp hardcoded agent self-service.
- Caller: Agent pengembang saat eksekusi patch terstruktur.
- Deps: Spec Wave 4, `message/handlers/agent.js`, `database/response_templates.json`, Jest.
- MainFuncs: Merinci task test-first, patch template, patch handler, docs/map, dan verifikasi.
- SideEffects: Tidak ada; dokumentasi statis.

# WA Hardcoded Message Migration Wave 4 Agent Self-Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrasi reply statis agent transaction/self-service ke `responseTemplates` tanpa mengubah behavior bisnis.

**Architecture:** `agent.js` tetap memakai helper lokal `renderResponseTemplate()` dari Wave 3. JSON template menjadi source admin-editable, sementara fallback string mempertahankan output lama jika template kosong atau tidak tersedia.

**Tech Stack:** Node.js CommonJS, Jest, JSON response templates.

---

### Task 1: Guardrail Test

**Files:**
- Create: `message/__tests__/wa-hardcoded-message-migration-wave4-agent.test.js`

- [x] Tambahkan test yang memastikan key Wave 4 tersedia di JSON dan dipakai di `agent.js`.
- [x] Jalankan test sebelum implementasi untuk memvalidasi coverage gagal bila key belum ada.

### Task 2: Template JSON

**Files:**
- Modify: `database/response_templates.json`

- [x] Tambahkan key Wave 4 sebelum cluster agent existing agar urutan tetap mudah dibaca.
- [x] Parse JSON untuk memastikan tidak ada trailing comma/duplicate syntax error.

### Task 3: Agent Handler

**Files:**
- Modify: `message/handlers/agent.js`

- [x] Ganti reply statis pada format salah, not found, status invalid, PIN/profile/status error dengan `renderResponseTemplate()`.
- [x] Pertahankan pesan dinamis besar berbasis transaksi/profil.

### Task 4: Docs And Maps

**Files:**
- Modify: `SYSTEM_MAP.md`
- Modify: `message/handlers/.module_map.md`
- Create: `docs/testing/wa-hardcoded-message-migration-wave-4-agent-self-service-results-2026-04-24.md`

- [x] Sinkronkan peta sistem dan peta handler.
- [x] Catat hasil verifikasi.

### Task 5: Verification

- [x] Run `node --check message/handlers/agent.js`.
- [x] Run `node --check message/__tests__/wa-hardcoded-message-migration-wave4-agent.test.js`.
- [x] Run JSON parse for `database/response_templates.json`.
- [x] Run focused Jest suite.
