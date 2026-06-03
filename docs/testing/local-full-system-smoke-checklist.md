# Header Doc
- Purpose: Menyediakan command pack smoke-core lokal yang repeatable untuk verifikasi lintas boundary utama.
- Caller: Pengembang/agent pada fase `local-full-system-smoke-preparation` sebelum deploy-hardening.
- Deps: `docs/testing/local-full-system-smoke-inventory.md`, suite Jest boundary utama, dan runtime Node lokal.
- MainFuncs: Mendefinisikan perintah smoke-core, pembagian per group, urutan eksekusi, dan interpretasi hasil non-blocking.
- SideEffects: Menjalankan suite Jest lokal dan pembacaan module load melalui `node -e`.

# LOCAL FULL-SYSTEM SMOKE CHECKLIST

## Smoke-Core Module Load
```powershell
node -e "require('./routes/api-psb-routes'); require('./services/api-psb.service'); require('./repositories/api-psb.repository'); console.log('ok')"
```

## Smoke-Core Grouped Commands

### 1. Bot / WA / State
```powershell
npm test -- lib/__tests__/whatsapp-gateway.test.js lib/__tests__/whatsapp-bootstrap.test.js lib/__tests__/whatsapp-inbound-adapter.contract.test.js message/__tests__/bot-hardening.test.js message/__tests__/conversation-state-boundary.test.js message/__tests__/raf-router-boundary.test.js
```

### 2. Runtime / Wiring
```powershell
npm test -- lib/__tests__/runtime-contract.test.js routes/__tests__/runtime-wiring.test.js
```

### 3. Admin / Ops
```powershell
npm test -- services/__tests__/admin-ops.service.runtime-boundary.test.js services/__tests__/network-ops.service.runtime-boundary.test.js routes/__tests__/admin-ops-registrar-boundary.test.js routes/__tests__/admin-wifi-ops-registrar-boundary.test.js
```

### 4. WiFi + Payment / Topup
```powershell
npm test -- services/__tests__/wifi-management.service.test.js repositories/__tests__/wifi.repository.contract.test.js services/__tests__/payment-flow.service.test.js repositories/__tests__/payment.repository.contract.test.js
```

### 5. API Domains
```powershell
npm test -- services/__tests__/api-users.service.test.js repositories/__tests__/api-users.repository.contract.test.js services/__tests__/api-voucher.service.test.js repositories/__tests__/api-voucher.repository.contract.test.js services/__tests__/api-network.service.test.js repositories/__tests__/api-network.repository.contract.test.js services/__tests__/api-psb.service.test.js repositories/__tests__/api-psb.repository.contract.test.js
```

## Single-Pass Smoke-Core Pack
```powershell
npm test -- lib/__tests__/whatsapp-gateway.test.js lib/__tests__/whatsapp-bootstrap.test.js lib/__tests__/whatsapp-inbound-adapter.contract.test.js message/__tests__/bot-hardening.test.js message/__tests__/conversation-state-boundary.test.js message/__tests__/raf-router-boundary.test.js lib/__tests__/runtime-contract.test.js routes/__tests__/runtime-wiring.test.js services/__tests__/admin-ops.service.runtime-boundary.test.js services/__tests__/network-ops.service.runtime-boundary.test.js services/__tests__/wifi-management.service.test.js repositories/__tests__/wifi.repository.contract.test.js services/__tests__/payment-flow.service.test.js repositories/__tests__/payment.repository.contract.test.js services/__tests__/api-users.service.test.js repositories/__tests__/api-users.repository.contract.test.js services/__tests__/api-voucher.service.test.js repositories/__tests__/api-voucher.repository.contract.test.js services/__tests__/api-network.service.test.js repositories/__tests__/api-network.repository.contract.test.js services/__tests__/api-psb.service.test.js repositories/__tests__/api-psb.repository.contract.test.js
```

## Exit Criteria
- Semua command di atas lulus tanpa suite fail.
- `node -e` module-load check mengembalikan `ok`.
- Warning `baseline-browser-mapping` boleh tercatat sebagai non-blocking.
- Warning `ENV test database` tidak diharapkan muncul default setelah deploy-hardening Task 2.
- Warning `legacyStateProxyRead/Write` hanya boleh muncul dari compatibility test surface.
- Suite exclusion seperti `message/__tests__/speed-payment-handler.test.js` tetap di luar smoke-core sampai distabilkan terpisah.

## Reading Results
- Jika group `Bot / WA / State` gagal:
  - fokus ke boundary WA facade, router bot, atau state authority.
- Jika group `Runtime / Wiring` gagal:
  - fokus ke runtime app, route registry, atau dependency mount order.
- Jika group `Admin / Ops` gagal:
  - fokus ke route registrar/service owner drift.
- Jika group `WiFi + Payment / Topup` gagal:
  - fokus ke handler tipis vs service/repository owner drift.
- Jika group `API Domains` gagal:
  - fokus ke domain normalization yang regresi pada users/voucher/network/psb.
