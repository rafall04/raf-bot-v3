# Admin/Network Ops Cleanup + Repository Normalization Wave 3

## Pendekatan
- Fokus pada service aktif `admin-ops` dan `network-ops` yang masih semi-legacy.
- Pisahkan concern orchestration, persistence/cache, dan adapter device/integration.
- Terapkan extraction bertahap per concern aktif, bukan rewrite helper besar sekaligus.

## Tujuan
- Meratakan kualitas arsitektur setelah normalisasi WiFi dan payment/topup.
- Membuat service ops aktif lebih eksplisit dan lebih tipis.
- Menurunkan concern persistence/cache/history ke repository owner yang jelas.
- Menjadikan helper `lib/*` sebagai adapter/utilitas, bukan bucket business+persistence.

## Problem Saat Ini
- `services/admin-ops.service.js` dan `services/network-ops.service.js` masih berpotensi menanggung orchestration + persistence/cache concern campuran.
- Helper `lib/*` yang dipakai oleh service ops/network masih mungkin menjadi owner tersembunyi untuk delete utility, cleanup, history, atau lookup cache.
- Boundary route -> service -> repository belum semerata domain WiFi dan payment/topup.

## Scope Prioritas
1. `services/admin-ops.service.js`
2. `services/network-ops.service.js`
3. Helper `lib/*` yang menjadi dependency langsung dua service itu untuk:
   - cache lookup
   - persistence write
   - cleanup/delete utility
   - network mutation/history concern

## Target Architecture
- Route/admin registrar:
  - adapter HTTP tipis
  - middleware + `asyncHandler`
- Service ops/network:
  - owner orchestration/decision
- Repository ops/network:
  - owner persistence/cache/history
- `lib/*`:
  - adapter perangkat/integrasi/utilitas murni

## Hard Rules
- Jangan ubah semantics operasi admin/network.
- Jangan redesign payload publik.
- Jangan bikin dual ownership antara repository baru dan helper lama.
- Service tetap SRP:
  - orchestration/decision di service
  - persistence/cache di repository
  - device/integration di adapter

## Implementation Slices
1. Inventory ownership untuk `admin-ops` dan `network-ops`.
2. Bentuk/perkuat repository owner untuk concern persistence/cache/history yang masih bercampur.
3. Cleanup service agar memakai repository owner secara konsisten.
4. Perketat route/consumer guardrails.
5. Sync docs dan jalankan focused verification.

## Testing Strategy
- Service boundary tests untuk `admin-ops.service.js` dan `network-ops.service.js`.
- Repository contract tests untuk owner baru yang dibentuk.
- Route/admin focused regression bila caller HTTP ikut disentuh.
- Source guardrail untuk melarang helper persistence langsung dari service ops bila perlu.

## Risiko
- Helper `lib/*` ops/network bisa mengandung side effect yang tidak terlihat.
- Extraction terlalu tipis sehingga helper lama tetap menjadi owner nyata.
- Operasi admin destruktif sensitif terhadap urutan side effect.

## Mitigasi
- Audit concern dulu sebelum edit.
- Ekstrak per concern aktif, bukan per file besar sekaligus.
- Tambah guardrail focused sebelum purge logic lama.

## Success Criteria
- Service ops aktif lebih tipis dan eksplisit.
- Persistence/cache/history concern punya repository owner yang jelas.
- Helper `lib/*` turun menjadi adapter/utilitas.
- Route/admin/network boundary makin merata kualitasnya.
