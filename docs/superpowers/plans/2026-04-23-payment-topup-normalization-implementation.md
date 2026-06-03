# Payment/Topup Normalization Implementation Plan

> Based on spec: `docs/superpowers/specs/2026-04-23-payment-topup-normalization-design.md`

## Execution Rules
- Kerjakan per slice kecil dengan verifikasi di akhir tiap slice.
- Jangan ubah semantics user-facing payment flow.
- Jangan buat dual source of truth antara repository baru dan helper lama.
- Semua file yang disentuh wajib sinkron dengan Header Doc dan map docs.

## Implementation Slices

### Task 1 - Concern Inventory
Goal: petakan exact concern payment/topup yang masih helper-first.

Steps:
1. Audit `message/handlers/payment-processor-handler.js`.
2. Audit `message/handlers/topup-handler.js`.
3. Kelompokkan concern:
   - request creation
   - pending/proof lookup
   - voucher purchase linkage
   - approval handoff
4. Tambahkan baseline guardrail bila perlu.

Verify:
- ownership concern payment/topup jelas sebelum refactor

### Task 2 - Payment Repository Owner
Goal: bentuk repository owner untuk request/proof/pending concern.

Steps:
1. Buat `repositories/payment.repository.js` atau equivalent.
2. Bungkus read/write request/proof/pending di repository owner.
3. Jika helper lama masih dipakai, posisikan sebagai adapter transisional.

Verify:
- repository contract tests lulus
- repository tidak membuat source of truth baru yang bentrok

### Task 3 - Payment Flow Service
Goal: bentuk service owner untuk bot-side payment/topup orchestration.

Steps:
1. Buat `services/payment-flow.service.js` atau equivalent.
2. Pindahkan orchestration request creation dan lookup concern dari handler ke service.
3. Jaga handoff ke approval/ledger boundary tetap konsisten.

Verify:
- service boundary tests lulus
- approval boundary tidak terganggu

### Task 4 - Handler Refactor
Goal: jadikan `payment-processor-handler.js` dan `topup-handler.js` lebih tipis.

Steps:
1. Ubah handler agar memanggil service/repository owner.
2. Hapus direct helper persistence access yang tidak lagi perlu.
3. Pertahankan reply shaping dan channel-specific concern di layer handler.

Verify:
- regression tests handler payment/topup lulus
- source guardrail boundary lulus

### Task 5 - Guardrails + Docs Sync
Goal: kunci boundary payment/topup baru.

Steps:
1. Tambah guardrail source/boundary test bila perlu.
2. Sync `SYSTEM_MAP.md`, `message/.module_map.md`, `message/handlers/.module_map.md`, dan map lain yang berubah.

Verify:
- guardrail tests lulus
- docs sinkron dengan owner final

### Task 6 - Final Regression
Goal: pastikan normalisasi payment/topup tidak memecah flow aktif.

Verify:
- repository contract tests
- service boundary tests
- regression `topup-handler`, `payment-processor-handler`, dan payment state/domain yang terkait

## Exit Criteria
- handler payment/topup lebih tipis
- request/proof/pending concern punya owner repository jelas
- bot payment flow punya owner service jelas
- approval/ledger boundary tetap utuh
- docs dan guardrail sinkron dengan boundary baru
