# Header Doc
- Purpose: Rencana implementasi bertahap untuk normalisasi domain API PSB.
- Caller: Agent/developer yang mengeksekusi fase `api-psb-normalization`.
- Deps: Spec `2026-04-23-api-psb-normalization-design.md`, `routes/api-psb-routes.js`, future service/repository PSB files.
- MainFuncs: Memecah pekerjaan menjadi slice kecil dengan checkpoint verifikasi.
- SideEffects: Tidak ada; dokumen statis.

# Implementation Slices

1. Task 1: inventory ownership `api-psb-routes.js`
- Tujuan: mengunci baseline helper-first concern aktif.
- Output:
  - focused baseline test untuk route PSB
  - daftar concern route: upload filesystem, persistence PSB, provisioning, notification/logging
- Verifikasi:
  - `npm test -- routes/__tests__/api-domain-ownership-baseline.test.js`

2. Task 2: skeleton owner PSB API
- Tujuan: membuat contract awal service/repository owner.
- Output:
  - `services/api-psb.service.js`
  - `repositories/api-psb.repository.js`
  - Header Doc dan stub method
- Verifikasi:
  - `node -e "require('./services/api-psb.service'); require('./repositories/api-psb.repository'); console.log('ok')"`

3. Task 3: repository-first PSB persistence
- Tujuan: memindahkan read/write PSB concern ke repository owner.
- Output:
  - repository contract tests
  - route/service tidak lagi memegang persistence helper langsung
- Verifikasi:
  - `npm test -- repositories/__tests__/api-psb.repository.contract.test.js`

4. Task 4: service-first provisioning orchestration
- Tujuan: memindahkan provisioning/notification flow aktif ke service owner.
- Output:
  - service boundary tests
  - route PSB delegate ke service
- Verifikasi:
  - `npm test -- services/__tests__/api-psb.service.test.js`

5. Task 5: route guardrail + doc sync final
- Tujuan: mengunci boundary PSB API dan sinkronkan map docs.
- Output:
  - baseline/source guardrail update
  - `SYSTEM_MAP.md` dan `routes/.module_map.md` sinkron
- Verifikasi:
  - `npm test -- routes/__tests__/api-domain-ownership-baseline.test.js repositories/__tests__/api-psb.repository.contract.test.js services/__tests__/api-psb.service.test.js`
