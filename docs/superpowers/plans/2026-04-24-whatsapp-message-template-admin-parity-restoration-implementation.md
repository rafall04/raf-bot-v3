# Header Doc
- Purpose: Implementation plan untuk memulihkan parity halaman admin `/templates` dengan kategori template WhatsApp runtime.
- Caller: Agent/pengembang saat mengeksekusi fase `whatsapp-message-template-admin-parity-restoration`.
- Deps: `docs/superpowers/specs/2026-04-24-whatsapp-message-template-admin-parity-restoration-design.md`, `routes/admin-content-routes.js`, `routes/message-templates.js`, `views/sb-admin/templates.php`, `lib/template-service.js`.
- MainFuncs: Merinci task TDD, file target, patch behavior, command verifikasi, dan dokumen/map yang harus disinkronkan.
- SideEffects: Tidak ada; dokumen rencana statis.

# WhatsApp Message Template Admin Parity Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Memastikan halaman admin `/templates` bisa melihat dan menyimpan kategori template WhatsApp penting tanpa menghapus metadata existing.

**Architecture:** `/api/templates` tetap owner full editor melalui `routes/admin-content-routes.js` dan `lib/template-service.js`. `/api/message-templates` tetap compat notification-template route, sedangkan UI lama `views/sb-admin/templates.php` diperketat agar `menuTemplates` dan `reportTemplates` editable dan payload save metadata-safe.

**Tech Stack:** Node.js CommonJS, Express route registrar, Jest/Supertest, PHP/jQuery admin view legacy, JSON template storage.

---

## File Structure

- Modify `views/sb-admin/templates.php`: tambah tab/editor `menu` dan `report`, mapping load/save kategori, dan helper preserve metadata.
- Modify `routes/__tests__/admin-content-routes.test.js`: perketat GET/POST `/api/templates` untuk semua kategori dan save category.
- Modify `routes/__tests__/message-templates.compat.test.js`: perjelas boundary compat route terhadap source `message_templates.json`.
- Create `views/__tests__/templates-admin-parity.test.js`: source guardrail untuk memastikan UI fetch `/api/templates`, expose `menuTemplates`/`reportTemplates`, dan memakai metadata-preserving save helper.
- Create `docs/testing/whatsapp-message-template-admin-parity-inventory-2026-04-24.md`: inventory kategori editable/runtime-backed vs hardcoded/fallback.
- Modify `SYSTEM_MAP.md`: catat admin template parity restoration.
- Modify `routes/.module_map.md`: jelaskan `/api/templates` sebagai full editor owner dan `/api/message-templates` sebagai compat notification-template surface.

## Tasks

### Task 1: Boundary Tests and Inventory

**Files:**
- Modify: `routes/__tests__/admin-content-routes.test.js`
- Create: `views/__tests__/templates-admin-parity.test.js`
- Create: `docs/testing/whatsapp-message-template-admin-parity-inventory-2026-04-24.md`

- [ ] **Step 1: Add failing route coverage for all template categories**

Add assertions that `GET /api/templates` returns `notificationTemplates`, `wifiMenuTemplates`, `responseTemplates`, `commandTemplates`, `errorTemplates`, `successTemplates`, `systemTemplates`, `menuTemplates`, and `reportTemplates`.

- [ ] **Step 2: Add source guardrail for admin UI**

Add Jest text-level assertions that `views/sb-admin/templates.php` fetches `/api/templates`, renders `menu`/`report` groups, maps them to `menuTemplates`/`reportTemplates`, and uses a helper that spreads existing metadata before overriding `name`/`template`.

- [ ] **Step 3: Add inventory doc**

Document editable categories, runtime readers, preserved-only categories removed by this phase, and known non-blocking hardcoded/fallback WhatsApp messages.

- [ ] **Step 4: Run focused failing tests**

Run: `npm test -- routes/__tests__/admin-content-routes.test.js views/__tests__/templates-admin-parity.test.js`

