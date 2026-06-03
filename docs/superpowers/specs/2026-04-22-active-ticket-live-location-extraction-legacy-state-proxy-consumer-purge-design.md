# Active Ticket Live-Location Extraction + Legacy State Proxy Consumer Purge

> Status: APPROVED

## Goal
Menutup dua hotspot tersisa di layer bot:
- branch `active ticket live-location` yang masih hidup di `message/raf.js`,
- consumer aktif yang masih memicu `legacyStateProxyRead/Write`.

## Problem
- `message/raf.js` masih menangani update lokasi tiket aktif non-state.
- Compatibility proxy state masih dipakai oleh sebagian consumer aktif, terlihat dari warning `legacyStateProxy*`.
- Selama dua jalur ini masih hidup, router belum final-tipis dan debugging state tetap mahal.

## Target Architecture
- `message/raf.js`
  - build context
  - run interceptors
  - route conversation state
  - dispatch intent
  - tidak meng-own flow lokasi teknisi
- `message/handlers/simple-location-handler.js` atau owner helper terkait
  - owner active-ticket live-location update
- `message/handlers/state-domains/teknisi.state.js`
  - owner state lokasi/perjalanan teknisi
- `message/handlers/conversation-handler.js`
  - compatibility proxy tetap ada sementara, tapi consumer aktif prioritas dipindah ke state boundary native

## Hard Rules
- `message/raf.js` dilarang memiliki representative active-ticket live-location branch.
- Consumer aktif prioritas yang disentuh tidak boleh lagi membaca/menulis lewat proxy legacy.
- Proxy compatibility tidak boleh jadi owner flow baru.
- Guardrail source tests wajib menahan branch router dan proxy usage yang dilarang.

## Implementation Slices
1. Baseline guardrail untuk branch live-location di router dan consumer proxy prioritas.
2. Pindahkan active-ticket live-location ke owner helper/domain yang tepat.
3. Audit consumer aktif yang memicu `legacyStateProxy*`.
4. Purge consumer prioritas ke `getUserState/setUserState` atau owner state/domain yang benar.
5. Tighten tests dan sinkronkan docs.

## Verification
- `message/__tests__/conversation-state-boundary.test.js`
- `message/__tests__/teknisi-state-owner.test.js`
- `message/__tests__/bot-hardening.test.js`
- `message/__tests__/conversation-state-router.test.js`
- test baru untuk proxy consumer bila diperlukan

## Success Criteria
- `message/raf.js` tidak lagi menangani active-ticket live-location.
- flow lokasi punya owner tunggal yang dapat ditrace.
- consumer aktif prioritas tidak lagi memicu `legacyStateProxy*` pada jalur yang disentuh.
- router bot dan state boundary makin deterministic.
