# API Domain Normalization + Legacy Lib Business Split Implementation Plan

> Based on spec: `docs/superpowers/specs/2026-04-23-api-domain-normalization-and-legacy-lib-business-split-design.md`

## Execution Rules
- Kerjakan per slice kecil dengan verifikasi di akhir tiap slice.
- Jangan ubah contract API publik tanpa alasan kuat.
- Jangan bikin dual ownership antara repository baru dan helper lama.
- Semua file yang disentuh wajib sinkron dengan Header Doc dan map docs.

## Implementation Slices

### Task 1 - API Ownership Inventory
Goal: petakan concern helper-first pada `api.js` dan sub-router `api-*.js`.

Steps:
1. Audit `routes/api.js`.
2. Audit `routes/api-users-routes.js`, `api-voucher-routes.js`, `api-network-routes.js`, `api-psb-routes.js`.
3. Kelompokkan concern:
   - route/controller logic
   - business orchestration
   - persistence/cache
   - adapter/integration
4. Tambahkan baseline guardrail jika perlu.

Verify:
- owner map API jelas sebelum extraction

### Task 2 - Users/Customer API Normalization
Goal: rapikan domain users/customer yang paling besar blast radius-nya.

Steps:
1. Bentuk/perkuat service owner users/customer.
2. Bentuk/perkuat repository owner untuk persistence/cache concern yang masih helper-first.
3. Refactor route agar lebih tipis.

Verify:
- route boundary tests lulus
- service/repository contract tests lulus

### Task 3 - Voucher/Network API Normalization
Goal: rapikan voucher dan network API yang masih helper-first.

Steps:
1. Ekstrak concern business/persistence ke service/repository owner.
2. Kurangi direct helper persistence dari route.
3. Pertahankan adapter/integrasi tetap di bawah service/repository owner.

Verify:
- regression route/service/repository voucher-network lulus

### Task 4 - PSB/Provisioning API Normalization
Goal: rapikan domain provisioning/PSB yang masih bercampur.

Steps:
1. Tetapkan owner service/repository yang jelas.
2. Refactor route agar hanya memegang adapter HTTP.
3. Tambah guardrail source jika perlu.

Verify:
- regression PSB/provisioning lulus

### Task 5 - Guardrails + Docs Sync
Goal: tutup phase API normalization dengan guardrail source dan docs sinkron.

Steps:
1. Tambah source/boundary tests untuk route API prioritas.
2. Sync `SYSTEM_MAP.md`, `routes/.module_map.md`, dan map lain yang berubah.
3. Jalankan focused regression akhir.

Verify:
- guardrail tests lulus
- docs sinkron dengan owner final

## Exit Criteria
- `routes/api.js` dan sub-router prioritas lebih tipis dan konsisten
- owner service/repository domain API bisa ditrace jelas
- helper `lib/*` business-heavy berkurang di jalur API aktif
- repository/service boundary makin merata lintas bot/admin/API