Expected before implementation: UI guardrail fails for `menu`/`report` and metadata preserve helper.

### Task 2: Metadata-Safe Admin Save

**Files:**
- Modify: `views/sb-admin/templates.php`
- Modify: `routes/__tests__/admin-content-routes.test.js`

- [ ] **Step 1: Add helper in UI save block**

Add `buildTemplatePayloadEntry(sourceEntry, headerText, templateText)` that returns strings unchanged for string sources and spreads object metadata for object sources:

```javascript
function buildTemplatePayloadEntry(sourceEntry, headerText, templateText) {
    if (sourceEntry && typeof sourceEntry === 'object' && !Array.isArray(sourceEntry)) {
        return {
            ...sourceEntry,
            name: sourceEntry.name || headerText,
            template: templateText
        };
    }
    return {
        name: headerText,
        template: templateText
    };
}
```

- [ ] **Step 2: Use helper for object-backed categories**

Replace direct `{ name, template }` reconstruction in save loop with `buildTemplatePayloadEntry(originalEntry, headerText, value)`.

- [ ] **Step 3: Add POST route test for save categories**

Assert POST `/api/templates` calls `saveCategory` for `menuTemplates` and `reportTemplates` when present and reloads template manager.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- routes/__tests__/admin-content-routes.test.js views/__tests__/templates-admin-parity.test.js`

Expected: PASS.

### Task 3: Expose Menu and Report Categories

**Files:**
- Modify: `views/sb-admin/templates.php`
- Modify: `views/__tests__/templates-admin-parity.test.js`

- [ ] **Step 1: Add admin tabs**

Add `Menu` and `Laporan` tabs with matching panes `#menu` and `#report`.

- [ ] **Step 2: Add load categorization**

Map `templates.menuTemplates` to `categorized.menu` and `templates.reportTemplates` to `categorized.report`.

- [ ] **Step 3: Add save target mapping**

Map save group `menu` to payload `menuTemplates` and group `report` to payload `reportTemplates`.

- [ ] **Step 4: Run UI guardrail**

Run: `npm test -- views/__tests__/templates-admin-parity.test.js`

Expected: PASS.

### Task 4: Compat Route Clarity

**Files:**
- Modify: `routes/__tests__/message-templates.compat.test.js`
- Modify: `routes/.module_map.md`

- [ ] **Step 1: Add diagnostics/source assertion**

Assert compat diagnostics still points to `message_templates.json`/`notificationTemplates` and does not claim to be the full editor route.

- [ ] **Step 2: Sync route module map**

Update route map rows for `admin-content-routes.js` and `message-templates.js`.

- [ ] **Step 3: Run compat test**

Run: `npm test -- routes/__tests__/message-templates.compat.test.js`

Expected: PASS.

### Task 5: Docs and Full Verification

**Files:**
- Modify: `SYSTEM_MAP.md`
- Modify: `routes/.module_map.md`
- Modify/Create: docs listed above

- [ ] **Step 1: Sync root map**

Add boundary note that `/api/templates` is the full admin template editor and `/api/message-templates` is compat notification-template API.

- [ ] **Step 2: Run focused template suite**

Run: `npm test -- routes/__tests__/admin-content-routes.test.js routes/__tests__/message-templates.compat.test.js lib/__tests__/template-service.test.js views/__tests__/templates-admin-parity.test.js`

Expected: PASS.

- [ ] **Step 3: Run smoke-core subset if focused suite passes**

Run: `npm run test:smoke-core`

Expected: PASS or document any unrelated existing residual.

## Self-Review

- Spec coverage: Slice A covered by Task 1, Slice B by Task 2, Slice C by Task 3, Slice D by Task 4, Slice E by Task 5.
- Placeholder scan: No TBD/TODO placeholders remain.
- Type consistency: Category names match `lib/template-service.js` category keys and `/api/templates` response contract.
