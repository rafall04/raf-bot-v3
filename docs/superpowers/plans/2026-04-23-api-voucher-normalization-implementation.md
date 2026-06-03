# Header Doc
- Purpose: Rencana implementasi bertahap untuk normalisasi domain API voucher.
- Caller: Agent/developer yang mengeksekusi fase `api-voucher-normalization`.
- Deps: Spec `2026-04-23-api-voucher-normalization-design.md`, `routes/api-voucher-routes.js`, future service/repository voucher files.
- MainFuncs: Memecah pekerjaan menjadi slice kecil dengan checkpoint verifikasi.
- SideEffects: Tidak ada; dokumen statis.

# Implementation Slices

1. Task 1: inventory ownership `api-voucher-routes.js`
- Tujuan: mengunci baseline helper-first concern aktif.
- Output:
  - focused baseline test untuk route voucher
  - daftar concern route: file fallback, PHP generation, history persistence, WA delivery
- Verifikasi:
  - `npm test -- routes/__tests__/api-domain-ownership-baseline.test.js`

2. Task 2: skeleton owner voucher API
- Tujuan: membuat contract awal service/repository owner.
- Output:
  - `services/api-voucher.service.js`
  - `repositories/api-voucher.repository.js`
  - Header Doc dan stub method
- Verifikasi:
  - `node -e "require('./services/api-voucher.service'); require('./repositories/api-voucher.repository'); console.log('ok')"`

3. Task 3: repository-first voucher history
- Tujuan: memindahkan voucher history read/write ke repository owner.
- Output:
  - repository contract tests
  - route/service tidak lagi memegang append/load history langsung
- Verifikasi:
  - `npm test -- repositories/__tests__/api-voucher.repository.contract.test.js`

4. Task 4: service-first generate/send orchestration
- Tujuan: memindahkan generate/send flow aktif ke service owner.
- Output:
  - service boundary tests
  - route voucher delegate ke service
- Verifikasi:
  - `npm test -- services/__tests__/api-voucher.service.test.js`

5. Task 5: route guardrail + doc sync final
- Tujuan: mengunci boundary voucher API dan sinkronkan map docs.
- Output:
  - baseline/source guardrail update
  - `SYSTEM_MAP.md` dan `routes/.module_map.md` sinkron
- Verifikasi:
  - `npm test -- routes/__tests__/api-domain-ownership-baseline.test.js repositories/__tests__/api-voucher.repository.contract.test.js services/__tests__/api-voucher.service.test.js`
