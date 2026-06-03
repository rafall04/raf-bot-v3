# Header Doc
- Purpose: Rencana implementasi bertahap untuk normalisasi domain API network.
- Caller: Agent/developer yang mengeksekusi fase `api-network-normalization`.
- Deps: Spec `2026-04-23-api-network-normalization-design.md`, `routes/api-network-routes.js`, future service/repository network files.
- MainFuncs: Memecah pekerjaan menjadi slice kecil dengan checkpoint verifikasi.
- SideEffects: Tidak ada; dokumen statis.

# Implementation Slices

1. Task 1: inventory ownership `api-network-routes.js`
- Tujuan: mengunci baseline helper-first concern aktif.
- Output:
  - focused baseline test untuk route network
  - daftar concern route: WA/runtime action, MikroTik orchestration, import/read-model
- Verifikasi:
  - `npm test -- routes/__tests__/api-domain-ownership-baseline.test.js`

2. Task 2: skeleton owner network API
- Tujuan: membuat contract awal service/repository owner.
- Output:
  - `services/api-network.service.js`
  - `repositories/api-network.repository.js`
  - Header Doc dan stub method
- Verifikasi:
  - `node -e "require('./services/api-network.service'); require('./repositories/api-network.repository'); console.log('ok')"`

3. Task 3: repository-first network read-model/import
- Tujuan: memindahkan read-model/import concern ke repository owner.
- Output:
  - repository contract tests
  - route/service tidak lagi memegang read-model/import helper langsung
- Verifikasi:
  - `npm test -- repositories/__tests__/api-network.repository.contract.test.js`

4. Task 4: service-first network orchestration
- Tujuan: memindahkan flow update/network action aktif ke service owner.
- Output:
  - service boundary tests
  - route network delegate ke service
- Verifikasi:
  - `npm test -- services/__tests__/api-network.service.test.js`

5. Task 5: route guardrail + doc sync final
- Tujuan: mengunci boundary network API dan sinkronkan map docs.
- Output:
  - baseline/source guardrail update
  - `SYSTEM_MAP.md` dan `routes/.module_map.md` sinkron
- Verifikasi:
  - `npm test -- routes/__tests__/api-domain-ownership-baseline.test.js repositories/__tests__/api-network.repository.contract.test.js services/__tests__/api-network.service.test.js`
