# Header Doc
- Purpose: Inventaris suite terpilih untuk smoke pack lokal lintas boundary utama sebelum deploy-hardening.
- Caller: Pengembang/agent pada fase `local-full-system-smoke-preparation`.
- Deps: `SYSTEM_MAP.md`, `routes/.module_map.md`, `message/.module_map.md`, dan suite Jest yang sudah ada.
- MainFuncs: Mengelompokkan kandidat suite smoke per bounded context, menandai suite inti, dan mencatat pengecualian yang tidak masuk pack.
- SideEffects: Tidak ada; dokumentasi statis.

# LOCAL FULL-SYSTEM SMOKE INVENTORY

## Boundary Inti

### Bot / WA Boundary
- `lib/__tests__/whatsapp-gateway.test.js`
- `lib/__tests__/whatsapp-bootstrap.test.js`
- `lib/__tests__/whatsapp-inbound-adapter.contract.test.js`
- `lib/__tests__/wa-boundary-guardrails.test.js`
- `message/__tests__/raf-inbound-boundary.test.js`
- `message/__tests__/wa-outbound-owner.test.js`
- `message/__tests__/raf-router-boundary.test.js`

### Conversation / State
- `message/__tests__/bot-hardening.test.js`
- `message/__tests__/conversation-state-boundary.test.js`
- `message/__tests__/conversation-state-router.test.js`
- `message/__tests__/conversation-state-owner-map.test.js`
- `message/__tests__/conversation-handler-state-store.test.js`
- `message/__tests__/conversation-handler-compatibility-boundary.test.js`

### Runtime / Wiring
- `lib/__tests__/runtime-contract.test.js`
- `lib/__tests__/runtime-repositories.test.js`
- `lib/__tests__/app-runtime.test.js`
- `routes/__tests__/runtime-wiring.test.js`
- `routes/__tests__/routes-registry.test.js`

### Admin / Ops
- `services/__tests__/admin-ops.service.runtime-boundary.test.js`
- `services/__tests__/network-ops.service.runtime-boundary.test.js`
- `services/__tests__/admin-database-ops.service.runtime-boundary.test.js`
- `routes/__tests__/admin-ops-registrar-boundary.test.js`
- `routes/__tests__/admin-wifi-ops-registrar-boundary.test.js`
- `routes/__tests__/admin-registrar-boundaries.test.js`

### WiFi Domain
- `services/__tests__/wifi-management.service.test.js`
- `repositories/__tests__/wifi.repository.contract.test.js`
- `message/__tests__/wifi-management-handler-boundary.test.js`
- `message/__tests__/wifi-domain.test.js`

### Payment / Topup Domain
- `services/__tests__/payment-flow.service.test.js`
- `services/__tests__/payment-approval.service.runtime-boundary.test.js`
- `repositories/__tests__/payment.repository.contract.test.js`
- `message/__tests__/payment-processor-handler-boundary.test.js`
- `message/__tests__/topup-handler-boundary.test.js`
- `message/__tests__/payment-state-owner.test.js`

### API Users
- `services/__tests__/api-users.service.test.js`
- `repositories/__tests__/api-users.repository.contract.test.js`
- `routes/__tests__/api-domain-ownership-baseline.test.js`

### API Voucher
- `services/__tests__/api-voucher.service.test.js`
- `repositories/__tests__/api-voucher.repository.contract.test.js`
- `routes/__tests__/api-voucher-routes-boundary.test.js`

### API Network
- `services/__tests__/api-network.service.test.js`
- `repositories/__tests__/api-network.repository.contract.test.js`
- `routes/__tests__/api-network-routes-boundary.test.js`

### API PSB
- `services/__tests__/api-psb.service.test.js`
- `repositories/__tests__/api-psb.repository.contract.test.js`
- `routes/__tests__/api-psb-routes-boundary.test.js`

## Smoke-Core Candidate Pack
- `lib/__tests__/whatsapp-gateway.test.js`
- `lib/__tests__/whatsapp-bootstrap.test.js`
- `lib/__tests__/whatsapp-inbound-adapter.contract.test.js`
- `message/__tests__/bot-hardening.test.js`
- `message/__tests__/conversation-state-boundary.test.js`
- `message/__tests__/raf-router-boundary.test.js`
- `lib/__tests__/runtime-contract.test.js`
- `routes/__tests__/runtime-wiring.test.js`
- `services/__tests__/admin-ops.service.runtime-boundary.test.js`
- `services/__tests__/network-ops.service.runtime-boundary.test.js`
- `services/__tests__/wifi-management.service.test.js`
- `repositories/__tests__/wifi.repository.contract.test.js`
- `services/__tests__/payment-flow.service.test.js`
- `repositories/__tests__/payment.repository.contract.test.js`
- `services/__tests__/api-users.service.test.js`
- `repositories/__tests__/api-users.repository.contract.test.js`
- `services/__tests__/api-voucher.service.test.js`
- `repositories/__tests__/api-voucher.repository.contract.test.js`
- `services/__tests__/api-network.service.test.js`
- `repositories/__tests__/api-network.repository.contract.test.js`
- `services/__tests__/api-psb.service.test.js`
- `repositories/__tests__/api-psb.repository.contract.test.js`

## Deliberate Exclusions
- `message/__tests__/speed-payment-handler.test.js`
  - Pernah gagal di luar slice normalization aktif; tidak dipakai sebagai smoke-core sampai distabilkan.
- Suite legacy-heavy yang menutupi domain di luar boundary utama phase ini.
  - Tidak dibuang, hanya tidak masuk smoke-core karena sinyalnya terlalu lebar untuk pre-deploy pack awal.

## Exit Criteria Task 1
- Boundary utama sudah punya minimal satu suite kandidat.
- Smoke-core candidate pack sudah cukup kecil untuk dijalankan `--runInBand`.
- Suite yang diketahui noisy/flaky sudah dicatat sebagai exclusion eksplisit.
