# Payment/Topup Normalization

> Status: APPROVED

## Goal
Menormalkan domain payment/topup agar:
- handler bot tidak lagi terlalu bergantung pada helper `lib/*` campuran,
- request/proof/pending concern punya owner repository yang jelas,
- approval/status flow tetap konsisten dengan source of truth ledger,
- flow voucher/topup aktif lebih mudah dirawat.

## Problem
- `message/handlers/payment-processor-handler.js` masih helper-first untuk QRIS/topup/voucher purchase orchestration.
- `message/handlers/topup-handler.js` masih langsung bergantung pada `lib/saldo-manager`.
- `services/payment-approval.service.js` sudah lebih sehat, tapi jalur bot dan approval belum sepenuhnya repo-first pada concern request/proof.
- Source concern masih campur antara payment request JSON, topup request/proof, saldo user, voucher purchase state, dan ledger/payment status.

## Target Architecture
- `message/handlers/payment-processor-handler.js`
  - adapter bot untuk create payment/topup/voucher purchase flow

- `message/handlers/topup-handler.js`
  - adapter bot untuk upload proof dan notifikasi admin

- `services/payment-flow.service.js`
  - owner orchestration bot-side untuk create request, validate flow, dan route ke repository/payment adapter

- `repositories/payment.repository.js`
  - owner persistence request/proof/pending concern
  - bridge ke helper lama bila perlu selama transisi

- `repositories/saldo.repository.js`
  - tetap owner saldo user

- `repositories/voucher.repository.js`
  - tetap owner katalog/profil voucher

- `services/payment-approval.service.js`
  - tetap owner approval/status write dan ledger transition

- `lib/payment-finance-service.js`
  - tetap source of truth payment status final berbasis ledger

- `lib/saldo-manager`, `lib/payment`, helper payment lain
  - turun menjadi adapter/compatibility surface, bukan owner persistence aktif baru

## Scope
Fokus pada concern aktif:
- create topup/payment request dari bot
- upload proof topup
- lookup pending request/proof
- voucher purchase flow yang terkait request/payment
- kesinambungan ke approval service yang sudah ada

## Hard Rules
- Jangan ubah semantics user-facing payment flow.
- Jangan buat dual source of truth antara repository baru dan helper lama.
- Semua write status final tetap tunduk pada ledger/payment approval boundary yang sudah ada.
- Handler bot harus makin tipis, bukan sekadar memindahkan kode acak.

## Implementation Slices
1. Inventory exact concern payment/topup: request creation, pending lookup, proof upload, voucher purchase linkage.
2. Bentuk repository owner untuk request/proof concern.
3. Bentuk service owner untuk bot-side orchestration.
4. Refactor `payment-processor-handler.js` dan `topup-handler.js` ke service/repository owner.
5. Tambah guardrail dan sinkronkan docs.

## Verification
- repository contract test untuk payment/topup request owner
- service boundary test untuk bot payment flow
- regression test handler:
  - `topup-handler`
  - `payment-processor-handler`
  - state/payment owner test yang terkait
- source guardrail bila perlu untuk melarang direct `saldo-manager` atau helper persistence dari handler aktif

## Success Criteria
- handler payment/topup lebih tipis
- request/proof/pending concern punya owner repository jelas
- bot payment flow punya owner service jelas
- approval/ledger boundary tetap utuh
- domain payment/topup lebih siap untuk fitur berikutnya tanpa helper chaos
