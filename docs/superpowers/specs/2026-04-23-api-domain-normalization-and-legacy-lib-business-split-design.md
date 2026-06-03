# API Domain Normalization + Legacy Lib Business Split

## Pendekatan
- Audit `routes/api.js` dan `api-*.js` per domain aktif.
- Tetapkan owner domain per sub-router: route tipis, service owner, repository owner, helper `lib/*` sebagai adapter.
- Lakukan extraction bertahap per domain dengan blast radius tertinggi.

## Tujuan
- Menjadikan route API sebagai adapter HTTP tipis yang konsisten.
- Memindahkan business orchestration ke service owner.
- Memindahkan persistence/cache concern ke repository owner.
- Menurunkan helper `lib/*` menjadi adapter/integration/util murni.

## Problem Saat Ini
- `routes/api.js` dan sub-router `api-*.js` masih berpotensi helper-first untuk concern users/customer, voucher, network, dan provisioning.
- Sebagian domain API belum punya owner map setegas domain bot/admin.
- Helper `lib/*` masih dapat memegang business rule + persistence + cache mutation + side effect integrasi dalam satu jalur.

## Priority Domains
1. `routes/api-users-routes.js`
2. `routes/api-voucher-routes.js`
3. `routes/api-network-routes.js`
4. `routes/api-psb-routes.js`
5. `routes/api.js` sebagai komposer/agregator

## Target Architecture
- Route:
  - adapter HTTP tipis
  - auth/validation ringan
  - `asyncHandler`
- Service:
  - owner orchestration domain
- Repository:
  - owner persistence/cache/read-model
- `lib/*`:
  - adapter external system / utilitas murni

## Hard Rules
- Jangan ubah contract API publik tanpa alasan kuat.
- Jangan redesign behavior domain.
- Jangan bikin dual ownership antara repository baru dan helper lama.
- Jika helper lama tetap dipakai, posisikan sebagai adapter transisional di bawah service/repository owner.

## Implementation Slices
1. Inventory + owner map untuk `api.js` dan `api-*.js`.
2. Users/customer API normalization.
3. Voucher/network API normalization.
4. PSB/provisioning API normalization.
5. Guardrails + docs sync.

## Testing Strategy
- Route boundary tests untuk `api-*.js`.
- Service boundary tests untuk domain yang disentuh.
- Repository contract tests untuk owner baru/yang diperluas.
- Regression focused untuk route API prioritas.
- Source guardrail untuk melarang direct helper persistence dari route bila perlu.

## Risiko
- Helper `lib/*` domain API mungkin memegang side effect tersembunyi.
- Extraction terlalu tipis sehingga helper lama tetap menjadi owner nyata.
- Beberapa endpoint API dipakai banyak flow internal, jadi regression harus hati-hati.

## Mitigasi
- Mulai dari inventory ownership.
- Ekstrak per domain aktif, bukan semua API sekaligus.
- Kunci guardrail tiap batch.

## Success Criteria
- `routes/api.js` dan sub-router lebih tipis dan konsisten.
- Owner domain API bisa ditrace jelas.
- Helper `lib/*` business-heavy berkurang dari jalur API aktif.
- Repository/service boundary makin merata lintas bot/admin/API.
