# Header Doc
- Purpose: Tech Spec untuk normalisasi domain API voucher agar `routes/api-voucher-routes.js` menjadi adapter tipis dan ownership service/repository jelas.
- Caller: Agent/developer yang menjalankan fase `api-voucher-normalization`.
- Deps: `SYSTEM_MAP.md`, `routes/.module_map.md`, `routes/api-voucher-routes.js`, future `services/api-voucher.service.js`, future `repositories/api-voucher.repository.js`.
- MainFuncs: Menetapkan target boundary, scope slice, guardrail, risiko, dan success criteria.
- SideEffects: Tidak ada; dokumen statis.

# API Voucher Normalization

## Tujuan
Menormalkan `routes/api-voucher-routes.js` agar:
- route menjadi adapter HTTP tipis,
- generate/send voucher flow pindah ke service owner,
- history persistence pindah ke repository owner,
- helper file/PHP/WA turun menjadi adapter.

## Problem Saat Ini
- Route masih memegang fallback file `voucher.json`.
- Route masih mengorkestrasi PHP generation via `axios`.
- Route masih menulis/membaca history lewat helper `loadVoucherSentHistory` dan `appendVoucherSentHistory`.
- Route masih memegang delivery orchestration WA.

## Target Architecture
- `routes/api-voucher-routes.js`
  - adapter HTTP tipis
  - auth/validation ringan
  - delegasi ke service
- `services/api-voucher.service.js`
  - owner orchestration generate/send voucher
  - owner fallback business rule untuk response API voucher
- `repositories/api-voucher.repository.js`
  - owner voucher history read/write
  - owner fallback catalog/read-model yang masih perlu dari file JSON
- Helper existing
  - `axios`/PHP generation tetap adapter
  - delivery WA tetap adapter
  - file fallback tetap compatibility source via repository

## Scope
Fase ini fokus ke:
- voucher generation request aktif,
- voucher send history read/write,
- delivery orchestration aktif,
- route boundary tightening.

Belum masuk:
- redesign inventory voucher admin,
- migrasi storage besar,
- perubahan contract publik API voucher.

## Hard Rules
- Jangan ubah response API publik tanpa alasan kuat.
- Jangan bikin dual owner untuk voucher history.
- Route tidak boleh lagi memegang persistence history setelah slice aktif dipindah.
- WA delivery harus tetap lewat boundary delivery terpusat.

## Implementation Slices
1. Inventory concern `api-voucher-routes.js`.
2. Skeleton `api-voucher.service.js` + `api-voucher.repository.js`.
3. Pindah history persistence ke repository owner.
4. Pindah generate/send orchestration ke service owner.
5. Tighten route boundary dan sync docs.

## Testing Strategy
- Repository contract test untuk voucher history owner.
- Service boundary test untuk generate/send flow.
- Route baseline/boundary test untuk `api-voucher-routes.js`.
- Regression focused untuk endpoint voucher aktif.

## Risiko
- Helper PHP generation bisa memegang side effect implisit.
- History fallback file dan route bisa overlap saat migrasi setengah jalan.
- Delivery voucher massal sensitif terhadap urutan side effect.

## Mitigasi
- Mulai dari inventory ownership.
- Pindahkan history lebih dulu sebelum orchestration penuh.
- Tambah guardrail source test per slice.

## Success Criteria
- `routes/api-voucher-routes.js` lebih tipis.
- Voucher history punya owner repository jelas.
- Generate/send flow punya owner service jelas.
- Helper file/PHP/WA turun jadi adapter, bukan owner bisnis/persistence.
