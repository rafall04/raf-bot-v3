# Header Doc
- Purpose: Checklist final sebelum menjalankan aplikasi di server setelah smoke-core lokal lulus.
- Caller: Pengembang/operator sebelum deploy atau restart runtime produksi.
- Deps: `docs/testing/local-full-system-smoke-checklist.md`, `docs/testing/local-full-system-smoke-results-2026-04-24.md`, `docs/testing/deploy-hardening-observability-inventory-2026-04-24.md`, `lib/env-config.js`.
- MainFuncs: Mendefinisikan urutan verifikasi pre-deploy, policy known warnings, command smoke replay, dan exit criteria operasional.
- SideEffects: Tidak ada; dokumentasi statis. Command yang dirujuk dapat menjalankan test lokal bila dieksekusi operator.

# PRE-DEPLOY VERIFICATION CHECKLIST

## 1. Environment Gate
- `NODE_ENV` produksi harus bernilai `production` atau tidak diset.
- `NODE_ENV=test` hanya untuk Jest/smoke lokal.
- `ENV_CONFIG_VERBOSE_BOOT=1` hanya dipakai saat debugging bootstrap environment.
- `config.json` harus tersedia sebelum startup produksi.
- Folder `database/` harus tersedia dan writable oleh proses Node.js.

## 2. Module Load Gate
```powershell
node -e "require('./routes/api-psb-routes'); require('./services/api-psb.service'); require('./repositories/api-psb.repository'); console.log('ok')"
```

Expected:
- output `ok`
- exit code `0`

## 3. Smoke-Core Gate
```powershell
npm test -- lib/__tests__/whatsapp-gateway.test.js lib/__tests__/whatsapp-bootstrap.test.js lib/__tests__/whatsapp-inbound-adapter.contract.test.js message/__tests__/bot-hardening.test.js message/__tests__/conversation-state-boundary.test.js message/__tests__/raf-router-boundary.test.js lib/__tests__/runtime-contract.test.js routes/__tests__/runtime-wiring.test.js services/__tests__/admin-ops.service.runtime-boundary.test.js services/__tests__/network-ops.service.runtime-boundary.test.js services/__tests__/wifi-management.service.test.js repositories/__tests__/wifi.repository.contract.test.js services/__tests__/payment-flow.service.test.js repositories/__tests__/payment.repository.contract.test.js services/__tests__/api-users.service.test.js repositories/__tests__/api-users.repository.contract.test.js services/__tests__/api-voucher.service.test.js repositories/__tests__/api-voucher.repository.contract.test.js services/__tests__/api-network.service.test.js repositories/__tests__/api-network.repository.contract.test.js services/__tests__/api-psb.service.test.js repositories/__tests__/api-psb.repository.contract.test.js
```

Expected:
- `22` suite pass
- `59` test pass
- `0` fail

## 4. Known Warnings Policy

Allowed during local smoke:
- `baseline-browser-mapping`
  - dependency/tooling warning, not application runtime.
- `legacyStateProxyRead` / `legacyStateProxyWrite`
  - compatibility surface test only.

Allowed only in explicit failure-path tests:
- `[WIFI_LOGGING] Could not get current WiFi info for logging`
- `[WIFI_LOGGING] Failed to write WiFi change log`

Not expected after Task 2 cleanup:
- `[ENV] test mode - using test database`
- `[WIFI_LOGGING] { logged: false, skipReason: 'test' }`

## 5. Production Startup Checks
- Startup should not print `[ENV] test mode - using test database`.
- Startup should not print compatibility proxy warnings unless a legacy compatibility path is being exercised manually.
- WhatsApp readiness should be read through `lib/whatsapp-gateway.js`.
- HTTP routes should load through `lib/routes-registry.js`.
- Payment status final write remains owned by `lib/payment-finance-service.js`.

## 6. Exit Criteria
- Module load gate passes.
- Smoke-core gate passes.
- No unexpected warning outside the known warnings policy.
- No new direct owner drift in routes/bot router/domain service boundaries.

## Current Baseline
- Last smoke-core baseline:
  - [C:\project\raf-bot-v2\docs\testing\local-full-system-smoke-results-2026-04-24.md](/C:/project/raf-bot-v2/docs/testing/local-full-system-smoke-results-2026-04-24.md)
- Observability inventory:
  - [C:\project\raf-bot-v2\docs\testing\deploy-hardening-observability-inventory-2026-04-24.md](/C:/project/raf-bot-v2/docs/testing/deploy-hardening-observability-inventory-2026-04-24.md)
