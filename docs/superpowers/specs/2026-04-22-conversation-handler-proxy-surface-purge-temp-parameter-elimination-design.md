# Conversation Handler Proxy Surface Purge + Temp Parameter Elimination

> Status: APPROVED

## Goal
Merapikan state layer bot agar:
- `createScopedStateProxy(...)` bukan lagi surface aktif utama,
- parameter `temp` yang sudah zombie di chain handler dihapus,
- state sub-handler bergantung pada kontrak state yang eksplisit.

## Problem
- `conversation-handler.js` masih mengekspor proxy compatibility yang dipakai test dan sebagian chain lama.
- `conversation-state-handler.js` masih meneruskan `temp` ke banyak sub-handler.
- Banyak sub-handler tampaknya tidak benar-benar memakai `temp`, hanya mewarisi signature lama.
- Ini membuat flow state terlihat lebih kompleks daripada perilaku nyata.

## Target Architecture
- `conversation-handler.js`
  - owner API eksplisit:
    - `getUserState`
    - `setUserState`
    - `deleteUserState`
    - `getScopedState`
    - `setScopedState`
    - `deleteScopedState`
  - proxy compatibility hanya tersisa sebagai adapter transisional kecil.

- `conversation-state-handler.js`
  - tidak lagi meneruskan `temp` ke sub-handler yang tidak membutuhkannya.
  - flow state berbasis `userState` + owner APIs.

- `message/handlers/states/*.js`
  - signature lebih ramping,
  - tidak menerima `temp` kecuali benar-benar dibutuhkan,
  - bergantung pada input eksplisit dan owner state API.

## Hard Rules
- Jangan ubah behavior user-facing flow.
- Jangan redesign state machine; fokus pada boundary/surface cleanup.
- Jangan hapus proxy compatibility penuh jika masih dipakai area yang belum disentuh.
- Signature handler yang dibersihkan wajib diikuti update test dan docs.

## Implementation Slices
1. Audit penggunaan riil `temp` di `conversation-state-handler.js` dan sub-handler state prioritas.
2. Hapus `temp` dari call chain yang tidak membutuhkannya.
3. Pindahkan consumer proxy aktif prioritas ke owner APIs eksplisit.
4. Tighten tests untuk memastikan flow aktif tidak lagi bergantung pada proxy compatibility.
5. Sinkronkan docs.

## Verification
- `message/__tests__/conversation-handler-state-store.test.js`
- `message/__tests__/bot-hardening.test.js`
- `message/__tests__/conversation-state-boundary.test.js`
- `message/__tests__/raf-router.test.js`
- test state handler/domain yang disentuh

## Success Criteria
- `conversation-state-handler.js` tidak lagi meneruskan `temp` secara membabi buta.
- Sub-handler prioritas tidak lagi menerima parameter zombie `temp`.
- Consumer aktif prioritas tidak memakai `createScopedStateProxy(...)` untuk flow utama.
- Compatibility proxy makin terisolasi dan state layer lebih eksplisit.
