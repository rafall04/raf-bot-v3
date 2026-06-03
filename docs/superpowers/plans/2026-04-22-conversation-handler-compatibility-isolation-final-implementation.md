# Conversation-Handler Compatibility Isolation Final Implementation Plan

> Based on spec: `docs/superpowers/specs/2026-04-22-conversation-handler-compatibility-isolation-final-design.md`

## Execution Rules
- Kerjakan per slice kecil dengan verifikasi di akhir tiap slice.
- Jangan ubah behavior user-facing flow.
- Jangan hapus `createScopedStateProxy(...)` total bila masih dipakai boundary legacy/test.
- Semua file yang disentuh wajib tetap sinkron dengan Header Doc dan map docs.

## Implementation Slices

### Task 1 - Caller Inventory + Guardrail Baseline
Goal: petakan seluruh pemanggil `createScopedStateProxy(...)` dan tetapkan baseline caller yang masih diizinkan.

Steps:
1. Audit seluruh caller `createScopedStateProxy(...)`.
2. Kelompokkan caller:
   - active production consumer
   - legacy compatibility consumer
   - test-only consumer
3. Tambahkan baseline guardrail test/source test yang memotret caller aktif yang seharusnya sudah dilarang.

Verify:
- source test baru lulus
- inventaris caller aktif jelas sebelum migrasi

### Task 2 - Active Consumer Migration
Goal: migrasikan caller aktif terakhir dari proxy compatibility ke API state eksplisit.

Steps:
1. Refactor consumer aktif prioritas agar memakai:
   - `getUserState`
   - `setUserState`
   - `getScopedState`
   - `setScopedState`
   - `deleteScopedState`
2. Pastikan tidak ada proxy baru yang dibuat pada jalur aktif.
3. Pertahankan compatibility behavior untuk jalur legacy/test yang belum disentuh.

Verify:
- regression targeted untuk consumer yang disentuh lulus
- guardrail source test tetap lulus

### Task 3 - Compatibility Boundary Tightening
Goal: jadikan proxy sebagai compatibility-only surface yang tegas.

Steps:
1. Perjelas boundary di `conversation-handler.js` bila perlu lewat doc/comment/export ordering yang menandai proxy sebagai transitional-only.
2. Tighten test agar file aktif prioritas tidak boleh memakai `createScopedStateProxy(...)`.
3. Pisahkan ekspektasi compatibility dari active-flow regression bila test saat ini masih campur.

Verify:
- `conversation-handler-state-store` tetap lulus
- active-flow tests tidak lagi memicu proxy dari jalur produksi

### Task 4 - Docs Sync
Goal: sinkronkan ownership dan batas compatibility di dokumentasi arsitektur.

Steps:
1. Update `SYSTEM_MAP.md`.
2. Update `message/.module_map.md`.
3. Update `message/handlers/.module_map.md`.

Verify:
- docs mencerminkan proxy sebagai compatibility-only surface
- jalur aktif state owner tetap terdeskripsi benar

### Task 5 - Final Regression
Goal: pastikan isolasi compatibility tidak memecah bot/state flow aktif.

Verify:
- `message/__tests__/conversation-handler-state-store.test.js`
- `message/__tests__/bot-hardening.test.js`
- `message/__tests__/conversation-state-boundary.test.js`
- `message/__tests__/raf-router-boundary.test.js`
- guardrail source test baru

## Exit Criteria
- Active consumer prioritas tidak lagi memakai `createScopedStateProxy(...)`.
- Proxy compatibility tinggal surface transisional/test yang jelas.
- Warning `legacyStateProxy*` tidak lagi berasal dari jalur aktif.
- Docs dan tests sinkron dengan boundary final terbaru.
