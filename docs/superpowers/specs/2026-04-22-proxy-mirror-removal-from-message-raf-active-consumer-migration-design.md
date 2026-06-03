# Proxy Mirror Removal from `message/raf.js` + Active Consumer Migration

> Status: APPROVED

## Goal
Menghapus compatibility mirror state dari router utama:
- `temp = createScopedStateProxy('legacy-temp')`
- `global.teknisiStates = createScopedStateProxy('teknisi')`

dan memigrasikan consumer aktif prioritas yang masih bergantung pada mirror/proxy itu ke API state native.

## Problem
- `message/raf.js` masih membuat proxy compatibility saat bootstrap handler.
- `global.teknisiStates` masih diisi dari router utama.
- Consumer lama masih punya jalan pintas ke state global lama melalui mirror tersebut.
- Selama mirror ini ada, boundary router belum final dan hidden dependency state tetap hidup.

## Target Architecture
- `message/raf.js`
  - tidak lagi membuat scoped proxy compatibility
  - hanya memanggil helper/context/state owner
- `message/handlers/raf-context.js`
  - hanya memegang inisialisasi transisional minimum bila benar-benar masih dibutuhkan
- `message/handlers/conversation-handler.js`
  - owner API state:
    - `getUserState`
    - `setUserState`
    - `getScopedState`
    - `setScopedState`
- consumer aktif
  - memakai owner state API langsung
  - bukan `global.teknisiStates` atau bucket proxy dari router

## Hard Rules
- `message/raf.js` dilarang memanggil `createScopedStateProxy(...)`.
- `message/raf.js` dilarang mengisi `global.teknisiStates`.
- Consumer aktif prioritas yang disentuh harus memakai API state owner langsung.
- Guardrail source tests wajib menolak mirror compatibility kembali ke router utama.

## Implementation Slices
1. Baseline source guard untuk mirror compatibility di `message/raf.js`.
2. Audit consumer aktif dari `legacy-temp`, `global.teknisiStates`, dan `createScopedStateProxy('teknisi')`.
3. Migrasikan consumer aktif prioritas ke API state native.
4. Hapus mirror creation dari `message/raf.js`.
5. Tighten tests dan sinkronkan docs.

## Verification
- `message/__tests__/conversation-state-boundary.test.js`
- `message/__tests__/raf-router-boundary.test.js`
- `message/__tests__/bot-hardening.test.js`
- test consumer-specific yang disentuh

## Success Criteria
- `message/raf.js` tidak lagi membuat proxy mirror.
- `message/raf.js` tidak lagi mengisi `global.teknisiStates`.
- Consumer aktif prioritas memakai owner state API langsung.
- Router bot makin dekat ke bentuk final tipis dan deterministic.
