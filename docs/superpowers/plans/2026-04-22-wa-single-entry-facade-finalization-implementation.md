# WA Single-Entry Facade Finalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menyelesaikan boundary WhatsApp agar perubahan Baileys terkonsentrasi di owner file yang jelas, dengan `message/raf.js` dan `message/handlers/*` tidak lagi mengetahui detail Baileys mentah.

**Architecture:** Fase ini mengunci owner untuk bootstrap, gateway, inbound normalization, outbound adapter/delivery, dan reply facade. Implementasi dilakukan bertahap: kontrak inbound dulu, lalu router slimming, lalu penguncian outbound, dan terakhir static guardrails. Setiap slice ditutup dengan verifikasi ringan agar kebocoran boundary cepat terdeteksi.

**Tech Stack:** Node.js CommonJS, Jest, Baileys runtime wrappers, `lib/whatsapp-*`, `message/raf.js`, `message/handlers/*`, static source guardrail tests.

---

### Task 1: Lock the Inbound Contract Before Refactor

**Files:**
- Create: `C:\project\raf-bot-v2\lib\__tests__\whatsapp-inbound-adapter.contract.test.js`
- Verify: `C:\project\raf-bot-v2\message\handlers\raf-context.js`
- Verify: `C:\project\raf-bot-v2\message\raf.js`

- [ ] **Step 1: Write the failing inbound contract test**

Tambahkan test untuk shape normalized message minimum:
- `from`
- `sender`
- `pushname`
- `command`
- `args`
- `chats`
- `isGroup`
- `messageType`

- [ ] **Step 2: Run inbound contract test**

Run: `npm test -- lib/__tests__/whatsapp-inbound-adapter.contract.test.js`
Expected: FAIL until owner adapter baru tersedia.

### Task 2: Create `lib/whatsapp-inbound-adapter.js`

**Files:**
- Create: `C:\project\raf-bot-v2\lib\whatsapp-inbound-adapter.js`
- Modify: `C:\project\raf-bot-v2\message\handlers\raf-context.js`
- Create: `C:\project\raf-bot-v2\lib\__tests__\whatsapp-inbound-adapter.test.js`

- [ ] **Step 1: Add inbound adapter skeleton with Header Doc**

Target API:

```js
function normalizeIncomingMessage(msg, options = {}) {}
```

- [ ] **Step 2: Move normalization logic into the adapter**

Pindahkan logic parsing pesan yang sekarang tersebar ke owner baru tanpa mengubah behavior.

- [ ] **Step 3: Re-run inbound adapter tests**

Run: `npm test -- lib/__tests__/whatsapp-inbound-adapter.contract.test.js lib/__tests__/whatsapp-inbound-adapter.test.js`
Expected: PASS.

### Task 3: Slim `message/raf.js` to Consume Normalized Input

**Files:**
- Modify: `C:\project\raf-bot-v2\message\raf.js`
- Modify: `C:\project\raf-bot-v2\message\handlers\raf-context.js`
- Create: `C:\project\raf-bot-v2\message\__tests__\raf-inbound-boundary.test.js`

- [ ] **Step 1: Write the failing boundary test**

Guardrail target:
- `message/raf.js` memakai inbound adapter owner,
- tidak lagi mem-parsing shape pesan mentah secara besar di router utama.

- [ ] **Step 2: Update router to use normalized message context**

Contoh target:

```js
const messageContext = normalizeIncomingMessage(msg, { runtime: requestRuntime });
```

- [ ] **Step 3: Re-run inbound boundary tests**

Run: `npm test -- message/__tests__/raf-inbound-boundary.test.js message/__tests__/bot-context-contract.test.js message/__tests__/raf-router-boundary.test.js`
Expected: PASS.

### Task 4: Tighten Outbound Owner Usage

**Files:**
- Verify/Modify: `C:\project\raf-bot-v2\lib\whatsapp.adapter.js`
- Verify/Modify: `C:\project\raf-bot-v2\lib\whatsapp-delivery-service.js`
- Verify/Modify: `C:\project\raf-bot-v2\message\handlers\reply-runtime.js`
- Create: `C:\project\raf-bot-v2\message\__tests__\wa-outbound-owner.test.js`

- [ ] **Step 1: Write the failing outbound owner test**

Pastikan text/contact/media keluar lewat facade owner, bukan socket raw.

- [ ] **Step 2: Patch direct outbound callers if any leak remains**

Prioritas:
- `message/handlers/*`
- helper flow WA aktif

- [ ] **Step 3: Re-run outbound tests**

Run: `npm test -- message/__tests__/wa-outbound-owner.test.js message/__tests__/reply-runtime.test.js`
Expected: PASS.

### Task 5: Add Forbidden Import Guardrails

**Files:**
- Create: `C:\project\raf-bot-v2\message\__tests__\wa-forbidden-imports.test.js`
- Verify: `C:\project\raf-bot-v2\message\raf.js`
- Verify: `C:\project\raf-bot-v2\message\handlers\*.js`

- [ ] **Step 1: Write static guardrails**

Larangan minimum:
- `@whiskeysockets/baileys` di `message/handlers/*`
- `global.raf`
- `.sendMessage(` di handler/router yang bukan owner outbound

- [ ] **Step 2: Run forbidden import test**

Run: `npm test -- message/__tests__/wa-forbidden-imports.test.js`
Expected: PASS after cleanup.

### Task 6: Sync Docs and Run Final WA Boundary Verification

**Files:**
- Modify: `C:\project\raf-bot-v2\SYSTEM_MAP.md`
- Modify: `C:\project\raf-bot-v2\message\.module_map.md`
- Modify: `C:\project\raf-bot-v2\message\handlers\.module_map.md`
- Modify: `C:\project\raf-bot-v2\lib\.module_map.md` if the inbound adapter changes local ownership wording

- [ ] **Step 1: Sync docs**

Tambahkan wording bahwa:
- inbound normalization owned by `lib/whatsapp-inbound-adapter.js`
- `message/raf.js` hanya composition router
- outbound WA lewat adapter/delivery/reply facade

- [ ] **Step 2: Run final verification suite**

Run: `npm test -- lib/__tests__/whatsapp-inbound-adapter.contract.test.js lib/__tests__/whatsapp-inbound-adapter.test.js message/__tests__/raf-inbound-boundary.test.js message/__tests__/wa-outbound-owner.test.js message/__tests__/wa-forbidden-imports.test.js message/__tests__/reply-runtime.test.js message/__tests__/bot-context-contract.test.js message/__tests__/raf-router-boundary.test.js message/__tests__/bot-hardening.test.js`
Expected: PASS.

- [ ] **Step 3: Commit the boundary batch**

```bash
git add lib message SYSTEM_MAP.md
git commit -m "refactor: finalize whatsapp single-entry facade"
```
