# Header Doc
- Purpose: Mencatat hasil aktual eksekusi smoke-core lokal pada 2026-04-24.
- Caller: Pengembang/agent saat menilai readiness sebelum deploy-hardening.
- Deps: `docs/testing/local-full-system-smoke-checklist.md` dan output suite Jest yang dijalankan.
- MainFuncs: Meringkas hasil per group, menandai regresi yang masih terbuka, dan memisahkan warning non-blocking.
- SideEffects: Tidak ada; dokumentasi statis.

# LOCAL FULL-SYSTEM SMOKE RESULTS 2026-04-24

## Module Load
- Command:
  - `node -e "require('./routes/api-psb-routes'); require('./services/api-psb.service'); require('./repositories/api-psb.repository'); console.log('ok')"`
- Result:
  - `PASS`

## Group Results

### 1. Bot / WA / State
- Command:
  - `npm test -- lib/__tests__/whatsapp-gateway.test.js lib/__tests__/whatsapp-bootstrap.test.js lib/__tests__/whatsapp-inbound-adapter.contract.test.js message/__tests__/bot-hardening.test.js message/__tests__/conversation-state-boundary.test.js message/__tests__/raf-router-boundary.test.js`
- Result:
  - `FAIL`
- Passing suites:
  - `lib/__tests__/whatsapp-gateway.test.js`
  - `lib/__tests__/whatsapp-bootstrap.test.js`
  - `lib/__tests__/whatsapp-inbound-adapter.contract.test.js`
  - `message/__tests__/conversation-state-boundary.test.js`
  - `message/__tests__/raf-router-boundary.test.js`
- Failing suite:
  - `message/__tests__/bot-hardening.test.js`
- Failure summary:
  - case `topup proof lookup uses canonical sender and does not crash on logger fields`
  - expected reply text `no pending`
  - actual reply text `❌ Gagal mengupload bukti transfer... Cannot read properties of undefined (reading 'filter')`
- Read:
  - regresi tampak terisolasi pada flow proof lookup/topup hardening, bukan boundary WA/router secara umum.

### 2. Runtime / Wiring
- Command:
  - `npm test -- lib/__tests__/runtime-contract.test.js routes/__tests__/runtime-wiring.test.js`
- Result:
  - `PASS`
- Summary:
  - `2` suite pass
  - `3` test pass

### 3. Admin / Ops
- Command:
  - `npm test -- services/__tests__/admin-ops.service.runtime-boundary.test.js services/__tests__/network-ops.service.runtime-boundary.test.js routes/__tests__/admin-ops-registrar-boundary.test.js routes/__tests__/admin-wifi-ops-registrar-boundary.test.js`
- Result:
  - `PASS`
- Summary:
  - `4` suite pass
  - `5` test pass

### 4. WiFi + Payment / Topup
- Command:
  - `npm test -- services/__tests__/wifi-management.service.test.js repositories/__tests__/wifi.repository.contract.test.js services/__tests__/payment-flow.service.test.js repositories/__tests__/payment.repository.contract.test.js`
- Result:
  - `PASS`
- Summary:
  - `4` suite pass
  - `6` test pass

### 5. API Domains
- Command:
  - `npm test -- services/__tests__/api-users.service.test.js repositories/__tests__/api-users.repository.contract.test.js services/__tests__/api-voucher.service.test.js repositories/__tests__/api-voucher.repository.contract.test.js services/__tests__/api-network.service.test.js repositories/__tests__/api-network.repository.contract.test.js services/__tests__/api-psb.service.test.js repositories/__tests__/api-psb.repository.contract.test.js`
- Result:
  - `PASS`
- Summary:
  - `8` suite pass
  - `31` test pass

## Aggregate
- Group status:
  - `4/5` groups pass
  - `1/5` groups fail
- Blocking issue:
  - `message/__tests__/bot-hardening.test.js` topup proof lookup regression

## Residual Non-Blocking Warnings
- `baseline-browser-mapping`
  - muncul di semua group smoke
- `[ENV] test mode - using test database`
  - muncul di group yang memuat repository/service tertentu
