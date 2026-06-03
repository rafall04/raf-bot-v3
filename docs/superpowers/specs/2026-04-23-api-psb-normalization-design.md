# Header Doc
- Purpose: Tech Spec untuk normalisasi domain API PSB agar `routes/api-psb-routes.js` menjadi adapter tipis dan ownership service/repository jelas.
- Caller: Agent/developer yang menjalankan fase `api-psb-normalization`.
- Deps: `SYSTEM_MAP.md`, `routes/.module_map.md`, `routes/api-psb-routes.js`, future `services/api-psb.service.js`, future `repositories/api-psb.repository.js`.
- MainFuncs: Menetapkan target boundary, scope slice, guardrail, risiko, dan success criteria.
- SideEffects: Tidak ada; dokumen statis.

# API PSB Normalization

## Tujuan
Menormalkan `routes/api-psb-routes.js` agar:
- route menjadi adapter HTTP tipis,
- persistence PSB pindah ke repository owner,
- provisioning/activation pindah ke service owner,
- upload filesystem dan notification turun menjadi adapter.

## Problem Saat Ini
- Route masih memegang upload filesystem seperti `multer.diskStorage`, `fs.mkdirSync`, dan `fs.renameSync`.
- Route masih memegang persistence PSB seperti `insertPSBRecord`, `updatePSBRecord`, dan `movePSBToUsers`.
- Route masih memegang provisioning seperti `addPPPoEUser` dan `checkPPPoEUserExists`.
- Route masih memegang notification/logging seperti `sendPSBPhase1Notification` dan `logWifiChange`.

## Target Architecture
- `routes/api-psb-routes.js`
  - adapter HTTP tipis
  - auth/validation ringan
  - delegasi ke service
- `services/api-psb.service.js`
  - owner orchestration PSB/provisioning API
  - owner activation/move-to-user flow
  - owner handoff notification/logging
- `repositories/api-psb.repository.js`
  - owner persistence/read-model PSB
  - owner bridge ke record PSB dan move-to-user concern
- Helper existing
  - upload filesystem tetap adapter
  - provisioning helper tetap adapter
  - WiFi log/notification tetap adapter terpusat

## Scope
Fase ini fokus ke:
- read/write record PSB aktif,
- move/import PSB ke users,
- provisioning availability + activation,
- route boundary tightening.

Belum masuk:
- redesign flow onboarding PSB penuh,
- migrasi storage besar,
- perubahan contract publik API PSB.

## Hard Rules
- Jangan ubah response API publik tanpa alasan kuat.
- Route tidak boleh lagi memegang persistence/provisioning langsung setelah slice dipindah.
- Upload filesystem tetap di boundary adapter, bukan business owner.
- Jangan bikin dual owner antara repository/service baru dan helper lama.

## Implementation Slices
1. Inventory concern `api-psb-routes.js`.
2. Skeleton `api-psb.service.js` + `api-psb.repository.js`.
3. Pindah persistence/read-model PSB ke repository owner.
4. Pindah provisioning/notification orchestration ke service owner.
5. Tighten route boundary dan sync docs.

## Testing Strategy
- Repository contract test untuk owner PSB.
- Service boundary test untuk flow provisioning/activation.
- Route baseline/boundary test untuk `api-psb-routes.js`.
- Regression focused untuk endpoint PSB aktif.

## Risiko
- Helper provisioning bisa memegang side effect implisit.
- Upload filesystem dan persistence PSB bisa overlap saat migrasi setengah jalan.
- Flow move-to-user sensitif terhadap urutan side effect provisioning/notifikasi.

## Mitigasi
- Mulai dari inventory ownership.
- Pindahkan persistence lebih dulu sebelum orchestration penuh.
- Tambah guardrail source test per slice.

## Success Criteria
- `routes/api-psb-routes.js` lebih tipis.
- Persistence/read-model PSB punya owner repository jelas.
- Provisioning/notifikasi punya owner service jelas.
- Helper upload/provisioning turun jadi adapter, bukan owner bisnis/persistence.
