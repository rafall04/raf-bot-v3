# Repository Normalization Wave 2 + Legacy Lib Business Split

> Status: APPROVED

## Goal
Melanjutkan fondasi arsitektur dengan merapikan domain aktif yang masih setengah repo-first dan masih terlalu bergantung pada helper `lib/*` campuran.

Target fase ini:
- consumer aktif lebih konsisten lewat repository owner,
- orchestration bisnis di helper `lib/*` mulai dipisah dari persistence,
- domain bot/HTTP jadi lebih presisi saat ditambah fitur.

## Problem
- Banyak handler/domain masih memanggil helper `lib/*` campuran melalui facade `domain-services.js`.
- Repository discipline belum merata untuk domain aktif seperti WiFi ops, payment/topup approval, dan sebagian admin/network ops.
- Helper `lib/*` masih sering mencampur:
  - business rule,
  - persistence,
  - cache lookup,
  - side effect integrasi.

## Priority Domains
1. **WiFi management**
   - `message/handlers/wifi-management-handler.js`
   - helper `lib/wifi.js`
   - log/history WiFi terkait

2. **Payment/topup**
   - `message/handlers/topup-handler.js`
   - `message/handlers/payment-processor-handler.js`
   - `services/payment-approval.service.js`
   - helper payment/topup di `lib/*`

3. **Admin/network ops follow-through**
   - `services/network-ops.service.js`
   - `services/admin-ops.service.js`
   - helper utilitas `lib/*` yang masih memegang operasi persistence campuran

## Target Architecture
- `handler/controller`
  - channel adapter saja
- `service`
  - business orchestration
- `repository`
  - persistence/cache owner
- `lib/*`
  - adapter/integration/util murni, bukan bucket business+persistence

## Hard Rules
- Jangan redesign perilaku fitur.
- Jangan migrasi storage fisik besar-besaran.
- Jangan pecah domain terlalu luas dalam satu batch.
- Setiap domain yang disentuh harus punya owner map jelas: handler/service, repository, helper adapter.

## Implementation Slices
1. Inventory + ownership map untuk domain WiFi, payment/topup, dan ops yang masih helper-first.
2. WiFi repository/service normalization untuk logging/history/persistence concern.
3. Payment/topup normalization untuk request/pending/proof persistence concern.
4. Admin/network ops cleanup agar service memakai repository/runtime owner konsisten.
5. Guardrails + docs sync.

## Verification
- repository contract tests per domain yang disentuh
- service boundary tests untuk memastikan consumer tidak lagi melompat ke helper persistence langsung
- regression tests pada handler bot/route yang memakai domain itu
- source guardrail bila perlu untuk forbidden direct helper access

## Success Criteria
- Domain wave 2 punya jalur owner yang lebih tegas.
- Consumer aktif berkurang nyata ketergantungannya pada helper `lib/*` campuran.
- Repository/service boundary makin merata.
- Fitur baru di domain WiFi/payment/ops jadi lebih murah ditambah dan direview.