- `[legacyStateProxyRead]` dan `[legacyStateProxyWrite]`
  - muncul saat `message/__tests__/bot-hardening.test.js`
  - masih expected dari compatibility test surface
- `[WIFI_LOGGING] { logged: false, skipReason: 'test' }`
  - muncul di group `Admin / Ops`
  - expected dari failure-path/test logging

## Exit Status
- Smoke preparation:
  - `COMPLETE`
- Smoke-core execution:
  - `PARTIAL PASS`
- Next fix target:
  - stabilkan `message/__tests__/bot-hardening.test.js` untuk flow topup proof lookup sebelum menjalankan single-pass smoke-core pack penuh.

## Post-Fix Rerun

### Bot / WA / State
- Command:
  - `npm test -- lib/__tests__/whatsapp-gateway.test.js lib/__tests__/whatsapp-bootstrap.test.js lib/__tests__/whatsapp-inbound-adapter.contract.test.js message/__tests__/bot-hardening.test.js message/__tests__/conversation-state-boundary.test.js message/__tests__/raf-router-boundary.test.js`
- Result:
  - `PASS`
- Summary:
  - `6` suite pass
  - `16` test pass

### Single-Pass Smoke-Core Pack
- Module-load check:
  - `PASS`
- Command:
  - `npm test -- lib/__tests__/whatsapp-gateway.test.js lib/__tests__/whatsapp-bootstrap.test.js lib/__tests__/whatsapp-inbound-adapter.contract.test.js message/__tests__/bot-hardening.test.js message/__tests__/conversation-state-boundary.test.js message/__tests__/raf-router-boundary.test.js lib/__tests__/runtime-contract.test.js routes/__tests__/runtime-wiring.test.js services/__tests__/admin-ops.service.runtime-boundary.test.js services/__tests__/network-ops.service.runtime-boundary.test.js services/__tests__/wifi-management.service.test.js repositories/__tests__/wifi.repository.contract.test.js services/__tests__/payment-flow.service.test.js repositories/__tests__/payment.repository.contract.test.js services/__tests__/api-users.service.test.js repositories/__tests__/api-users.repository.contract.test.js services/__tests__/api-voucher.service.test.js repositories/__tests__/api-voucher.repository.contract.test.js services/__tests__/api-network.service.test.js repositories/__tests__/api-network.repository.contract.test.js services/__tests__/api-psb.service.test.js repositories/__tests__/api-psb.repository.contract.test.js`
- Result:
  - `PASS`
- Summary:
  - `22` suite pass
  - `59` test pass
  - `0` fail

## Final Aggregate
- Group status:
  - `5/5` groups pass
- Single-pass smoke-core:
  - `PASS`
- Blocking issue:
  - `NONE`

## Final Residual Non-Blocking Warnings
- `baseline-browser-mapping`
  - masih muncul pada smoke-core penuh
- `[legacyStateProxyRead]` dan `[legacyStateProxyWrite]`
  - masih muncul pada compatibility surface test di `message/__tests__/bot-hardening.test.js`
- `[WIFI_LOGGING]` failure-path warning/error
  - hanya muncul pada skenario logging runtime yang memang gagal; skip-path `test` sudah silent

## Final Exit Status
- Smoke preparation:
  - `COMPLETE`
- Smoke-core execution:
  - `PASS`
- Next phase:
  - lanjut ke deploy-hardening / observability cleanup final.

## Deploy-Hardening Rerun
- Module-load check:
  - `PASS`
- Focused observability tests:
  - `npm test -- lib/__tests__/env-config.test.js services/__tests__/network-ops.service.runtime-boundary.test.js services/__tests__/network-ops.service.test.js`
  - `3` suite pass
  - `8` test pass
- Single-pass smoke-core:
  - `PASS`
  - `22` suite pass
  - `59` test pass
  - `0` fail
- Residual warnings after deploy-hardening cleanup:
  - `baseline-browser-mapping`
  - `legacyStateProxyRead/Write` from compatibility surface test
  - `[WIFI_LOGGING]` failure-path warning/error only in explicit failure-path tests
