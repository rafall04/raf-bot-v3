# Admin/Network Ops Cleanup + Repository Normalization Wave 3 Implementation Plan

> Based on spec: `docs/superpowers/specs/2026-04-23-admin-network-ops-cleanup-repository-normalization-wave-3-design.md`

## Execution Rules
- Kerjakan per slice kecil dengan verifikasi di akhir tiap slice.
- Jangan ubah semantics operasi admin/network.
- Jangan buat dual ownership antara repository baru dan helper lama.
- Semua file yang disentuh wajib sinkron dengan Header Doc dan map docs.

## Implementation Slices

### Task 1 - Ownership Inventory
Goal: petakan concern aktif yang masih campur di `admin-ops` dan `network-ops`.

Steps:
1. Audit `services/admin-ops.service.js`.
2. Audit `services/network-ops.service.js`.
3. Kelompokkan concern:
   - orchestration/decision
   - persistence/cache/history
   - adapter/integration
4. Tambahkan baseline guardrail bila perlu.

Verify:
- ownership concern ops/network jelas sebelum extraction

### Task 2 - Repository Owner Extraction
Goal: bentuk/perkuat repository owner untuk concern persistence/cache/history ops/network.

Steps:
1. Buat repository owner baru atau perluas repository yang sudah ada.
2. Bungkus read/write cache, cleanup, atau history yang masih helper-first.
3. Jika helper lama masih dipakai, posisikan sebagai adapter transisional.

Verify:
- repository contract tests lulus
- repository tidak membuat source of truth baru yang bentrok

### Task 3 - Service Cleanup
Goal: pindahkan service ops/network ke dependency repository owner yang eksplisit.

Steps:
1. Ubah `admin-ops.service.js` agar memakai repository owner konsisten.
2. Ubah `network-ops.service.js` agar memakai repository owner konsisten.
3. Pertahankan device/integration calls di adapter, bukan di repository.

Verify:
- service boundary tests lulus
- helper persistence langsung berkurang nyata

### Task 4 - Route/Consumer Guardrails
Goal: kunci boundary baru agar route/admin consumer tidak kembali lompat ke helper campuran.

Steps:
1. Tambah source/boundary tests untuk service/route caller yang disentuh.
2. Larang import/helper persistence langsung bila owner repository sudah ada.
3. Pastikan `asyncHandler`/global error path tetap utuh.

Verify:
- route/admin focused tests lulus
- source guardrail lulus

### Task 5 - Docs Sync + Final Regression
Goal: tutup wave 3 dengan docs sinkron dan verifikasi focused.

Steps:
1. Sync `SYSTEM_MAP.md`, `routes/.module_map.md`, `message/.module_map.md`, atau map relevan lain.
2. Jalankan focused regression untuk service, repository, dan route yang disentuh.

Verify:
- docs sinkron dengan owner final
- focused regression lulus

## Exit Criteria
- `admin-ops.service.js` dan `network-ops.service.js` lebih tipis dan eksplisit
- persistence/cache/history concern ops/network punya repository owner yang jelas
- helper `lib/*` turun menjadi adapter/utilitas
- route/admin/network boundary makin konsisten dengan domain lain
