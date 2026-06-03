# Message Raf Final Slimming + Location Flow Ownership Extraction

> Status: APPROVED

## Goal
Menjadikan `message/raf.js` sebagai composition router yang lebih final dengan menghapus dead fallback `false && ...` serta memindahkan ownership flow lokasi teknisi/customer journey ke owner state/domain yang jelas.

## Problem
- `message/raf.js` masih menyimpan dead branch hasil stabilisasi bertahap.
- Flow lokasi `AWAITING_LOCATION_FOR_JOURNEY` dan active-ticket live location masih ditangani langsung di router.
- Dead code dan dependency sisa membuat boundary router belum final-clean.

## Target Architecture
- `message/raf.js`
  - build bot context
  - run interceptors
  - route conversation state
  - dispatch intent
- `message/handlers/state-domains/teknisi.state.js`
  - owner step lokasi/state teknisi yang masih aktif
- `message/handlers/teknisi-workflow-handler.js`
  - tetap owner orchestration teknisi existing yang dipanggil state owner

## Hard Rules
- `message/raf.js` dilarang menyimpan dead fallback `false && ...`.
- `message/raf.js` dilarang meng-own representative location state branch.
- State lokasi harus bisa ditrace ke owner domain/state yang tunggal.
- Guardrail test wajib menolak reintroduksi dead fallback dan location branch lama.

## Implementation Slices
1. Baseline source guardrail untuk dead fallback dan location branch representative.
2. Ekstraksi owner lokasi ke `teknisi.state.js` atau owner terkait yang sudah ada.
3. Purge dead fallback dan location branch dari `message/raf.js`.
4. Rapikan import/dependency yang sudah tidak dipakai.
5. Sinkronkan `SYSTEM_MAP.md`, `message/.module_map.md`, dan `message/handlers/.module_map.md`.

## Verification
- `message/__tests__/conversation-state-boundary.test.js`
- `message/__tests__/teknisi-state-owner.test.js`
- `message/__tests__/conversation-state-router.test.js`
- `message/__tests__/bot-hardening.test.js`
- `message/__tests__/raf-router-boundary.test.js`

## Success Criteria
- `message/raf.js` tidak lagi punya dead fallback.
- Flow lokasi tidak lagi di-own router utama.
- Owner state teknisi/location jelas dan diuji.
- Router bot makin tipis dan deterministic.
