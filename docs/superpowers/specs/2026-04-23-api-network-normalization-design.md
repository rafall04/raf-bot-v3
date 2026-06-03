# Header Doc
- Purpose: Tech Spec untuk normalisasi domain API network agar `routes/api-network-routes.js` menjadi adapter tipis dan ownership service/repository jelas.
- Caller: Agent/developer yang menjalankan fase `api-network-normalization`.
- Deps: `SYSTEM_MAP.md`, `routes/.module_map.md`, `routes/api-network-routes.js`, future `services/api-network.service.js`, future `repositories/api-network.repository.js`.
- MainFuncs: Menetapkan target boundary, scope slice, guardrail, risiko, dan success criteria.
- SideEffects: Tidak ada; dokumen statis.

# API Network Normalization

## Tujuan
Menormalkan `routes/api-network-routes.js` agar:
- route menjadi adapter HTTP tipis,
- orchestration jaringan/MikroTik pindah ke service owner,
- read-model/import/history concern pindah ke repository owner,
- helper WA/runtime/network turun menjadi adapter.

## Problem Saat Ini
- Route masih memegang direct WA/runtime action seperti `getSocket()` dan `sendMessage(...)`.
- Route masih mengorkestrasi mutasi jaringan seperti `updatePPPoEProfile(...)`.
- Route masih memegang read-model/import concern seperti `getAllPPPoESecrets(...)` dan `getDevicesForImport(...)`.
- Ownership customer/device lookup dan handoff notifikasi belum setegas domain API lain yang sudah dinormalkan.

## Target Architecture
- `routes/api-network-routes.js`
  - adapter HTTP tipis
  - auth/validation ringan
  - delegasi ke service
- `services/api-network.service.js`
  - owner orchestration update profile jaringan
  - owner orchestration import/read-model device aktif
  - owner handoff notifikasi network API
- `repositories/api-network.repository.js`
  - owner read-model/persistence/import concern domain API network
  - owner snapshot customer/device/import yang masih perlu
- Helper existing
  - helper MikroTik tetap adapter
  - delivery WA tetap adapter
  - runtime lookup tetap dependency injection, bukan logic route

## Scope
Fase ini fokus ke:
- flow update PPPoE/profile yang aktif di API network,
- flow import/read-model device/secrets,
- flow notifikasi WA yang terkait endpoint network aktif,
- route boundary tightening.

Belum masuk:
- redesign monitoring jaringan,
- rewrite semua helper MikroTik,
- perubahan contract publik API network.

## Hard Rules
- Jangan ubah response API publik tanpa alasan kuat.
- Route tidak boleh lagi memegang orchestration MikroTik aktif setelah slice dipindah.
- WA delivery harus tetap lewat boundary delivery terpusat, bukan socket raw di route.
- Jangan bikin dual owner antara service/repository baru dan helper lama.

## Implementation Slices
1. Inventory concern `api-network-routes.js`.
2. Skeleton `api-network.service.js` + `api-network.repository.js`.
3. Pindah read-model/import concern ke repository owner.
4. Pindah orchestration update/network action ke service owner.
5. Tighten route boundary dan sync docs.

## Testing Strategy
- Repository contract test untuk owner network read-model/import.
- Service boundary test untuk flow update/import/notifikasi.
- Route baseline/boundary test untuk `api-network-routes.js`.
- Regression focused untuk endpoint network aktif.

## Risiko
- Helper MikroTik/network bisa memegang side effect implisit yang tidak tampak dari route.
- Route dan service bisa overlap saat migrasi setengah jalan.
- Flow update profile/notifikasi sensitif terhadap urutan side effect.

## Mitigasi
- Mulai dari inventory ownership.
- Pindahkan read-model/import lebih dulu sebelum orchestration penuh.
- Tambah guardrail source test per slice.

## Success Criteria
- `routes/api-network-routes.js` lebih tipis.
- Orchestration jaringan aktif punya owner service jelas.
- Read-model/import/history concern punya owner repository jelas.
- Helper WA/runtime/network turun jadi adapter, bukan owner bisnis/persistence.
