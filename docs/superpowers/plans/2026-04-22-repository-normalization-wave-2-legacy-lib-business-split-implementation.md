# Repository Normalization Wave 2 + Legacy Lib Business Split Implementation Plan

> Based on spec: `docs/superpowers/specs/2026-04-22-repository-normalization-wave-2-legacy-lib-business-split-design.md`

## Execution Rules
- Kerjakan per slice kecil dengan verifikasi di akhir tiap slice.
- Jangan redesign perilaku fitur.
- Jangan migrasi storage fisik besar-besaran.
- Setiap domain yang disentuh wajib sinkron dengan Header Doc dan map docs.

## Implementation Slices

### Task 1 - Inventory + Ownership Baseline
Goal: petakan domain WiFi, payment/topup, dan admin/network ops yang masih helper-first.

Steps:
1. Audit consumer aktif yang masih memanggil helper `lib/*` business-heavy.
2. Tetapkan owner concern per domain:
   - handler/controller
   - service
   - repository
   - helper adapter
3. Tambahkan baseline guardrail/source test jika ada direct helper persistence access yang jelas harus dilarang.

Verify:
- inventory caller/helper selesai
- ownership map domain wave 2 jelas sebelum migrasi

### Task 2 - WiFi Repository/Service Normalization
Goal: pisahkan logging/history/persistence WiFi dari helper campuran.

Steps:
1. Bentuk atau kuatkan repository owner untuk concern WiFi yang aktif.
2. Refactor consumer prioritas di handler/service WiFi agar membaca concern persistence lewat owner repository.
3. Biarkan helper `lib/wifi.js` hanya sebagai adapter integrasi/device operation.

Verify:
- contract test repository WiFi lulus
- regression handler WiFi yang disentuh lulus

### Task 3 - Payment/Topup Normalization
Goal: pisahkan request/pending/proof persistence dari helper payment campuran.

Steps:
1. Identifikasi source of truth request/proof/pending yang masih di helper `lib/*`.
2. Pindahkan concern persistence ke repository owner yang jelas.
3. Ubah handler/service payment-topup prioritas agar memakai repository/service owner.

Verify:
- repository/service boundary tests lulus
- regression handler topup/payment lulus

### Task 4 - Admin/Network Ops Follow-Through
Goal: pastikan service ops membaca runtime/repository owner secara konsisten.

Steps:
1. Audit sisa helper `lib/*` yang masih dipanggil langsung oleh `admin-ops.service.js` atau `network-ops.service.js` untuk persistence concern.
2. Refactor service prioritas agar concern read/write memakai repository/runtime owner.
3. Pertahankan helper integrasi hanya sebagai adapter eksternal/util.

Verify:
- service boundary tests lulus
- route/service regression ops prioritas lulus

### Task 5 - Guardrails + Docs Sync
Goal: kunci boundary baru agar tidak bocor kembali.

Steps:
1. Tambahkan guardrail/source tests untuk forbidden direct helper access bila diperlukan.
2. Sync `SYSTEM_MAP.md`, `message/.module_map.md`, `message/handlers/.module_map.md`, atau map domain lain yang berubah ownership.

Verify:
- guardrail tests lulus
- docs sinkron dengan owner final

### Task 6 - Final Regression
Goal: pastikan wave 2 tidak memecah flow aktif.

Verify:
- repository contract tests domain yang disentuh
- service boundary tests domain yang disentuh
- regression handler/route aktif domain WiFi, payment/topup, dan ops

## Exit Criteria
- Domain WiFi/payment/ops yang disentuh punya owner repository/service lebih tegas.
- Consumer aktif prioritas berkurang ketergantungannya pada helper `lib/*` campuran.
- Helper lama tersisa sebagai adapter/integration surface, bukan owner persistence.
- Docs dan guardrail sinkron dengan boundary baru.
